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
// 每日一题：{ question, state } state: { date, qid, answered, correct, streak, bestStreak, period }
const dailyPuzzle = ref(null)
const dailyAnalysisOpen = ref(false)
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

onMounted(load)
watch(() => props.subject.id, load)
watch(() => props.refreshKey, load) // 切回首页时刷新实时数据

const goalPct = computed(() => dailyGoal.value ? Math.min(100, Math.round((summary.value.today / dailyGoal.value) * 100)) : 0)

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
let focusTimer = null

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
  try { weakPoints.value = await tiku.getWeakPoints(5) } catch (e) { weakPoints.value = [] }
  try { heatmap.value = await tiku.getActivityHeatmap(120) } catch (e) { heatmap.value = [] }
  try { examDate.value = (await tiku.getSetting('exam_date')) || '' } catch (e) { examDate.value = '' }
  try { weakAccuracy.value = (await tiku.getCategoryAccuracy()).slice(0, 3) } catch (e) { weakAccuracy.value = [] }
  try { dailyPuzzle.value = await tiku.getDailyPuzzle() } catch (e) { dailyPuzzle.value = null }
  dailyAnalysisOpen.value = false
  loading.value = false
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
  focusLeft.value = focusMinutes.value * 60
  focusRunning.value = true
  focusTimer = setInterval(() => {
    focusLeft.value--
    if (focusLeft.value <= 0) stopFocus(true)
  }, 1000)
}
async function stopFocus(completed = false) {
  clearInterval(focusTimer)
  focusTimer = null
  focusRunning.value = false
  if (completed) {
    await tiku.addFocusSession(focusMinutes.value)
    showToast(`专注 ${focusMinutes.value} 分钟完成，+${focusMinutes.value * 2} XP`, 'ok')
    const fs = await tiku.focusStats()
    focusToday.value = fs.today
  }
  focusLeft.value = 0
}
onBeforeUnmount(() => { if (focusTimer) clearInterval(focusTimer) })
</script>

<template>
  <div class="home">
    <!-- 欢迎卡片 -->
    <div class="card welcome">
      <div class="welcome-text">
        <div class="subtitle">基于艾宾浩斯记忆曲线，科学记忆，高效备考</div>
        <h1>欢迎来到<br>知识记忆小助手</h1>
        <button class="btn btn-primary" @click="$emit('start', { mode: 'practice' })">立即开始</button>
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

    <!-- 总数卡片 -->
    <div class="card stat-card">
      <div class="stat-title">知识卡片总数</div>
      <div class="stat-number">
        <span class="num"><CountUp :value="summary.total" /></span>
        <span class="unit">张</span>
      </div>
    </div>

    <!-- 空题库引导 -->
    <div v-if="!loading && summary.total === 0" class="card empty-guide">
      <p class="eg-title">题库还是空的，先导入一批题开始吧</p>
      <p class="eg-sub">支持 CSV / Excel / JSON 批量导入（我的 → 题库管理），或用内置样题直接体验</p>
    </div>

    <!-- 今日目标进度 -->
    <div class="card goal-card" v-if="dailyGoal">
      <div class="goal-top">
        <span class="goal-label"><Icon name="target" :size="14"/> 今日目标</span>
        <span class="goal-num">{{ Math.min(summary.today, dailyGoal) }} / {{ dailyGoal }} 题</span>
      </div>
      <div class="goal-bar"><div class="goal-fill" :style="{ width: goalPct + '%' }"></div></div>
      <div class="goal-sub">{{ goalPct >= 100 ? '🎉 今日目标已达成！' : '还差 ' + Math.max(0, dailyGoal - summary.today) + ' 题，去刷几道吧' }}</div>
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

    <!-- 考试倒计时 + 专注概览（都有数据时左右两块，风格同下方 duo-card） -->
    <div v-if="examLeft && focusWeek > 0" class="card duo-card">
      <div class="duo-row">
        <div class="duo-block">
          <div class="duo-title">🎯 考试倒计时</div>
          <div class="exam-count-num" :class="{ soon: examLeft.days <= 7 && examLeft.days >= 0 }">
            {{ examLeft.days >= 0 ? examLeft.days : 0 }}<small> 天</small>
          </div>
          <div class="duo-sub">{{ examLeft.date }} {{ examLeft.days > 0 ? '· 每天坚持刷题，稳扎稳打' : (examLeft.days === 0 ? '· 就是今天！加油 🎉' : '· 已过考试日，可在「我的」更新日期') }}</div>
        </div>
        <div class="duo-block">
          <div class="duo-title">🍅 专注概览</div>
          <div class="focus-nums">
            <span class="fn-item"><b>{{ focusToday }}</b><small>今日分钟</small></span>
            <span class="fn-item"><b>{{ focusWeek }}</b><small>本周分钟</small></span>
          </div>
          <div class="focus-bar"><div class="focus-fill" :style="{ width: Math.min(100, Math.round(focusWeek / 420 * 100)) + '%' }"></div></div>
          <div class="duo-sub">本周目标 7 小时 · 每专注 25 分钟休息一下 🌿</div>
        </div>
      </div>
    </div>
    <div v-else-if="examLeft" class="card exam-count-card">
      <div class="exam-count-top">
        <span class="exam-count-label">🎯 考试倒计时</span>
        <span class="exam-count-num" :class="{ soon: examLeft.days <= 7 && examLeft.days >= 0 }">
          {{ examLeft.days >= 0 ? examLeft.days : 0 }}<small> 天</small>
        </span>
      </div>
      <div class="exam-count-sub">{{ examLeft.date }} {{ examLeft.days > 0 ? '· 每天坚持刷题，稳扎稳打' : (examLeft.days === 0 ? '· 就是今天！加油 🎉' : '· 已过考试日，可在「我的」更新日期') }}</div>
    </div>
    <div v-else-if="focusWeek > 0" class="card focus-sum-card">
      <div class="card-title">🍅 专注概览</div>
      <div class="focus-nums">
        <span class="fn-item"><b>{{ focusToday }}</b><small>今日分钟</small></span>
        <span class="fn-item"><b>{{ focusWeek }}</b><small>本周分钟</small></span>
      </div>
      <div class="focus-bar"><div class="focus-fill" :style="{ width: Math.min(100, Math.round(focusWeek / 420 * 100)) + '%' }"></div></div>
      <div class="focus-sub">本周目标 7 小时 · 每专注 25 分钟休息一下 🌿</div>
    </div>

    <!-- 近 7 天趋势 + 学习日历（都有数据时左右两块） -->
    <div v-if="weeklyTrend.length && heatmap.length" class="card duo-card">
      <div class="duo-row">
        <div class="duo-block">
          <div class="duo-title"><Icon name="stats" :size="14"/> 近 7 天答题趋势</div>
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
        <div class="duo-block">
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
    </div>
    <div v-else-if="weeklyTrend.length" class="card trend-card">
      <div class="card-title"><Icon name="stats" :size="14"/> 近 7 天答题趋势</div>
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
    <div v-else-if="heatmap.length" class="card heat-card">
      <div class="card-title">
        <Icon name="fire" :size="14"/> 学习日历
        <span class="heat-streak">🔥 连续打卡 {{ heatStreak }} 天</span>
      </div>
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

    <!-- 薄弱点 TopN + 薄弱章节 -->
    <div class="card weak-card" v-if="weakPoints.length || weakAccuracy.length">
      <div class="card-title"><Icon name="alert" :size="14"/> 待攻克薄弱点</div>
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

    <!-- 每日任务 Quest -->
    <div class="card quest-card">
      <div class="card-title"><Icon name="paper" :size="14"/> 每日任务 <span class="quest-xp">每个 +20 XP</span></div>
      <div v-if="questClaimed" class="quest-claimed">🎉 {{ questClaimed }} 已完成，XP 已到账</div>
      <div class="quest-list">
        <div v-for="t in tasks" :key="t.key" class="quest-item" :class="{ done: t.done }" @click="onTaskClick(t)">
          <span class="quest-check"><Icon v-if="t.done" name="check" :size="14"/><i v-else class="hollow"></i></span>
          <span class="quest-name">{{ t.name }}</span>
          <span class="quest-state">{{ t.done ? '已完成' : '去做' }}</span>
        </div>
      </div>
    </div>

    <!-- 习惯打卡（无习惯时显示引导） -->
    <div class="card habit-card">
      <div class="card-title"><Icon name="refresh" :size="14"/> 我的习惯 <span class="quest-xp">每天打卡 +5 XP</span></div>
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

    <!-- 每日回顾 + 专注 -->
    <div class="card duo-card">
      <div class="duo-row">
        <div class="duo-left" @click="reviewOpen = true">
          <span class="duo-title"><Icon name="pulse" :size="14"/> 每日回顾</span>
          <span class="duo-sub">主动回忆 · 对抗遗忘</span>
        </div>
        <div class="duo-right">
          <span class="duo-title"><Icon name="clock" :size="14"/> 专注 {{ focusMinutes }} 分钟</span>
          <div class="focus-ctrl">
            <span v-if="focusRunning" class="focus-time">{{ focusText }}</span>
            <button v-if="!focusRunning" class="btn btn-primary" @click="startFocus">开始</button>
            <button v-else class="btn" @click="stopFocus(false)">停止</button>
          </div>
          <span class="duo-sub">今日已专注 {{ focusToday }} 分钟</span>
        </div>
      </div>
    </div>

    <!-- 快捷入口 -->
    <div class="card shortcuts">
      <div class="card-title">知识卡片预览</div>
      <div class="shortcut-grid">
        <div class="shortcut" @click="$emit('start', { mode: 'wrong' })">
          <div class="s-icon wrong"><Icon name="x" :size="14"/></div>
          <div class="s-label">错题本</div>
          <div class="s-count">{{ summary.wrongCount }} 题</div>
        </div>
        <div class="shortcut" @click="$emit('start', { mode: 'favorite' })">
          <div class="s-icon fav"><Icon name="star" :size="14"/></div>
          <div class="s-label">我的收藏</div>
          <div class="s-count">去复习</div>
        </div>
        <div class="shortcut" @click="$emit('start', { mode: 'practice' })">
          <div class="s-icon all"><Icon name="book" :size="14"/></div>
          <div class="s-label">全部刷题</div>
          <div class="s-count">{{ summary.total }} 题</div>
        </div>
        <div class="shortcut no-click">
          <div class="s-icon today"><Icon name="calendar" :size="14"/></div>
          <div class="s-label">今日已刷</div>
          <div class="s-count">{{ summary.today }} 题</div>
        </div>
      </div>
    </div>

    <!-- 模拟考试入口 -->
    <div class="card mock-entry">
      <div class="me-text">
        <div class="me-title">模拟考试</div>
        <div class="me-sub">按题型 / 难度组卷，限时实战，考后看得分与逐题解析</div>
      </div>
      <button class="btn btn-primary" @click="$emit('start-mock')">去组卷</button>
    </div>

    <!-- 单词卡入口 -->
    <div class="card mock-entry">
      <div class="me-text">
        <div class="me-title">单词卡 <span class="me-badge">{{ cardStats.due > 0 ? '今日到期 ' + cardStats.due : '闪卡记忆' }}</span></div>
        <div class="me-sub">正反面闪卡，按遗忘曲线自动安排复习（记住 3 天再见 / 忘记明天再来）</div>
      </div>
      <button class="btn btn-primary" @click="cardsOpen = true">{{ cardStats.total ? '去复习' : '去添加' }}</button>
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
</style>
