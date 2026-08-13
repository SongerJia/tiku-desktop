<script setup>
import Icon from './Icon.vue'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { showConfirm } from '../utils/confirm.js'
import KbReader from './KbReader.vue'

const props = defineProps({ subject: { type: Object, default: () => ({ id: null, name: '' }) }, scope: { type: String, default: 'current' } })
const docs = ref([])
const allTags = ref([])
const tagFilter = ref(null) // null=全部
const keyword = ref('')
const loading = ref(true)
const reader = ref({ show: false, doc: null })
const editor = ref({ show: false, doc: null, tags: [], title: '', folder: '', subjectId: null, categoryId: null, chapters: [] })
// 文档编辑弹窗「所属科目」下拉的数据源
const subjects = ref([])
// 知识库范围：'current' 跟随顶部科目（tab 默认）；'all' 全部科目管理（「我的→知识库概览」进入）
const filterSubjectId = computed(() => props.scope === 'all' ? undefined : props.subject.id || undefined)

let debounceTimer = null
onUnmounted(() => { if (debounceTimer) clearTimeout(debounceTimer) })

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

watch(() => props.subject.id, () => { if (props.scope !== 'all') loadList() }) // 顶部切科目（跟随态）→ 刷新
watch(() => props.scope, loadList) // 范围切换（current↔all）→ 刷新

onMounted(() => {
  loadTags()
  loadSubjects()
  loadList()
  loadGraph()
})

// ---- 知识互链图谱（环形布局，点击节点打开文档）----
const viewMode = ref('list')
const graph = ref({ nodes: [], links: [] })
const graphNodes = computed(() => graph.value.nodes.slice(0, 40))
const graphNodeIds = computed(() => new Set(graphNodes.value.map(n => n.id)))
const graphLinks = computed(() => graph.value.links.filter(l => graphNodeIds.value.has(l.from_doc_id) && graphNodeIds.value.has(l.to_doc_id)))
const gPos = computed(() => {
  const n = graphNodes.value.length
  const map = {}
  graphNodes.value.forEach((node, i) => {
    const cx = 160, cy = 110
    const R = n > 12 ? 92 : 72
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n)
    map[node.id] = { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) }
  })
  return map
})
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
  try { graph.value = await tiku.getKbGraph() } catch (e) { graph.value = { nodes: [], links: [] } }
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
const groupedDocs = computed(() => {
  const groups = new Map()
  // 组内排序：读得多/最近更新的在前（B3 修正版：无阅读时间字段，用 read_count 排序零成本）
  const byHot = (a, b) => (b.read_count || 0) - (a.read_count || 0) || (b.updated_at || 0) - (a.updated_at || 0)
  for (const d of filteredDocs.value) {
    const isNote = String(d.title || '').endsWith('笔记')
    const k = isNote ? '' : (d.folder || '')
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(d)
  }
  const out = []
  if (groups.has('')) { out.push({ folder: '', label: '未分类', docs: groups.get('').sort(byHot) }) }
  for (const [k, list] of groups) {
    if (k !== '') out.push({ folder: k, label: k, docs: [...list].sort(byHot) })
  }
  return out
})

async function onImport() {
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
}

async function onExport() {
  const r = await tiku.kbExport()
  if (r && r.ok) showToast(`已导出 ${r.files} 个文件 / ${r.docs} 篇文档到：${r.target}`, 'ok')
  else if (r && !r.canceled) showToast('导出失败', 'err')
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
  editor.value = { show: true, doc, tags: [...(doc.tags || [])], title: doc.title, folder: doc.folder || '', subjectId: doc.subject_id ?? null, categoryId: doc.category_id ?? null, chapters: [] }
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
  if ((editor.value.folder || '') !== (editor.value.doc.folder || '')) await tiku.kbMove(editor.value.doc.id, editor.value.folder)
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
        />
        <button class="btn" :class="{ 'btn-active': viewMode === 'graph' }" @click="toggleGraph">图谱</button>
        <button class="btn" @click="onExport">导出</button>
        <button class="btn btn-primary" @click="onImport">导入文档</button>
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
        <span class="graph-hint">点击节点打开文档 · 在阅读页可建立文档互链</span>
      </div>
      <svg v-if="graphNodes.length" viewBox="0 0 320 240" class="graph-svg">
        <line v-for="(e, i) in gEdges" :key="'e' + i" :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2" class="g-edge"/>
        <g v-for="n in graphNodes" :key="n.id" class="g-node" @click="openGraphDoc(n)">
          <circle :cx="gPos[n.id].x" :cy="gPos[n.id].y" :r="n.type === 'pdf' ? 7 : 5.5" :class="'g-' + (n.type === 'pdf' ? 'pdf' : 'md')"/>
          <text :x="gPos[n.id].x" :y="gPos[n.id].y + 16" class="g-label">{{ shortTitle(n.title) }}</text>
        </g>
      </svg>
      <div v-else class="empty-sm">文档还不多，先导入几篇并在阅读页建立互链，图谱会自动生成</div>
    </div>

    <SkeletonCards v-if="loading" :count="4" />
    <div v-else-if="!docs.length" class="empty card">
      <p>知识库还是空的</p>
      <p class="kb-hint">把 md / pdf 文档拖进导入（点「导入文档」多选），或直接整本教材 PDF 丢进来</p>
      <button class="btn btn-primary" @click="onImport">立即导入</button>
    </div>
    <div v-else-if="!filteredDocs.length" class="empty card">没有匹配的文档</div>
    <div v-else class="kb-groups">
      <div v-for="g in groupedDocs" :key="g.folder" class="kb-group">
        <div class="kb-group-head">
          <span class="kb-group-name">{{ g.label }}</span>
          <span class="kb-group-n">{{ g.docs.length }} 篇</span>
        </div>
            <div class="kb-grid">
          <div
            v-for="d in g.docs"
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
              <span class="kb-title">{{ d.title }}</span>
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
      </div>
    </div>

    <!-- 标签/改名/移动弹层 -->
    <div v-if="editor.show" class="kb-mask" @click.self="editor.show = false">
      <div class="card kb-modal">
        <h3>文档信息</h3>
        <label class="kb-lab">标题</label>
        <input v-model="editor.title" class="input" />
        <label class="kb-lab">文件夹</label>
        <input v-model="editor.folder" class="input" placeholder="留空=未分类（输入新名字即创建文件夹）" />
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
.kb-scope-tag.all { color: var(--brand); border-color: rgba(91,124,250,.4); background: rgba(91,124,250,.06); }
.kb-tools .input { flex: 1; }
.kb-tag-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
/* 知识库 chip 统一样式：与文档卡片 q-tag 一致（圆角矩形 + 品牌色淡背景） */
.kb-tag-row .filter-chip, .kb-scope-line .filter-chip {
  font-size: 12px; color: var(--brand);
  border: 1px solid var(--line); border-radius: 12px;
  background: rgba(91, 124, 250, 0.08);
  padding: 4px 12px; display: inline-flex; align-items: center; gap: 4px;
}
.kb-tag-row .filter-chip:hover, .kb-scope-line .filter-chip:hover {
  border-color: var(--brand); background: rgba(91, 124, 250, 0.16);
}
.kb-tag-row .filter-chip.active, .kb-scope-line .filter-chip.active {
  background: var(--brand); color: #fff; font-weight: 600; border-color: var(--brand);
}
.kb-tag-n {
  font-size: 10px; line-height: 14px; min-width: 14px; text-align: center;
  color: var(--brand); background: rgba(91, 124, 250, 0.14);
  border-radius: 999px; padding: 0 5px; margin-left: 2px;
}
.kb-tag-row .filter-chip.active .kb-tag-n {
  color: #021018; background: rgba(255, 255, 255, 0.35);
}

.kb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
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
.kb-type.md { background: rgba(91, 124, 250, 0.12); color: var(--brand); }
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
  background: rgba(91, 124, 250, 0.08);
  cursor: pointer;
}
.q-tag:hover { border-color: var(--brand); }
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
.kb-act-del:hover { color: #e85f3d; }
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
.graph-svg { width: 100%; background: radial-gradient(circle, rgba(91, 124, 250, 0.07), transparent 72%); border-radius: 12px; }
.g-edge { stroke: var(--line); stroke-width: 1; }
.g-node { cursor: pointer; }
.g-node circle { transition: r .12s ease; }
.g-node:hover circle { fill: var(--brand); }
.g-md { fill: rgba(91, 124, 250, 0.72); }
.g-pdf { fill: rgba(255, 77, 109, 0.72); }
.g-label { font-size: 9px; fill: var(--muted); text-anchor: middle; }
.empty-sm { font-size: 12px; color: var(--muted); padding: 10px 0; }

/* 知识库铺开（2026-08-12）：文档卡渐变边框 */
.kb-card {
  border: 1px solid transparent;
  background-image:
    linear-gradient(var(--card), var(--card)),
    linear-gradient(135deg, rgba(91, 124, 250, 0.35), rgba(122, 92, 255, 0.35));
  background-origin: border-box;
  background-clip: padding-box, border-box;
}
.kb-card:hover { box-shadow: var(--glow-soft); }

/* 知识库加浓（2026-08-12）：stagger 交错入场 */
.kb > * { animation: riseIn .4s cubic-bezier(.2, .7, .3, 1) both; }
.kb > *:nth-child(2) { animation-delay: .06s; }
.kb > *:nth-child(3) { animation-delay: .12s; }
.kb > *:nth-child(4) { animation-delay: .18s; }


/* ===== 知识库列表页打磨（2026-08-13）：类型徽章渐变 / 分组标题 / 继续阅读浮层 / 已读徽章 ===== */
/* A1 类型徽章：渐变底 + 微光 */
.kb-type.pdf {
  background: linear-gradient(135deg, rgba(232, 95, 61, 0.28), rgba(232, 95, 61, 0.10));
  color: #ff9a7a;
  border: 1px solid rgba(232, 95, 61, 0.45);
  box-shadow: 0 0 8px rgba(232, 95, 61, 0.15);
}
.kb-type.md {
  background: linear-gradient(135deg, rgba(91, 124, 250, 0.28), rgba(122, 92, 255, 0.12));
  color: #93b1ff;
  border: 1px solid rgba(91, 124, 250, 0.45);
  box-shadow: 0 0 8px rgba(91, 124, 250, 0.15);
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
  background: rgba(91, 124, 250, 0.12);
  border: 1px solid rgba(91, 124, 250, 0.3);
  border-radius: 10px; padding: 1px 8px;
  font-weight: 600; color: #93b1ff;
}

/* B1 继续阅读浮层：hover 显示在卡片顶部 */
.kb-card { position: relative; }
.kb-continue {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%) translateY(-4px);
  background: #1c2434; border: 1px solid rgba(91, 124, 250, 0.45);
  border-radius: 14px; padding: 5px 14px;
  font-size: 11.5px; color: #c8d3f5; white-space: nowrap;
  opacity: 0; pointer-events: none; z-index: 5;
  transition: opacity .15s ease, transform .15s ease;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}
.kb-card:hover .kb-continue { opacity: 1; transform: translateX(-50%) translateY(0); }
[data-theme="light"] .kb-continue { background: #fff; color: #3d5bd9; border-color: rgba(61, 91, 217, 0.4); }

/* B2 已读/未读徽章 */
.kb-unread {
  color: var(--warn, #ffb84d);
  border: 1px solid rgba(255, 184, 77, 0.5);
  background: rgba(255, 184, 77, 0.08);
  border-radius: 8px; padding: 0 6px; font-size: 10.5px;
}
.kb-read-pos {
  color: #4fd1a5;
  border: 1px solid rgba(47, 191, 143, 0.4);
  background: rgba(47, 191, 143, 0.08);
  border-radius: 8px; padding: 0 6px; font-size: 10.5px;
}

</style>