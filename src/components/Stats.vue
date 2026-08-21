<script setup>
import CountUp from './CountUp.vue'
import Icon from './Icon.vue'
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import { tiku } from '../api/tiku.js'
import { vTilt } from '../utils/tilt.js'
import { computePosition, offset, flip, shift } from '@floating-ui/dom'
import { printHtml } from '../utils/print.js'

// 学习周报：聚合近 7 天数据 → 打印/导出 PDF
async function exportReport() {
  const r = await tiku.getWeeklyReport(filterSubjectId.value)
  const bar = r.daily.map(d => `<div class="bar-cell"><div class="bar" style="height:${Math.max(4, d.n * 6)}px"></div><span>${d.date}</span><b>${d.n}</b></div>`).join('')
  const body = `
<h1>学习周报</h1>
<p class="doc-sub">生成时间：${new Date().toLocaleString()} · 知识记忆小助手</p>
<div class="sec">本周概览</div>
<div class="kpis">
  <div class="kpi"><b>${r.answered}</b><span>答题数</span></div>
  <div class="kpi"><b>${r.accuracy}%</b><span>正确率</span></div>
  <div class="kpi"><b>${r.xp}</b><span>获得 XP</span></div>
</div>
<div class="sec">近 7 天答题分布</div>
<div class="bars">${bar}</div>
<div class="sec">累计数据</div>
<table class="report-table">
  <tr><td>等级</td><td>Lv.${r.level}（总 ${r.totalXp} XP）</td></tr>
  <tr><td>累计已做</td><td>${r.totalAnswered} 题</td></tr>
  <tr><td>掌握</td><td>${r.mastered} 题</td></tr>
  <tr><td>活跃错题</td><td>${r.wrongActive} 题</td></tr>
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

// ---- 统计范围：跟随顶部科目（默认）｜总览（全部科目汇总）----
const props = defineProps({ subject: { type: Object, default: () => ({ id: null, name: '' }) } })
const emit = defineEmits(['goto'])
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
  heatFading.value = true // B2 年份切换：淡出 → 新数据回来淡入
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
// ⑧ 月份 → 当月总题数（月份标签 hover 用；近一年窗口月份不重复，label 可直接作 key）
const monthTotals = computed(() => {
  const m = {}
  for (const d of heatmap.value) {
    const label = MONTHS[new Date(d.date + 'T00:00:00').getMonth()]
    m[label] = (m[label] || 0) + (d.count || 0)
  }
  return m
})
const heatStats = computed(() => {
  const list = heatmap.value
  const isCur = heatYear.value === new Date().getFullYear()
  const todayStr = localKey(new Date())
  // 往年是自然年数据，无"今日/本周"概念 → 显示 —（避免误导）
  const today = isCur ? ((list.find(d => d.date === todayStr) || {}).count || 0) : null
  const week = isCur ? list.slice(-7).reduce((a, d) => a + (d.count || 0), 0) : null
  // A1 峰值：窗口内单日最多；最勤：按星期聚合总量最大
  let peak = null
  for (const d of list) if (!peak || d.count > peak.count) peak = d
  const byWeek = {}
  for (const d of list) {
    if (!d.count) continue
    const w = new Date(d.date + 'T00:00:00').getDay()
    byWeek[w] = (byWeek[w] || 0) + d.count
  }
  let bestDay = null
  for (const [w, n] of Object.entries(byWeek)) {
    if (!bestDay || n > bestDay.n) bestDay = { w: Number(w), n }
  }
  if (bestDay) bestDay.name = WEEKS[bestDay.w]
  return { today, week, total: heatGrid.value.total, streak: summary.value.streak || 0, activeDays: summary.value.activeDays || 0, peak, bestDay }
})

// 热力图自适应格子尺寸：顶满卡片宽度不留空白（clamp 5~20，移动端最小 5px）
const heatCellSize = ref(10)
const heatGap = ref(2) // 列间距：窄屏 1px（格子更密，53 周一屏放全）
const heatWrapEl = ref(null)
const HEAT_GAP = 2
function computeHeatSize() {
  const wrap = heatWrapEl.value
  if (!wrap) return
  const avail = wrap.clientWidth
  // 窄屏（≤640px 媒体查询）下统计列与格子区垂直堆叠：统计列不再与格子区并排，宽度不能从可用宽中扣除
  const isNarrow = window.innerWidth <= 640
  heatGap.value = isNarrow ? 1 : 2
  const gap = heatGap.value
  const statsEl = wrap.querySelector('.heat-stats')
  const statsW = (!isNarrow && statsEl) ? statsEl.offsetWidth + 16 : 0 // 统计列宽 + 列间距
  const cols = Math.max(1, heatGrid.value.cols || 53)
  const cell = Math.floor((avail - statsW - (cols - 1) * gap - 4) / cols)
  heatCellSize.value = Math.max(5, Math.min(20, cell))
}
let heatObs = null

// hover 浮层（对齐 GitHub 贡献图标准）：锚定格子正上方居中，不跟随鼠标（hover 哪个格子浮层就在哪个格子上方，换格子才更新）
const hoverCell = ref(null)
const tipEl = ref(null)
const WEEKS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const weekLabel = (dateStr) => { try { return WEEKS[new Date(dateStr + 'T00:00:00').getDay()] } catch (e) { return '' } }
const anchorState = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
const tipAnchor = {
  getBoundingClientRect: () => ({
    width: anchorState.width, height: anchorState.height,
    left: anchorState.left, top: anchorState.top,
    right: anchorState.right, bottom: anchorState.bottom,
    x: anchorState.left, y: anchorState.top
  })
}
let tipSeq = 0
async function placeTip() {
  const el = tipEl.value
  if (!el || !hoverCell.value) return
  const seq = ++tipSeq
  const { x, y } = await computePosition(tipAnchor, el, {
    placement: 'top', // 居中对齐格子（GitHub 标准）；浮层紧凑后右侧极少溢出 shift 不介入
    middleware: [offset(4), flip(), shift({ padding: 8 })]
  })
  if (seq !== tipSeq) return
  el.style.left = x + 'px'
  el.style.top = y + 'px'
}
function onHeatEnter(e, c) {
  if (!c || c.count < 0) { hoverCell.value = null; return }
  hoverCell.value = { date: c.date, count: c.count, isToday: c.isToday }
  const rect = e.currentTarget.getBoundingClientRect()
  anchorState.left = rect.left
  anchorState.top = rect.top
  anchorState.right = rect.right
  anchorState.bottom = rect.bottom
  anchorState.width = rect.width
  anchorState.height = rect.height
  placeTip()
}
function onHeatLeave() { hoverCell.value = null }

// 动态取当前年：跨年停留在页面也能刷新（热力图年份按钮用）
const nowY = () => { const d = new Date(); return d.getFullYear() }

async function login() {
  loggedIn.value = true
  loading.value = true
  await Promise.all([loadContent(), loadGlobal()])
  loading.value = false
  await loadReasonAnalysis()
}
// ---- 错因分析（行业空白）：结果页/错题本标记的错因分布 + 归因建议 ----
const reasonScope = ref('week') // 'week' 本周 | 'all' 全部
const reasonData = ref(null) // { total, list: [{reason,count,pct}] }
const reasonPrev = ref(null) // A4 上周错因数据（本周口径时并行取，供趋势对比）
async function loadReasonAnalysis() {
  if (reasonScope.value === 'week') {
    const [cur, prev] = await Promise.allSettled([
      tiku.getReasonAnalysis('week'),
      tiku.getReasonAnalysis('prevWeek')
    ])
    reasonData.value = cur.status === 'fulfilled' && cur.value && cur.value.list ? cur.value : null
    reasonPrev.value = prev.status === 'fulfilled' && prev.value ? prev.value : null
  } else {
    try {
      const r = await tiku.getReasonAnalysis('all')
      reasonData.value = r && r.list ? r : null
      reasonPrev.value = null
    } catch (e) { reasonData.value = null; reasonPrev.value = null }
  }
}
// A4 带 delta 的错因列表：本周占比 - 上周占比（null=上周无此项）
const reasonList = computed(() => {
  if (!reasonData.value) return []
  const pmap = {}
  if (reasonPrev.value) for (const r of reasonPrev.value.list) pmap[r.reason] = r.pct
  return reasonData.value.list.map(r => {
    let delta = null
    if (pmap[r.reason] !== undefined) delta = r.pct - pmap[r.reason]
    return { ...r, delta }
  })
})
const REASON_COLOR = { '粗心': '#e5535f', '知识点不懂': '#5b7cfa', '时间不够': '#d99a3d' }
const reasonTip = computed(() => {
  const list = reasonData.value && reasonData.value.list ? reasonData.value.list : []
  const top = list[0]
  if (!top || top.pct < 20) return null
  if (top.reason === '粗心') return `你的错因集中在<b>粗心（${top.pct}%）</b>：下次答题先放慢速度、逐项核对选项，正确率预计可提升`
  if (top.reason === '知识点不懂') return `你的错因集中在<b>知识点不懂（${top.pct}%）</b>：错题解析里的知识点建议反复巩固`
  if (top.reason === '时间不够') return `你的错因集中在<b>时间不够（${top.pct}%）</b>：先做有把握的题，拿不准的标记后回查，别在单题上恋战`
  return `你的错因集中在「${top.reason}」（${top.pct}%）：针对这个习惯调整答题节奏`
})
let contentSeq = 0 // 防竞态：快速切范围/年份时旧请求晚返回，seq 不匹配则丢弃
const heatFading = ref(false) // B2 年份切换淡入淡出过渡态
async function loadContent() {
  const seq = ++contentSeq
  const sid = filterSubjectId.value
  const hy = heatYear.value
  const [sumR, heatR, catR] = await Promise.allSettled([
    tiku.getSummary(sid),
    tiku.getActivityHeatmap(hy, sid),
    tiku.getCategoryAccuracy(sid)
  ])
  if (seq !== contentSeq) return
  if (sumR.status === 'fulfilled') summary.value = sumR.value
  if (heatR.status === 'fulfilled') heatmap.value = heatR.value; else heatmap.value = []
  if (catR.status === 'fulfilled') catAccuracy.value = catR.value; else catAccuracy.value = []
  heatFading.value = false // 数据落地 → 淡入（年份切换动画）
}
async function loadGlobal() {
  const seq = contentSeq
  try {
    const q = await tiku.checkQuests(filterSubjectId.value)
    if (seq === contentSeq) quest.value = { tasks: q.tasks, claimed: q.claimed.join('、') }
  } catch (e) { if (seq === contentSeq) quest.value = { tasks: [], claimed: '' } }
}

watch(filterSubjectId, async () => {
  if (loggedIn.value) { await loadContent(); await loadGlobal() } // 切范围刷新内容类 + 每日任务（目标跟随科目）
})

onMounted(async () => {
  await login()
  await loadAnalysis()
  computeHeatSize()
  // ResizeObserver 回调内同步读尺寸会触发 "loop completed" 警告 → rAF 延迟打破同步循环
  heatObs = new ResizeObserver(() => {
    if (heatRaf) return
    heatRaf = requestAnimationFrame(() => { heatRaf = 0; computeHeatSize() })
  })
  if (heatWrapEl.value) heatObs.observe(heatWrapEl.value)
})
let heatRaf = 0
watch(() => heatGrid.value.cols, () => { if (loggedIn.value) computeHeatSize() }) // 年份/数据变化后重算格子尺寸
onBeforeUnmount(() => {
  if (heatObs) heatObs.disconnect()
  if (heatRaf) cancelAnimationFrame(heatRaf)
})

// ---- 章节正确率雷达 + 练习成绩历史曲线 ----
const catAccuracy = ref([])
const examHistory = ref([])
const radarCenter = { x: 90, y: 84 }
// B1 强弱章节：catAccuracy 升序 → 最弱在前、最强在后
const bestWeak = computed(() => {
  const l = catAccuracy.value
  if (l.length < 2 || l[l.length - 1].rate <= l[0].rate) return null
  return { best: l[l.length - 1], weak: l[0] }
})
// A2 雷达中心平均正确率（catAccuracy 平均）
const avgRate = computed(() => {
  const l = catAccuracy.value
  if (!l.length) return 0
  return Math.round(l.reduce((a, c) => a + c.rate, 0) / l.length)
})
const radarCats = computed(() => catAccuracy.value.slice(0, 6)) // 正确率最低 6 章
const radarPoints = computed(() => {
  const n = Math.max(3, radarCats.value.length)
  return radarCats.value.map((c, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / n
    const r = 56 - (c.rate / 100) * 46
    return { x: radarCenter.x + r * Math.cos(ang), y: radarCenter.y + r * Math.sin(ang), cat: c.cat, rate: c.rate }
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
// A3 曲线近 5 次均值参考线（虚线 + 标签）
const avgRecent = computed(() => {
  const h = examHistory.value
  if (h.length < 2) return null
  const recent = h.slice(-5)
  return Math.round(recent.reduce((a, e) => a + e.pct, 0) / recent.length)
})
const avgLineY = computed(() => avgRecent.value === null ? 0 : 62 - (avgRecent.value / 100) * 50)
// ⑦ 曲线面积：histPath 闭合到基线 → 渐变填充（升级面积趋势图）
const areaPath = computed(() => {
  const p = histPath.value
  if (!p) return ''
  return p + ' L290,62 L10,62 Z'
})
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
        :class="{ active: subjectScope === 'all' }"
        @click="subjectScope = 'all'"
      >全部科目</button>
      <button
        class="filter-chip"
        :class="{ active: subjectScope === 'current' }"
        @click="subjectScope = 'current'"
      >{{ props.subject.name || '全部' }}</button>
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
      <div class="card heat-card" v-tilt="{ deg: 3, flat: true }">
        <div class="heat-head">
          <span class="card-title">学习热力图 <span class="heat-scope">（{{ subjectScope === 'all' ? '全部科目' : (props.subject.name || '全部') }}）</span></span>
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
        <div ref="heatWrapEl" class="heat-flex" :class="{ fading: heatFading }">
          <div class="heat-stats">
            <div class="hs-item"><b>{{ heatStats.week ?? '—' }}</b><span>本周</span></div>
            <div class="hs-item"><b>{{ heatStats.total }}</b><span>{{ heatYear === nowY() ? '近一年' : '全年' }}</span></div>
            <div class="hs-item"><b>{{ heatStats.activeDays }}</b><span>累计</span></div>
            <div class="hs-item"><b class="hot">{{ heatStats.streak }}</b><span>连续</span></div>
            <div class="hs-item"><b>{{ heatStats.peak ? heatStats.peak.count : '—' }}</b><span :title="heatStats.peak ? heatStats.peak.date : ''">峰值{{ heatStats.peak ? ' · ' + heatStats.peak.date.slice(5) : '' }}</span></div>
            <div class="hs-item"><b>{{ heatStats.bestDay ? heatStats.bestDay.n : '—' }}</b><span>最勤{{ heatStats.bestDay ? heatStats.bestDay.name : '' }}</span></div>
          </div>
          <div class="heat-main">
            <div class="heat-months">
              <span v-for="m in heatGrid.months" :key="m.col" class="hm-label" :title="`${m.label} · ${monthTotals[m.label] || 0} 题`" :style="{ left: m.col * (heatCellSize + heatGap) + 'px' }">{{ m.label }}</span>
            </div>
            <div class="heat-grid" :key="'h' + heatYear + '-' + filterSubjectId" :style="{ gridTemplateColumns: `repeat(${heatGrid.cols}, ${heatCellSize}px)`, gridTemplateRows: `repeat(7, ${heatCellSize}px)`, columnGap: heatGap + 'px' }" @mouseleave="onHeatLeave">
              <div
                v-for="(c, i) in heatGrid.cells"
                :key="i"
                class="heat-cell"
                :class="[c.count < 0 ? 'ghost' : 'lvl-' + heatLevel(c.count), c.isToday ? 'today' : '']"
                :style="{ width: heatCellSize + 'px', height: heatCellSize + 'px', animationDelay: (Math.floor(i / 7) * 0.008) + 's' }"
                @mouseenter="onHeatEnter($event, c)"
              ></div>
            </div>
          </div>
        </div>
        <Teleport to="body">
          <div ref="tipEl" v-show="hoverCell" class="heat-tip">
            <i v-if="hoverCell && hoverCell.isToday" class="ht-today">今天</i>{{ hoverCell && hoverCell.date.slice(5) }} · {{ hoverCell ? weekLabel(hoverCell.date) : '' }} · <span class="ht-count" :class="{ none: hoverCell && !hoverCell.count }">{{ hoverCell && hoverCell.count > 0 ? hoverCell.count + '题' : '无记录' }}</span>
          </div>
        </Teleport>
      </div>

      <!-- 每日任务 Quest（未设置显示友好提示） -->
      <div class="card quest-card" v-tilt="{ deg: 3, flat: true }">
        <div class="card-title">每日任务 <span class="quest-xp">每个 +20 XP</span></div>
        <div v-if="quest.claimed" class="quest-claimed">{{ quest.claimed }} 已完成，XP 已到账</div>
        <div v-if="!quest.tasks.length" class="quest-empty">
          <span>未设置任务，去「我的 → 学习目标」设置每日刷题目标吧</span>
          <button class="quest-set" @click="emit('goto', 'profile', 'goals')">去设置 ›</button>
        </div>
        <div v-else class="quest-list">
          <div v-for="t in quest.tasks" :key="t.key" class="quest-item" :class="{ done: t.done }">
            <span class="quest-check"><Icon v-if="t.done" name="check" :size="14"/><i v-else class="hollow"></i></span>
            <span class="quest-name">{{ t.name }}</span>
            <span class="quest-state">{{ t.done ? '已完成' : '待完成' }}</span>
          </div>
        </div>
      </div>

      <!-- 分析：章节正确率雷达 + 成绩历史 -->
      <div class="card analysis-card" v-tilt="{ deg: 3, flat: true }">
        <div class="card-title">章节正确率雷达 <span class="card-sub">（最弱 {{ radarCats.length }} 章）</span></div>
        <svg v-if="radarCats.length" viewBox="0 0 180 176" class="radar">
          <polygon :points="gridHex(56)" fill="none" stroke="var(--line)" stroke-width="1"/>
          <polygon :points="gridHex(28)" fill="none" stroke="var(--line)" stroke-width="1"/>
          <polygon :points="radarPoly" fill="var(--brand)" fill-opacity="0.25" stroke="var(--brand)" stroke-width="2" pathLength="1" class="radar-poly"/>
          <text x="90" y="80" text-anchor="middle" class="radar-avg">{{ avgRate }}%</text>
          <text x="90" y="94" text-anchor="middle" class="radar-avg-sub">平均正确率</text>
          <circle v-for="(p, i) in radarPoints" :key="p.cat" :cx="p.x" :cy="p.y" r="3" fill="var(--brand)" class="radar-dot" :style="{ animationDelay: (0.55 + i * 0.06) + 's' }">
            <title>{{ p.cat }} · 正确率 {{ p.rate }}%</title>
          </circle>
          <text v-for="(c, i) in radarCats" :key="'l' + i" :x="labelPos(i).x" :y="labelPos(i).y" class="radar-label" text-anchor="middle">
            <title>{{ c.cat }} · 正确率 {{ c.rate }}%</title>{{ c.cat.length > 4 ? c.cat.slice(0, 4) + '…' : c.cat }}
          </text>
        </svg>
        <div v-if="!radarCats.length" class="empty-sm">暂无答题数据</div>
        <div class="card-title hist-title">近 {{ examHistory.length }} 次练习正确率</div>
        <svg v-if="histPath" viewBox="0 0 300 70" class="hist">
          <defs>
            <linearGradient id="histArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--brand)" stop-opacity="0.3"/>
              <stop offset="100%" stop-color="var(--brand)" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <path :d="areaPath" fill="url(#histArea)" class="hist-area"/>
          <line x1="10" y1="62" x2="290" y2="62" stroke="var(--line)" stroke-width="1"/>
          <line v-if="avgRecent !== null" x1="10" :y1="avgLineY" x2="290" :y2="avgLineY" class="hist-avg-line"/>
          <text v-if="avgRecent !== null" x="288" :y="avgLineY - 4" text-anchor="end" class="hist-avg-label">近5均 {{ avgRecent }}%</text>
          <path :d="histPath" class="hist-path" pathLength="1" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linejoin="round"/>
          <circle v-for="(e, i) in examHistory" :key="i" :cx="histX(i)" :cy="histY(e)" r="2.5" fill="var(--brand)" :class="{ latest: i === examHistory.length - 1 }">
            <title>{{ e.date }} · {{ e.label }} · {{ e.pct }}%</title>
          </circle>
        </svg>
        <div v-if="!examHistory.length" class="empty-sm">完成练习 / 模考后，这里会记录你的正确率曲线</div>
      </div>

      <!-- B1 强弱章节对比 -->
      <div v-if="bestWeak" class="card bw-card" v-tilt="{ deg: 3, flat: true }">
        <div class="card-title">强弱章节对比 <span class="card-sub">（正确率最高 vs 最低）</span></div>
        <div class="bw-row">
          <div class="bw-item strong">
            <div class="bw-label">最强</div>
            <div class="bw-name" :title="bestWeak.best.cat">{{ bestWeak.best.cat }}</div>
            <div class="bw-rate"><CountUp :value="bestWeak.best.rate" /><small>%</small></div>
            <div class="bw-desc">保持当前复习节奏</div>
          </div>
          <div class="bw-vs">VS</div>
          <div class="bw-item weak" @click="emit('goto', 'bank')" style="cursor:pointer">
            <div class="bw-label">最弱</div>
            <div class="bw-name" :title="bestWeak.weak.cat">{{ bestWeak.weak.cat }}</div>
            <div class="bw-rate"><CountUp :value="bestWeak.weak.rate" /><small>%</small></div>
            <div class="bw-desc">点击去题库 · 优先攻克</div>
          </div>
        </div>
      </div>

      <!-- 错因分析：本周/全部错因分布 + 归因建议（数据来自结果页/错题本标记） -->
      <div class="card reason-card" v-tilt="{ deg: 3, flat: true }">
        <div class="rc-head">
          <span class="card-title">错因分析 <span class="card-sub">（丢分习惯洞察）</span></span>
          <div class="rc-scope">
            <button class="rc-chip" :class="{ on: reasonScope === 'week' }" @click="reasonScope = 'week'; loadReasonAnalysis()">本周</button>
            <button class="rc-chip" :class="{ on: reasonScope === 'all' }" @click="reasonScope = 'all'; loadReasonAnalysis()">全部</button>
          </div>
        </div>

        <div v-if="reasonData && reasonData.total > 0" class="rc-body">
          <div class="rc-stack">
            <div v-for="(r, i) in reasonList" :key="r.reason" class="rc-seg"
              :style="{ width: r.pct + '%', background: (REASON_COLOR[r.reason] || '#888780'), animationDelay: (i * 0.1) + 's' }"
              :title="`${r.reason} ${r.pct}%`"></div>
          </div>
          <div class="rc-rows">
            <div v-for="r in reasonList" :key="'r' + r.reason" class="rc-row">
              <div class="rc-row-top">
                <span class="rc-name" :style="{ color: REASON_COLOR[r.reason] || 'var(--text)' }">{{ r.reason }} <span class="rc-count">· {{ r.count }} 次</span></span>
                <span class="rc-pct" :style="{ color: REASON_COLOR[r.reason] || 'var(--text)' }">{{ r.pct }}%
                  <span v-if="r.delta !== null" class="rc-delta" :class="r.delta > 0 ? 'up' : (r.delta < 0 ? 'down' : 'flat')" :title="`较上周 ${r.delta > 0 ? '+' : ''}${r.delta}%`">{{ r.delta > 0 ? '▲' : (r.delta < 0 ? '▼' : '—') }}</span>
                </span>
              </div>
              <div class="rc-track">
                <div class="rc-fill" :style="{ width: r.pct + '%', background: REASON_COLOR[r.reason] || '#888780' }"></div>
              </div>
            </div>
          </div>
          <div v-if="reasonTip" class="rc-tip" v-html="reasonTip"></div>
        </div>
        <div v-else class="rc-empty">
          <div>暂无错因数据</div>
          <div class="rc-empty-sub">答题结束后标记「粗心 / 知识点不懂 / 时间不够」，这里会分析你的丢分习惯</div>
        </div>
      </div>

    </template>
  </div>
</template>

<style scoped>
.stats { display: flex; flex-direction: column; gap: 16px; }
.stats-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
.stats-title { margin: 0; font-size: 20px; font-weight: 700; color: var(--text); letter-spacing: -.3px; }

/* 统计范围切换：跟随顶部 / 总览 */
.stats-scope { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; }
.scope-label { font-size: 12px; color: var(--muted); }
.filter-chip {
  font-size: 12px; padding: 6px 16px;
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
  border: 1px solid var(--line); border-radius: 14px; padding: 14px 10px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 7%, transparent), color-mix(in srgb, var(--brand2) 4%, transparent));
  box-shadow: 0 2px 12px color-mix(in srgb, var(--brand) 6%, transparent);
}
.kpi-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; padding: 2px 0; }
.kpi-sep { width: 1px; background: var(--line); margin: 6px 8px; }
.kpi-num { font-size: 22px; font-weight: 700; color: var(--text); line-height: 1.1; font-variant-numeric: tabular-nums; }
.kpi-num small { font-size: 13px; color: var(--muted); font-weight: 400; }
.kpi-label { font-size: 11px; color: var(--muted); font-weight: 500; }

/* 热力图（GitHub 贡献图） */
.heat-card { display: flex; flex-direction: column; gap: 12px; overflow-x: clip; overflow-y: visible; padding: 18px; }
.heat-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.heat-scope { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 6px; }
.heat-legend { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--muted); margin-left: auto; }
.heat-legend .heat-cell { width: 12px; height: 12px; cursor: default; border-radius: 2px; }
.heat-year-nav { display: flex; align-items: center; gap: 6px; }
.hy-btn { width: 24px; height: 24px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; font-size: 14px; line-height: 1; display: flex; align-items: center; justify-content: center; }
.hy-btn:hover:not(:disabled) { border-color: var(--brand); color: var(--brand); }
.hy-btn:disabled { opacity: .35; cursor: default; }
.hy-year { font-size: 13px; font-weight: 600; color: var(--text); min-width: 80px; text-align: center; }
.hy-year small { font-size: 10px; color: var(--muted); font-weight: 400; }
.heat-flex { display: flex; gap: 20px; align-items: stretch; }
.heat-stats { display: grid; grid-template-columns: repeat(2, auto); gap: 8px 20px; align-content: center; flex-shrink: 0; }
.hs-item { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 4px 8px; border-radius: 8px; background: var(--bg-faint); }
.hs-item b { font-size: 17px; color: var(--text); font-variant-numeric: tabular-nums; }
.hs-item b.hot { color: var(--warn); }
.hs-item span { font-size: 10px; color: var(--muted); }
.heat-main { flex: 1; min-width: 0; overflow: hidden; }
.heat-months { position: relative; height: 16px; margin-bottom: 2px; }
.hm-label { position: absolute; top: 0; font-size: 9px; color: var(--muted); white-space: nowrap; }
.heat-grid { display: grid; grid-auto-flow: column; gap: 2px; }
.heat-cell { width: 10px; height: 10px; border-radius: 2px; background: rgba(148, 163, 184, 0.14); transition: transform .12s ease, box-shadow .12s ease; }
.heat-cell:hover { transform: scale(1.35); box-shadow: 0 0 8px color-mix(in srgb, var(--brand) 45%, transparent); position: relative; z-index: 2; }
.heat-cell.ghost { background: transparent; }
.heat-cell.ghost:hover { box-shadow: none; }
.heat-cell.today { outline: 1.5px solid var(--brand); outline-offset: 1px; }
.heat-cell.lvl-0 { background: rgba(148, 163, 184, 0.14); }
.heat-cell.lvl-1 { background: rgba(28, 58, 110, 0.75); }
.heat-cell.lvl-2 { background: rgba(42, 92, 168, 0.85); }
.heat-cell.lvl-3 { background: rgba(63, 127, 214, 0.9); }
.heat-cell.lvl-4 { background: #5b9cfa; }
.heat-tip { position: fixed; z-index: 9999; background: var(--card, #1b2130); border: 1px solid var(--line); border-radius: 6px; padding: 3px 8px; box-shadow: 0 4px 16px rgba(0, 0, 0, .35); pointer-events: none; white-space: nowrap; font-size: 11px; }
.ht-date { color: var(--text); }
.ht-count { color: var(--brand); }
.ht-count.none { color: var(--muted); }
.ht-today { font-style: normal; color: var(--brand); margin-right: 4px; font-weight: 600; }
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

/* 学习习惯 */

/* 每日任务 */
.quest-xp { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 6px; }
.quest-claimed { font-size: 12px; color: var(--ok); margin-bottom: 8px; }
.quest-empty {
  font-size: 12px; color: var(--muted);
  border: 1px dashed var(--line); border-radius: 10px; padding: 10px 14px;
  display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap;
}
.quest-set {
  background: transparent; border: 1px solid var(--brand); color: var(--brand);
  border-radius: 999px; padding: 4px 14px; font-size: 12px; cursor: pointer;
  transition: all .15s;
}
.quest-set:hover { background: var(--brand-light); box-shadow: var(--glow-soft); }
.quest-list { display: flex; flex-direction: column; gap: 8px; }
.quest-item {
  display: flex; align-items: center; gap: 10px;
  border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px;
}
.quest-item.done { border-color: color-mix(in srgb, var(--ok) 40%, transparent); background: color-mix(in srgb, var(--ok) 5%, transparent); }
.quest-check { width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--muted); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; color: var(--muted); }
.quest-item.done .quest-check { border-color: var(--ok); color: var(--ok); }
.quest-name { flex: 1; font-size: 13px; color: var(--text); }
.quest-state { font-size: 11px; color: var(--muted); }

/* 错因分析卡 */
.reason-card { padding: 14px 16px; }
.rc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.rc-scope { display: flex; gap: 6px; }
.rc-chip {
  font-size: 11.5px; padding: 3px 10px; border-radius: 7px; cursor: pointer;
  background: transparent; color: var(--muted);
  border: 1px solid var(--line); transition: all .15s;
}
.rc-chip.on { background: var(--brand-light); border-color: var(--brand); color: var(--brand); }
.rc-stack { display: flex; height: 10px; border-radius: 5px; overflow: hidden; margin-bottom: 14px; }
.rc-seg { height: 100%; }
.rc-rows { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
.rc-row-top { display: flex; justify-content: space-between; align-items: baseline; font-size: 12.5px; margin-bottom: 4px; }
.rc-name { font-weight: 500; }
.rc-count { color: var(--muted); font-weight: 400; }
.rc-pct { font-weight: 500; }
.rc-track { height: 6px; border-radius: 3px; background: rgba(148, 163, 184, 0.12); overflow: hidden; }
.rc-fill { height: 100%; border-radius: 3px; }
.rc-tip {
  padding: 10px 12px; font-size: 12.5px; line-height: 1.6; color: var(--tip-text);
  background: color-mix(in srgb, var(--brand) 8%, transparent); border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent); border-radius: 10px;
}
.rc-tip b { color: var(--brand); }
.rc-empty {
  font-size: 12.5px; color: var(--muted); text-align: center;
  border: 1px dashed var(--line); border-radius: 10px; padding: 16px 12px;
}
.rc-empty-sub { font-size: 11.5px; color: var(--muted); opacity: .8; margin-top: 6px; }

/* ===== 统计页铺开（2026-08-12）：渐变语言 / 热力图渐变边框+流光 ===== */
/* KPI 数字渐变光泽 + 分隔线渐变（与首页同语言；三主题由 --num-grad 统一） */
.kpi-num {
  background: var(--num-grad);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
}
.kpi-num small { -webkit-text-fill-color: var(--muted); }
.kpi-sep { background: linear-gradient(180deg, transparent, rgba(148, 163, 184, 0.35), transparent); }

/* 热力图卡：渐变边框（主角）+ hover 流光描边 */
.heat-card {
  border: 1px solid transparent;
  background-image:
    linear-gradient(var(--card), var(--card)),
    linear-gradient(135deg, color-mix(in srgb, var(--brand) 45%, transparent), color-mix(in srgb, var(--brand2) 45%, transparent));
  background-origin: border-box;
  background-clip: padding-box, border-box;
  position: relative;
}
.heat-card::after {
  content: ''; position: absolute; inset: -1px; border-radius: inherit;
  padding: 1px;
  background: conic-gradient(from var(--ang), transparent 0deg, color-mix(in srgb, var(--brand) 70%, transparent) 80deg, transparent 170deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0; pointer-events: none; transition: opacity .18s;
}
.heat-card:hover::after { opacity: 1; animation: angSpin 2.2s linear infinite; }

/* ===== 统计页加浓（2026-08-12）：首页同款浓度 ===== */
/* stagger 交错入场：与首页同步（1-2 为标题/范围，3 起卡片依次浮入） */
.stats > * { animation: riseIn .4s cubic-bezier(.2, .7, .3, 1) both; }
.stats > *:nth-child(3) { animation-delay: .04s; }
.stats > *:nth-child(4) { animation-delay: .09s; }
.stats > *:nth-child(5) { animation-delay: .14s; }
.stats > *:nth-child(6) { animation-delay: .19s; }
.stats > *:nth-child(7) { animation-delay: .24s; }
.stats > *:nth-child(8) { animation-delay: .29s; }

/* 大标题渐变（门面） */
.stats-title {
  background: linear-gradient(90deg, #93b1ff, #c3a8ff);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
}
[data-theme="light"] .stats-title { background: linear-gradient(90deg, #3d5bd9, #7c3aed); -webkit-background-clip: text; background-clip: text; }
[data-theme="eye"] .stats-title { background: linear-gradient(90deg, #2e6649, #4d8f6e); -webkit-background-clip: text; background-clip: text; }

/* 成绩曲线：入场后 1s「画出来」（pathLength=1 + dashoffset） */
.hist-path {
  stroke-dasharray: 1; stroke-dashoffset: 1;
  animation: drawPath 1.1s cubic-bezier(.4, 0, .2, 1) .5s forwards;
}
@keyframes drawPath { to { stroke-dashoffset: 0; } }

/* 错因分布条/百分比条：从 0 填充 */
.rc-fill { animation: fillBar .9s cubic-bezier(.3, .7, .3, 1) both; }
.rc-stack .rc-seg { animation: fillBar .9s cubic-bezier(.3, .7, .3, 1) both; }

/* 热力图卡：右上装饰光斑（与流光 ::after 不冲突） */
.heat-card::before {
  content: ''; position: absolute; top: -60px; right: -8px;
  width: 170px; height: 170px; border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--brand) 9%, transparent), transparent 62%);
  pointer-events: none;
}

/* KPI 数字弹入（同首页） */
.kpi-num { animation: numPop .45s cubic-bezier(.2, .7, .3, 1) both; }
@keyframes numPop { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: scale(1); } }


/* ===== 统计页打磨（2026-08-13）：A2 4 卡流光 / A4 最新点发光 ===== */
/* A2 雷达/错因/习惯/任务 卡补流光描边（与热力图卡同款，全站语言统一） */
.analysis-card::after, .reason-card::after, .quest-card::after {
  content: ''; position: absolute; inset: -1px; border-radius: inherit;
  padding: 1px;
  background: conic-gradient(from var(--ang), transparent 0deg, color-mix(in srgb, var(--brand) 55%, transparent) 80deg, transparent 170deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  opacity: 0; transition: opacity .2s ease; pointer-events: none; z-index: 1;
}
.analysis-card:hover::after, .reason-card:hover::after, .quest-card:hover::after {
  opacity: 1; animation: angSpin 2.2s linear infinite;
}
/* 卡片容器需 relative（流光 absolute 定位） */
.analysis-card, .reason-card, .quest-card { position: relative; }

/* A4 曲线最新点：放大 + 品牌光晕（一眼看到现在的水平） */
.hist circle.latest {
  r: 4;
  fill: var(--brand);
  stroke: var(--bg, #0b1020);
  stroke-width: 1.5;
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--brand) 90%, transparent));
  transition: r .2s ease, filter .2s ease;
}


/* ===== 统计页打磨 B/C 组（2026-08-13）：今日呼吸 / 年份过渡 / 错因行 hover / 习惯数字 ===== */
/* B1 今日格子：呼吸光晕（品牌光 2.4s 一圈，叠加现有 today outline） */
.heat-cell.today { animation: heatToday 2.4s ease-in-out infinite; }
@keyframes heatToday {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--brand) 35%, transparent); }
  50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 55%, transparent); }
}

/* B2 年份切换：淡出 → 数据回来淡入 */
.heat-flex { transition: opacity .25s ease; }
.heat-flex.fading { opacity: 0; }

/* C1 错因行 hover：亮底 + 条微亮 */
.rc-row {
  transition: background .15s ease;
  border-radius: 8px; padding: 6px 8px; margin: 0 -8px;
}
.rc-row:hover { background: color-mix(in srgb, var(--brand) 7%, transparent); }
.rc-row:hover .rc-fill { filter: brightness(1.3); }

/* C2 学习习惯数字：渐变 + 弹入（KPI 同语言） */


/* ===== 统计页特效批一（2026-08-13）：扫描点亮/雷达展开/点反馈/面积/周报按钮 ===== */
/* ① 热力图格子扫描点亮（从左到右，0.008s×列；ghost 占位不参与） */
.heat-cell { animation: cellIn .45s ease both; }
.heat-cell.ghost { animation: none; }
@keyframes cellIn { from { opacity: 0 } to { opacity: 1 } }

/* ③ 雷达：描边画出来（复用 drawPath）+ 填充渐显 + 顶点依次弹入 */
.radar-poly {
  stroke-dasharray: 1; stroke-dashoffset: 1;
  fill-opacity: 0;
  animation: drawPath .8s cubic-bezier(.4, 0, .2, 1) .2s forwards,
             radarFade .5s ease .9s forwards;
}
@keyframes radarFade { to { fill-opacity: 1 } }
.radar-dot { animation: dotPop .4s cubic-bezier(.2, .7, .3, 1) both; }
@keyframes dotPop { from { opacity: 0; r: 0 } to { opacity: 1; r: 3 } }

/* ④ 曲线点 hover 放大发光（最新点已有专属发光，历史点补反馈） */
.hist circle { transition: r .15s ease, filter .15s ease; cursor: pointer; }
.hist circle:hover { r: 4.5; filter: drop-shadow(0 0 5px color-mix(in srgb, var(--brand) 85%, transparent)); }

/* ⑦ 曲线面积：淡入（等描边画完后 0.3s 渐显） */
.hist-area { opacity: 0; animation: areaFade .6s ease 1.1s forwards; }
@keyframes areaFade { to { opacity: 1 } }

/* ⑨ 雷达顶点 hover 放大发光 */
.radar-dot { transition: r .15s ease, filter .15s ease; cursor: pointer; }
.radar-dot:hover { r: 4.5; filter: drop-shadow(0 0 5px color-mix(in srgb, var(--brand) 85%, transparent)); }

/* ⑩ 导出周报按钮：hover 品牌光晕 + 微弹 */
.report-btn { transition: all .18s ease; }
.report-btn:hover { box-shadow: 0 4px 18px color-mix(in srgb, var(--brand) 45%, transparent), 0 0 0 1px color-mix(in srgb, var(--brand) 50%, transparent); transform: translateY(-1px); }
.report-btn:active { transform: translateY(0) scale(.97); }


/* ===== 统计页洞察批二 A1/A2/A3/B1（2026-08-13）===== */
/* A2 雷达中心均值：渐变 + 弹入（KPI 同语言） */
.radar-avg {
  font-size: 17px; font-weight: 700;
  fill: var(--brand);
  animation: numPop .5s cubic-bezier(.2, .7, .3, 1) .55s both;
}
.radar-avg-sub { font-size: 8.5px; fill: var(--muted); animation: numPop .5s cubic-bezier(.2, .7, .3, 1) .65s both; }

/* A3 曲线均值参考线：橙色虚线 + 标签（描边后淡入） */
.hist-avg-line { stroke: var(--warn); stroke-width: 1; stroke-dasharray: 4 3; opacity: 0; animation: areaFade .6s ease 1.3s forwards; }
.hist-avg-label { font-size: 9px; fill: var(--warn); opacity: 0; animation: areaFade .6s ease 1.3s forwards; }

/* B1 强弱章节对比卡 */
.bw-row { display: flex; align-items: stretch; gap: 10px; }
.bw-item {
  flex: 1; min-width: 0; border-radius: 10px; padding: 12px 14px;
  border: 1px solid var(--line); text-align: center;
}
.bw-item.strong { background: rgba(47, 191, 143, 0.08); border-color: rgba(47, 191, 143, 0.4); }
.bw-item.weak { background: rgba(229, 83, 95, 0.07); border-color: rgba(229, 83, 95, 0.4); }
.bw-label { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
.bw-item.strong .bw-label { color: var(--ok-soft); }
.bw-item.weak .bw-label { color: var(--bad-soft); }
.bw-name { font-size: 13px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bw-rate { font-size: 24px; font-weight: 700; margin: 4px 0 2px; }
.bw-item.strong .bw-rate { color: var(--ok); }
.bw-item.weak .bw-rate { color: var(--bad); }
.bw-rate small { font-size: 13px; color: var(--muted); }
.bw-desc { font-size: 11px; color: var(--muted); }
.bw-vs { align-self: center; font-size: 11px; font-weight: 700; color: var(--muted); opacity: .7; flex-shrink: 0; }


/* A4 错因趋势箭头：恶化红▲ / 改善绿▼ / 持平灰—（弹跳出现） */
.rc-delta {
  font-size: 10px; margin-left: 4px;
  animation: deltaPop .3s cubic-bezier(.2, .7, .3, 1) both;
}
@keyframes deltaPop { from { opacity: 0; transform: scale(.4) } 70% { transform: scale(1.25) } to { opacity: 1; transform: scale(1) } }
.rc-delta.up { color: var(--bad); }
.rc-delta.down { color: var(--ok); }
.rc-delta.flat { color: var(--muted); }

/* 窄屏（手机/窄窗口）：热力图统计列与格子区垂直堆叠，避免挤压溢出 */
@media (max-width: 640px) {
  .heat-flex { flex-direction: column; }
  .heat-stats { grid-template-columns: repeat(3, auto); }
  /* 热力图：窄屏格子缩小（5px+1px 间距，53 周一屏放全）；极端情况仍可横向滚动查看 */
  .heat-main { overflow-x: auto; -webkit-overflow-scrolling: touch; }
}

</style>