<script setup>
import Icon from './Icon.vue'
import { ref, computed, onMounted, watch, onBeforeUnmount } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import CountUp from './CountUp.vue'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import ReviewPanel from './ReviewPanel.vue'
import CardsPanel from './CardsPanel.vue'

const props = defineProps({ subject: Object, refreshKey: { default: 0 } })
const emit = defineEmits(['start', 'start-mock', 'goto', 'daily'])

const summary = ref({ total: 0, learned: 0, mastered: 0, today: 0, wrongCount: 0 })
const dailyGoal = ref(0)
const loading = ref(true)
// 欢迎卡仅首次启动显示（localStorage 标记，本机偏好不进云）
const showWelcome = ref(false)
// 每日一题：{ question, state } state: { date, qid, answered, correct, streak, bestStreak, period }
const dailyPuzzle = ref(null)
const dailyAnalysisOpen = ref(false)
// 今日任务单：到期复习 / 每日一题 / 今日目标 / 未读文档
const dueReviews = ref(0)
const kbUnread = ref(0)
// 番茄专注（工具，留在首页）
const focusWeek = ref(0)
const weakPoints = ref([])
const weakAccuracy = ref([])

onMounted(() => { load(); checkWelcome() })
watch(() => props.subject.id, load)
watch(() => props.refreshKey, load) // 切回首页时刷新实时数据

function checkWelcome() {
  try {
    showWelcome.value = !localStorage.getItem('tiku_welcome_shown')
  } catch (e) { showWelcome.value = false }
}
function dismissWelcome() {
  showWelcome.value = false
  try { localStorage.setItem('tiku_welcome_shown', '1') } catch (e) {}
}

// 学习数据折叠卡已移除：全局数据搬统计页，首页只留薄弱点（科目）
const goalPct = computed(() => dailyGoal.value ? Math.min(100, Math.round((summary.value.today / dailyGoal.value) * 100)) : 0)

// 今日任务单：按优先级聚合可点击任务（实时判定，完成即消失）
const taskItems = computed(() => {
  const items = []
  // 1) 到期错题复习（最紧急）
  if (dueReviews.value > 0) {
    items.push({ key: 'review', name: `复习 ${dueReviews.value} 道到期错题`, desc: '约 1 分钟 · 智能复习排期已到', urgent: true, run: () => emit('start', { mode: 'review-due' }) })
  }
  // 2) 每日一题（未答）
  if (dailyPuzzle.value && dailyPuzzle.value.question && !dailyPuzzle.value.state.answered) {
    items.push({ key: 'daily', name: '每日一题 · 今天还没做', desc: '答对攒连击，保持节奏', hot: true, run: () => startDaily() })
  }
  // 3) 今日目标剩余
  const remain = dailyGoal.value > 0 ? Math.max(0, dailyGoal.value - summary.value.today) : 0
  if (dailyGoal.value > 0 && remain > 0) {
    items.push({ key: 'quiz', name: `今日还差 ${remain} 题`, desc: `目标 ${dailyGoal.value} 题 · 已刷 ${summary.value.today}`, warm: true, run: () => emit('start', { mode: 'practice' }) })
  } else if (!dailyGoal.value && summary.value.today === 0) {
    items.push({ key: 'quiz', name: '今天还没刷题', desc: '刷几道保持手感（「我的」可设每日目标）', warm: true, run: () => emit('start', { mode: 'practice' }) })
  }
  // 4) 未读文档
  if (kbUnread.value > 0) {
    items.push({ key: 'kb', name: `有 ${kbUnread.value} 篇文档待读`, desc: '知识库新增未读内容', cool: true, run: () => emit('goto', 'kb') })
  }
  return items
})

// 每日回顾 + 番茄钟
const reviewOpen = ref(false)
const cardsOpen = ref(false)
const cardStats = ref({ total: 0, due: 0 })
const focusMinutes = ref(25)
const focusLeft = ref(0)
const focusRunning = ref(false)
const focusToday = ref(0)
const focusPhase = ref('work')   // 'work' 25 分钟 | 'break' 5 分钟（番茄循环）
const pomodoroCount = ref(0)     // 本日完成的番茄数（会话内累计）
const paused = ref(false)
const noiseOn = ref(false)       // 白噪音开关
let focusTimer = null
let noiseCtx = null
let noiseSrc = null

async function load() {
  loading.value = true
  summary.value = await tiku.getSummary(props.subject.id)
  try { dailyGoal.value = Number(await tiku.getSetting('daily_goal')) || 0 } catch (e) { dailyGoal.value = 0 }
  try { const fs = await tiku.focusStats(); focusToday.value = fs.today; focusWeek.value = fs.week } catch (e) { focusToday.value = 0 }
  try { cardStats.value = await tiku.cardsStats() } catch (e) {}
  try { weakPoints.value = await tiku.getWeakPoints(5, props.subject.id) } catch (e) { weakPoints.value = [] }
  try { weakAccuracy.value = (await tiku.getCategoryAccuracy(props.subject.id)).slice(0, 3) } catch (e) { weakAccuracy.value = [] }
  try { dailyPuzzle.value = await tiku.getDailyPuzzle(props.subject.id) } catch (e) { dailyPuzzle.value = null }
  try { dueReviews.value = (await tiku.reviewDueStats(props.subject.id)).due || 0 } catch (e) { dueReviews.value = 0 }
  try { kbUnread.value = (await tiku.kbStats()).unread || 0 } catch (e) { kbUnread.value = 0 }
  dailyAnalysisOpen.value = false
  loading.value = false
}

function typeLabel(t) {
  return ({ single: '单选题', multiple: '多选题', judge: '判断题', essay: '问答题' })[t] || t || '未知'
}
function startDaily() {
  if (dailyPuzzle.value && dailyPuzzle.value.question) emit('daily', dailyPuzzle.value.question)
}

// 番茄钟
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
async function phaseComplete() {
  if (focusPhase.value === 'work') {
    // 完成一个番茄：记账 25 分钟，进入 5 分钟休息（自动衔接下一轮）
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
    // 休息结束自动开始下一轮
    focusPhase.value = 'work'
    focusLeft.value = 25 * 60
    showToast(`休息结束，开始第 ${pomodoroCount.value + 1} 个番茄 💪`, 'ok')
  }
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
  if (completed && focusPhase.value === 'work') {
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
    src.loop = true
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
onBeforeUnmount(() => {
  if (focusTimer) clearInterval(focusTimer)
  stopNoise()
})
</script>

<template>
  <div class="home">
    <!-- 欢迎卡片（仅首次启动显示） -->
    <div v-if="showWelcome" class="card welcome">
      <div class="welcome-text">
        <div class="subtitle">基于艾宾浩斯记忆曲线，科学记忆，高效备考</div>
        <h1>欢迎来到<br>知识记忆小助手</h1>
        <div class="welcome-actions">
          <button class="btn btn-primary" @click="$emit('start', { mode: 'practice' }); dismissWelcome()">立即开始</button>
          <button class="btn ghost" @click="dismissWelcome">开始探索</button>
        </div>
      </div>
      <div class="welcome-illustration">
        <svg viewBox="0 0 120 100" width="110" height="92">
          <rect x="10" y="40" width="70" height="50" rx="8" fill="#0a1a26" stroke="#1c6f7d" stroke-width="1.5" />
          <rect x="25" y="25" width="70" height="50" rx="8" fill="#150f33" stroke="#7b46c4" stroke-width="1.5" />
          <rect x="40" y="10" width="70" height="50" rx="8" fill="#0c2230" stroke="#5b7cfa" stroke-width="2" />
          <circle cx="95" cy="25" r="14" fill="none" stroke="#5b7cfa" stroke-width="1.5" opacity="0.7" />
          <path d="M95 11 L98 21 L108 21 L100 27 L103 37 L95 31 L87 37 L90 27 L82 21 L92 21 Z" fill="#5b7cfa" />
        </svg>
      </div>
    </div>

    <!-- 统计条：一行四个核心数字 + 今日目标进度 -->
    <div class="stat-strip">
      <div class="stat-item">
        <span class="stat-num"><CountUp :value="summary.total" /></span>
        <span class="stat-label">知识卡片</span>
      </div>
      <div class="stat-sep"></div>
      <div class="stat-item">
        <span class="stat-num" :class="{ on: summary.today > 0 }"><CountUp :value="summary.today" /></span>
        <span class="stat-label">今日已刷</span>
      </div>
      <div class="stat-sep"></div>
      <div class="stat-item">
        <span class="stat-num" :class="{ bad: summary.wrongCount > 0 }"><CountUp :value="summary.wrongCount" /></span>
        <span class="stat-label">错题</span>
      </div>
      <div class="stat-sep"></div>
      <div class="stat-item">
        <span class="stat-num ok"><CountUp :value="summary.mastered || 0" /></span>
        <span class="stat-label">已掌握</span>
      </div>
      <div v-if="dailyGoal" class="stat-goal">
        <div class="stat-goal-top">
          <span class="stat-goal-label">今日目标 {{ Math.min(summary.today, dailyGoal) }} / {{ dailyGoal }} 题</span>
          <span class="stat-goal-pct">{{ goalPct }}%</span>
        </div>
        <div class="stat-goal-bar"><div class="stat-goal-fill" :style="{ width: goalPct + '%' }"></div></div>
      </div>
    </div>

    <!-- 空题库引导 -->
    <div v-if="!loading && summary.total === 0" class="card empty-guide">
      <p class="eg-title">题库还是空的，先导入一批题开始吧</p>
      <p class="eg-sub">支持 CSV / Excel / JSON 批量导入（我的 → 题库管理），或用内置样题直接体验</p>
    </div>

    <!-- 今日任务单（行动中心：到期复习/每日一题/今日目标/待读文档） -->
    <div v-if="!loading && taskItems.length" class="card task-card">
      <div class="task-head">
        <span class="task-title">今日任务单</span>
        <span class="task-badge">{{ taskItems.length }} 项待完成</span>
      </div>
      <div class="task-list">
        <div
          v-for="t in taskItems"
          :key="t.key"
          class="task-item"
          :class="{ urgent: t.urgent, hot: t.hot, warm: t.warm, cool: t.cool }"
          @click="t.run"
        >
          <span class="task-ico">{{ t.urgent ? '!' : t.hot ? '?' : t.warm ? '+' : 'M' }}</span>
          <div class="task-info">
            <p class="task-name">{{ t.name }}</p>
            <p class="task-desc">{{ t.desc }}</p>
          </div>
          <span class="task-arrow">›</span>
        </div>
      </div>
    </div>

    <!-- 快捷启动：三个主行动按钮 -->
    <div v-if="!loading && summary.total > 0" class="card launch-card">
      <div class="launch-row">
        <button class="launch-btn primary" @click="$emit('start', { mode: 'practice' })">
          <span class="lb-ico"><Icon name="book" :size="18"/></span>
          <span class="lb-main">开始练习</span>
          <span class="lb-sub">随机刷题保持手感</span>
        </button>
        <button class="launch-btn warn" :class="{ hot: dueReviews > 0 }" @click="$emit('start', { mode: 'review-due' })">
          <span class="lb-ico"><Icon name="pulse" :size="18"/></span>
          <span class="lb-main">错题复习</span>
          <span class="lb-sub">{{ dueReviews > 0 ? dueReviews + ' 道到期' : '智能排期' }}</span>
        </button>
        <button class="launch-btn accent" @click="startDaily" :disabled="!(dailyPuzzle && dailyPuzzle.question)">
          <span class="lb-ico"><Icon name="star" :size="18"/></span>
          <span class="lb-main">每日一题</span>
          <span class="lb-sub">{{ dailyPuzzle && dailyPuzzle.question ? (dailyPuzzle.state.answered ? '已答 · 查看' : '开始作答') : '明天再来' }}</span>
        </button>
      </div>
    </div>

    <!-- 薄弱点（当前科目） -->
    <div v-if="!loading && (weakPoints.length || weakAccuracy.length)" class="card weak-card">
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
      <div v-if="!weakPoints.length && !weakAccuracy.length" class="weak-empty">暂无薄弱点，继续保持！</div>
    </div>

    <!-- 每日回顾 + 番茄专注（专注概览已并入） -->
    <div class="card duo-card">
      <div class="duo-row">
        <div class="duo-left" @click="reviewOpen = true">
          <span class="duo-title"><Icon name="pulse" :size="14"/> 每日回顾</span>
          <span class="duo-sub">主动回忆 · 对抗遗忘</span>
        </div>
        <div class="duo-right">
          <span class="duo-title">
            <Icon name="clock" :size="14"/>
            <template v-if="!focusRunning">番茄专注 · 25+5 循环</template>
            <template v-else>{{ focusPhase === 'work' ? `🍅 第 ${pomodoroCount + 1} 轮 · 工作中` : '☕ 休息中 · 5 分钟' }}</template>
          </span>
          <div class="focus-ctrl">
            <span v-if="focusRunning" class="focus-time" :class="{ break: focusPhase === 'break' }">{{ focusText }}</span>
            <button v-if="!focusRunning" class="btn btn-primary" @click="startFocus">开始</button>
            <template v-else>
              <button class="btn" @click="pauseFocus">{{ paused ? '继续' : '暂停' }}</button>
              <button v-if="focusPhase === 'break'" class="btn" @click="skipBreak">跳过休息</button>
              <button class="btn" @click="stopFocus(false)">停止</button>
            </template>
            <button class="btn noise-btn" :class="{ on: noiseOn }" @click="toggleNoise">🎧 白噪音</button>
          </div>
          <span class="duo-sub">今日 {{ focusToday }} 分钟 · 本周 {{ focusWeek }} 分钟 · 已 {{ pomodoroCount }} 个番茄</span>
        </div>
      </div>
    </div>

    <!-- 更多功能 -->
    <div class="card more-card">
      <div class="card-title">更多功能</div>
      <div class="more-grid">
        <div class="more-item" @click="$emit('start', { mode: 'wrong' })">
          <span class="mi-ico wrong"><Icon name="x" :size="16"/></span>
          <span class="mi-main">错题本</span>
          <span class="mi-count">{{ summary.wrongCount }} 题</span>
        </div>
        <div class="more-item" @click="$emit('start', { mode: 'favorite' })">
          <span class="mi-ico fav"><Icon name="star" :size="16"/></span>
          <span class="mi-main">收藏复习</span>
        </div>
        <div class="more-item" @click="$emit('start', { mode: 'practice' })">
          <span class="mi-ico all"><Icon name="book" :size="16"/></span>
          <span class="mi-main">全部刷题</span>
        </div>
        <div class="more-item" @click="$emit('goto', 'kb')">
          <span class="mi-ico kb"><Icon name="doc" :size="16"/></span>
          <span class="mi-main">知识库</span>
        </div>
        <div class="more-item" @click="$emit('start-mock')">
          <span class="mi-ico exam"><Icon name="clock" :size="16"/></span>
          <span class="mi-main">模拟考试</span>
        </div>
        <div class="more-item" @click="cardsOpen = true">
          <span class="mi-ico cards"><Icon name="bookmark" :size="16"/></span>
          <span class="mi-main">单词卡</span>
          <span v-if="cardStats.due > 0" class="mi-count due">{{ cardStats.due }} 到期</span>
        </div>
      </div>
    </div>
    <SkeletonCards v-if="loading" :count="3" />

    <ReviewPanel :show="reviewOpen" @close="reviewOpen = false" />
    <CardsPanel :show="cardsOpen" @close="cardsOpen = false" />
  </div>
</template>

<style scoped>
.welcome {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background:
    radial-gradient(circle at 90% 15%, rgba(122, 92, 255, 0.20), transparent 60%),
    linear-gradient(135deg, rgba(91, 124, 250, 0.10), rgba(122, 92, 255, 0.06));
  border-color: rgba(91, 124, 250, 0.30);
  box-shadow: var(--glow-soft), var(--shadow);
}
.welcome-text { flex: 1; }
.welcome-text h1 { font-size: 22px; line-height: 1.3; margin: 8px 0 14px 0; color: var(--text); text-shadow: var(--glow-soft); }
.welcome-text .subtitle { font-size: 12px; color: var(--muted); }
.welcome-illustration { flex-shrink: 0; filter: drop-shadow(0 0 8px rgba(91, 124, 250, 0.35)); }

.stat-card { display: flex; flex-direction: column; gap: 8px; }
.stat-title { font-size: 15px; font-weight: 600; color: var(--text); }
.stat-number { display: flex; align-items: baseline; gap: 6px; }
.stat-number .num { font-size: 40px; font-weight: 700; color: var(--brand); line-height: 1; text-shadow: var(--glow); }
.stat-number .unit { font-size: 14px; color: var(--muted); }

.goal-card { display: flex; flex-direction: column; gap: 8px; }
.goal-top { display: flex; align-items: center; justify-content: space-between; }
.goal-label { font-size: 14px; font-weight: 600; color: var(--text); }
.goal-num { font-size: 13px; color: var(--brand); font-weight: 600; }
.goal-bar { height: 8px; background: rgba(255,255,255,.06); border-radius: 6px; overflow: hidden; }
.goal-fill { height: 100%; background: linear-gradient(90deg, var(--brand), var(--brand2, #7b46c4)); border-radius: 6px; transition: width .4s; box-shadow: var(--glow-soft); }
.goal-sub { font-size: 12px; color: var(--muted); }

.empty-guide { border-color: var(--warn); background: rgba(255, 180, 84, 0.06); display: flex; flex-direction: column; gap: 6px; }
.eg-title { font-size: 14px; font-weight: 600; color: var(--warn); margin: 0; }
.eg-sub { font-size: 12px; color: var(--muted); margin: 0; }

/* 每日任务 */
.quest-xp { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 6px; }
.quest-claimed { font-size: 12px; color: var(--ok); margin-bottom: 8px; }
.quest-list { display: flex; flex-direction: column; gap: 8px; }
.quest-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 9px 12px;
  cursor: pointer;
  transition: border-color .2s;
}
.quest-item:hover { border-color: var(--brand); }
.quest-item.done { border-color: rgba(44, 229, 168, 0.4); background: rgba(44, 229, 168, 0.05); }
.quest-check { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--muted); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; color: var(--muted); }
.quest-item.done .quest-check { border-color: var(--ok); color: var(--ok); }
.quest-name { flex: 1; font-size: 13px; color: var(--text); }
.quest-state { font-size: 11px; color: var(--muted); }
.quest-item.done .quest-state { color: var(--ok); }

/* 习惯打卡 */
.habit-list { display: flex; flex-direction: column; gap: 6px; }
.habit-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  cursor: pointer;
}
.habit-item.done { border-color: rgba(44, 229, 168, 0.4); background: rgba(44, 229, 168, 0.05); }
.habit-icon { font-size: 16px; }
.habit-name { flex: 1; font-size: 13px; color: var(--text); }
.habit-streak { font-size: 11px; color: var(--warn); }
.habit-check { font-size: 16px; color: var(--muted); }
.habit-item.done .habit-check { color: var(--ok); }
.habit-empty { font-size: 12px; color: var(--muted); line-height: 1.7; }
.habit-week { display: inline-flex; gap: 3px; align-items: center; }
.habit-week i { width: 6px; height: 6px; border-radius: 50%; background: rgba(148, 163, 184, 0.25); }
.habit-week i.on { background: var(--ok); box-shadow: 0 0 4px rgba(47, 191, 143, 0.5); }
.habit-check .hollow { display: inline-block; width: 12px; height: 12px; border: 1.5px solid var(--line); border-radius: 50%; }

/* 每日回顾 + 专注 */
.duo-row { display: flex; gap: 14px; }
.duo-block {
  flex: 1;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.duo-left {
  flex: 1;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.duo-left:hover { border-color: var(--brand); }
.duo-right {
  flex: 1;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.duo-title { font-size: 13px; font-weight: 600; color: var(--text); }
.duo-sub { font-size: 11px; color: var(--muted); }
.focus-ctrl { display: flex; align-items: center; gap: 8px; }
.focus-time { font-size: 20px; font-weight: 600; color: var(--brand); font-variant-numeric: tabular-nums; }
.focus-time.break { color: var(--warn); }
.noise-btn { font-size: 12px; padding: 5px 10px; }
.noise-btn.on { background: rgba(44, 229, 168, 0.14); color: var(--ok); border-color: rgba(44, 229, 168, 0.4); }

.shortcuts .shortcut-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.shortcut {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 4px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: all .2s;
}
.shortcut:hover { background: var(--brand-light); border-color: var(--brand); box-shadow: var(--glow-soft); }
.s-icon {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: #021018;
}
.s-icon.wrong { background: var(--bad); box-shadow: 0 0 10px rgba(255, 77, 109, 0.55); }
.s-icon.fav { background: var(--warn); box-shadow: 0 0 10px rgba(255, 180, 84, 0.55); }
.s-icon.all { background: var(--brand); box-shadow: var(--glow); }
.s-icon.today { background: var(--ok); box-shadow: 0 0 10px rgba(44, 229, 168, 0.55); }
.s-label { font-size: 12px; color: var(--text); }
.s-count { font-size: 11px; color: var(--muted); }
.shortcut.no-click { cursor: default; }
.shortcut.no-click:hover { background: rgba(255, 255, 255, 0.02); border-color: var(--line); box-shadow: none; }

.mock-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background:
    radial-gradient(circle at 12% 50%, rgba(255, 193, 84, 0.16), transparent 55%),
    linear-gradient(135deg, rgba(91, 124, 250, 0.08), rgba(255, 193, 84, 0.06));
  border-color: rgba(255, 193, 84, 0.30);}
.mock-entry .me-text { flex: 1; }
.me-title { font-size: 16px; font-weight: 700; color: var(--text); }
.me-badge { font-size: 10px; font-weight: 500; color: var(--warn); border: 1px solid rgba(217, 154, 61, 0.4); border-radius: 8px; padding: 0 6px; vertical-align: 2px; }
.me-sub { font-size: 12px; color: var(--muted); margin-top: 4px; line-height: 1.5; }
.mock-entry .btn { flex: 0 0 auto; }

/* 近 7 天学习趋势 */
.trend-card { display: flex; flex-direction: column; gap: 10px; }
.trend-svg { width: 100%; height: auto; display: block; }
.trend-x { font-size: 11px; fill: var(--muted); }
.trend-x.on { fill: var(--brand); font-weight: 700; }
.trend-v { font-size: 10px; fill: var(--text); font-weight: 600; }

/* 待攻克薄弱点 */
.weak-card { display: flex; flex-direction: column; gap: 10px; }
.weak-list { display: flex; flex-direction: column; gap: 8px; }
.weak-item {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm);
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
.weak-empty { font-size: 12px; color: var(--muted); }

/* 学习日历热力图（GitHub 风格） */
.heat-card { max-width: 100%; }
.heat-streak { margin-left: auto; font-size: 12px; color: var(--brand); font-weight: 600; }
/* 左右并排（duo 容器）时热力图紧凑化 */
.duo-block .duo-title { display: flex; align-items: center; gap: 4px; }
.duo-block .heat-streak { font-size: 11px; }
.duo-block .heat-grid {
  grid-template-rows: repeat(7, 10px);
  grid-auto-columns: 10px;
}
.duo-block .heat-cell { width: 10px; height: 10px; }
.heat-grid {
  display: grid;
  grid-template-rows: repeat(7, 12px);
  grid-auto-flow: column;
  grid-auto-columns: 12px;
  gap: 3px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.heat-cell { width: 12px; height: 12px; border-radius: 3px; background: var(--line); transition: transform .12s ease; }
.heat-cell:hover { transform: scale(1.25); }
.heat-cell.lvl-0 { background: var(--line); }
.heat-cell.lvl-1 { background: rgba(91,124,250,0.35); }
.heat-cell.lvl-2 { background: rgba(91,124,250,0.6); }
.heat-cell.lvl-3 { background: rgba(91,124,250,0.84); }
.heat-cell.lvl-4 { background: var(--brand); }
.heat-legend { display: flex; align-items: center; gap: 4px; margin-top: 8px; font-size: 11px; color: var(--muted); }
.heat-legend .heat-cell { cursor: default; }
.lg-text { margin: 0 2px; }

/* 考试倒计时 */
.exam-count-card { display: flex; flex-direction: column; gap: 6px; }
.exam-count-top { display: flex; align-items: center; justify-content: space-between; }
.exam-count-label { font-size: 13px; font-weight: 600; color: var(--text); }
.exam-count-num { font-size: 22px; font-weight: 800; color: var(--brand); }
.exam-count-num small { font-size: 12px; font-weight: 500; color: var(--muted); }
.exam-count-num.soon { color: var(--bad); animation: blink 1s steps(2) infinite; }
.exam-count-sub { font-size: 12px; color: var(--muted); }
@keyframes blink { 50% { opacity: .55; } }

/* 专注概览 */
.focus-sum-card { display: flex; flex-direction: column; gap: 8px; }
.focus-nums { display: flex; gap: 18px; }
.fn-item { display: flex; flex-direction: column; }
.fn-item b { font-size: 18px; color: var(--brand); }
.fn-item small { font-size: 11px; color: var(--muted); }
.focus-bar { height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; }
.focus-fill { height: 100%; border-radius: 999px; background: var(--brand); transition: width .4s ease; }
.focus-sub { font-size: 11px; color: var(--muted); }

/* 每日一题 + 连击 */
.daily-card { display: flex; flex-direction: column; gap: 8px; border: 1px solid rgba(91, 124, 250, 0.35); }
.daily-head { display: flex; align-items: center; justify-content: space-between; }
.daily-title { font-size: 14px; font-weight: 600; color: var(--text); }
.daily-streak { font-size: 12px; color: var(--warn); font-weight: 600; }
.daily-streak.muted { color: var(--muted); font-weight: 400; }
.daily-tags { display: flex; gap: 6px; }
.daily-tag { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 1px 7px; }
.daily-stem { font-size: 14px; line-height: 1.6; color: var(--text); margin: 2px 0 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.daily-note { font-size: 11px; color: var(--muted); }
.daily-result { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 8px 12px; border-radius: 8px; }
.daily-result.ok { background: rgba(44, 229, 168, 0.1); color: var(--ok); }
.daily-result.bad { background: rgba(255, 77, 109, 0.1); color: var(--bad); }
.daily-best { margin-left: auto; font-size: 11px; color: var(--muted); }
.daily-actions { display: flex; gap: 10px; }
.daily-analysis { font-size: 13px; color: var(--text); background: var(--bg-soft, rgba(127, 127, 127, 0.06)); border: 1px dashed var(--line); border-radius: 8px; padding: 10px 12px; line-height: 1.7; }
.daily-analysis b { color: var(--brand); }
.ans-line { margin-bottom: 4px; }

/* 目标契约 */
.goal-c-card { display: flex; flex-direction: column; gap: 8px; border: 1px solid rgba(255, 165, 42, 0.3); }
.goal-c-head { display: flex; align-items: center; justify-content: space-between; }
.goal-c-title { font-size: 14px; font-weight: 600; color: var(--text); }
.goal-c-badge { font-size: 12px; color: var(--warn); border: 1px solid rgba(255, 165, 42, 0.4); border-radius: 999px; padding: 2px 10px; }
.goal-c-badge.done { color: var(--ok); border-color: rgba(44, 229, 168, 0.4); }
.goal-c-miss { font-size: 12px; color: var(--muted); background: rgba(255, 165, 42, 0.08); border-radius: 8px; padding: 6px 10px; }
.goal-c-bar { height: 8px; border-radius: 999px; background: var(--line); overflow: hidden; }
.goal-c-fill { height: 100%; border-radius: 999px; background: var(--warn); transition: width .4s ease; }
.goal-c-meta { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); }
.goal-c-claim-row { margin-top: 2px; }
.goal-c-claimed { font-size: 12px; color: var(--ok); }
.goal-c-label { font-size: 13px; color: var(--text); margin: 2px 0 0; }
.goal-c-chips { display: flex; gap: 8px; }
.goal-c-chip { font-size: 12px; padding: 5px 14px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; transition: all .15s; }
.goal-c-chip.on { background: rgba(255, 165, 42, 0.15); color: var(--warn); border-color: rgba(255, 165, 42, 0.45); font-weight: 600; }
.goal-c-row { display: flex; align-items: center; gap: 8px; }
.goal-c-row .input { flex: 1; }
.goal-c-unit { font-size: 12px; color: var(--muted); }

/* 今日任务单 */
.task-card { display: flex; flex-direction: column; gap: 10px; border: 1px solid rgba(91, 124, 250, 0.25); }
.task-head { display: flex; align-items: center; justify-content: space-between; }
.task-title { font-size: 14px; font-weight: 600; color: var(--text); }
.task-badge { font-size: 12px; color: var(--brand); border: 1px solid rgba(91, 124, 250, 0.35); border-radius: 999px; padding: 2px 10px; }
.task-list { display: flex; flex-direction: column; gap: 8px; }
.task-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  border: 1px solid var(--line); border-radius: 10px; cursor: pointer; transition: all .15s;
}
.task-item:hover { border-color: var(--brand); box-shadow: var(--glow-soft); }
.task-item.urgent { border-color: rgba(255, 77, 109, 0.4); }
.task-item.hot { border-color: rgba(255, 165, 42, 0.35); }
.task-item.warm { border-color: rgba(91, 124, 250, 0.35); }
.task-ico {
  width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 600; flex-shrink: 0;
}
.task-item.urgent .task-ico { background: rgba(255, 77, 109, 0.14); color: var(--bad); }
.task-item.hot .task-ico { background: rgba(255, 165, 42, 0.14); color: var(--warn); }
.task-item.warm .task-ico { background: rgba(91, 124, 250, 0.14); color: var(--brand); }
.task-item.cool .task-ico { background: rgba(127, 127, 127, 0.12); color: var(--muted); }
.task-info { flex: 1; min-width: 0; }
.task-name { font-size: 13px; color: var(--text); margin: 0; }
.task-desc { font-size: 11px; color: var(--muted); margin: 2px 0 0; }
.task-arrow { color: var(--muted); font-size: 18px; flex-shrink: 0; }

/* ===== 首页重构（2026-08-08）：统计条 / 快捷启动 / 学习数据折叠 / 日常 duo / 更多功能 ===== */

/* 欢迎卡操作行 */
.welcome-actions { display: flex; gap: 10px; margin-top: 4px; }
.welcome-actions .ghost { background: transparent; border: 1px solid var(--line); color: var(--muted); }
.welcome-actions .ghost:hover { border-color: var(--brand); color: var(--text); }

/* 统计条：一行四个核心数字 + 今日目标进度 */
.stat-strip {
  display: flex;
  align-items: stretch;
  gap: 0;
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 12px 8px;
  background: linear-gradient(135deg, rgba(91, 124, 250, 0.07), rgba(122, 92, 255, 0.04));
}
.stat-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
.stat-sep { width: 1px; background: var(--line); margin: 4px 6px; }
.stat-num { font-size: 22px; font-weight: 700; color: var(--text); line-height: 1.1; font-variant-numeric: tabular-nums; }
.stat-num.on { color: var(--brand); }
.stat-num.bad { color: var(--bad); }
.stat-num.fire { color: var(--warn); }
.stat-label { font-size: 11px; color: var(--muted); }
.stat-goal { margin: 10px 4px 2px; }
.stat-goal-top { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: var(--muted); margin-bottom: 4px; }
.stat-goal-pct { color: var(--brand); font-weight: 600; }
.stat-goal-bar { height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; }
.stat-goal-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--brand), var(--brand2, #7b46c4)); transition: width .4s; box-shadow: var(--glow-soft); }

/* 快捷启动：三个主行动按钮 */
.launch-card { padding: 12px; }
.launch-row { display: flex; gap: 10px; }
.launch-btn {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(148, 163, 184, 0.05);
  cursor: pointer;
  transition: all .18s ease;
  text-align: left;
}
.launch-btn:hover { border-color: var(--brand); background: rgba(91, 124, 250, 0.08); transform: translateY(-1px); }
.launch-btn:disabled { opacity: .45; cursor: not-allowed; transform: none; }
.launch-btn .lb-ico {
  width: 34px; height: 34px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(91, 124, 250, 0.12); color: var(--brand); flex-shrink: 0;
}
.launch-btn.primary .lb-ico { background: rgba(91, 124, 250, 0.14); color: var(--brand); }
.launch-btn.warn .lb-ico { background: rgba(255, 165, 42, 0.12); color: var(--warn); }
.launch-btn.warn.hot { border-color: rgba(255, 77, 109, 0.4); }
.launch-btn.warn.hot .lb-ico { background: rgba(255, 77, 109, 0.14); color: var(--bad); }
.launch-btn.accent .lb-ico { background: rgba(122, 92, 255, 0.14); color: var(--brand2, #7b46c4); }
.launch-btn .lb-main { font-size: 14px; font-weight: 600; color: var(--text); display: block; }
.launch-btn .lb-sub { font-size: 11px; color: var(--muted); display: block; margin-top: 1px; }

/* 学习数据（可折叠） */
.data-fold { padding: 0; overflow: hidden; }
.fold-head {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 14px; cursor: pointer; user-select: none;
}
.fold-head:hover { background: rgba(91, 124, 250, 0.05); }
.fold-title { font-size: 13px; font-weight: 600; color: var(--text); display: inline-flex; align-items: center; gap: 5px; }
.fold-badge {
  margin-left: auto; font-size: 11px; color: var(--muted);
  border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px;
}
.fold-badge.soon { color: var(--bad); border-color: rgba(255, 77, 109, 0.4); animation: blink 1s steps(2) infinite; }
.fold-arrow { font-size: 12px; color: var(--muted); transition: transform .18s; }
.fold-inner { border-top: 1px dashed var(--line); padding: 12px 14px 14px; }
.fold-inner + .fold-inner { border-top: 1px solid var(--line); }
.fold-inner .weak-card { gap: 8px; }
.weak-head { font-size: 13px; font-weight: 600; color: var(--text); display: inline-flex; align-items: center; gap: 5px; margin-bottom: 2px; }

/* 日常 duo 内任务/习惯列 */
.duo-block .quest-list, .duo-block .habit-list { min-width: 0; }
.duo-block .habit-item { border-radius: 10px; }

/* 更多功能网格 */
.more-card { padding: 12px 14px; }
.more-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.more-item {
  display: flex; align-items: center; gap: 9px;
  border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 12px; cursor: pointer; transition: all .15s ease;
}
.more-item:hover { border-color: var(--brand); background: rgba(91, 124, 250, 0.06); }
.mi-ico {
  width: 30px; height: 30px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.mi-ico.wrong { background: rgba(255, 77, 109, 0.12); color: var(--bad); }
.mi-ico.fav { background: rgba(255, 165, 42, 0.12); color: var(--warn); }
.mi-ico.all { background: rgba(91, 124, 250, 0.12); color: var(--brand); }
.mi-ico.kb { background: rgba(56, 189, 248, 0.12); color: #38bdf8; }
.mi-ico.exam { background: rgba(122, 92, 255, 0.12); color: var(--brand2, #7b46c4); }
.mi-ico.cards { background: rgba(44, 196, 138, 0.12); color: var(--ok); }
.mi-main { flex: 1; font-size: 13px; color: var(--text); }
.mi-count { font-size: 11px; color: var(--muted); }
.mi-count.due { color: var(--bad); font-weight: 600; }
</style>
