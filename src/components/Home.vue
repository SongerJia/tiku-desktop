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
const showData = ref(false) // 学习数据折叠卡（趋势/日历/薄弱点默认收起）
// 每日一题：{ question, state } state: { date, qid, answered, correct, streak, bestStreak, period }
const dailyPuzzle = ref(null)
const dailyAnalysisOpen = ref(false)
// 目标契约：{ contract, progress, achieved, lastMissed }
const goalData = ref(null)
const goalType = ref('quiz')
const goalValue = ref(100)
// 今日任务单：到期复习 / 每日一题 / 今日目标 / 未读文档
const dueReviews = ref(0)
const kbUnread = ref(0)
const goalLabel = computed(() => ({ quiz: '本周刷题', review: '本周复习', focus: '本周专注' })[goalType.value] || '本周刷题')
const goalUnit = computed(() => ({ quiz: '题', review: '条', focus: '分钟' })[goalType.value] || '题')
const goalDaysLeft = computed(() => {
  const d = new Date()
  const dow = (d.getDay() + 6) % 7 // 周一=0
  return 7 - dow
})
const weeklyTrend = ref([])
const heatmap = ref([])
const heatStreak = computed(() => summary.value.streak || 0)
// 考试倒计时 + 专注概览
const examDate = ref('')
const focusWeek = ref(0)
const examLeft = computed(() => {
  if (!examDate.value) return null
  const target = new Date(examDate.value + 'T00:00:00')
  const now = new Date(); now.setHours(0, 0, 0, 0)
  return { date: examDate.value, days: Math.round((target - now) / 86400000) }
})
function heatLevel(c) { return c === 0 ? 0 : c <= 2 ? 1 : c <= 5 ? 2 : c <= 10 ? 3 : 4 }
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

// 学习数据折叠卡：趋势/日历/薄弱点/考试倒计时任一有数据即可展开
const hasData = computed(() =>
  weeklyTrend.value.length || heatmap.value.length ||
  weakPoints.value.length || weakAccuracy.value.length || !!examLeft.value
)

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

// 近 7 天答题趋势（getWeeklyTrend 返回每日计数），纯 SVG 柱状图，无第三方依赖
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const todayKey = new Date().toISOString().slice(0, 10)
const trendMax = computed(() => Math.max(1, ...weeklyTrend.value.map(d => d.count)))
const trendBars = computed(() => weeklyTrend.value.map(d => {
  const count = d.count || 0
  return {
    label: WEEKDAYS[new Date(d.date + 'T00:00:00').getDay()],
    count,
    h: count ? Math.round((count / trendMax.value) * 52) + 4 : 0,
    isToday: d.date === todayKey
  }
}))

// 每日任务 Quest + 习惯打卡 + 每日回顾 + 番茄钟
const tasks = ref([])
const habits = ref([])
const questClaimed = ref('')
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
  summary.value = await tiku.getSummary()
  try { dailyGoal.value = Number(await tiku.getSetting('daily_goal')) || 0 } catch (e) { dailyGoal.value = 0 }
  try {
    const q = await tiku.checkQuests()
    tasks.value = q.tasks
    questClaimed.value = q.claimed.join('、')
  } catch (e) { /* 任务失败不阻塞 */ }
  try { habits.value = await tiku.listHabits() } catch (e) { habits.value = [] }
  try { const fs = await tiku.focusStats(); focusToday.value = fs.today; focusWeek.value = fs.week } catch (e) { focusToday.value = 0 }
  try { cardStats.value = await tiku.cardsStats() } catch (e) {}
  try { weeklyTrend.value = await tiku.getWeeklyTrend() } catch (e) { weeklyTrend.value = [] }
  try { weakPoints.value = await tiku.getWeakPoints(5, props.subject.id) } catch (e) { weakPoints.value = [] }
  try { heatmap.value = await tiku.getActivityHeatmap(120) } catch (e) { heatmap.value = [] }
  try { examDate.value = (await tiku.getSetting('exam_date')) || '' } catch (e) { examDate.value = '' }
  try { weakAccuracy.value = (await tiku.getCategoryAccuracy(props.subject.id)).slice(0, 3) } catch (e) { weakAccuracy.value = [] }
  try { dailyPuzzle.value = await tiku.getDailyPuzzle(props.subject.id) } catch (e) { dailyPuzzle.value = null }
  try { goalData.value = await tiku.getGoalContract() } catch (e) { goalData.value = null }
  try { dueReviews.value = (await tiku.reviewDueStats(props.subject.id)).due || 0 } catch (e) { dueReviews.value = 0 }
  try { kbUnread.value = (await tiku.kbStats()).unread || 0 } catch (e) { kbUnread.value = 0 }
  dailyAnalysisOpen.value = false
  loading.value = false
}

async function setGoal() {
  const v = Math.max(1, Math.round(Number(goalValue.value) || 0))
  try {
    const r = await tiku.setGoalContract({ type: goalType.value, value: v })
    goalData.value = r.contract
    showToast(`已立约：${goalLabel.value} ${v} ${goalUnit.value}，加油！`, 'ok')
  } catch (e) { showToast('立约失败：' + (e.message || '未知错误'), 'err') }
}

async function claimGoal() {
  try {
    const r = await tiku.claimGoalReward()
    if (r.ok) {
      showToast(`目标达成，+${r.xp} XP 🎉`, 'ok')
      goalData.value = await tiku.getGoalContract()
    }
  } catch (e) { showToast('领取失败：' + (e.message || '未知错误'), 'err') }
}

function typeLabel(t) {
  return ({ single: '单选题', multiple: '多选题', judge: '判断题', essay: '问答题' })[t] || t || '未知'
}
function startDaily() {
  if (dailyPuzzle.value && dailyPuzzle.value.question) emit('daily', dailyPuzzle.value.question)
}

async function toggleHabit(h) {
  if (h.checkedToday) {
    await tiku.uncheckHabit(h.id)
    showToast(`已取消「${h.name}」打卡`)
  } else {
    await tiku.checkHabit(h.id)
    showToast(`「${h.name}」打卡成功，+5 XP，连续 ${h.streak + 1} 天`, 'ok')
  }
  habits.value = await tiku.listHabits()
}

function onTaskClick(t) {
  if (t.key === 'quiz20') emit('start', { mode: 'practice' })
  else if (t.key === 'review5') reviewOpen.value = true
  else emit('goto', 'kb') // 阅读任务：直接跳知识库
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
        <span class="stat-num fire"><CountUp :value="summary.streak || 0" /></span>
        <span class="stat-label">连续打卡</span>
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

    <!-- 学习数据（可折叠：趋势 / 日历 / 薄弱点 / 考试倒计时，默认收起） -->
    <div v-if="!loading && hasData" class="card data-fold">
      <div class="fold-head" @click="showData = !showData">
        <span class="fold-title"><Icon name="chart" :size="14"/> 学习数据</span>
        <span v-if="examLeft" class="fold-badge" :class="{ soon: examLeft.days >= 0 && examLeft.days <= 7 }">🎯 考试还有 {{ examLeft.days >= 0 ? examLeft.days : 0 }} 天</span>
        <span class="fold-arrow">{{ showData ? '▾' : '▸' }}</span>
      </div>
      <template v-if="showData">
        <!-- 7 天趋势 + 学习日历（左右两块） -->
        <div v-if="weeklyTrend.length || heatmap.length" class="duo-row fold-inner">
          <div v-if="weeklyTrend.length" class="duo-block">
            <div class="duo-title"><Icon name="chart" :size="14"/> 近 7 天答题趋势</div>
            <svg class="trend-svg" viewBox="0 0 280 96" preserveAspectRatio="xMidYMid meet">
              <line x1="6" y1="84" x2="274" y2="84" stroke="var(--line)" stroke-width="1"/>
              <g v-for="(b, i) in trendBars" :key="i">
                <rect
                  :x="14 + i * 38" :y="84 - b.h" width="24" :height="b.h"
                  :rx="b.h ? 4 : 0"
                  :fill="b.isToday ? 'var(--brand)' : 'rgba(91,124,250,0.42)'"
                />
                <text v-if="b.count" :x="26 + i * 38" :y="80 - b.h" text-anchor="middle" class="trend-v">{{ b.count }}</text>
                <text :x="26 + i * 38" y="96" text-anchor="middle" class="trend-x" :class="{ on: b.isToday }">{{ b.label }}</text>
              </g>
            </svg>
          </div>
          <div v-if="heatmap.length" class="duo-block">
            <div class="duo-title"><Icon name="fire" :size="14"/> 学习日历 <span class="heat-streak">🔥 连续 {{ heatStreak }} 天</span></div>
            <div class="heat-grid">
              <div
                v-for="(d, i) in heatmap"
                :key="i"
                class="heat-cell"
                :class="'lvl-' + heatLevel(d.count)"
                :title="d.date + (d.isToday ? '（今天）' : '') + ' · ' + d.count + ' 题' + (d.focus ? ' · 专注 ' + d.focus + ' 分钟' : '')"
              ></div>
            </div>
            <div class="heat-legend">
              <span class="lg-text">少</span>
              <i class="heat-cell lvl-0"></i><i class="heat-cell lvl-1"></i><i class="heat-cell lvl-2"></i><i class="heat-cell lvl-3"></i><i class="heat-cell lvl-4"></i>
              <span class="lg-text">多</span>
            </div>
          </div>
        </div>
        <!-- 薄弱点 TopN + 薄弱章节 -->
        <div v-if="weakPoints.length || weakAccuracy.length" class="weak-card fold-inner">
          <div class="weak-head"><Icon name="info" :size="14"/> 待攻克薄弱点</div>
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
      </template>
    </div>

    <!-- 每日一题 + 连击 -->
    <div class="card daily-card" v-if="dailyPuzzle && dailyPuzzle.question">
      <div class="daily-head">
        <span class="daily-title">每日一题 · 第 {{ dailyPuzzle.state.period || 1 }} 期</span>
        <span class="daily-streak" v-if="dailyPuzzle.state.streak">🔥 连续 {{ dailyPuzzle.state.streak }} 天</span>
        <span class="daily-streak muted" v-else>今日打卡赢连击</span>
      </div>
      <div class="daily-tags">
        <span class="daily-tag" v-if="dailyPuzzle.question.categoryName">{{ dailyPuzzle.question.categoryName }}</span>
        <span class="daily-tag">{{ typeLabel(dailyPuzzle.question.type) }}</span>
      </div>
      <p class="daily-stem">{{ dailyPuzzle.question.stem }}</p>

      <template v-if="!dailyPuzzle.state.answered">
        <button class="btn btn-primary" @click="startDaily">开始作答</button>
        <p class="daily-note">每天一道题 · 答对攒连击，隔天未答会清零</p>
      </template>
      <template v-else>
        <div class="daily-result" :class="dailyPuzzle.state.correct ? 'ok' : 'bad'">
          {{ dailyPuzzle.state.correct ? '答对了' : '答错了' }} · 本题考「{{ dailyPuzzle.question.categoryName || '本知识点' }}」
          <span class="daily-best" v-if="dailyPuzzle.state.bestStreak">最佳连击 {{ dailyPuzzle.state.bestStreak }} 天</span>
        </div>
        <div class="daily-actions">
          <button class="btn" @click="dailyAnalysisOpen = !dailyAnalysisOpen">{{ dailyAnalysisOpen ? '收起解析' : '查看解析' }}</button>
          <button class="btn btn-primary" @click="startDaily">重做一遍</button>
        </div>
        <div v-if="dailyAnalysisOpen" class="daily-analysis">
          <div class="ans-line" v-if="dailyPuzzle.question.answer && dailyPuzzle.question.answer.length">
            <b>参考答案：</b>{{ dailyPuzzle.question.answer.join('、') }}
          </div>
          <div v-if="dailyPuzzle.question.analysis"><b>解析：</b>{{ dailyPuzzle.question.analysis }}</div>
        </div>
        <p class="daily-note">明天 0 点换新题，坚持每天打卡</p>
      </template>
    </div>

    <!-- 目标契约（每周 flag） -->
    <div class="card goal-c-card">
      <template v-if="goalData && goalData.contract">
        <div class="goal-c-head">
          <span class="goal-c-title">目标契约 · {{ ({ quiz: '本周刷题', review: '本周复习', focus: '本周专注' })[goalData.contract.type] }}</span>
          <span class="goal-c-badge" :class="{ done: goalData.achieved }">{{ goalData.achieved ? '已达成 🎉' : '还差 ' + goalDaysLeft + ' 天' }}</span>
        </div>
        <div v-if="goalData.lastMissed" class="goal-c-miss">上周还差 {{ goalData.lastMissed.missedBy }} {{ ({ quiz: '题', review: '条', focus: '分钟' })[goalData.lastMissed.type] }}，这周重新出发 💪</div>
        <div class="goal-c-bar">
          <div class="goal-c-fill" :style="{ width: Math.min(100, Math.round((goalData.progress / goalData.contract.value) * 100)) + '%' }"></div>
        </div>
        <div class="goal-c-meta">
          <span>已完成 {{ goalData.progress }} / {{ goalData.contract.value }} {{ ({ quiz: '题', review: '条', focus: '分钟' })[goalData.contract.type] }}</span>
          <span>{{ Math.min(100, Math.round((goalData.progress / goalData.contract.value) * 100)) }}%</span>
        </div>
        <div v-if="goalData.achieved && !goalData.contract.claimed" class="goal-c-claim-row">
          <button class="btn btn-primary" @click="claimGoal">领取 +50 XP</button>
        </div>
        <div v-else-if="goalData.achieved" class="goal-c-claimed">+50 XP 已领取</div>
      </template>
      <template v-else>
        <div class="goal-c-head">
          <span class="goal-c-title">目标契约 · 立个本周 flag</span>
          <span class="goal-c-badge">周一自动重来</span>
        </div>
        <p class="goal-c-label">本周想完成什么？</p>
        <div class="goal-c-chips">
          <button class="goal-c-chip" :class="{ on: goalType === 'quiz' }" @click="goalType = 'quiz'">本周刷题</button>
          <button class="goal-c-chip" :class="{ on: goalType === 'review' }" @click="goalType = 'review'">本周复习</button>
          <button class="goal-c-chip" :class="{ on: goalType === 'focus' }" @click="goalType = 'focus'">本周专注</button>
        </div>
        <div class="goal-c-row">
          <input v-model.number="goalValue" type="number" min="1" class="input" placeholder="目标值" />
          <span class="goal-c-unit">{{ goalUnit }}</span>
          <button class="btn btn-primary" @click="setGoal">立约</button>
        </div>
      </template>
    </div>

    <!-- 日常 duo：每日任务 ｜ 习惯打卡（左右两块） -->
    <div class="card duo-card">
      <div class="duo-row">
        <div class="duo-block">
          <div class="duo-title"><Icon name="paper" :size="14"/> 每日任务 <span class="quest-xp">每个 +20 XP</span></div>
          <div v-if="questClaimed" class="quest-claimed">🎉 {{ questClaimed }} 已完成，XP 已到账</div>
          <div class="quest-list">
            <div v-for="t in tasks" :key="t.key" class="quest-item" :class="{ done: t.done }" @click="onTaskClick(t)">
              <span class="quest-check"><Icon v-if="t.done" name="check" :size="14"/><i v-else class="hollow"></i></span>
              <span class="quest-name">{{ t.name }}</span>
              <span class="quest-state">{{ t.done ? '已完成' : '去做' }}</span>
            </div>
          </div>
        </div>
        <div class="duo-block">
          <div class="duo-title"><Icon name="refresh" :size="14"/> 我的习惯 <span class="quest-xp">每天打卡 +5 XP</span></div>
          <div v-if="!habits.length" class="habit-empty">还没有习惯。在「我的 → 习惯管理」添加一个（如：雅思刷题 / 健身 / 阅读），每天打卡攒连续天数。</div>
          <div v-else class="habit-list">
            <div v-for="h in habits" :key="h.id" class="habit-item" :class="{ done: h.checkedToday }" @click="toggleHabit(h)">
              <span class="habit-icon">{{ h.icon }}</span>
              <span class="habit-name">{{ h.name }}</span>
              <span class="habit-streak"><Icon name="fire" :size="14"/> {{ h.streak }} 天</span>
              <span class="habit-week">
                <i v-for="(ok, i) in h.week" :key="i" :class="{ on: ok }"></i>
              </span>
              <span class="habit-check"><Icon v-if="h.checkedToday" name="check" :size="14"/><i v-else class="hollow"></i></span>
            </div>
          </div>
        </div>
      </div>
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
