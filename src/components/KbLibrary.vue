<script setup>
import Icon from './Icon.vue'
import { ref, computed, onMounted } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { showConfirm } from '../utils/confirm.js'
import KbReader from './KbReader.vue'

const props = defineProps({ subject: { type: Object, default: () => ({ id: null, name: '' }) } })
const docs = ref([])
const allTags = ref([])
const tagFilter = ref(null) // null=全部
const keyword = ref('')
const loading = ref(true)
const reader = ref({ show: false, doc: null })
const editor = ref({ show: false, doc: null, tags: [], title: '', folder: '', subjectId: null })
// 知识库科目筛选：默认跟随当前科目，可切「全部科目」
const subjects = ref([])
const subjectFilter = ref('current') // 'current' | 'all' | 具体科目 id
const filterSubjectId = computed(() => {
  if (subjectFilter.value === 'all') return undefined
  if (subjectFilter.value === 'current') return props.subject.id || undefined
  return Number(subjectFilter.value) || undefined
})

let debounceTimer = null

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
  for (const d of filteredDocs.value) {
    const isNote = String(d.title || '').endsWith('笔记')
    const k = isNote ? '' : (d.folder || '')
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(d)
  }
  const out = []
  if (groups.has('')) { out.push({ folder: '', label: '未分类', docs: groups.get('') }) }
  for (const [k, list] of groups) {
    if (k !== '') out.push({ folder: k, label: k, docs: list })
  }
  return out
})

async function onImport() {
  const res = (await tiku.kbImportFiles(null, filterSubjectId.value)) || []
  const ok = res.filter(r => r.ok)
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

function openEditor(doc) {
  editor.value = { show: true, doc, tags: [...(doc.tags || [])], title: doc.title, folder: doc.folder || '', subjectId: doc.subject_id ?? null }
}

function addEditorTag() {
  const v = (document.getElementById('kb-tag-input').value || '').trim()
  if (v && !editor.value.tags.includes(v)) editor.value.tags.push(v)
  document.getElementById('kb-tag-input').value = ''
}

function removeEditorTag(t) {
  editor.value.tags = editor.value.tags.filter(x => x !== t)
}

async function saveEditor() {
  const title = editor.value.title.trim()
  if (title && title !== editor.value.doc.title) await tiku.kbUpdate(editor.value.doc.id, { title })
  if ((editor.value.folder || '') !== (editor.value.doc.folder || '')) await tiku.kbMove(editor.value.doc.id, editor.value.folder)
  if ((editor.value.subjectId ?? null) !== (editor.value.doc.subject_id ?? null)) {
    await tiku.kbUpdate(editor.value.doc.id, { subjectId: editor.value.subjectId || null })
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
      <div class="kb-subj-row">
        <button
          class="filter-chip"
          :class="{ active: subjectFilter === 'current' }"
          @click="subjectFilter = 'current'; loadList()"
        >{{ props.subject.name || '当前科目' }}</button>
        <button
          class="filter-chip"
          :class="{ active: subjectFilter === 'all' }"
          @click="subjectFilter = 'all'; loadList()"
        >全部科目</button>
        <button
          v-for="s in subjects"
          :key="s.id"
          class="filter-chip"
          :class="{ active: subjectFilter === String(s.id) }"
          @click="subjectFilter = String(s.id); loadList()"
        >{{ s.name }}</button>
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
            <div class="kb-head">
              <span class="badge kb-type" :class="d.type">{{ d.type === 'pdf' ? 'PDF' : 'MD' }}</span>
              <span class="kb-title">{{ d.title }}</span>
            </div>
            <div v-if="d.tags && d.tags.length" class="kb-tags">
              <span v-for="t in d.tags" :key="t" class="q-tag">{{ t }}</span>
            </div>
            <div class="kb-meta">
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
        <select v-model="editor.subjectId" class="input">
          <option :value="null">未分类</option>
          <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <label class="kb-lab">标签</label>
        <div class="kb-edit-tags">
          <span v-for="t in editor.tags" :key="t" class="q-tag" @click="removeEditorTag(t)">{{ t }} <Icon name="x" :size="14"/></span>
        </div>
        <div class="kb-edit-add">
          <input id="kb-tag-input" class="input" placeholder="输入标签回车添加（点击标签可移除）" @keyup.enter="addEditorTag" />
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
.kb-tools .input { flex: 1; }
.kb-tag-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.kb-tag-n { font-size: 11px; opacity: .7; margin-left: 4px; }
.kb-subj-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--line); }

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
</style>
