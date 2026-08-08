<script setup>
import CountUp from './CountUp.vue'
import Icon from './Icon.vue'
import { ref, computed, onMounted, watch } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import { tiku } from '../api/tiku.js'
import { printHtml } from '../utils/print.js'

// 学习周报：聚合近 7 天数据 → 打印/导出 PDF
async function exportReport() {
  const r = await tiku.getWeeklyReport()
  const bar = r.daily.map(d => `<div class="bar-cell"><div class="bar" style="height:${Math.max(4, d.n * 6)}px"></div><span>${d.date}</span><b>${d.n}</b></div>`).join('')
  const body = `
<h1>学习周报</h1>
<p class="doc-sub">生成时间：${new Date().toLocaleString()} · 知识记忆小助手</p>
<div class="sec">本周概览</div>
<div class="kpis">
  <div class="kpi"><b>${r.answered}</b><span>答题数</span></div>
  <div class="kpi"><b>${r.accuracy}%</b><span>正确率</span></div>
  <div class="kpi"><b>${r.xp}</b><span>获得 XP</span></div>
  <div class="kpi"><b>${r.focus}</b><span>专注分钟</span></div>
  <div class="kpi"><b>${r.review}</b><span>回顾条数</span></div>
  <div class="kpi"><b>${r.habitDays}</b><span>习惯打卡天</span></div>
</div>
<div class="sec">近 7 天答题分布</div>
<div class="bars">${bar}</div>
<div class="sec">累计数据</div>
<table class="report-table">
  <tr><td>等级</td><td>Lv.${r.level}（总 ${r.totalXp} XP）</td></tr>
  <tr><td>累计已做</td><td>${r.totalAnswered} 题</td></tr>
  <tr><td>掌握</td><td>${r.mastered} 题</td></tr>
  <tr><td>活跃错题</td><td>${r.wrongActive} 题</td></tr>
  <tr><td>知识库</td><td>${r.kbDocs} 篇文档 · ${r.kbLinks} 条联动 · 阅读 ${r.kbRead} 次</td></tr>
</table>`
  const style = `
h1 { margin: 0 0 4px; }
.doc-sub { color: #666; font-size: 12px; margin: 0 0 16px; }
.sec { font-size: 14px; font-weight: bold; margin: 18px 0 8px; border-left: 3px solid #3d5bd9; padding-left: 8px; }
.kpis { display: flex; gap: 10px; flex-wrap: wrap; }
.kpi { flex: 1; min-width: 90px; border: 1px solid #ddd; border-radius: 10px; padding: 12px; text-align: center; }
.kpi b { display: block; font-size: 20px; color: #3d5bd9; }
.kpi span { font-size: 11px; color: #666; }
.bars { display: flex; align-items: flex-end; gap: 8px; height: 120px; }
.bar-cell { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
.bar { width: 60%; background: #3d5bd9; border-radius: 4px 4px 0 0; }
.bar-cell span { font-size: 11px; color: #666; }
.bar-cell b { font-size: 12px; }
.report-table { width: 100%; border-collapse: collapse; }
.report-table td { border: 1px solid #ddd; padding: 8px 10px; font-size: 13px; }
.report-table td:first-child { width: 120px; color: #666; }`
  printHtml('学习周报', body, style)
}

const loggedIn = ref(false)
const loading = ref(false)
const summary = ref({ total: 0, learned: 0, mastered: 0, streak: 0, activeDays: 0 })
const trend = ref([])
const calendar = ref({})

// ---- 全局学习中心：科目范围切换（默认全部，可切单科目）----
const subjects = ref([])
const subjectScope = ref('all')
const filterSubjectId = computed(() => subjectScope.value === 'all' ? undefined : Number(subjectScope.value) || undefined)
// 从首页搬入的全局区块
const heatmap = ref([])
const goalData = ref(null)
const quest = ref({ tasks: [], claimed: '' })
const habits = ref([])
const examDate = ref('')
const examLeft = computed(() => {
  if (!examDate.value) return null
  const target = new Date(examDate.value + 'T00:00:00')
  const now = new Date(); now.setHours(0, 0, 0, 0)
  return { date: examDate.value, days: Math.round((target - now) / 86400000) }
})
const heatStreak = computed(() => summary.value.streak || 0)
function heatLevel(c) { return c === 0 ? 0 : c <= 2 ? 1 : c <= 5 ? 2 : c <= 10 ? 3 : 4 }

const now = new Date()
const year = now.getFullYear()
const month = now.getMonth() + 1

const rate = computed(() => {
  return summary.value.total ? Math.round((summary.value.mastered / summary.value.total) * 100) : 0
})

const maxTrend = computed(() => Math.max(1, ...trend.value.map(d => d.count)))

const calendarDays = computed(() => {
  const firstDay = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const startWeekday = firstDay.getDay() // 0=Sun
  const days = []
  for (let i = 0; i < startWeekday; i++) days.push({ empty: true })
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const count = calendar.value[key] || 0
    days.push({ day: d, count })
  }
  return days
})

// 内容类统计（跟随科目切换）；行为类（XP/契约/Quest/习惯/连击）全局
async function login() {
  loggedIn.value = true
  loading.value = true
  await Promise.all([loadContent(), loadGlobal()])
  loading.value = false
}
async function loadContent() {
  const sid = filterSubjectId.value
  try { summary.value = await tiku.getSummary(sid) } catch (e) {}
  try { trend.value = await tiku.getWeeklyTrend(sid) } catch (e) { trend.value = [] }
  try { heatmap.value = await tiku.getActivityHeatmap(120, sid) } catch (e) { heatmap.value = [] }
  try { calendar.value = await tiku.getMonthlyCalendar(year, month, sid) } catch (e) { calendar.value = {} }
  try { catAccuracy.value = await tiku.getCategoryAccuracy(sid) } catch (e) { catAccuracy.value = [] }
}
async function loadGlobal() {
  try { subjects.value = await tiku.getSubjects() } catch (e) { subjects.value = [] }
  try { goalData.value = await tiku.getGoalContract() } catch (e) { goalData.value = null }
  try {
    const q = await tiku.checkQuests()
    quest.value = { tasks: q.tasks, claimed: q.claimed.join('、') }
  } catch (e) { quest.value = { tasks: [], claimed: '' } }
  try { habits.value = await tiku.listHabits() } catch (e) { habits.value = [] }
  try { examDate.value = (await tiku.getSetting('exam_date')) || '' } catch (e) { examDate.value = '' }
}

watch(filterSubjectId, () => { if (loggedIn.value) loadContent() }) // 切科目只刷新内容类

async function toggleHabit(h) {
  if (h.checkedToday) { await tiku.uncheckHabit(h.id) }
  else { await tiku.checkHabit(h.id) }
  habits.value = await tiku.listHabits()
}

async function claimGoal() {
  try {
    const r = await tiku.claimGoalReward()
    if (r.ok) goalData.value = await tiku.getGoalContract()
  } catch (e) {}
}

onMounted(async () => {
  // 本地单用户直接视为已登录，加载真实数据；如需演示未登录 UI 可注释掉下面这行
  await login()
  await loadAnalysis()
})

// ---- 章节正确率雷达 + 练习成绩历史曲线 ----
const catAccuracy = ref([])
const examHistory = ref([])
const radarCenter = { x: 90, y: 84 }
const radarCats = computed(() => catAccuracy.value.slice(0, 6)) // 正确率最低 6 章
const radarPoints = computed(() => {
  const n = Math.max(3, radarCats.value.length)
  return radarCats.value.map((c, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / n
    const r = 56 * (Math.max(8, c.rate) / 100)
    return { x: radarCenter.x + r * Math.cos(ang), y: radarCenter.y + r * Math.sin(ang), cat: c.cat }
  })
})
const radarPoly = computed(() => radarPoints.value.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
const gridHex = (r) => {
  const n = Math.max(3, radarCats.value.length)
  const pts = []
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / n
    pts.push(`${(radarCenter.x + r * Math.cos(ang)).toFixed(1)},${(radarCenter.y + r * Math.sin(ang)).toFixed(1)}`)
  }
  return pts.join(' ')
}
const labelPos = (i) => {
  const n = Math.max(3, radarCats.value.length)
  const ang = -Math.PI / 2 + (2 * Math.PI * i) / n
  return { x: radarCenter.x + 66 * Math.cos(ang), y: radarCenter.y + 66 * Math.sin(ang) + 3 }
}
const histPath = computed(() => {
  const h = examHistory.value
  if (h.length < 2) return ''
  return 'M' + h.map((e, i) => {
    const x = 10 + (i * 280) / (h.length - 1)
    const y = 62 - (e.pct / 100) * 50
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' L')
})
const histX = (i) => examHistory.value.length === 1 ? 150 : 10 + (i * 280) / (examHistory.value.length - 1)
const histY = (e) => 62 - (e.pct / 100) * 50
async function loadAnalysis() {
  try { catAccuracy.value = await tiku.getCategoryAccuracy() } catch (e) { catAccuracy.value = [] }
  try { examHistory.value = JSON.parse(localStorage.getItem('exam_history') || '[]').slice(-30) } catch (e) { examHistory.value = [] }
}
</script>

<template>
  <div class="stats">
    <!-- 页面标题行 + 导出周报 -->
    <div class="stats-head">
      <h2 class="stats-title">学习统计</h2>
      <button class="btn btn-primary report-btn" @click="exportReport">导出学习周报</button>
    </div>

    <!-- 科目范围切换：内容类统计跟随，行为类全局 -->
    <div class="stats-scope" v-if="loggedIn">
      <button
        class="filter-chip"
        :class="{ active: subjectScope === 'all' }"
        @click="subjectScope = 'all'"
      >全部科目</button>
      <button
        v-for="s in subjects"
        :key="s.id"
        class="filter-chip"
        :class="{ active: subjectScope === String(s.id) }"
        @click="subjectScope = String(s.id)"
      >{{ s.name }}</button>
      <span class="scope-hint">内容类统计（题数/趋势/日历/正确率）随范围切换 · XP/契约/习惯 始终全局</span>
    </div>

    <div v-if="loggedIn">
      <div class="stats-grid">
      <!-- 分析：章节正确率雷达 + 成绩历史 -->
      <div class="card analysis-card">
        <div class="card-title">📊 章节正确率雷达 <span class="card-sub">（最弱 {{ radarCats.length }} 章）</span></div>
        <svg v-if="radarCats.length" viewBox="0 0 180 176" class="radar">
          <polygon :points="gridHex(56)" fill="none" stroke="var(--line)" stroke-width="1"/>
          <polygon :points="gridHex(28)" fill="none" stroke="var(--line)" stroke-width="1"/>
          <polygon :points="radarPoly" fill="rgba(91,124,250,0.25)" stroke="var(--brand)" stroke-width="2"/>
          <circle v-for="p in radarPoints" :key="p.cat" :cx="p.x" :cy="p.y" r="3" fill="var(--brand)"/>
          <text v-for="(c, i) in radarCats" :key="'l' + i" :x="labelPos(i).x" :y="labelPos(i).y" class="radar-label" text-anchor="middle">{{ c.cat.length > 4 ? c.cat.slice(0, 4) + '…' : c.cat }}</text>
        </svg>
        <div v-if="!radarCats.length" class="empty-sm">暂无答题数据</div>
        <div class="card-title hist-title">📈 近 {{ examHistory.length }} 次练习正确率</div>
        <svg v-if="histPath" viewBox="0 0 300 70" class="hist">
          <line x1="10" y1="62" x2="290" y2="62" stroke="var(--line)" stroke-width="1"/>
          <path :d="histPath" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linejoin="round"/>
          <circle v-for="(e, i) in examHistory" :key="i" :cx="histX(i)" :cy="histY(e)" r="2.5" fill="var(--brand)">
            <title>{{ e.date }} · {{ e.label }} · {{ e.pct }}%</title>
          </circle>
        </svg>
        <div v-if="!examHistory.length" class="empty-sm">完成练习 / 模考后，这里会记录你的正确率曲线</div>
      </div>
      <!-- 概览：掌握进度环形 + 数字 -->
      <div class="card overview-card">
        <div class="ring-wrap">
          <svg class="ring" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(91, 124, 250, 0.14)" stroke-width="10" />
            <circle
              cx="60" cy="60" r="50" fill="none" stroke="var(--brand)"
              stroke-width="10" stroke-linecap="round"
              :stroke-dasharray="`${rate * 3.14} ${314 - rate * 3.14}`"
              transform="rotate(-90 60 60)"
            />
          </svg>
          <div class="ring-text">
            <div class="ring-num">{{ rate }}%</div>
            <div class="ring-label">掌握进度</div>
          </div>
        </div>

      <div class="overview-numbers">
        <div class="num-item">
          <div class="num-value"><CountUp :value="summary.total" /></div>
          <div class="num-label">总卡片数</div>
        </div>
        <div class="num-item">
          <div class="num-value"><CountUp :value="summary.learned" /></div>
          <div class="num-label">已学习</div>
        </div>
        <div class="num-item">
          <div class="num-value"><CountUp :value="summary.mastered" /></div>
          <div class="num-label">已掌握</div>
        </div>
      </div>
      </div>

      <!-- 学习趋势 -->
      <div class="card trend-card">
        <div class="card-title">学习趋势</div>
        <div v-if="!trend.length" class="empty">本周暂无学习记录</div>
        <div v-else class="trend-bars">
          <div v-for="d in trend" :key="d.date" class="bar-item" :title="`${d.date}：${d.count} 题`">
            <div class="bar-track">
              <div class="bar-fill" :style="{ height: `${(d.count / maxTrend) * 60}px` }"></div>
            </div>
            <div class="bar-date">{{ d.date.slice(5) }}</div>
            <div class="bar-count">{{ d.count }}</div>
          </div>
        </div>
      </div>

      <!-- 学习习惯 -->
      <div class="card habit-card">
        <div class="card-title">学习习惯</div>
        <div class="habit-row">
          <div class="habit-item">
            <div class="habit-label">连续学习</div>
            <div class="habit-value">{{ summary.streak }}<span class="unit">天</span></div>
            <div class="habit-desc">坚持每天学习，养成好习惯</div>
          </div>
          <div class="habit-item">
            <div class="habit-label">累计学习</div>
            <div class="habit-value">{{ summary.activeDays }}<span class="unit">天</span></div>
            <div class="habit-desc">走过的每一步都算数</div>
          </div>
        </div>
      </div>

      <!-- 学习日历 -->
      <div class="card calendar-card">
        <div class="cal-header">
          <div class="card-title" style="margin:0">{{ year }}年{{ month }}月</div>
          <div class="cal-summary">已学习 {{ Object.keys(calendar).length }}/{{ calendarDays.filter(d => !d.empty).length }} 天</div>
        </div>
        <div class="weekdays">
          <span v-for="w in ['日','一','二','三','四','五','六']" :key="w">{{ w }}</span>
        </div>
        <div class="days">
          <span
            v-for="(d, i) in calendarDays"
            :key="i"
            class="day"
            :class="{ empty: d.empty, active: d.count > 0 }"
          >{{ d.empty ? '' : d.day }}</span>
        </div>
        <div class="cal-legend">
          <span>少</span>
          <span class="dot light"></span>
          <span class="dot mid"></span>
          <span class="dot heavy"></span>
          <span>多</span>
        </div>
      </div>

      <!-- 学习日历热力图（120 天） -->
      <div class="card heat-card" v-if="heatmap.length">
        <div class="card-title">🔥 学习日历热力图 <span class="heat-streak">连续 {{ heatStreak }} 天</span></div>
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

      <!-- 考试倒计时（全局） -->
      <div class="card exam-card" v-if="examLeft">
        <div class="exam-head">
          <span class="exam-label">🎯 考试倒计时</span>
          <span class="exam-num" :class="{ soon: examLeft.days >= 0 && examLeft.days <= 7 }">{{ examLeft.days >= 0 ? examLeft.days : 0 }}<small> 天</small></span>
        </div>
        <div class="exam-sub">{{ examLeft.date }} {{ examLeft.days > 0 ? '· 每天坚持刷题，稳扎稳打' : (examLeft.days === 0 ? '· 就是今天！加油 🎉' : '· 已过考试日，可在「我的」更新日期') }}</div>
      </div>

      <!-- 目标契约（全局） -->
      <div class="card goal-c-card" v-if="goalData && goalData.contract">
        <div class="goal-c-head">
          <span class="goal-c-title">目标契约 · {{ ({ quiz: '本周刷题', review: '本周复习', focus: '本周专注' })[goalData.contract.type] }}</span>
          <span class="goal-c-badge" :class="{ done: goalData.achieved }">{{ goalData.achieved ? '已达成 🎉' : '进行中' }}</span>
        </div>
        <div class="goal-c-bar"><div class="goal-c-fill" :style="{ width: Math.min(100, Math.round((goalData.progress / goalData.contract.value) * 100)) + '%' }"></div></div>
        <div class="goal-c-meta">
          <span>已完成 {{ goalData.progress }} / {{ goalData.contract.value }}</span>
          <span>{{ Math.min(100, Math.round((goalData.progress / goalData.contract.value) * 100)) }}%</span>
        </div>
        <div v-if="goalData.achieved && !goalData.contract.claimed" class="goal-c-claim-row">
          <button class="btn btn-primary" @click="claimGoal">领取 +50 XP</button>
        </div>
        <div v-else-if="goalData.achieved" class="goal-c-claimed">+50 XP 已领取</div>
      </div>

      <!-- 每日任务 Quest（全局） -->
      <div class="card quest-card">
        <div class="card-title">每日任务 <span class="quest-xp">每个 +20 XP</span></div>
        <div v-if="quest.claimed" class="quest-claimed">🎉 {{ quest.claimed }} 已完成，XP 已到账</div>
        <div class="quest-list">
          <div v-for="t in quest.tasks" :key="t.key" class="quest-item" :class="{ done: t.done }">
            <span class="quest-check"><Icon v-if="t.done" name="check" :size="14"/><i v-else class="hollow"></i></span>
            <span class="quest-name">{{ t.name }}</span>
            <span class="quest-state">{{ t.done ? '已完成' : '待完成' }}</span>
          </div>
        </div>
      </div>

      <!-- 习惯打卡（全局） -->
      <div class="card habit-list-card">
        <div class="card-title">我的习惯 <span class="quest-xp">每天打卡 +5 XP</span></div>
        <div v-if="!habits.length" class="empty-sm">还没有习惯，在「我的 → 习惯管理」添加一个吧</div>
        <div v-else class="habit-list">
          <div v-for="h in habits" :key="h.id" class="habit-item" :class="{ done: h.checkedToday }" @click="toggleHabit(h)">
            <span class="habit-icon">{{ h.icon }}</span>
            <span class="habit-name">{{ h.name }}</span>
            <span class="habit-streak">🔥 {{ h.streak }} 天</span>
            <span class="habit-check"><Icon v-if="h.checkedToday" name="check" :size="14"/><i v-else class="hollow"></i></span>
          </div>
        </div>
      </div>
      </div>
    </div>

    <SkeletonCards v-if="loading" :count="3" />
  </div>
</template>

<style scoped>
.stats-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.stats-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--text); }

.overview-card {
  display: flex;
  align-items: center;
  gap: 28px;
  padding: 20px 24px;
}
@media (max-width: 520px) {
  .overview-card { flex-direction: column; gap: 16px; }
}
.overview-numbers {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.overview-numbers .num-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px dashed var(--line);
  padding-bottom: 12px;
}
.overview-numbers .num-item:last-child { border-bottom: none; padding-bottom: 0; }
.overview-numbers .num-value { font-size: 24px; }
.overview-numbers .num-label { margin-top: 0; font-size: 12px; }
.avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--brand-light);
  color: var(--brand);
  font-size: 24px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  box-shadow: var(--glow-soft);
}
.avatar.solid { background: var(--brand); color: #ffffff; }

.ring-wrap {
  position: relative;
  width: 140px;
  height: 140px;
  margin: 10px auto 0;
}
.ring { width: 100%; height: 100%; }
.ring-text {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}
.ring-num { font-size: 28px; font-weight: 700; color: var(--brand); }
.ring-label { font-size: 12px; color: var(--muted); }

.numbers {
  display: flex;
  justify-content: space-around;
  text-align: center;
}
.num-value { font-size: 26px; font-weight: 700; color: var(--brand); }
.num-label { font-size: 12px; color: var(--muted); margin-top: 4px; }

.trend-bars {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  height: 90px;
  padding-top: 10px;
}
.bar-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.bar-track {
  width: 14px;
  height: 60px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 7px;
  position: relative;
  overflow: hidden;
}
.bar-fill {
  position: absolute;
  bottom: 0;
  width: 100%;
  background: linear-gradient(180deg, var(--brand), var(--brand2));
  border-radius: 7px;
  min-height: 4px;
  box-shadow: 0 0 8px rgba(91, 124, 250, 0.5);
}
.bar-date { font-size: 10px; color: var(--muted); }
.bar-count { font-size: 10px; color: var(--brand); }

.habit-row { display: flex; gap: 12px; }
.habit-item {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 12px;
}
.habit-label { font-size: 13px; color: var(--text); }
.habit-value { font-size: 22px; font-weight: 700; color: var(--brand); margin: 6px 0; }
.habit-value .unit { font-size: 12px; margin-left: 2px; }
.habit-desc { font-size: 11px; color: var(--muted); }

.cal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.cal-summary { font-size: 12px; color: var(--muted); }
.weekdays, .days { display: grid; grid-template-columns: repeat(7, 1fr); text-align: center; gap: 6px; }
.weekdays { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
.day {
  width: 30px;
  height: 30px;
  line-height: 30px;
  border-radius: 50%;
  font-size: 12px;
  margin: 0 auto;
  color: var(--text);
}
.day.active { background: var(--brand); color: #ffffff; font-weight: 600; }
.day.empty { visibility: hidden; }
.cal-legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 10px;
  font-size: 11px;
  color: var(--muted);
}
.dot { width: 10px; height: 10px; border-radius: 2px; }
.dot.light { background: rgba(91, 124, 250, 0.25); }
.dot.mid { background: rgba(91, 124, 250, 0.55); }
.dot.heavy { background: var(--brand); box-shadow: var(--glow); }
.report-btn { margin: 0; }

/* 分析卡：雷达图 + 成绩曲线 */
.analysis-card { min-width: 260px; }
.card-title { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
.card-sub { font-size: 11px; color: var(--muted); font-weight: 400; }
.radar { width: 100%; max-width: 220px; display: block; margin: 0 auto; }
.radar-label { font-size: 9px; fill: var(--muted); }
.hist-title { margin-top: 12px; }
.hist { width: 100%; max-width: 320px; display: block; }
.empty-sm { font-size: 12px; color: var(--muted); padding: 8px 0; }

/* ===== 全局中心新增：科目切换 / 热力图 / 考试倒计时 / 目标契约 / Quest / 习惯 ===== */
.stats-scope { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 14px; }
.filter-chip {
  background: none; border: 1px solid var(--line); border-radius: 999px;
  font-size: 12px; color: var(--muted); padding: 5px 14px; cursor: pointer; transition: all .15s;
}
.filter-chip.active { background: var(--brand); border-color: var(--brand); color: #021018; font-weight: 600; }
.scope-hint { font-size: 11px; color: var(--muted); margin-left: auto; }

.heat-card .heat-streak { margin-left: 6px; font-size: 11px; color: var(--brand); font-weight: 600; }
.heat-grid {
  display: grid; grid-template-rows: repeat(7, 12px); grid-auto-flow: column; grid-auto-columns: 12px;
  gap: 3px; overflow-x: auto; padding-bottom: 4px;
}
.heat-cell { width: 12px; height: 12px; border-radius: 3px; background: var(--line); transition: transform .12s ease; }
.heat-cell:hover { transform: scale(1.25); }
.heat-cell.lvl-1 { background: rgba(91,124,250,0.35); }
.heat-cell.lvl-2 { background: rgba(91,124,250,0.6); }
.heat-cell.lvl-3 { background: rgba(91,124,250,0.84); }
.heat-cell.lvl-4 { background: var(--brand); }
.heat-legend { display: flex; align-items: center; gap: 4px; margin-top: 8px; font-size: 11px; color: var(--muted); }
.heat-legend .heat-cell { cursor: default; }
.lg-text { margin: 0 2px; }

.exam-card { display: flex; flex-direction: column; gap: 6px; }
.exam-head { display: flex; align-items: center; justify-content: space-between; }
.exam-label { font-size: 13px; font-weight: 600; color: var(--text); }
.exam-num { font-size: 22px; font-weight: 800; color: var(--brand); }
.exam-num small { font-size: 12px; font-weight: 500; color: var(--muted); }
.exam-num.soon { color: var(--bad); animation: stblink 1s steps(2) infinite; }
.exam-sub { font-size: 12px; color: var(--muted); }
@keyframes stblink { 50% { opacity: .55; } }

.goal-c-card { display: flex; flex-direction: column; gap: 8px; }
.goal-c-head { display: flex; align-items: center; justify-content: space-between; }
.goal-c-title { font-size: 13px; font-weight: 600; color: var(--text); }
.goal-c-badge { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; }
.goal-c-badge.done { color: var(--ok); border-color: rgba(44,196,138,.4); }
.goal-c-bar { height: 8px; border-radius: 999px; background: var(--line); overflow: hidden; }
.goal-c-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--brand), var(--brand2, #7b46c4)); transition: width .4s; }
.goal-c-meta { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); }
.goal-c-claim-row { margin-top: 2px; }
.goal-c-claimed { font-size: 12px; color: var(--ok); font-weight: 600; }

.quest-xp { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 6px; }
.quest-claimed { font-size: 12px; color: var(--ok); margin-bottom: 8px; }
.quest-list { display: flex; flex-direction: column; gap: 8px; }
.quest-item {
  display: flex; align-items: center; gap: 10px;
  border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px;
}
.quest-item.done { border-color: rgba(44, 229, 168, 0.4); background: rgba(44, 229, 168, 0.05); }
.quest-check { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--muted); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; color: var(--muted); }
.quest-item.done .quest-check { border-color: var(--ok); color: var(--ok); }
.quest-name { flex: 1; font-size: 13px; color: var(--text); }
.quest-state { font-size: 11px; color: var(--muted); }

.habit-list { display: flex; flex-direction: column; gap: 6px; }
.habit-item {
  display: flex; align-items: center; gap: 10px;
  border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px; cursor: pointer; transition: all .15s;
}
.habit-item:hover { border-color: var(--brand); }
.habit-item.done { border-color: rgba(44, 229, 168, 0.4); background: rgba(44, 229, 168, 0.05); }
.habit-icon { font-size: 16px; }
.habit-name { flex: 1; font-size: 13px; color: var(--text); }
.habit-streak { font-size: 12px; color: var(--warn); font-weight: 600; }
.habit-check .hollow { display: inline-block; width: 12px; height: 12px; border: 1.5px solid var(--line); border-radius: 50%; }
.habit-item.done .habit-check { color: var(--ok); }
</style>
