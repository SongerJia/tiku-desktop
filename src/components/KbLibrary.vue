<script setup>
import Icon from './Icon.vue'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { showConfirm } from '../utils/confirm.js'
import { useEsc } from '../utils/useEsc.js'
import { useBodyLock } from '../composables/useBodyLock.js'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import KbReader from './KbReader.vue'

const props = defineProps({ subject: { type: Object, default: () => ({ id: null, name: '' }) }, scope: { type: String, default: 'current' }, refreshToken: { type: Number, default: 0 } })
const emit = defineEmits(['manage'])
const docs = ref([])
const allTags = ref([])
const tagFilter = ref(null) // null=全部
const keyword = ref('')
const loading = ref(true)
const importing = ref(false)
const reader = ref({ show: false, doc: null })
const editor = ref({ show: false, doc: null, tags: [], title: '', subjectId: null, categoryId: null, chapters: [] })
useBodyLock(() => editor.value.show)
useFocusTrap(() => editor.value.show, '.kb-modal')
// 文档编辑弹窗「所属科目」下拉的数据源
const subjects = ref([])
// 知识库范围：'current' 跟随顶部科目（tab 默认）；'all' 全部科目管理（「我的→知识库概览」进入）
const filterSubjectId = computed(() => props.scope === 'all' ? undefined : props.subject.id || undefined)

let debounceTimer = null
onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  // 拖拽中卸载的兜底：移除 window 级监听（图谱 pan 的 mousemove/mouseup）
  if (typeof onGraphPanEnd === 'function') onGraphPanEnd()
})
// Esc：文档信息弹窗（kb-mask）打开时关闭它；阅读器由 KbReader 自行处理
useEsc(() => { if (editor.value.show) editor.value.show = false })

async function loadList() {
  loading.value = true
  if (keyword.value.trim()) {
    const hits = await tiku.kbSearch(keyword.value.trim(), 50)
    docs.value = hits.map(h => ({ ...h, tags: [], linkCount: 0 }))
  } else {
    docs.value = await tiku.kbList(filterSubjectId.value)
  }
  loading.value = false
}

async function loadTags() {
  allTags.value = await tiku.kbTags()
}

async function loadSubjects() {
  try { subjects.value = await tiku.getSubjects() } catch (e) { subjects.value = [] }
}

// 章节名映射（列表分组/图谱图例共用）：展平分类树 id → name（二级章节直接取，一级科目名拼接）
const catNameMap = ref({})
async function loadCatNames() {
  try {
    const tree = await tiku.getCategories()
    const flat = {}
    const walk = (nodes, parentName) => {
      for (const n of nodes || []) {
        flat[n.id] = parentName ? `${parentName} · ${n.name}` : n.name
        walk(n.children, flat[n.id])
      }
    }
    walk(tree)
    catNameMap.value = flat
  } catch (e) { catNameMap.value = {} }
}

watch(() => props.subject.id, () => { if (props.scope !== 'all') loadList() }) // 顶部切科目（跟随态）→ 刷新
watch(() => props.refreshToken, () => { if (props.refreshToken) loadList() }) // 文档管理弹窗变更 → 刷新
watch(() => props.scope, loadList) // 范围切换（current↔all）→ 刷新

onMounted(() => {
  loadTags()
  loadSubjects()
  loadCatNames()
  loadList()
  loadGraph()
})

// ---- 知识互链图谱（环形布局，点击节点打开文档）----
const viewMode = ref('list')
const graph = ref({ nodes: [], links: [] })
const graphNodes = computed(() => graph.value.nodes.slice(0, 40))
const graphNodeIds = computed(() => new Set(graphNodes.value.map(n => n.id)))
const graphLinks = computed(() => graph.value.links.filter(l => graphNodeIds.value.has(l.from_doc_id) && graphNodeIds.value.has(l.to_doc_id)))

// 图谱节点着色（2026-08-13）：按科目/章节维度切换 + 色板 hash 分配 + 图例。
// 图谱节点着色（2026-08-13 简化）：固定按章节着色，无章节节点灰色；不提供维度切换（顶部科目上下文已定范围）
const GRAPH_COLORS = ['#5b7cfa', '#2fbf8f', '#ffb84d', '#e5535f', '#c084fc', '#38bdf8', '#f472b6', '#a3e635']
function colorKey(v) {
  let h = 0
  for (let i = 0; i < String(v).length; i++) h = (h * 31 + String(v).charCodeAt(i)) >>> 0
  return GRAPH_COLORS[h % GRAPH_COLORS.length]
}
function nodeDimKey(node) {
  return node.categoryId ? 'c' + node.categoryId : ''
}
function nodeDimName(key) {
  if (!key) return '未分类'
  return catNameMap.value[key.slice(1)] || ('章节 #' + key.slice(1))
}
function nodeColor(node) {
  const k = nodeDimKey(node)
  return k ? colorKey(k) : 'rgba(148, 163, 184, 0.45)'
}
// 图例：当前维度下出现的 key → 名称/颜色（去重，前 8）
const graphLegend = computed(() => {
  const seen = new Map()
  for (const n of graphNodes.value) {
    const k = nodeDimKey(n)
    if (!k) continue
    if (!seen.has(k)) seen.set(k, { name: nodeDimName(k), color: colorKey(k) })
  }
  return [...seen.values()].slice(0, 8)
})

// 力导向布局（2026-08-13）：Fruchterman-Reingold 冷却版（确定性，无随机）
// - 斥力 k²/dist + 引力 dist²/k + 温度冷却位移限幅（防过冲）
// - 硬分离（dist<14 直接推开）防重叠 + 墙斥力（靠边往里推）防挤死角落
// - 固定环形初始 + 全确定性 → 每次打开布局一致不跳变
function layoutForce(nodes, links, iterations = 100) {
  if (!nodes.length) return {}
  const pos = {}
  const k = Math.sqrt((296 * 216) / Math.max(1, nodes.length))
  nodes.forEach((node, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / nodes.length
    pos[node.id] = { x: 160 + 88 * Math.cos(ang), y: 110 + 70 * Math.sin(ang) }
  })
  const adj = new Map()
  for (const l of links) {
    if (!adj.has(l.from_doc_id)) adj.set(l.from_doc_id, new Set())
    adj.get(l.from_doc_id).add(l.to_doc_id)
  }
  for (let it = 0; it < iterations; it++) {
    const ids = Object.keys(pos)
    const disp = {}
    for (const id of ids) disp[id] = { x: 0, y: 0 }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]], b = pos[ids[j]]
        let dx = a.x - b.x, dy = a.y - b.y
        let dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 0.5) { dx = ((i * 37) % 9) - 4; dy = ((j * 53) % 9) - 4; dist = Math.hypot(dx, dy) || 1 }
        // 硬分离：过近直接推开（防重叠）
        if (dist < 14) {
          const sep = (14 - dist) / 2 * 0.3
          a.x += (dx / dist) * sep; a.y += (dy / dist) * sep
          b.x -= (dx / dist) * sep; b.y -= (dy / dist) * sep
          dist = 14
        }
        const f = (k * k) / dist
        const fx = (dx / dist) * f, fy = (dy / dist) * f
        disp[ids[i]].x += fx; disp[ids[i]].y += fy
        disp[ids[j]].x -= fx; disp[ids[j]].y -= fy
      }
    }
    // 引力：有链接的互相靠近
    for (const [from, set] of adj) {
      const a = pos[from], da = disp[from]
      if (!a || !da) continue
      for (const to of set) {
        const b = pos[to], db = disp[to]
        if (!b || !db) continue
        const dx = b.x - a.x, dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const f = (dist * dist) / k
        da.x -= (dx / dist) * f; da.y -= (dy / dist) * f
        db.x += (dx / dist) * f; db.y += (dy / dist) * f
      }
    }
    // 温度冷却 + 墙斥力（防挤死角落）
    const temp = Math.max(1.2, 8 * (1 - it / iterations))
    for (const id of ids) {
      const d = disp[id]
      const len = Math.hypot(d.x, d.y) || 1
      let px = pos[id].x + (d.x / len) * Math.min(len, temp)
      let py = pos[id].y + (d.y / len) * Math.min(len, temp)
      const m = 16
      if (px < 20 + m) px += (20 + m - px) * 0.18
      if (px > 300 - m) px -= (px - (300 - m)) * 0.18
      if (py < 20 + m) py += (20 + m - py) * 0.18
      if (py > 220 - m) py -= (py - (220 - m)) * 0.18
      pos[id].x = Math.max(20, Math.min(300, px))
      pos[id].y = Math.max(20, Math.min(220, py))
    }
  }
  return pos
}
// 节点位置缓存：节点集变化时重算一次（避免 computed 每帧重跑 80 轮迭代）
let cachedNodes = null
let cachedPos = null
const gPos = computed(() => {
  const key = graphNodes.value.map(n => n.id).join(',')
  if (cachedNodes !== key) {
    cachedNodes = key
    cachedPos = layoutForce(graphNodes.value, graphLinks.value)
  }
  return cachedPos
})
// 节点度数（连接数）→ 大小（枢纽一眼可见）+ hub 呼吸光晕判定
const nodeDeg = (node) => graphLinks.value.filter(l => l.from_doc_id === node.id || l.to_doc_id === node.id).length
const nodeRadius = (node) => {
  const deg = nodeDeg(node)
  const base = node.type === 'pdf' ? 7 : 5.5
  return Math.min(13, base + deg * 1.6)
}
// hover 节点 → 其相连边高亮（2026-08-13 特效⑦）
const hoverNodeId = ref(null)
const gEdges = computed(() => graphLinks.value.map(l => {
  const a = gPos.value[l.from_doc_id]
  const b = gPos.value[l.to_doc_id]
  return a && b ? { x1: a.x, y1: a.y, x2: b.x, y2: b.y } : null
}).filter(Boolean))
function shortTitle(t) { const s = String(t || ''); return s.length > 6 ? s.slice(0, 6) + '…' : s }
function openGraphDoc(n) {
  const d = docs.value.find(x => x.id === n.id)
  if (d) openReader(d)
  else openReader({ id: n.id, type: n.type, title: n.title })
}
function toggleGraph() {
  viewMode.value = viewMode.value === 'graph' ? 'list' : 'graph'
  if (viewMode.value === 'graph') loadGraph()
}
async function loadGraph() {
  // 跟随顶部范围（科目/章节）+ 列表标签筛选（联动）
  try {
    graph.value = await tiku.getKbGraph({
      subjectId: filterSubjectId.value,
      tag: tagFilter.value || null
    })
  } catch (e) { graph.value = { nodes: [], links: [] } }
  cachedNodes = null // 节点集变化 → 布局重算（力导向）
  resetGraphView()
}

// 图谱缩放平移 + 全屏（2026-08-13，P0/P1）
const graphZoom = ref(1)
const graphPan = ref({ x: 0, y: 0 })
const graphFull = ref(false)
const ZOOM_MIN = 0.5, ZOOM_MAX = 2.5
function resetGraphView() {
  graphZoom.value = 1
  graphPan.value = { x: 0, y: 0 }
}
function graphZoomBy(factor) {
  graphZoom.value = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(graphZoom.value * factor).toFixed(2)))
}
function onGraphWheel(e) {
  e.preventDefault()
  graphZoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12)
}
let dragStart = null
function onGraphPanStart(e) {
  dragStart = { x: e.clientX - graphPan.value.x, y: e.clientY - graphPan.value.y }
  window.addEventListener('mousemove', onGraphPanMove)
  window.addEventListener('mouseup', onGraphPanEnd)
}
function onGraphPanMove(e) {
  if (!dragStart) return
  graphPan.value = { x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }
}
function onGraphPanEnd() {
  dragStart = null
  window.removeEventListener('mousemove', onGraphPanMove)
  window.removeEventListener('mouseup', onGraphPanEnd)
}

// 图谱跟随：顶部切科目/章节 + 列表标签筛选 → 图谱刷新（联动）
watch(() => props.subject.id, () => {
  if (props.scope !== 'all' && viewMode.value === 'graph') loadGraph()
})
watch(tagFilter, () => {
  if (viewMode.value === 'graph') loadGraph()
})

// 分组可折叠（2026-08-13）：点击分组头收起/展开
const collapsedGroups = ref([])
function toggleGroup(k) {
  const i = collapsedGroups.value.indexOf(k)
  if (i >= 0) collapsedGroups.value.splice(i, 1)
  else collapsedGroups.value.push(k)
}
// 组内「更多」：超过 8 张显示前 8 + 更多(N)▾，点击展开该组全部（与整组折叠共存）
const GROUP_PAGE = 8
const groupMoreOpen = ref([])
function toggleGroupMore(k) {
  const i = groupMoreOpen.value.indexOf(k)
  if (i >= 0) groupMoreOpen.value.splice(i, 1)
  else groupMoreOpen.value.push(k)
}

function onSearchInput() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(loadList, 300)
}

const filteredDocs = computed(() => {
  if (!tagFilter.value) return docs.value
  return docs.value.filter(d => (d.tags || []).includes(tagFilter.value))
})

// 文件夹分组：未分类在前，其余按名称
// 笔记文档（标题以「笔记」结尾）不再单列，直接归入未分类
// 分组：按「科目 · 章节」（B 方案，2026-08-13）——与练习/知识点/图谱/记忆卡同维度。
// 有科目有章节 → '科目 · 章节'；有科目无章节 → 科目名；都无 → 未分类（= 没设归属，提示去设置）
const groupedDocs = computed(() => {
  const groups = new Map()
  // 组内排序：读得多/最近更新的在前
  const byHot = (a, b) => (b.read_count || 0) - (a.read_count || 0) || (b.updated_at || 0) - (a.updated_at || 0)
  for (const d of filteredDocs.value) {
    const subj = d.subject_id ? (subjects.value.find(s => s.id === d.subject_id)?.name || `科目#${d.subject_id}`) : ''
    const cat = d.category_id ? (catNameMap.value[d.category_id] || '') : ''
    let k, label
    if (subj && cat) { k = `s${d.subject_id}|c${d.category_id}`; label = cat } // 组名只显示章节（顶部已定科目，不重复）
    else if (subj) { k = `s${d.subject_id}`; label = subj }
    else { k = ''; label = '未分类' }
    if (!groups.has(k)) groups.set(k, { label, docs: [] })
    groups.get(k).docs.push(d)
  }
  const out = []
  if (groups.has('')) out.push({ folder: '', label: groups.get('').label, docs: groups.get('').docs })
  for (const [k, g] of groups) {
    if (k !== '') out.push({ folder: k, label: g.label, docs: [...g.docs].sort(byHot) })
  }
  return out
})

async function onImport() {
  if (importing.value) return
  importing.value = true
  try {
    const res = (await tiku.kbImportFiles(null, filterSubjectId.value)) || []
    const ok = res.filter(r => r.ok && !r.duplicated) // duplicated 项不重复计数
    const dup = res.filter(r => r.duplicated)
    const failed = res.filter(r => !r.ok)
    if (ok.length || dup.length) {
      await loadTags()
      await loadList()
    }
    const msgs = []
    if (ok.length) msgs.push(`导入 ${ok.length} 篇`)
    if (dup.length) msgs.push(`已存在跳过 ${dup.length} 篇`)
    if (failed.length) msgs.push(`失败 ${failed.length} 篇（${failed[0].error || '仅支持 md/pdf'}）`)
    if (msgs.length) showToast(msgs.join('；'), failed.length ? 'err' : 'ok')
  } finally {
    importing.value = false
  }
}

function openReader(doc) {
  reader.value = { show: true, doc }
}

// 从双链跳转打开另一篇文档（优先本地列表，否则按 id 拉取）
async function openLinkedDoc(docId) {
  const found = docs.value.find(d => d.id === docId)
  if (found) { reader.value = { show: true, doc: found }; return }
  const d = await tiku.kbGet(docId)
  if (d) reader.value = { show: true, doc: { id: d.id, type: d.type, title: d.title } }
}

async function onDelete(doc) {
  const ok = await showConfirm(`确定删除「${doc.title}」？
将同时移除其文本块与题目关联（副本文件一并删除，不影响你的原始文件）。`)
  if (!ok) return
  await tiku.kbDelete(doc.id)
  await loadTags()
  await loadList()
}

async function openEditor(doc) {
  editor.value = { show: true, doc, tags: [...(doc.tags || [])], title: doc.title, subjectId: doc.subject_id ?? null, categoryId: doc.category_id ?? null, chapters: [] }
  await loadChapters(editor.value.subjectId || null) // 加载该科目的章节下拉
}

// 加载某科目的章节列表（getCategories 树里取该科目的 children）
async function loadChapters(subjectId) {
  editor.value.chapters = []
  if (!subjectId) { editor.value.categoryId = null; return }
  try {
    const roots = await tiku.getCategories()
    const sub = roots.find(s => s.id === subjectId)
    editor.value.chapters = (sub && sub.children) || []
  } catch (e) { editor.value.chapters = [] }
}

// 科目切换：清空章节选择并加载新科目的章节
async function onSubjectChange() {
  editor.value.categoryId = null
  await loadChapters(editor.value.subjectId || null)
}

function addEditorTag() {
  const raw = (document.getElementById('kb-tag-input').value || '').trim()
  if (!raw) return
  // 支持逗号（中英文）/顿号/空格分隔一次添加多个
  raw.split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean).forEach(p => {
    if (p && !editor.value.tags.includes(p)) editor.value.tags.push(p)
  })
  document.getElementById('kb-tag-input').value = ''
}

function removeEditorTag(t) {
  editor.value.tags = editor.value.tags.filter(x => x !== t)
}

async function saveEditor() {
  const title = editor.value.title.trim()
  if (title && title !== editor.value.doc.title) await tiku.kbUpdate(editor.value.doc.id, { title })
  const subChanged = (editor.value.subjectId ?? null) !== (editor.value.doc.subject_id ?? null)
  const catChanged = (editor.value.categoryId ?? null) !== (editor.value.doc.category_id ?? null)
  if (subChanged || catChanged) {
    await tiku.kbUpdate(editor.value.doc.id, { subjectId: editor.value.subjectId || null, categoryId: editor.value.categoryId || null })
  }
  await tiku.kbSetTags(editor.value.doc.id, editor.value.tags)
  editor.value.show = false
  await loadTags()
  await loadList()
}

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
</script>

<template>
  <div class="kb">
    <div class="card kb-search-card">
      <div class="kb-scope-line">
        <span class="kb-scope-tag" :class="{ all: scope === 'all' }">{{ scope === 'all' ? '全部科目文档' : (props.subject.name || '当前科目') + ' 文档' }}</span>
      </div>
      <div class="kb-tools">
        <input
          v-model="keyword"
          class="input"
          placeholder="搜索文档全文（中英文均可）"
          @input="onSearchInput"
          @keyup.enter="onSearchInput"
        />
        <button class="btn btn-primary" @click="onSearchInput">搜索</button>
        <button class="btn" :class="{ 'btn-active': viewMode === 'graph' }" @click="toggleGraph">图谱</button>
        <button class="btn btn-primary" @click="emit('manage')">管理文档</button>
      </div>
      <div v-if="allTags.length" class="kb-tag-row">
        <button
          class="filter-chip"
          :class="{ active: !tagFilter }"
          @click="tagFilter = null"
        >全部</button>
        <button
          v-for="t in allTags"
          :key="t.tag"
          class="filter-chip"
          :class="{ active: tagFilter === t.tag }"
          @click="tagFilter = tagFilter === t.tag ? null : t.tag"
        >{{ t.tag }}<span class="kb-tag-n">{{ t.n }}</span></button>
      </div>
    </div>

    <!-- 知识互链图谱 -->
    <div v-if="viewMode === 'graph'" class="card graph-card">
      <div class="graph-title">知识互链图谱 · {{ graph.nodes.length }} 篇文档 / {{ graph.links.length }} 条互链
        <span class="graph-hint">滚轮缩放 · 拖拽平移 · 点击节点打开文档</span>
        <button class="g-full" @click="graphFull = true">⛶ 全屏</button>
      </div>
      <!-- 图例：按章节着色，无章节节点灰色 -->
      <div class="graph-legend">
        <div class="g-legend-items">
          <span v-for="(item, i) in graphLegend" :key="i" class="g-legend-item">
            <i :style="{ background: item.color }"></i>{{ item.name }}
          </span>
          <span v-if="!graphLegend.length" class="g-legend-item muted">文档未设置章节 → 节点为灰色 · 在文档卡「标签/改名/科目」里设置后可着色</span>
        </div>
      </div>
      <!-- 画布：滚轮缩放 + 拖拽平移 -->
      <div class="graph-stage" @wheel.prevent="onGraphWheel" @mousedown.prevent="onGraphPanStart">
        <svg v-if="graphNodes.length" viewBox="0 0 320 240" class="graph-svg"
          :style="{ transform: `scale(${graphZoom}) translate(${graphPan.x}px, ${graphPan.y}px)`, transformOrigin: '0 0' }">
          <line v-for="(e, i) in gEdges" :key="'e' + i" :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2" class="g-edge" pathLength="1"
            :class="{ active: hoverNodeId && (e.from_doc_id === hoverNodeId || e.to_doc_id === hoverNodeId) }"
            :style="{ animationDelay: (i * 0.03) + 's' }"/>
          <g v-for="(n, i) in graphNodes" :key="n.id" class="g-node" @click="openGraphDoc(n)"
            @mouseenter="hoverNodeId = n.id" @mouseleave="hoverNodeId = null"
            :style="{ animationDelay: (i * 0.05) + 's' }">
            <title>{{ n.title }}</title>
            <circle :cx="gPos[n.id].x" :cy="gPos[n.id].y" :r="nodeRadius(n)" :fill="nodeColor(n)" :class="{ hub: nodeDeg(n) >= 3 }"/>
            <text :x="gPos[n.id].x" :y="gPos[n.id].y + 16" class="g-label">{{ shortTitle(n.title) }}</text>
          </g>
        </svg>
        <div v-else class="empty-sm">文档还不多，先导入几篇并在阅读页建立互链，图谱会自动生成</div>
      </div>
      <!-- 缩放控制条 -->
      <div class="graph-ctl">
        <button class="g-ctl-btn" @click="graphZoomBy(1 / 1.2)" title="缩小">−</button>
        <span class="g-zoom-pct">{{ Math.round(graphZoom * 100) }}%</span>
        <button class="g-ctl-btn" @click="graphZoomBy(1.2)" title="放大">+</button>
        <button v-if="graphZoom !== 1 || graphPan.x || graphPan.y" class="g-ctl-btn reset" @click="resetGraphView">复位</button>
      </div>
    </div>

    <!-- 全屏图谱（Teleport 弹层，复用缩放平移状态） -->
    <Teleport to="body">
      <div v-if="graphFull" class="gf-mask" @click.self="graphFull = false">
        <div class="gf-panel">
          <div class="gf-head">
            <span class="gf-title">知识图谱 · 全屏</span>
            <span class="gf-hint">滚轮缩放 · 拖拽平移</span>
            <button class="gf-close" @click="graphFull = false">✕</button>
          </div>
          <div class="gf-stage" @wheel.prevent="onGraphWheel" @mousedown.prevent="onGraphPanStart">
            <svg v-if="graphNodes.length" viewBox="0 0 320 240" class="graph-svg gf-svg"
              :style="{ transform: `scale(${graphZoom}) translate(${graphPan.x}px, ${graphPan.y}px)`, transformOrigin: '0 0' }">
              <line v-for="(e, i) in gEdges" :key="'e' + i" :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2" class="g-edge" pathLength="1"
                :class="{ active: hoverNodeId && (e.from_doc_id === hoverNodeId || e.to_doc_id === hoverNodeId) }"
                :style="{ animationDelay: (i * 0.03) + 's' }"/>
              <g v-for="(n, i) in graphNodes" :key="n.id" class="g-node" @click="openGraphDoc(n)"
                @mouseenter="hoverNodeId = n.id" @mouseleave="hoverNodeId = null"
                :style="{ animationDelay: (i * 0.05) + 's' }">
                <title>{{ n.title }}</title>
                <circle :cx="gPos[n.id].x" :cy="gPos[n.id].y" :r="nodeRadius(n)" :fill="nodeColor(n)" :class="{ hub: nodeDeg(n) >= 3 }"/>
                <text :x="gPos[n.id].x" :y="gPos[n.id].y + 16" class="g-label gf-label">{{ shortTitle(n.title) }}</text>
              </g>
            </svg>
            <div v-else class="empty-sm">文档还不多，先导入几篇并在阅读页建立互链，图谱会自动生成</div>
          </div>
          <div class="graph-ctl gf-ctl">
            <button class="g-ctl-btn" @click="graphZoomBy(1 / 1.2)">−</button>
            <span class="g-zoom-pct">{{ Math.round(graphZoom * 100) }}%</span>
            <button class="g-ctl-btn" @click="graphZoomBy(1.2)">+</button>
            <button v-if="graphZoom !== 1 || graphPan.x || graphPan.y" class="g-ctl-btn reset" @click="resetGraphView">复位</button>
          </div>
        </div>
      </div>
    </Teleport>

    <SkeletonCards v-if="loading" :count="4" />
    <div v-else-if="!docs.length" class="empty card">
      <p>知识库还是空的</p>
      <p class="kb-hint">把 md / pdf 文档拖进导入（点「导入文档」多选），或直接整本教材 PDF 丢进来</p>
      <button class="btn btn-primary" :disabled="importing" @click="onImport">{{ importing ? '导入中…' : '立即导入' }}</button>
    </div>
    <div v-else-if="!filteredDocs.length" class="empty card">没有匹配的文档</div>
    <div v-else class="kb-groups">
      <div v-for="g in groupedDocs" :key="g.folder" class="kb-group">
        <div class="kb-group-head" @click="toggleGroup(g.folder)">
          <span class="kb-fold">{{ collapsedGroups.includes(g.folder) ? '▸' : '▾' }}</span>
          <span class="kb-group-name">{{ g.label }}</span>
          <span class="kb-group-n">{{ g.docs.length }} 篇</span>
        </div>
        <template v-if="!collapsedGroups.includes(g.folder)">
            <div class="kb-grid">
          <div
            v-for="d in (groupMoreOpen.includes(g.folder) ? g.docs : g.docs.slice(0, GROUP_PAGE))"
            :key="d.id"
            class="card kb-card"
            @click="openReader(d)"
          >
            <!-- 继续阅读浮层（hover 显示）：PDF 用阅读位置记忆，MD 用已读次数 -->
            <div class="kb-continue">
              <template v-if="d.type === 'pdf'">
                <span v-if="d.last_page">上次读到第 {{ d.last_page }} 页 · 继续 ›</span>
                <span v-else>开始阅读 ›</span>
              </template>
              <template v-else>
                <span v-if="d.read_count">已读 {{ d.read_count }} 次 · 打开 ›</span>
                <span v-else>开始阅读 ›</span>
              </template>
            </div>
            <div class="kb-head">
              <span class="badge kb-type" :class="d.type">{{ d.type === 'pdf' ? 'PDF' : 'MD' }}</span>
              <span class="kb-title" :title="d.title">{{ d.title }}</span>
            </div>
            <div v-if="d.tags && d.tags.length" class="kb-tags">
              <span v-for="t in d.tags" :key="t" class="q-tag">{{ t }}</span>
            </div>
            <div class="kb-meta">
              <span v-if="!d.read_count" class="kb-unread">未读</span>
              <span v-else-if="d.type === 'pdf' && d.last_page" class="kb-read-pos">读到第 {{ d.last_page }} 页</span>
              <span>{{ fmtTime(d.updated_at) }}</span>
              <span v-if="d.read_count">· 读过 {{ d.read_count }} 次</span>
              <span v-if="d.linkCount">· {{ d.linkCount }} 题关联</span>
            </div>
            <div class="kb-actions">
              <button class="kb-act" @click.stop="openEditor(d)">标签/改名/移动</button>
              <button class="kb-act kb-act-del" @click.stop="onDelete(d)">删除</button>
            </div>
          </div>
        </div>
        <!-- 组内更多：超过 8 张折叠（与整组折叠共存） -->
        <button
          v-if="g.docs.length > GROUP_PAGE"
          class="kb-more"
          @click.stop="toggleGroupMore(g.folder)"
        >{{ groupMoreOpen.includes(g.folder) ? '收起 ▴' : `更多 (${g.docs.length - GROUP_PAGE}) ▾` }}</button>
        </template>
      </div>
    </div>

    <!-- 标签/改名/科目弹层 -->
    <div v-if="editor.show" class="kb-mask" @click.self="editor.show = false">
      <div class="card kb-modal">
        <h3>文档信息</h3>
        <label class="kb-lab">标题</label>
        <input v-model="editor.title" class="input" />
        <label class="kb-lab">所属科目</label>
        <select v-model="editor.subjectId" class="input" @change="onSubjectChange">
          <option :value="null">未分类</option>
          <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <label class="kb-lab">所属章节</label>
        <select v-model="editor.categoryId" class="input" :disabled="!editor.subjectId">
          <option :value="null">不指定章节</option>
          <option v-for="c in editor.chapters" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <label class="kb-lab">标签</label>
        <div class="kb-edit-tags">
          <span v-for="t in editor.tags" :key="t" class="q-tag" @click="removeEditorTag(t)">{{ t }} <Icon name="x" :size="14"/></span>
        </div>
        <div class="kb-edit-add">
          <input id="kb-tag-input" class="input" placeholder="输入标签回车添加，逗号分隔可一次多个（点击标签可移除）" @keyup.enter="addEditorTag" />
          <button class="btn" @click="addEditorTag">添加</button>
        </div>
        <div class="kb-modal-actions">
          <button class="btn" @click="editor.show = false">取消</button>
          <button class="btn btn-primary" @click="saveEditor">保存</button>
        </div>
      </div>
    </div>

    <KbReader :show="reader.show" :doc="reader.doc" @close="reader.show = false" @open-doc="openLinkedDoc" />
  </div>
</template>

<style scoped>
.kb-search-card { padding: 14px; margin-bottom: 14px; }
.kb-tools { display: flex; gap: 10px; }
.kb-scope-line { margin-bottom: 8px; }
.kb-scope-tag {
  display: inline-block; font-size: 11px; color: var(--muted);
  border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px;
}
.kb-scope-tag.all { color: var(--brand); border-color: color-mix(in srgb, var(--brand) 40%, transparent); background: color-mix(in srgb, var(--brand) 6%, transparent); }
.kb-tools .input { flex: 1; }
.kb-tag-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
/* 知识库 chip 统一样式：与文档卡片 q-tag 一致（圆角矩形 + 品牌色淡背景） */
.kb-tag-row .filter-chip, .kb-scope-line .filter-chip {
  font-size: 12px; color: var(--brand);
  border: 1px solid var(--line); border-radius: 12px;
  background: color-mix(in srgb, var(--brand) 8%, transparent);
  padding: 4px 12px; display: inline-flex; align-items: center; gap: 4px;
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif;
  line-height: 1.5;
}
.kb-tag-row .filter-chip:hover, .kb-scope-line .filter-chip:hover {
  border-color: var(--brand); background: color-mix(in srgb, var(--brand) 16%, transparent);
}
.kb-tag-row .filter-chip.active, .kb-scope-line .filter-chip.active {
  background: var(--brand); color: #fff; font-weight: 600; border-color: var(--brand);
}
.kb-tag-n {
  font-size: 10px; line-height: 14px; min-width: 14px; text-align: center;
  color: var(--brand); background: color-mix(in srgb, var(--brand) 14%, transparent);
  border-radius: 999px; padding: 0 5px; margin-left: 2px;
}
/* active 内的数字徽标：品牌底上白底深字，跨主题对比清晰（原 rgba 半透明白底在浅色下边缘弱） */
.kb-tag-row .filter-chip.active .kb-tag-n, .kb-scope-line .filter-chip.active .kb-tag-n {
  color: #0e1512; background: #fff;
}

.kb-grid {
  display: grid;
  /* 限宽不拉伸：minmax 上界固定 → 最后一行卡片不会 1fr 拉满整行（此前右侧大留白的根因） */
  grid-template-columns: repeat(auto-fill, minmax(220px, 280px));
  gap: 12px;
}
.kb-groups { display: flex; flex-direction: column; gap: 20px; }
.kb-group-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}
.kb-group-name { font-size: 13px; font-weight: 500; color: var(--brand); }
.kb-group-n { font-size: 11px; color: var(--muted); }
.kb-card {
  padding: 14px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: transform .1s, border-color .2s, box-shadow .2s;
}
.kb-card:hover { border-color: var(--brand); box-shadow: var(--shadow-hover); transform: translateY(-2px); }
.kb-card:active { transform: translateY(0) scale(0.99); }
.kb-head { display: flex; align-items: center; gap: 8px; }
.kb-type { text-transform: uppercase; letter-spacing: 1px; }
.kb-type.pdf { background: rgba(232, 95, 61, 0.15); color: #e85f3d; }
.kb-type.md { background: color-mix(in srgb, var(--brand) 12%, transparent); color: var(--brand); }
.kb-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.kb-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.q-tag {
  font-size: 11px;
  color: var(--brand);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 1px 8px;
  background: color-mix(in srgb, var(--brand) 8%, transparent);
  cursor: pointer;
  /* 中英混排基线对齐：中文字体优先，英文/数字不再回退到 Segoe UI（基线不同会错位） */
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif;
  line-height: 1.5;
}
.q-tag:hover { border-color: var(--brand); }
.q-tag svg { vertical-align: -2px; }
.kb-meta { font-size: 12px; color: var(--muted); }
.kb-actions { display: flex; gap: 10px; margin-top: auto; }
.kb-act {
  font-size: 12px;
  color: var(--muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 0;
}
.kb-act:hover { color: var(--brand); }
.kb-act-del:hover { color: var(--bad); }
.kb-hint { font-size: 12px; color: var(--muted); margin: 6px 0 12px; }

.kb-mask {
  position: fixed;
  inset: 0;
  background: var(--modal-mask);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 20px;
}
.kb-modal { width: min(420px, 92vw); padding: 18px; display: flex; flex-direction: column; gap: 8px; }
.kb-lab { font-size: 12px; color: var(--muted); margin-top: 6px; }
.kb-edit-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.kb-edit-add { display: flex; gap: 8px; }
.kb-edit-add .input { flex: 1; }
.kb-modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }

/* 知识互链图谱 */
.btn-active { border-color: var(--brand) !important; color: var(--brand) !important; }
.graph-card { margin-bottom: 12px; }
.graph-title { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
.graph-hint { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 6px; }
.graph-svg { width: 100%; background: radial-gradient(circle, color-mix(in srgb, var(--brand) 7%, transparent), transparent 72%); border-radius: 12px; }
.g-edge { stroke: var(--line); stroke-width: 1; }
.g-node { cursor: pointer; }
.g-node circle { transition: r .12s ease; }
.g-node:hover circle { fill: var(--brand); }
.g-md { fill: color-mix(in srgb, var(--brand) 72%, transparent); }
.g-pdf { fill: rgba(255, 77, 109, 0.72); }
.g-label { font-size: 9px; fill: var(--muted); text-anchor: middle; }
.empty-sm { font-size: 12px; color: var(--muted); padding: 10px 0; }

/* 知识库铺开（2026-08-12）：文档卡渐变边框 */
.kb-card {
  border: 1px solid transparent;
  background-image:
    linear-gradient(var(--card), var(--card)),
    linear-gradient(135deg, color-mix(in srgb, var(--brand) 35%, transparent), color-mix(in srgb, var(--brand2) 35%, transparent));
  background-origin: border-box;
  background-clip: padding-box, border-box;
}
.kb-card:hover { box-shadow: var(--glow-soft); }

/* 知识库加浓（2026-08-12）：stagger 交错入场
   注：排除 .kb-page（全屏阅读器组件根）——入场动画的 transform 会干扰其 position:fixed 全屏定位 */
.kb > *:not(.kb-page) { animation: riseIn .4s cubic-bezier(.2, .7, .3, 1) both; }
.kb > *:not(.kb-page):nth-child(2) { animation-delay: .06s; }
.kb > *:not(.kb-page):nth-child(3) { animation-delay: .12s; }
.kb > *:not(.kb-page):nth-child(4) { animation-delay: .18s; }


/* ===== 知识库列表页打磨（2026-08-13）：类型徽章渐变 / 分组标题 / 继续阅读浮层 / 已读徽章 ===== */
/* A1 类型徽章：渐变底 + 微光 */
.kb-type.pdf {
  background: linear-gradient(135deg, rgba(232, 95, 61, 0.28), rgba(232, 95, 61, 0.10));
  color: var(--warn-soft);
  border: 1px solid rgba(232, 95, 61, 0.45);
  box-shadow: 0 0 8px rgba(232, 95, 61, 0.15);
}
.kb-type.md {
  background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 28%, transparent), color-mix(in srgb, var(--brand2) 12%, transparent));
  color: var(--brand-soft);
  border: 1px solid color-mix(in srgb, var(--brand) 45%, transparent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--brand) 15%, transparent);
}

/* A3 分组标题：渐变竖线 + 计数徽章 */
.kb-group-head { position: relative; padding-left: 12px; }
.kb-group-head::before {
  content: '';
  position: absolute; left: 0; top: 3px; bottom: 3px;
  width: 3px; border-radius: 2px;
  background: linear-gradient(180deg, var(--brand), var(--brand2, #7a5cff));
}
.kb-group-n {
  background: color-mix(in srgb, var(--brand) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent);
  border-radius: 10px; padding: 1px 8px;
  font-weight: 600; color: var(--brand-soft);
}

/* B1 继续阅读浮层：hover 显示在卡片顶部（三主题由语义变量统一） */
.kb-card { position: relative; }
.kb-continue {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%) translateY(-4px);
  background: var(--tip-bg); border: 1px solid color-mix(in srgb, var(--brand) 45%, transparent);
  border-radius: 14px; padding: 5px 14px;
  font-size: 11.5px; color: var(--tip-text); white-space: nowrap;
  opacity: 0; pointer-events: none; z-index: 5;
  transition: opacity .15s ease, transform .15s ease;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}
.kb-card:hover .kb-continue { opacity: 1; transform: translateX(-50%) translateY(0); }

/* B2 已读/未读徽章 */
.kb-unread {
  color: var(--warn, #ffb84d);
  border: 1px solid rgba(255, 184, 77, 0.5);
  background: rgba(255, 184, 77, 0.08);
  border-radius: 8px; padding: 0 6px; font-size: 10.5px;
}
.kb-read-pos {
  color: var(--ok-soft);
  border: 1px solid rgba(47, 191, 143, 0.4);
  background: rgba(47, 191, 143, 0.08);
  border-radius: 8px; padding: 0 6px; font-size: 10.5px;
}


/* ===== 知识库第二波（2026-08-13）：图谱着色 / 分组折叠 / 标题省略 ===== */
/* 文档标题：单行省略 + hover 全名（title 属性已挂） */
.kb-title {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0; flex: 1;
}
.kb-fold { font-size: 11px; color: var(--muted); transition: color .15s; }
.kb-group-head { cursor: pointer; user-select: none; }
.kb-group-head:hover .kb-fold { color: var(--brand); }

/* 图谱：维度 seg + 图例 */
.graph-legend { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
.g-legend-items { display: flex; gap: 10px; flex-wrap: wrap; }
.g-legend-item { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); }
.g-legend-item i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.g-legend-item.muted { color: var(--muted); opacity: .7; }
.g-node circle { transition: r .12s ease, filter .15s ease; }
.g-node:hover circle { filter: brightness(1.35) drop-shadow(0 0 4px color-mix(in srgb, var(--brand) 80%, transparent)); }


/* 组内更多按钮：橙色虚线（与章节筛选「更多」同语言） */
.kb-more {
  margin-top: 10px; width: 100%;
  padding: 6px; border: 1px dashed rgba(255, 184, 77, 0.5);
  background: rgba(255, 184, 77, 0.06); color: var(--warn, #ffb84d);
  border-radius: 8px; font-size: 12px; cursor: pointer; transition: border-color .15s;
}
.kb-more:hover { border-color: var(--warn, #ffb84d); }


/* ===== 图谱优化（2026-08-13）：画布缩放平移 / 控制条 / 全屏 ===== */
.graph-title { display: flex; align-items: center; gap: 8px; }
.g-full {
  margin-left: auto;
  font-size: 11px; padding: 2px 10px; border-radius: 7px;
  border: 1px solid var(--line); background: rgba(255, 255, 255, 0.03);
  color: var(--muted); cursor: pointer; transition: all .15s;
}
.g-full:hover { border-color: var(--brand); color: var(--brand); }
.graph-stage {
  position: relative; overflow: hidden; border-radius: 10px;
  cursor: grab; touch-action: none;
  border: 1px solid var(--line);
  background: radial-gradient(circle, color-mix(in srgb, var(--brand) 5%, transparent), transparent 72%);
}
.graph-stage:active { cursor: grabbing; }
.graph-svg { width: 100%; height: auto; display: block; }
.graph-ctl { display: flex; align-items: center; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.g-ctl-btn {
  width: 26px; height: 26px; border-radius: 7px;
  border: 1px solid var(--line); background: rgba(255, 255, 255, 0.04);
  color: var(--text); font-size: 14px; cursor: pointer; line-height: 1;
}
.g-ctl-btn:hover { border-color: var(--brand); color: var(--brand); }
.g-ctl-btn.reset { width: auto; padding: 0 10px; font-size: 12px; color: var(--warn); }
.g-zoom-pct { font-size: 12px; color: var(--muted); min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; }

/* 全屏弹层（遮罩跟随主题 --modal-mask） */
.gf-mask {
  position: fixed; inset: 0; z-index: 400;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur, 6px));
  display: flex; align-items: center; justify-content: center; padding: 20px;
  animation: maskIn .18s ease;
}
.gf-panel {
  width: 94vw; height: 92vh;
  background: var(--card-solid, #0b1020);
  border: 1px solid var(--line); border-radius: 14px;
  display: flex; flex-direction: column; overflow: hidden;
  animation: riseIn .28s cubic-bezier(.2, .7, .3, 1) both;
}
.gf-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.gf-title { font-size: 14px; font-weight: 600; }
.gf-hint { font-size: 11.5px; color: var(--muted); }
.gf-close { margin-left: auto; font-size: 15px; color: var(--muted); cursor: pointer; background: none; border: none; }
.gf-close:hover { color: var(--text); }
.gf-stage { flex: 1; min-height: 0; position: relative; overflow: hidden; cursor: grab; touch-action: none; }
.gf-stage:active { cursor: grabbing; }
.gf-svg { width: 100%; height: 100%; }
.gf-label { font-size: 12px; }
.gf-ctl { padding: 10px 16px; border-top: 1px solid var(--line); margin-top: 0; }
@keyframes maskIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes riseIn { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: translateY(0) } }


/* ===== 知识库特效（2026-08-13）：流光描边/徽章弹/连线生长/节点渐显/hub 呼吸/边高亮 ===== */
/* ① 文档卡 hover 流光描边（conic 光点沿边框旋转，首页同款；--ang 全局注册） */
.kb-card::after {
  content: ''; position: absolute; inset: -1px; border-radius: inherit;
  background: conic-gradient(from var(--ang), transparent 0deg, color-mix(in srgb, var(--brand) 55%, transparent) 60deg, transparent 130deg, transparent 360deg);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  padding: 1px;
  opacity: 0; transition: opacity .2s ease; pointer-events: none; z-index: 1;
}
.kb-card:hover::after { opacity: 1; animation: angSpin 2.2s linear infinite; }
/* ④ 类型徽章 hover 微弹 */
.kb-type { transition: transform .15s ease; }
.kb-card:hover .kb-type { transform: scale(1.08); }

/* ② 图谱连线生长动画（pathLength=1 + dashoffset） */
.g-edge {
  stroke-dasharray: 1; stroke-dashoffset: 1;
  animation: drawEdge .9s cubic-bezier(.4, 0, .2, 1) forwards;
  transition: stroke .2s ease, stroke-width .2s ease;
}
@keyframes drawEdge { to { stroke-dashoffset: 0; } }
/* ⑦ hover 节点 → 相连边高亮 */
.g-edge.active { stroke: var(--brand, #5b7cfa); stroke-width: 1.6; }

/* ③ 节点入场渐显（依次点亮；不用 scale 避免 SVG 原点问题） */
.g-node { animation: nodeFade .45s cubic-bezier(.2, .7, .3, 1) both; }
@keyframes nodeFade { from { opacity: 0 } to { opacity: 1 } }
/* ⑥ 枢纽节点（连接≥3）呼吸光晕 */
.g-node circle { transition: r .12s ease, filter .15s ease; }
.g-node circle.hub { animation: hubPulse 2.4s ease-in-out infinite; }
@keyframes hubPulse {
  0%, 100% { filter: drop-shadow(0 0 2px color-mix(in srgb, var(--brand) 40%, transparent)); }
  50% { filter: drop-shadow(0 0 8px color-mix(in srgb, var(--brand) 80%, transparent)); }
}

</style>