<script setup>
import { ref, computed, onMounted } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { showConfirm } from '../utils/confirm.js'
import KbReader from './KbReader.vue'

const docs = ref([])
const allTags = ref([])
const tagFilter = ref(null) // null=全部
const keyword = ref('')
const loading = ref(true)
const reader = ref({ show: false, doc: null })
const editor = ref({ show: false, doc: null, tags: [], title: '', folder: '' })

let debounceTimer = null

async function loadList() {
  loading.value = true
  if (keyword.value.trim()) {
    const hits = await tiku.kbSearch(keyword.value.trim(), 50)
    docs.value = hits.map(h => ({ ...h, tags: [], linkCount: 0 }))
  } else {
    docs.value = await tiku.kbList()
  }
  loading.value = false
}

async function loadTags() {
  allTags.value = await tiku.kbTags()
}

onMounted(() => {
  loadTags()
  loadList()
})

function onSearchInput() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(loadList, 300)
}

const filteredDocs = computed(() => {
  if (!tagFilter.value) return docs.value
  return docs.value.filter(d => (d.tags || []).includes(tagFilter.value))
})

// 文件夹分组：未分类在前，其余按名称
const groupedDocs = computed(() => {
  const groups = new Map()
  for (const d of filteredDocs.value) {
    const k = d.folder || ''
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
  const res = (await tiku.kbImportFiles()) || []
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
  editor.value = { show: true, doc, tags: [...(doc.tags || [])], title: doc.title, folder: doc.folder || '' }
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
        <label class="kb-lab">标签</label>
        <div class="kb-edit-tags">
          <span v-for="t in editor.tags" :key="t" class="q-tag" @click="removeEditorTag(t)">{{ t }} ✕</span>
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
.kb-card:hover { border-color: var(--brand); box-shadow: var(--glow-soft); }
.kb-card:active { transform: scale(0.99); }
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
  background: rgba(2, 12, 24, 0.75);
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
</style>
