<script setup>
import Icon from './Icon.vue'
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import CountUp from './CountUp.vue'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import CardsPanel from './CardsPanel.vue'

const props = defineProps({ subject: Object, refreshKey: { default: 0 } })
const emit = defineEmits(['start', 'start-mock', 'goto', 'daily'])

const summary = ref({ total: 0, learned: 0, mastered: 0, today: 0, wrongCount: 0, accuracy: 0, weekAccuracy: 0, weekDelta: 0, streak: 0 })
const dailyGoal = ref(0)
const loading = ref(true)
const dailyPuzzle = ref(null) // { question, state }
const dueReviews = ref(0)
const xpTotal = ref(0)
const examDate = ref('')
const weakPoints = ref([])
const weakAccuracy = ref([])

onMounted(load)
watch(() => props.subject.id, load)
watch(() => props.refreshKey, load) // 切回首页时刷新实时数据

// 首页问候语：按时段切换
const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '夜深了，注意休息'
  if (h < 12) return '早上好，继续加油'
  if (h < 18) return '下午好，保持专注'
  return '晚上好，今天也在进步'
})
const todayStr = computed(() => {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日 ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]}`
})

// 一句话成长总结：本周正确率 + 对比 + 错题数（有数据才显示，无数据给引导）
const growthText = computed(() => {
  if (!summary.value.today && !summary.value.wrongCount) return null
  const acc = summary.value.weekAccuracy
  const delta = summary.value.weekDelta
  const parts = []
  if (summary.value.today > 0) {
    const accTxt = acc > 0 ? `${acc}%` : '—'
    parts.push(`本周正确率 ${accTxt}${delta !== 0 ? (delta > 0 ? ` · 比上周 +${delta}%` : ` · 比上周 ${delta}%`) : ''}`)
  }
  if (summary.value.wrongCount > 0) parts.push(`错题还剩 ${summary.value.wrongCount} 题`)
  return parts.join(' · ')
})

// 考试倒计时（设了考试日显示天数；没设显示引导）
const examLeft = computed(() => {
  if (!examDate.value) return null
  const target = new Date(examDate.value + 'T00:00:00')
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const days = Math.round((target - now) / 86400000)
  return { date: examDate.value, days, over: days < 0 }
})

// 今日刷题进度（目标 KPI 格）
const goalPct = computed(() => dailyGoal.value ? Math.min(100, Math.round((summary.value.today / dailyGoal.value) * 100)) : 0)

let loadSeq = 0 // 防竞态：快速切科目时旧请求晚返回，seq 不匹配则整体丢弃，避免过期数据覆盖
async function load() {
  const seq = ++loadSeq
  loading.value = true
  const sid = props.subject && props.subject.id
  const [sumR, goalR, fsR, cardsR, weakR, accR, puzzleR, dueR, xpR, exR] = await Promise.allSettled([
    tiku.getSummary(sid),
    tiku.getSetting(sid ? `daily_goal_${sid}` : 'daily_goal'),
    tiku.focusStats(),
    tiku.cardsStats(sid),
    tiku.getWeakPoints(5, sid),
    tiku.getCategoryAccuracy(sid),
    tiku.getDailyPuzzle(sid),
    tiku.reviewDueStats(sid),
    tiku.xpStats(),
    tiku.getSetting(sid ? `exam_date_${sid}` : 'exam_date')
  ])
  if (seq !== loadSeq) return // 已被更新的加载取代，丢弃本次结果
  summary.value = sumR.status === 'fulfilled' && sumR.value ? sumR.value : { total: 0, learned: 0, mastered: 0, today: 0, wrongCount: 0, accuracy: 0, weekAccuracy: 0, weekDelta: 0, streak: 0 }
  dailyGoal.value = goalR.status === 'fulfilled' ? Number(goalR.value) || 0 : 0
  // 科目未设目标时回退全局 daily_goal
  if (!dailyGoal.value && sid) {
    try { dailyGoal.value = Number((await tiku.getSetting('daily_goal')) || 0) } catch (e) { dailyGoal.value = 0 }
    if (seq !== loadSeq) return
  }
  if (fsR.status === 'fulfilled' && fsR.value) { focusToday.value = fsR.value.today; focusWeek.value = fsR.value.week }
  if (cardsR.status === 'fulfilled' && cardsR.value) cardStats.value = cardsR.value
  weakPoints.value = weakR.status === 'fulfilled' && Array.isArray(weakR.value) ? weakR.value : []
  weakAccuracy.value = accR.status === 'fulfilled' && Array.isArray(accR.value) ? accR.value.slice(0, 3) : []
  dailyPuzzle.value = puzzleR.status === 'fulfilled' ? puzzleR.value : null
  dueReviews.value = dueR.status === 'fulfilled' && dueR.value ? dueR.value.due || 0 : 0
  xpTotal.value = xpR.status === 'fulfilled' && xpR.value ? (xpR.value.total || 0) : 0
  // 考试日：科目 key 优先，未设置则全局兜底
  examDate.value = exR.status === 'fulfilled' ? (exR.value || '') : ''
  if (!examDate.value && sid) {
    try { examDate.value = (await tiku.getSetting('exam_date')) || '' } catch (e) { examDate.value = '' }
    if (seq !== loadSeq) return
  }
  loading.value = false
}

function startDaily() {
  if (dailyPuzzle.value && dailyPuzzle.value.question) emit('daily', dailyPuzzle.value.question)
}
// 智能复习路由：有到期 → review-due；无到期有错题 → wrong；都无 → 提示
function startSmartReview() {
  if (dueReviews.value > 0) emit('start', { mode: 'review-due' })
  else if (summary.value.wrongCount > 0) emit('start', { mode: 'wrong' })
  else showToast('当前没有到期复习和错题，去刷几道新题吧', 'ok')
}

// ---- 番茄钟 ----
const cardsOpen = ref(false)
const cardStats = ref({ total: 0, due: 0 })
const focusMinutes = ref(25)
const focusLeft = ref(0)
const focusRunning = ref(false)
const focusToday = ref(0)
const focusWeek = ref(0)
const focusPhase = ref('work')   // 'work' 25 分钟 | 'break' 5 分钟（番茄循环）
const pomodoroCount = ref(0)     // 本日完成的番茄数（会话内累计）
const paused = ref(false)
const noiseOn = ref(false)       // 白噪音开关
let focusTimer = null
let noiseCtx = null
let noiseSrc = null

const focusText = computed(() => {
  const m = Math.floor(focusLeft.value / 60)
  const s = focusLeft.value % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})
function startFocus() {
  if (focusRunning.value) return
  focusPhase.value = 'work'
  focusLeft.value = 25 * 60
  focusRunning.value = true
  paused.value = false
  focusTimer = setInterval(tick, 1000)
}
function tick() {
  if (paused.value) return
  focusLeft.value--
  if (focusLeft.value <= 0) phaseComplete()
}
let focusCompleting = false // 防重入：记账 await 期间 tick 再次触发
async function phaseComplete() {
  if (focusCompleting) return
  focusCompleting = true
  try {
    if (focusPhase.value === 'work') {
      pomodoroCount.value++
      try {
        await tiku.addFocusSession(25)
        const fs = await tiku.focusStats()
        focusToday.value = fs.today
      } catch (e) {}
      showToast(`🍅 第 ${pomodoroCount.value} 个番茄完成，+50 XP，休息一下`, 'ok')
      focusPhase.value = 'break'
      focusLeft.value = 5 * 60
    } else {
      focusPhase.value = 'work'
      focusLeft.value = 25 * 60
      showToast(`休息结束，开始第 ${pomodoroCount.value + 1} 个番茄 💪`, 'ok')
    }
  } finally { focusCompleting = false }
}
function pauseFocus() {
  paused.value = !paused.value
}
function skipBreak() {
  if (focusPhase.value === 'break') {
    focusPhase.value = 'work'
    focusLeft.value = 25 * 60
  }
}
async function stopFocus(completed = false) {
  clearInterval(focusTimer)
  focusTimer = null
  focusRunning.value = false
  paused.value = false
  stopNoise()
  if (completed && focusPhase.value === 'work' && !focusCompleting) { // focusCompleting 防与 phaseComplete 并发双记账
    await tiku.addFocusSession(focusMinutes.value)
    const fs = await tiku.focusStats()
    focusToday.value = fs.today
  }
  focusLeft.value = 0
}
// 白噪音：Web Audio 本地生成粉噪（无需外部文件）
function startNoise() {
  if (noiseCtx) return
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    noiseCtx = new AC()
    const size = 2 * noiseCtx.sampleRate
    const buffer = noiseCtx.createBuffer(1, size, noiseCtx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < size; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02 // 一阶低通近似粉噪
      data[i] = last * 3.5
    }
    const src = noiseCtx.createBufferSource()
    src.buffer = buffer
    const gain = noiseCtx.createGain()
    gain.gain.value = 0.05
    src.connect(gain).connect(noiseCtx.destination)
    src.start()
    noiseSrc = src
  } catch (e) { /* 音频不可用则静默 */ }
}
function stopNoise() {
  try { if (noiseSrc) noiseSrc.stop() } catch (e) {}
  try { if (noiseCtx) noiseCtx.close() } catch (e) {}
  noiseSrc = null
  noiseCtx = null
}
function toggleNoise() {
  noiseOn.value = !noiseOn.value
  if (noiseOn.value) startNoise()
  else stopNoise()
}
// 记忆卡复习/增删后刷新首页「到期」角标
async function onCardsUpdated() {
  try {
    const r = await tiku.cardsStats(props.subject.id)
    if (r) cardStats.value = r
  } catch (e) { /* 忽略 */ }
}
onBeforeUnmount(() => {
  if (focusTimer) clearInterval(focusTimer)
  stopNoise()
})
</script>

<template>
  <div class="home">
    <SkeletonCards v-if="loading" :count="3" />

    <template v-else>
      <!-- 顶部问候卡 + 一句话成长总结 -->
      <div class="card greet-card">
        <div class="greet-head">
          <span class="greet-title">{{ greeting }}</span>
          <span class="greet-date">{{ todayStr }}</span>
        </div>
        <div v-if="growthText" class="growth-bar" @click="emit('goto', 'stats')">
          <span class="growth-icon"><Icon name="pulse" :size="14"/></span>
          <span class="growth-text">{{ growthText }}</span>
          <span class="growth-go">看统计 ›</span>
        </div>
        <div v-else class="growth-bar ghost">
          <span class="growth-text">开始刷题，这里会出现你的成长轨迹</span>
        </div>
      </div>

      <!-- 考试倒计时：设了考试日显示天数；没设显示引导（点击去我的页设置） -->
      <div v-if="examLeft" class="card exam-banner" :class="{ soon: examLeft.days >= 0 && examLeft.days <= 7 }">
        <span class="exam-ico"><Icon name="clock" :size="18"/></span>
        <div class="exam-info">
          <div class="exam-name">{{ examLeft.over ? '考试日已过' : '考试倒计时' }}</div>
          <div class="exam-sub">{{ examLeft.date }} · 每天坚持刷题，稳扎稳打</div>
        </div>
        <div class="exam-num" :class="{ over: examLeft.over }">{{ examLeft.over ? '已过' : examLeft.days }}<small v-if="!examLeft.over"> 天</small></div>
      </div>
      <div v-else class="card exam-banner exam-guide" @click="emit('goto', 'profile')">
        <span class="exam-ico"><Icon name="clock" :size="18"/></span>
        <div class="exam-info">
          <div class="exam-name">设置目标考试日</div>
          <div class="exam-sub">在「我的」里设定考试日期，这里显示倒计时</div>
        </div>
        <div class="exam-num guide">去设置 ›</div>
      </div>

      <!-- 主行动区：今日复习 + 每日一题 -->
      <div class="action-row">
        <div class="action-card review" @click="startSmartReview">
          <span class="ac-title">今日复习</span>
          <div class="ac-num-row">
            <span class="ac-num">{{ dueReviews }}</span>
            <span class="ac-unit">题到期</span>
          </div>
          <span class="ac-sub">错题本还剩 {{ summary.wrongCount }} 题 · SM-2 智能排期</span>
          <span class="ac-btn">开始复习</span>
        </div>
        <div class="action-card daily" @click="startDaily" :class="{ disabled: !(dailyPuzzle && dailyPuzzle.question) }">
          <span class="ac-title">每日一题</span>
          <div class="ac-num-row">
            <span class="ac-num">{{ dailyPuzzle && dailyPuzzle.state ? dailyPuzzle.state.streak : 0 }}</span>
            <span class="ac-unit">天连击</span>
          </div>
          <span class="ac-sub">{{ dailyPuzzle && dailyPuzzle.question ? (dailyPuzzle.state.answered ? '今天已答 · 查看解析' : '30 秒搞定，答对攒连击') : '明天再来' }}</span>
          <span class="ac-btn ghost">{{ dailyPuzzle && dailyPuzzle.question && !dailyPuzzle.state.answered ? '去挑战' : '查看' }}</span>
        </div>
      </div>

      <!-- KPI 数据条 -->
      <div class="kpi-strip">
        <div class="kpi-item">
          <span class="kpi-num"><CountUp :value="summary.streak" /></span>
          <span class="kpi-label">连续学习</span>
        </div>
        <div class="kpi-sep"></div>
        <div class="kpi-item">
          <span class="kpi-num">{{ summary.today }}<small v-if="dailyGoal"> / {{ dailyGoal }}</small></span>
          <span class="kpi-label">今日刷题{{ dailyGoal ? ' · 目标' : '' }}</span>
          <div v-if="dailyGoal" class="kpi-bar"><div class="kpi-fill" :style="{ width: goalPct + '%' }"></div></div>
        </div>
        <div class="kpi-sep"></div>
        <div class="kpi-item">
          <span class="kpi-num"><CountUp :value="xpTotal" /></span>
          <span class="kpi-label">累计 XP</span>
        </div>
        <div class="kpi-sep"></div>
        <div class="kpi-item link" @click="emit('goto', 'stats')">
          <span class="kpi-num accent">看足迹</span>
          <span class="kpi-label">热力图</span>
        </div>
      </div>

      <!-- 薄弱点（并入错题本入口，首页保留一条） -->
      <div v-if="weakPoints.length || weakAccuracy.length" class="card weak-card">
        <div class="card-title"><Icon name="info" :size="14"/> 待攻克薄弱点</div>
        <div v-if="weakPoints.length" class="weak-list">
          <div v-for="w in weakPoints" :key="w.id" class="weak-item" @click="emit('goto', 'bank')">
            <span class="weak-stem">{{ w.stem || '（空题干）' }}</span>
            <span class="weak-meta">
              <span class="weak-tag" v-if="w.cat">{{ w.cat }}</span>
              <span class="weak-count">错 {{ w.wrong_count }} 次</span>
            </span>
          </div>
        </div>
        <div v-if="weakAccuracy.length" class="weak-cats">
          <div v-for="a in weakAccuracy" :key="a.cat" class="weak-cat">
            <span class="weak-cat-name">{{ a.cat }}</span>
            <span class="weak-cat-rate" :class="{ low: a.rate < 60 }">正确率 {{ a.rate }}%</span>
          </div>
        </div>
      </div>

      <!-- 番茄专注（单行） -->
      <div class="card focus-bar">
        <span class="fb-ico"><Icon name="clock" :size="16"/></span>
        <div class="fb-info">
          <span class="fb-title">番茄专注</span>
          <span class="fb-sub">今日 {{ focusToday }} 分钟 · 已 {{ pomodoroCount }} 个番茄</span>
        </div>
        <div class="fb-ctrl">
          <span v-if="focusRunning" class="focus-time" :class="{ break: focusPhase === 'break' }">{{ focusText }}</span>
          <button v-if="!focusRunning" class="btn btn-primary" @click="startFocus">25:00 开始</button>
          <template v-else>
            <button class="btn" @click="pauseFocus">{{ paused ? '继续' : '暂停' }}</button>
            <button v-if="focusPhase === 'break'" class="btn" @click="skipBreak">跳过休息</button>
            <button class="btn" @click="stopFocus(false)">停止</button>
          </template>
        </div>
      </div>

      <!-- 更多功能 -->
      <div class="card more-card">
        <div class="card-title">更多功能</div>
        <div class="more-grid">
          <div class="more-item" @click="emit('start', { mode: 'wrong' })">
            <span class="mi-ico wrong"><Icon name="x" :size="16"/></span>
            <span class="mi-main">错题本</span>
            <span class="mi-count">{{ summary.wrongCount }} 题</span>
          </div>
          <div class="more-item" @click="emit('start', { mode: 'favorite' })">
            <span class="mi-ico fav"><Icon name="star" :size="16"/></span>
            <span class="mi-main">收藏复习</span>
          </div>
          <div class="more-item" @click="emit('start', { mode: 'practice' })">
            <span class="mi-ico all"><Icon name="book" :size="16"/></span>
            <span class="mi-main">全部刷题</span>
          </div>
          <div class="more-item" @click="emit('goto', 'kb')">
            <span class="mi-ico kb"><Icon name="doc" :size="16"/></span>
            <span class="mi-main">知识库</span>
          </div>
          <div class="more-item" @click="emit('start-mock')">
            <span class="mi-ico exam"><Icon name="clock" :size="16"/></span>
            <span class="mi-main">模拟考试</span>
          </div>
          <div class="more-item" @click="cardsOpen = true">
            <span class="mi-ico cards"><Icon name="bookmark" :size="16"/></span>
            <span class="mi-main">记忆卡</span>
            <span v-if="cardStats.due > 0" class="mi-count due">{{ cardStats.due }} 到期</span>
          </div>
        </div>
      </div>

      <CardsPanel :show="cardsOpen" :subject="props.subject" @close="cardsOpen = false" @updated="onCardsUpdated" />
    </template>
  </div>
</template>

<style scoped>
.home { display: flex; flex-direction: column; gap: 14px; }

/* 问候卡 + 成长总结 */
.greet-card { padding: 16px; }
.greet-head { display: flex; align-items: baseline; justify-content: space-between; }
.greet-title { font-size: 17px; font-weight: 600; color: var(--text); }
.greet-date { font-size: 12px; color: var(--muted); }
.growth-bar {
  display: flex; align-items: center; gap: 8px;
  margin-top: 12px; padding: 10px 12px;
  background: rgba(91, 124, 250, 0.10);
  border: 1px solid rgba(91, 124, 250, 0.35);
  border-radius: 10px; cursor: pointer; transition: all .15s;
}
.growth-bar:hover { border-color: var(--brand); }
.growth-bar.ghost { background: transparent; border-style: dashed; cursor: default; }
.growth-icon { color: var(--brand); flex-shrink: 0; }
.growth-text { flex: 1; font-size: 13px; color: var(--text); line-height: 1.5; }
.growth-go { font-size: 12px; color: var(--brand); white-space: nowrap; }

/* 考试倒计时横幅 */
.exam-banner {
  display: flex; align-items: center; gap: 14px;
  background: rgba(255, 184, 77, 0.07);
  border: 1px solid rgba(255, 184, 77, 0.4);
  padding: 12px 16px;
}
.exam-banner.soon { border-color: var(--bad); background: rgba(255, 77, 109, 0.08); }
.exam-ico { width: 34px; height: 34px; border-radius: 9px; background: rgba(255, 184, 77, 0.18); color: var(--warn); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.exam-banner.soon .exam-ico { background: rgba(255, 77, 109, 0.18); color: var(--bad); }
.exam-info { flex: 1; min-width: 0; }
.exam-name { font-size: 13px; font-weight: 600; color: var(--text); }
.exam-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
.exam-num { font-size: 26px; font-weight: 600; color: var(--warn); font-variant-numeric: tabular-nums; }
.exam-num small { font-size: 13px; color: var(--muted); }
.exam-banner.soon .exam-num { color: var(--bad); }
.exam-num.over { color: var(--muted); font-size: 16px; }
.exam-num.guide { font-size: 13px; font-weight: 500; color: var(--brand); white-space: nowrap; }
.exam-guide { cursor: pointer; border-style: dashed; }
.exam-guide:hover { border-color: var(--brand); background: rgba(91, 124, 250, 0.08); }

/* 主行动区 */
.action-row { display: flex; gap: 12px; }
.action-card {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--line); border-radius: 12px;
  cursor: pointer; transition: all .15s;
}
.action-card.review { border-color: rgba(91, 124, 250, 0.5); }
.action-card.daily { border-color: var(--line); }
.action-card:hover { box-shadow: var(--glow-soft); }
.action-card.disabled { opacity: .55; cursor: default; }
.ac-title { font-size: 13px; font-weight: 600; color: var(--text); }
.ac-num-row { display: flex; align-items: baseline; gap: 6px; }
.ac-num { font-size: 30px; font-weight: 600; color: var(--brand); line-height: 1.1; font-variant-numeric: tabular-nums; }
.action-card.daily .ac-num { color: var(--warn); }
.ac-unit { font-size: 12px; color: var(--muted); }
.ac-sub { font-size: 12px; color: var(--muted); }
.ac-btn {
  margin-top: 4px; text-align: center;
  background: var(--brand); color: #fff;
  border-radius: 8px; padding: 8px 0; font-size: 13px; font-weight: 600;
}
.ac-btn.ghost { background: rgba(148, 163, 184, 0.12); border: 1px solid rgba(148, 163, 184, 0.3); color: var(--text); }

/* KPI 数据条 */
.kpi-strip {
  display: flex; align-items: stretch; gap: 0;
  border: 1px solid var(--line); border-radius: 14px; padding: 12px 8px;
  background: linear-gradient(135deg, rgba(91, 124, 250, 0.07), rgba(122, 92, 255, 0.04));
}
.kpi-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
.kpi-item.link { cursor: pointer; }
.kpi-sep { width: 1px; background: var(--line); margin: 4px 6px; }
.kpi-num { font-size: 20px; font-weight: 700; color: var(--text); line-height: 1.1; font-variant-numeric: tabular-nums; }
.kpi-num small { font-size: 12px; color: var(--muted); font-weight: 400; }
.kpi-num.accent { color: var(--brand); font-size: 15px; }
.kpi-label { font-size: 11px; color: var(--muted); }
.kpi-bar { height: 4px; border-radius: 2px; background: var(--line); width: 70%; margin-top: 4px; overflow: hidden; }
.kpi-fill { height: 100%; border-radius: 2px; background: var(--brand); transition: width .4s; }

/* 薄弱点 */
.weak-card { display: flex; flex-direction: column; gap: 10px; }
.weak-list { display: flex; flex-direction: column; gap: 8px; }
.weak-item {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
  cursor: pointer; transition: all .15s;
}
.weak-item:hover { border-color: var(--bad); background: rgba(255, 77, 109, 0.06); }
.weak-stem { flex: 1; font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.weak-meta { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.weak-tag { font-size: 10px; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 1px 5px; }
.weak-count { font-size: 11px; color: var(--bad); }
.weak-cats { display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed var(--line); padding-top: 8px; }
.weak-cat { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.weak-cat-name { color: var(--text); }
.weak-cat-rate { color: var(--muted); }
.weak-cat-rate.low { color: var(--bad); font-weight: 600; }

/* 番茄专注单行 */
.focus-bar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
.fb-ico { width: 26px; height: 26px; border-radius: 50%; background: rgba(255, 184, 77, 0.15); color: var(--warn); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.fb-info { flex: 1; min-width: 0; }
.fb-title { font-size: 13px; color: var(--text); }
.fb-sub { font-size: 12px; color: var(--muted); margin-left: 8px; }
.fb-ctrl { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.focus-time { font-size: 18px; font-weight: 600; color: var(--brand); font-variant-numeric: tabular-nums; }
.focus-time.break { color: var(--warn); }

/* 更多功能 */
.more-card { padding: 12px 16px; }
.more-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px; }
.more-item {
  display: flex; align-items: center; gap: 10px;
  padding: 12px; border: 1px solid var(--line); border-radius: 12px;
  cursor: pointer; transition: all .15s; background: rgba(148, 163, 184, 0.05);
}
.more-item:hover { border-color: var(--brand); box-shadow: var(--glow-soft); }
.mi-ico { width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.mi-ico.wrong { background: rgba(255, 77, 109, 0.14); color: var(--bad); }
.mi-ico.fav { background: rgba(244, 114, 182, 0.14); color: #f472b6; }
.mi-ico.all { background: rgba(91, 124, 250, 0.14); color: var(--brand); }
.mi-ico.kb { background: rgba(44, 229, 168, 0.14); color: var(--ok); }
.mi-ico.exam { background: rgba(56, 189, 248, 0.14); color: #38bdf8; }
.mi-ico.cards { background: rgba(167, 139, 250, 0.14); color: #a78bfa; }
.mi-main { flex: 1; font-size: 13px; color: var(--text); }
.mi-count { font-size: 11px; color: var(--muted); }
.mi-count.due { color: var(--warn); font-weight: 600; }
</style>
