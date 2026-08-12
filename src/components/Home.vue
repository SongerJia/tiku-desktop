<script setup>
import Icon from './Icon.vue'
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import CountUp from './CountUp.vue'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import CardsPanel from './CardsPanel.vue'

const props = defineProps({ subject: Object, refreshKey: { default: 0 } })
const emit = defineEmits(['start', 'start-mock', 'goto', 'daily', 'quick'])

const summary = ref({ total: 0, learned: 0, mastered: 0, today: 0, wrongCount: 0, accuracy: 0, weekAccuracy: 0, weekDelta: 0, streak: 0 })
const dailyGoal = ref(0)
const loading = ref(true)
const dailyPuzzle = ref(null) // { question, state }
const dueReviews = ref(0)
const xpTotal = ref(0)
const examDate = ref('')
const weakPoints = ref([])
const weakAccuracy = ref([])
const dailyBrief = ref({ answered: 0, correct: 0, pct: 0, mastered: 0 }) // 昨日小结（问候卡下）

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
// 目标进度环弧长：157 = 2πr(25)，按完成度缩放
const ringOffset = computed(() => 157 - (157 * goalPct.value) / 100)
// 进度环动画：数据加载完成后从空环填充到目标值（精致动效）
const ringAnim = ref(false)
watch(loading, (v) => { if (!v) setTimeout(() => { ringAnim.value = true }, 80) })

// 3D 倾斜（加码 3）：行动台跟随鼠标轻微立体倾斜（perspective 6deg），离开展平
function onDockMove(e) {
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  const px = (e.clientX - r.left) / r.width - 0.5
  const py = (e.clientY - r.top) / r.height - 0.5
  el.style.transform = `perspective(700px) rotateY(${(px * 6).toFixed(2)}deg) rotateX(${(-py * 6).toFixed(2)}deg)`
}
function onDockLeave(e) {
  e.currentTarget.style.transform = ''
}
// 入场动画结束（riseIn fill both 会压制内联 transform）：动画完成后解除压制，3D 倾斜才生效
function onDockAnimEnd(e) {
  if (e.animationName === 'riseIn') e.currentTarget.style.animation = 'none'
}

// 通用 3D 倾斜指令（v-tilt）：任何卡片跟随鼠标立体倾斜，入场动画结束后自动解除压制
// 幅度按元素类型分级：行动台 ±6°，其他区块 ±4°
const vTilt = {
  mounted(el, binding) {
    const max = (binding.value && binding.value.deg) || 4
    el.dataset.tiltBound = '1'
    el.style.transition = 'transform .25s cubic-bezier(.2,.7,.3,1), box-shadow .18s ease, background .15s ease'
    el.style.transformStyle = 'preserve-3d'
    el.style.willChange = 'transform'
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width - 0.5
      const py = (e.clientY - r.top) / r.height - 0.5
      el.style.transform = `perspective(700px) rotateY(${(px * max).toFixed(2)}deg) rotateX(${(-py * max).toFixed(2)}deg)`
    })
    el.addEventListener('mouseleave', () => { el.style.transform = '' })
    el.addEventListener('animationend', (e) => { if (e.animationName === 'riseIn') el.style.animation = 'none' })
  }
}

let loadSeq = 0 // 防竞态：快速切科目时旧请求晚返回，seq 不匹配则整体丢弃，避免过期数据覆盖
async function load() {
  const seq = ++loadSeq
  loading.value = true
  const sid = props.subject && props.subject.id
  const [sumR, goalR, fsR, cardsR, weakR, accR, puzzleR, dueR, xpR, exR, briefR] = await Promise.allSettled([
    tiku.getSummary(sid),
    tiku.getSetting(sid ? `daily_goal_${sid}` : 'daily_goal'),
    tiku.focusStats(),
    tiku.cardsStats(sid),
    tiku.getWeakPoints(5, sid),
    tiku.getCategoryAccuracy(sid),
    tiku.getDailyPuzzle(sid),
    tiku.reviewDueStats(sid),
    tiku.xpStats(),
    tiku.getSetting(sid ? `exam_date_${sid}` : 'exam_date'),
    tiku.getDailyBrief()
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
  if (exR.status === 'fulfilled') examDate.value = exR.value || ''
  if (briefR.status === 'fulfilled' && briefR.value) dailyBrief.value = briefR.value
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
        <!-- 昨日小结（昨日有学习记录时优先显示，替代本周总结条） -->
        <div v-if="dailyBrief.answered > 0" class="brief-bar" @click="emit('goto', 'stats')">
          <span class="growth-icon"><Icon name="check" :size="14"/></span>
          <span class="brief-text">
            昨日小结：刷题 <b>{{ dailyBrief.answered }}</b> 题 · 正确率 <b>{{ dailyBrief.pct }}%</b><template v-if="dailyBrief.mastered"> · 新增掌握 <b>{{ dailyBrief.mastered }}</b></template>
            <span class="brief-sub">今日还有 {{ dueReviews }} 题待复习 ›</span>
          </span>
        </div>
        <div v-else-if="growthText" class="growth-bar" @click="emit('goto', 'stats')">
          <span class="growth-icon"><Icon name="pulse" :size="14"/></span>
          <span class="growth-text">{{ growthText }}</span>
          <span class="growth-go">看统计 ›</span>
        </div>
        <div v-else class="growth-bar ghost">
          <span class="growth-text">开始刷题，这里会出现你的成长轨迹</span>
        </div>
      </div>

      <!-- 复习到期横幅（有到期才显示） -->
      <div v-if="dueReviews > 0" class="review-banner" v-tilt @click="startSmartReview">
        <span class="rb-ico"><Icon name="clock" :size="15"/></span>
        <div class="rb-info">
          <div class="rb-title">{{ dueReviews }} 道错题已到复习期</div>
          <div class="rb-sub">间隔记忆提醒你：现在复习效果最好</div>
        </div>
        <span class="rb-btn">开始复习</span>
      </div>

      <!-- 今日行动台：目标进度环 + 三大行动 -->
      <div class="action-dock" @mousemove="onDockMove" @mouseleave="onDockLeave" @animationend="onDockAnimEnd">
        <div class="dock-ring" :class="{ clickable: !dailyGoal }" @click="dailyGoal ? null : emit('goto', 'profile')">
          <svg viewBox="0 0 60 60" width="88" height="88">
            <circle cx="30" cy="30" r="25" fill="none" stroke="rgba(148,163,184,0.14)" stroke-width="5"/>
            <circle cx="30" cy="30" r="25" fill="none" stroke="var(--brand)" stroke-width="5" stroke-linecap="round" class="ring-anim"
              :stroke-dasharray="'157 157'" :stroke-dashoffset="ringAnim ? ringOffset : 157" transform="rotate(-90 30 30)"/>
            <text x="30" y="28" text-anchor="middle" font-size="13" fill="var(--text)" font-weight="600">{{ dailyGoal ? summary.today + '/' + dailyGoal : '—' }}</text>
            <text x="30" y="43" text-anchor="middle" font-size="10" fill="var(--muted)">今日目标</text>
          </svg>
          <div class="ring-sub">{{ dailyGoal ? '完成 ' + goalPct + '%' : '点此设置目标' }}</div>
        </div>
        <div class="dock-actions">
          <div class="dock-btn review" @click="startSmartReview">
            <div><b>今日复习</b><span class="db-sub">{{ dueReviews }} 题到期 · SM-2 排期</span></div>
            <em>{{ dueReviews }}</em>
          </div>
          <div class="dock-btn daily" @click="startDaily" :class="{ disabled: !(dailyPuzzle && dailyPuzzle.question) }">
            <div><b>每日一题</b><span class="db-sub">{{ dailyPuzzle && dailyPuzzle.question ? (dailyPuzzle.state.answered ? '今天已答 · 查看解析' : '30 秒搞定 · 攒连击') : '明天再来' }}</span></div>
            <em>{{ dailyPuzzle && dailyPuzzle.state ? dailyPuzzle.state.streak : 0 }}</em>
          </div>
          <div class="dock-btn quick" @click="emit('quick')">
            <div><b>3 分钟快刷</b><span class="db-sub">随机 5 题 · 随时开始</span></div>
            <span class="dock-go">开始 ›</span>
          </div>
        </div>
      </div>

      <!-- KPI 数据条 -->
      <div class="kpi-strip" v-tilt>
        <div class="kpi-item">
          <span class="kpi-num"><CountUp :value="summary.streak" /></span>
          <span class="kpi-label">连续学习</span>
        </div>
        <div class="kpi-sep"></div>
        <div class="kpi-item">
          <span class="kpi-num"><CountUp :value="summary.today" /><small v-if="dailyGoal"> / {{ dailyGoal }}</small></span>
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

      <!-- 考试倒计时（压缩单行小条：设了考试日显示天数，没设显示引导） -->
      <div v-if="examLeft" class="exam-mini" @click="emit('goto', 'profile')">
        <span class="em-ico"><Icon name="clock" :size="13"/></span>
        <span class="em-name">{{ examLeft.over ? '考试日已过' : '目标考试日' }} · {{ examLeft.date }}</span>
        <span class="em-num" :class="{ over: examLeft.over }">{{ examLeft.over ? '已过' : examLeft.days + ' 天' }}</span>
      </div>
      <div v-else class="exam-mini guide" @click="emit('goto', 'profile')">
        <span class="em-ico"><Icon name="clock" :size="13"/></span>
        <span class="em-name">设置目标考试日，首页显示倒计时</span>
        <span class="em-num">去设置 ›</span>
      </div>

      <!-- 番茄专注（单行） -->
      <div class="card focus-bar" v-tilt>
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
      <div class="card more-card" v-tilt>
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

      <!-- 薄弱点（沉底：不占首屏，有数据才显示） -->
      <div v-if="weakPoints.length || weakAccuracy.length" class="card weak-card" v-tilt>
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
/* 昨日小结条 */
.brief-bar {
  display: flex; align-items: center; gap: 8px;
  margin-top: 12px; padding: 10px 12px;
  background: rgba(47, 191, 143, 0.08);
  border: 1px solid rgba(47, 191, 143, 0.3);
  border-radius: 10px; cursor: pointer; transition: all .15s;
}
.brief-bar:hover { box-shadow: var(--glow-soft); }
.brief-text { font-size: 12.5px; color: #a8d9c5; }
.brief-text b { color: #bfe8d8; font-weight: 600; }
.brief-sub { color: var(--muted); margin-left: 6px; }
.growth-bar:hover { border-color: var(--brand); }
.growth-bar.ghost { background: transparent; border-style: dashed; cursor: default; }
.growth-icon { color: var(--brand); flex-shrink: 0; }
.growth-text { flex: 1; font-size: 13px; color: var(--text); line-height: 1.5; }
.growth-go { font-size: 12px; color: var(--brand); white-space: nowrap; }

/* 考试倒计时（压缩单行小条：不占首屏主位） */
.exam-mini {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255, 184, 77, 0.06);
  border: 1px solid rgba(255, 184, 77, 0.28);
  border-radius: 10px; padding: 7px 12px; cursor: pointer; transition: all .15s;
}
.exam-mini:hover { border-color: var(--warn); }
.exam-mini.guide { border-style: dashed; }
.em-ico { color: var(--warn); display: flex; flex-shrink: 0; }
.em-name { flex: 1; min-width: 0; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.em-num { font-size: 13px; font-weight: 600; color: var(--warn); flex-shrink: 0; }
.em-num.over { color: var(--muted); }
.exam-mini.guide .em-num { color: var(--brand); }

/* 主行动区 */
/* 复习到期横幅 */
.review-banner {
  display: flex; align-items: center; gap: 10px;
  background: rgba(217, 154, 61, 0.10);
  border: 1px solid rgba(217, 154, 61, 0.45);
  border-radius: 12px; padding: 12px 14px; cursor: pointer; transition: all .15s;
}
.review-banner:hover { box-shadow: var(--glow-soft); }
.rb-ico { color: var(--warn); flex-shrink: 0; display: flex; }
.rb-info { flex: 1; min-width: 0; }
.rb-title { font-size: 14px; font-weight: 600; color: #f0c98a; }
.rb-sub { font-size: 12px; color: var(--muted); }
.rb-btn { flex-shrink: 0; background: var(--warn); color: #1a160e; border-radius: 9px; padding: 7px 14px; font-size: 13px; font-weight: 600; }

/* 今日行动台：目标进度环 + 三大行动 */
.action-dock { display: flex; gap: 14px; transition: transform .25s cubic-bezier(.2, .7, .3, 1); transform-style: preserve-3d; will-change: transform; }
.dock-ring {
  flex: 0 0 108px; min-width: 108px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 6px;
}
.dock-ring.clickable { cursor: pointer; }
.dock-ring.clickable:hover { border-color: var(--brand); }
.ring-sub { font-size: 11px; color: var(--muted); margin-top: 6px; }
.dock-actions { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.dock-btn {
  flex: 1; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 12px 14px; border-radius: 12px; cursor: pointer; transition: all .15s;
}
.dock-btn b { font-size: 15px; font-weight: 600; display: block; }
.db-sub { display: block; margin-top: 3px; font-size: 12px; color: var(--muted); }
.dock-btn em { font-style: normal; font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.dock-btn.review { background: rgba(91, 124, 250, 0.14); border: 1px solid rgba(91, 124, 250, 0.4); }
.dock-btn.review:hover { box-shadow: var(--glow-soft); }
.dock-btn.review b { color: #d6ddf7; }
.dock-btn.review em { color: var(--brand); }
.dock-btn.daily { background: rgba(47, 191, 143, 0.10); border: 1px solid rgba(47, 191, 143, 0.35); }
.dock-btn.daily:hover { box-shadow: var(--glow-soft); }
.dock-btn.daily b { color: #bfe8d8; }
.dock-btn.daily em { color: var(--ok); }
.dock-btn.daily.disabled { opacity: .55; cursor: default; }
.dock-btn.quick { background: var(--card); border: 1px dashed rgba(148, 163, 184, 0.3); }
.dock-btn.quick:hover { border-style: solid; border-color: var(--brand); box-shadow: var(--glow-soft); }
.dock-go { font-size: 12px !important; color: var(--muted); }

/* KPI 数据条 */
.kpi-strip {
  display: flex; align-items: stretch; gap: 0;
  background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 8px;
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

/* ===== 精致化（2026-08-12）：入场 stagger / 问候渐变 / 环动画 / 宫格 hover ===== */
/* 卡片依次浮入（非 .card 元素如 action-dock/kpi-strip 也覆盖） */
.home > * { animation: riseIn .4s cubic-bezier(.2, .7, .3, 1) both; }
.home > *:nth-child(1) { animation-delay: .02s; }
.home > *:nth-child(2) { animation-delay: .06s; }
.home > *:nth-child(3) { animation-delay: .10s; }
.home > *:nth-child(4) { animation-delay: .14s; }
.home > *:nth-child(5) { animation-delay: .18s; }
.home > *:nth-child(6) { animation-delay: .22s; }
.home > *:nth-child(7) { animation-delay: .26s; }
.home > *:nth-child(8) { animation-delay: .30s; }

/* 问候卡：靛蓝渐变打底 + 品牌描边（门面质感） */
.greet-card {
  background: linear-gradient(160deg, rgba(91, 124, 250, 0.12), var(--card) 55%);
  border-color: rgba(91, 124, 250, 0.35);
}

/* 目标进度环：从空环填充到目标值 */
.ring-anim { transition: stroke-dashoffset 1s cubic-bezier(.3, .7, .3, 1); }

/* 更多宫格：hover 抬升 + 亮底 */
.more-item { transition: transform .15s ease, background .15s ease, box-shadow .15s ease; }
.more-item:hover { transform: translateY(-2px); background: rgba(91, 124, 250, 0.08); box-shadow: var(--glow-soft); }

/* ===== 首页审查精修（2026-08-12）：hover 质感统一 + 图标对齐 ===== */
/* 进度环卡：无论是否可点，统一 hover 抬升亮边 */
.dock-ring { transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
.dock-ring:hover { transform: translateY(-2px); box-shadow: var(--glow-soft); border-color: rgba(91, 124, 250, 0.4); }

/* KPI 条 hover 微亮（只增质感，不暗示可点） */
.kpi-strip { transition: box-shadow .18s ease; }
.kpi-strip:hover { box-shadow: var(--glow-soft); }

/* 番茄条 hover 抬升 */
.focus-bar { transition: transform .18s ease, box-shadow .18s ease; }
.focus-bar:hover { transform: translateY(-2px); box-shadow: var(--glow-soft); }

/* 薄弱点行 hover 亮底 */
.weak-item { transition: background .15s ease; border-radius: 8px; }
.weak-item:hover { background: rgba(91, 124, 250, 0.08); }
/* 薄弱点卡标题：Icon 与文字垂直居中 */
.weak-card .card-title { display: flex; align-items: center; gap: 6px; }

/* 成长/小结条 hover 微抬 */
.growth-bar, .brief-bar { transform: translateY(0); }
.growth-bar:hover, .brief-bar:hover { transform: translateY(-1px); box-shadow: var(--glow-soft); }

/* 快刷 hover：箭头转品牌色 */
.dock-btn.quick:hover .dock-go { color: var(--brand); }

/* ===== 首页加码（2026-08-12）：呼吸召唤 / 数字滚动 / 图标微弹 / 双层节奏 ===== */
/* ① 到期横幅：伪元素呼吸光晕（不抢主元素入场动画） */
.review-banner { position: relative; }
.review-banner::after {
  content: ''; position: absolute; inset: -1px; border-radius: inherit;
  border: 1px solid rgba(217, 154, 61, 0.5);
  animation: bannerPulse 2.4s ease-in-out infinite; pointer-events: none;
}
@keyframes bannerPulse { 0%, 100% { opacity: .15; } 50% { opacity: .9; } }

/* ② KPI 进度条：从 0 填充（配合数字滚动） */
.kpi-fill { animation: fillBar .9s cubic-bezier(.3, .7, .3, 1) both; }
@keyframes fillBar { from { width: 0; } }

/* ③ 宫格图标：hover 微弹 */
.mi-ico { transition: transform .18s cubic-bezier(.3, .7, .3, 1); }
.more-item:hover .mi-ico { transform: translateY(-2px) scale(1.08); }

/* ④ 行动按钮：父卡入场后逐个弹出（双层节奏） */
.dock-actions > * { animation: riseIn .38s cubic-bezier(.2, .7, .3, 1) both; }
.dock-actions > *:nth-child(1) { animation-delay: .10s; }
.dock-actions > *:nth-child(2) { animation-delay: .15s; }
.dock-actions > *:nth-child(3) { animation-delay: .20s; }

/* ⑤ 问候卡：更浓渐变 + 顶部高光线 */
.greet-card {
  background: linear-gradient(160deg, rgba(91, 124, 250, 0.16), var(--card) 60%);
  border-color: rgba(91, 124, 250, 0.45);
  position: relative; overflow: hidden;
}
.greet-card::before {
  content: ''; position: absolute; top: 0; left: 10%; right: 10%;
  height: 1px; background: linear-gradient(90deg, transparent, rgba(91, 124, 250, 0.65), transparent);
}

/* ⑥ 日期胶囊化 */
.greet-date {
  font-size: 11px; color: var(--muted);
  background: rgba(148, 163, 184, 0.1); border: 1px solid var(--line);
  border-radius: 999px; padding: 3px 10px;
}

/* ⑦ 看足迹 hover 加深 */
.kpi-item.link:hover .kpi-num { color: var(--brand-dark); }
.kpi-item.link:hover .kpi-label { color: var(--brand); }

/* ===== 加码 2（2026-08-12）：数字弹入 / hover 彩色光晕描边 ===== */
/* KPI 数字：加载弹入（scale .85 → 1） */
.kpi-num { animation: numPop .45s cubic-bezier(.2, .7, .3, 1) both; }
@keyframes numPop { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: scale(1); } }

/* 行动按钮 hover：彩色光晕描边（品牌色晕 + 1px 亮边，质感拉满） */
.dock-btn.review:hover { box-shadow: 0 6px 22px rgba(91, 124, 250, 0.35), 0 0 0 1px rgba(91, 124, 250, 0.5); }
.dock-btn.daily:hover { box-shadow: 0 6px 22px rgba(47, 191, 143, 0.28), 0 0 0 1px rgba(47, 191, 143, 0.45); }
.dock-btn.quick:hover { box-shadow: 0 6px 22px rgba(91, 124, 250, 0.3), 0 0 0 1px rgba(91, 124, 250, 0.4); }
.more-item:hover { box-shadow: var(--glow-soft), 0 0 0 1px rgba(91, 124, 250, 0.3); }

/* ===== 实验：hover 流光描边（2026-08-12，用户好奇项，不合适可回退）===== */
/* @property --ang 已移 style.css 全局注册 */
.dock-btn { position: relative; }
.dock-btn::after {
  content: ''; position: absolute; inset: -1px; border-radius: inherit;
  padding: 1px;
  background: conic-gradient(from var(--ang), transparent 0deg, rgba(91, 124, 250, 0.85) 80deg, transparent 170deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0; pointer-events: none; transition: opacity .18s;
}
.dock-btn:hover::after { opacity: 1; animation: angSpin 2.2s linear infinite; }
@keyframes angSpin { to { --ang: 360deg; } }

/* 更多宫格也挂流光（复用 --ang，hover 光点绕边框转） */
.more-item { position: relative; }
.more-item::after {
  content: ''; position: absolute; inset: -1px; border-radius: inherit;
  padding: 1px;
  background: conic-gradient(from var(--ang), transparent 0deg, rgba(91, 124, 250, 0.7) 80deg, transparent 170deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0; pointer-events: none; transition: opacity .18s;
}
.more-item:hover::after { opacity: 1; animation: angSpin 2.2s linear infinite; }
</style>
