<script setup>
import CountUp from './CountUp.vue'
import Icon from './Icon.vue'
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
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
const summary = ref({ total: 0, learned: 0, mastered: 0, streak: 0, activeDays: 0, today: 0, accuracy: 0, weekAccuracy: 0, weekDelta: 0 })
const trend = ref([])
const calendar = ref({})

// ---- 统计范围：跟随顶部科目（默认）｜总览（全部科目汇总）----
const props = defineProps({ subject: { type: Object, default: () => ({ id: null, name: '' }) } })
const subjects = ref([])
const subjectScope = ref('current') // 'current'(跟随顶部) | 'all'(总览)
const filterSubjectId = computed(() => {
  if (subjectScope.value === 'all') return undefined
  return props.subject.id || undefined
})

// 从首页搬入的全局区块
const heatmap = ref([])
const heatYear = ref(new Date().getFullYear())
const quest = ref({ tasks: [], claimed: '' })
function heatLevel(c) { return c === 0 ? 0 : c <= 2 ? 1 : c <= 5 ? 2 : c <= 10 ? 3 : 4 }
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
const localKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function shiftHeatYear(delta) {
  const y = heatYear.value + delta
  if (y < 2020 || y > new Date().getFullYear()) return
  heatYear.value = y
  loadContent()
}

// GitHub 贡献图布局：7 行（周日~周六）× N 列（每周一列），列首对齐周日，窗口外格子 ghost
const heatGrid = computed(() => {
  const list = heatmap.value
  const empty = { cols: 0, cells: [], months: [], total: 0 }
  if (!list.length) return empty
  const first = new Date(list[0].date + 'T00:00:00')
  const last = new Date(list[list.length - 1].date + 'T00:00:00')
  const weekStart = new Date(first)
  weekStart.setDate(first.getDate() - first.getDay()) // 对齐到所在周周日
  const map = {}
  list.forEach(d => { map[d.date] = d.count })
  const todayStr = localKey(new Date())
  const cells = []
  const months = []
  const seenMonthInCol = new Map()
  let cursor = new Date(weekStart)
  let col = 0
  while (cursor <= last) {
    let monthOfCol = null
    for (let r = 0; r < 7; r++) {
      const d = new Date(cursor)
      const key = localKey(d)
      const inWin = d >= first && d <= last
      cells.push({
        date: key,
        count: inWin ? (map[key] || 0) : -1, // -1 = 窗口外占位
        isToday: key === todayStr
      })
      if (d.getDate() === 1 && !monthOfCol) monthOfCol = d.getMonth()
      cursor.setDate(cursor.getDate() + 1)
    }
    if (monthOfCol !== null && !seenMonthInCol.has(col)) {
      seenMonthInCol.set(col, true)
      months.push({ col, label: MONTHS[monthOfCol] })
    }
    col++
  }
  const total = list.reduce((a, d) => a + (d.count || 0), 0)
  return { cols: col, cells, months, total }
})
// 左统计列：今日/本周/本窗口/连续天数
const heatStats = computed(() => {
  const list = heatmap.value
  const todayStr = localKey(new Date())
  const today = (list.find(d => d.date === todayStr) || {}).count || 0
  const week = list.slice(-7).reduce((a, d) => a + (d.count || 0), 0)
  return { today, week, total: heatGrid.value.total, streak: summary.value.streak || 0 }
})

// 热力图自适应格子尺寸：顶满卡片宽度不留空白（clamp 8~20）
const heatCellSize = ref(10)
const heatWrapEl = ref(null)
const HEAT_GAP = 2
function computeHeatSize() {
  const wrap = heatWrapEl.value
  if (!wrap) return
  const avail = wrap.clientWidth
  const statsEl = wrap.querySelector('.heat-stats')
  const statsW = statsEl ? statsEl.offsetWidth + 16 : 0 // 统计列宽 + 列间距
  const cols = Math.max(1, heatGrid.value.cols || 53)
  const cell = Math.floor((avail - statsW - (cols - 1) * HEAT_GAP - 4) / cols)
  heatCellSize.value = Math.max(8, Math.min(20, cell))
}
let heatObs = null

// hover 浮层：跟随鼠标（Teleport 到 body 防 transform 祖先错位），右侧/底部放不下自动翻转，内容友好
const hoverCell = ref(null)
const WEEKS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const weekLabel = (dateStr) => { try { return WEEKS[new Date(dateStr + 'T00:00:00').getDay()] } catch (e) { return '' } }
const TIP_W = 170 // 浮层预估宽
const TIP_H = 56  // 浮层预估高
function placeTip(e) {
  const pad = 12
  const vw = window.innerWidth
  const vh = window.innerHeight
  let x = e.clientX + pad
  let y = e.clientY + pad
  if (x + TIP_W > vw - 8) x = e.clientX - pad - TIP_W // 右侧放不下 → 放鼠标左边
  if (y + TIP_H > vh - 8) y = e.clientY - pad - TIP_H // 底部放不下 → 放鼠标上方
  return { x: Math.max(8, x), y: Math.max(8, y) }
}
function onHeatEnter(e, c) {
  if (!c || c.count < 0) { hoverCell.value = null; return }
  hoverCell.value = { date: c.date, count: c.count, isToday: c.isToday, ...placeTip(e) }
}
function onHeatMove(e) {
  if (hoverCell.value) Object.assign(hoverCell.value, placeTip(e))
}
function onHeatLeave() { hoverCell.value = null }

// 动态取当前年月：跨月/跨日停留在页面也能刷新到新月份
const nowY = () => { const d = new Date(); return d.getFullYear() }
const nowM = () => { const d = new Date(); return d.getMonth() + 1 }

const maxTrend = computed(() => Math.max(1, ...trend.value.map(d => d.count)))

const calendarDays = computed(() => {
  const firstDay = new Date(nowY(), nowM() - 1, 1)
  const daysInMonth = new Date(nowY(), nowM(), 0).getDate()
  const startWeekday = firstDay.getDay() // 0=Sun
  const days = []
  for (let i = 0; i < startWeekday; i++) days.push({ empty: true })
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${nowY()}-${String(nowM()).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const count = calendar.value[key] || 0
    days.push({ day: d, count })
  }
  return days
})

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
  try { heatmap.value = await tiku.getActivityHeatmap(heatYear.value, sid) } catch (e) { heatmap.value = [] }
  try { calendar.value = await tiku.getMonthlyCalendar(nowY(), nowM(), sid) } catch (e) { calendar.value = {} }
  try { catAccuracy.value = await tiku.getCategoryAccuracy(sid) } catch (e) { catAccuracy.value = [] }
}
async function loadGlobal() {
  try {
    const q = await tiku.checkQuests(filterSubjectId.value)
    quest.value = { tasks: q.tasks, claimed: q.claimed.join('、') }
  } catch (e) { quest.value = { tasks: [], claimed: '' } }
}

watch(filterSubjectId, async () => {
  if (loggedIn.value) { await loadContent(); await loadGlobal() } // 切范围刷新内容类 + 每日任务（目标跟随科目）
})

onMounted(async () => {
  await login()
  await loadAnalysis()
  computeHeatSize()
  heatObs = new ResizeObserver(() => computeHeatSize())
  if (heatWrapEl.value) heatObs.observe(heatWrapEl.value)
})
watch(() => heatGrid.value.cols, () => { if (loggedIn.value) computeHeatSize() }) // 年份/数据变化后重算格子尺寸
onBeforeUnmount(() => { if (heatObs) heatObs.disconnect() })

// ---- 章节正确率雷达 + 练习成绩历史曲线 ----
const catAccuracy = ref([])
const examHistory = ref([])
const radarCenter = { x: 90, y: 84 }
const radarCats = computed(() => catAccuracy.value.slice(0, 6)) // 正确率最低 6 章
const radarPoints = computed(() => {
  const n = Math.max(3, radarCats.value.length)
  return radarCats.value.map((c, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / n
    const r = 56 - (c.rate / 100) * 46
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

    <!-- 统计范围：跟随顶部科目 ｜ 总览（全部汇总） -->
    <div class="stats-scope" v-if="loggedIn">
      <span class="scope-label">统计范围</span>
      <button
        class="filter-chip"
        :class="{ active: subjectScope === 'current' }"
        @click="subjectScope = 'current'"
      >跟随顶部：{{ props.subject.name || '全部' }}</button>
      <button
        class="filter-chip"
        :class="{ active: subjectScope === 'all' }"
        @click="subjectScope = 'all'"
      >总览（全部科目）</button>
      <span class="scope-hint">切顶部科目 → 此处自动跟随</span>
    </div>

    <SkeletonCards v-if="loading" :count="3" />

    <template v-if="loggedIn && !loading">
      <!-- KPI 数据条 -->
      <div class="kpi-strip">
        <div class="kpi-item">
          <span class="kpi-num"><CountUp :value="summary.streak" /></span>
          <span class="kpi-label">连续学习</span>
        </div>
        <div class="kpi-sep"></div>
        <div class="kpi-item">
          <span class="kpi-num"><CountUp :value="summary.today" /></span>
          <span class="kpi-label">今日刷题</span>
        </div>
        <div class="kpi-sep"></div>
        <div class="kpi-item">
          <span class="kpi-num"><CountUp :value="summary.accuracy" /><small>%</small></span>
          <span class="kpi-label">正确率</span>
        </div>
        <div class="kpi-sep"></div>
        <div class="kpi-item">
          <span class="kpi-num"><CountUp :value="summary.mastered" /></span>
          <span class="kpi-label">已掌握</span>
        </div>
      </div>

      <!-- 学习热力图（GitHub 贡献图：7 行 × N 列 + 月份标签 + 年份切换 + 统计列） -->
      <div class="card heat-card">
        <div class="heat-head">
          <span class="card-title">🔥 学习热力图 <span class="heat-scope">（{{ subjectScope === 'all' ? '全部科目' : (props.subject.name || '全部') }}）</span></span>
          <div class="heat-legend">
            <span class="lg-text">少</span>
            <i class="heat-cell lvl-0"></i><i class="heat-cell lvl-1"></i><i class="heat-cell lvl-2"></i><i class="heat-cell lvl-3"></i><i class="heat-cell lvl-4"></i>
            <span class="lg-text">多</span>
          </div>
          <span class="heat-year-nav">
            <button class="hy-btn" @click="shiftHeatYear(-1)">‹</button>
            <span class="hy-year">{{ heatYear }}<small v-if="heatYear === nowY()"> 滚动 365 天</small></span>
            <button class="hy-btn" @click="shiftHeatYear(1)" :disabled="heatYear >= nowY()">›</button>
          </span>
        </div>
        <div ref="heatWrapEl" class="heat-flex">
          <div class="heat-stats">
            <div class="hs-item"><b>{{ heatStats.today }}</b><span>今日</span></div>
            <div class="hs-item"><b>{{ heatStats.week }}</b><span>本周</span></div>
            <div class="hs-item"><b>{{ heatStats.total }}</b><span>{{ heatYear === nowY() ? '近一年' : '全年' }}</span></div>
            <div class="hs-item"><b class="hot">{{ heatStats.streak }}</b><span>连续</span></div>
          </div>
          <div class="heat-main">
            <div class="heat-months">
              <span v-for="m in heatGrid.months" :key="m.col" class="hm-label" :style="{ left: m.col * (heatCellSize + HEAT_GAP) + 'px' }">{{ m.label }}</span>
            </div>
            <div class="heat-grid" :style="{ gridTemplateColumns: `repeat(${heatGrid.cols}, ${heatCellSize}px)`, gridTemplateRows: `repeat(7, ${heatCellSize}px)` }">
              <div
                v-for="(c, i) in heatGrid.cells"
                :key="i"
                class="heat-cell"
                :class="[c.count < 0 ? 'ghost' : 'lvl-' + heatLevel(c.count), c.isToday ? 'today' : '']"
                :style="{ width: heatCellSize + 'px', height: heatCellSize + 'px' }"
                @mouseenter="onHeatEnter($event, c)"
                @mousemove="onHeatMove($event)"
                @mouseleave="onHeatLeave"
              ></div>
            </div>
          </div>
        </div>
        <Teleport to="body">
          <div v-if="hoverCell" class="heat-tip" :style="{ left: hoverCell.x + 'px', top: hoverCell.y + 'px' }">
            <div class="ht-date">{{ hoverCell.date }} · {{ weekLabel(hoverCell.date) }}<i v-if="hoverCell.isToday" class="ht-today">今天</i></div>
            <div class="ht-count" :class="{ none: !hoverCell.count }">{{ hoverCell.count > 0 ? '刷了 ' + hoverCell.count + ' 题' : '没有学习记录' }}</div>
          </div>
        </Teleport>
      </div>

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

      <!-- 7 天趋势 -->
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

      <!-- 学习习惯（连续/累计） -->
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
          <div class="card-title" style="margin:0">{{ nowY() }}年{{ nowM() }}月</div>
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

      <!-- 每日任务 Quest（未设置显示友好提示） -->
      <div class="card quest-card">
        <div class="card-title">每日任务 <span class="quest-xp">每个 +20 XP</span></div>
        <div v-if="quest.claimed" class="quest-claimed">🎉 {{ quest.claimed }} 已完成，XP 已到账</div>
        <div v-if="!quest.tasks.length" class="quest-empty">
          未设置任务，去「我的 → 学习目标」设置每日刷题 / 复习 / 阅读目标吧
        </div>
        <div v-else class="quest-list">
          <div v-for="t in quest.tasks" :key="t.key" class="quest-item" :class="{ done: t.done }">
            <span class="quest-check"><Icon v-if="t.done" name="check" :size="14"/><i v-else class="hollow"></i></span>
            <span class="quest-name">{{ t.name }}</span>
            <span class="quest-state">{{ t.done ? '已完成' : '待完成' }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stats { display: flex; flex-direction: column; gap: 14px; }
.stats-head { display: flex; align-items: center; justify-content: space-between; }
.stats-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--text); }

/* 统计范围切换：跟随顶部 / 总览 */
.stats-scope { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.scope-label { font-size: 12px; color: var(--muted); }
.filter-chip {
  font-size: 12px; padding: 6px 14px;
  border: 1px solid var(--line); border-radius: 999px;
  background: transparent; color: var(--text); cursor: pointer;
  transition: all .15s;
}
.filter-chip:hover { border-color: var(--brand); }
.filter-chip.active { background: var(--brand); border-color: var(--brand); color: #fff; font-weight: 600; }
.scope-hint { font-size: 11px; color: var(--muted); margin-left: auto; }

/* KPI 数据条 */
.kpi-strip {
  display: flex; align-items: stretch; gap: 0;
  border: 1px solid var(--line); border-radius: 14px; padding: 12px 8px;
  background: linear-gradient(135deg, rgba(91, 124, 250, 0.07), rgba(122, 92, 255, 0.04));
}
.kpi-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
.kpi-sep { width: 1px; background: var(--line); margin: 4px 6px; }
.kpi-num { font-size: 20px; font-weight: 700; color: var(--text); line-height: 1.1; font-variant-numeric: tabular-nums; }
.kpi-num small { font-size: 12px; color: var(--muted); font-weight: 400; }
.kpi-label { font-size: 11px; color: var(--muted); }

/* 热力图（GitHub 贡献图） */
.heat-card { display: flex; flex-direction: column; gap: 10px; }
.heat-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.heat-scope { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 6px; }
.heat-legend { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--muted); margin-left: auto; }
.heat-legend .heat-cell { width: 12px; height: 12px; cursor: default; }
.heat-year-nav { display: flex; align-items: center; gap: 6px; }
.hy-btn { width: 22px; height: 22px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; font-size: 14px; line-height: 1; }
.hy-btn:hover:not(:disabled) { border-color: var(--brand); color: var(--brand); }
.hy-btn:disabled { opacity: .35; cursor: default; }
.hy-year { font-size: 12px; font-weight: 600; color: var(--text); min-width: 72px; text-align: center; }
.hy-year small { font-size: 10px; color: var(--muted); font-weight: 400; }
.heat-flex { display: flex; gap: 16px; align-items: stretch; }
.heat-stats { display: grid; grid-template-columns: repeat(2, auto); gap: 10px 18px; align-content: center; flex-shrink: 0; }
.hs-item { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.hs-item b { font-size: 16px; color: var(--text); font-variant-numeric: tabular-nums; }
.hs-item b.hot { color: var(--warn); }
.hs-item span { font-size: 10px; color: var(--muted); }
.heat-main { flex: 1; min-width: 0; overflow-x: auto; }
.heat-months { position: relative; height: 16px; margin-bottom: 2px; }
.hm-label { position: absolute; top: 0; font-size: 9px; color: var(--muted); white-space: nowrap; }
.heat-grid { display: grid; grid-auto-flow: column; gap: 2px; }
.heat-cell { width: 10px; height: 10px; border-radius: 2px; background: rgba(148, 163, 184, 0.14); }
.heat-cell.ghost { background: transparent; }
.heat-cell.today { outline: 1.5px solid var(--brand); outline-offset: 1px; }
.heat-cell.lvl-0 { background: rgba(148, 163, 184, 0.14); }
.heat-cell.lvl-1 { background: rgba(28, 58, 110, 0.75); }
.heat-cell.lvl-2 { background: rgba(42, 92, 168, 0.85); }
.heat-cell.lvl-3 { background: rgba(63, 127, 214, 0.9); }
.heat-cell.lvl-4 { background: #5b9cfa; }
.heat-tip { position: fixed; z-index: 9999; background: var(--card, #1b2130); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; box-shadow: 0 6px 24px rgba(0, 0, 0, .35); pointer-events: none; white-space: nowrap; }
.ht-date { font-size: 12px; color: var(--text); }
.ht-today { font-style: normal; font-size: 11px; color: var(--brand); margin-left: 6px; }
.ht-count { font-size: 12px; color: var(--brand); margin-top: 2px; }
.ht-count.none { color: var(--muted); }

/* 分析卡 */
.analysis-card { display: flex; flex-direction: column; gap: 6px; }
.radar { width: 100%; max-width: 280px; margin: 0 auto; }
.radar-label { font-size: 10px; fill: var(--muted); }
.hist { width: 100%; max-width: 420px; margin: 0 auto; }
.hist-title { margin-top: 10px; }
.empty-sm { font-size: 12px; color: var(--muted); padding: 8px 0; }
.empty { font-size: 12px; color: var(--muted); padding: 10px 0; }

/* 趋势 */
.trend-bars { display: flex; align-items: flex-end; gap: 8px; min-height: 80px; }
.bar-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.bar-track { width: 100%; height: 60px; display: flex; align-items: flex-end; }
.bar-fill { width: 60%; margin: 0 auto; background: var(--brand); border-radius: 4px 4px 0 0; min-height: 2px; }
.bar-date { font-size: 10px; color: var(--muted); }
.bar-count { font-size: 11px; color: var(--text); }

/* 学习习惯 */
.habit-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.habit-item { border: 1px solid var(--line); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 4px; }
.habit-label { font-size: 12px; color: var(--muted); }
.habit-value { font-size: 22px; font-weight: 700; color: var(--text); }
.habit-value .unit { font-size: 12px; color: var(--muted); font-weight: 400; }
.habit-desc { font-size: 11px; color: var(--muted); }

/* 月度日历 */
.cal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.cal-summary { font-size: 12px; color: var(--muted); }
.weekdays { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 4px; }
.weekdays span { text-align: center; font-size: 10px; color: var(--muted); }
.days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.day {
  aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: var(--text); border-radius: 6px;
  background: rgba(148, 163, 184, 0.06);
}
.day.active { background: var(--brand); color: #fff; font-weight: 600; }
.day.empty { background: transparent; }
.cal-legend { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--muted); margin-top: 8px; }
.dot { width: 10px; height: 10px; border-radius: 3px; }
.dot.light { background: rgba(28, 58, 110, 0.35); }
.dot.mid { background: rgba(42, 92, 168, 0.6); }
.dot.heavy { background: #5b9cfa; }

/* 每日任务 */
.quest-xp { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 6px; }
.quest-claimed { font-size: 12px; color: var(--ok); margin-bottom: 8px; }
.quest-empty {
  font-size: 12px; color: var(--muted);
  border: 1px dashed var(--line); border-radius: 10px; padding: 14px;
  text-align: center;
}
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
</style>
