<script setup>
import Icon from './Icon.vue'
import { ref, computed, watch, onMounted } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import { tiku } from '../api/tiku.js'
import { bankToCsv, TYPE_LABEL } from '../utils/bankParser.js'
import ImportWizard from './ImportWizard.vue'
import QuestionEditor from './QuestionEditor.vue'

const props = defineProps({
  show: Boolean,
  wide: Boolean,
  initialKeyword: { type: String, default: '' }
})
const emit = defineEmits(['close', 'changed'])

const stats = ref({ total: 0, categories: 0, byType: [], bySubject: [] })
const categories = ref([])
const subjectId = ref('')
const categoryId = ref('')
const keyword = ref('')
const page = ref(1)
const pageSize = 10
const list = ref({ total: 0, items: [] })
const loading = ref(false)
const toast = ref('')

const showImport = ref(false)
const showEditor = ref(false)
const editing = ref(null)
const confirmId = ref(null)

const totalPages = computed(() => Math.max(1, Math.ceil(list.value.total / pageSize)))
const chapters = computed(() => {
  const s = categories.value.find(c => String(c.id) === String(subjectId.value))
  return s ? (s.children || []) : []
})
const subjects = computed(() => categories.value.map(c => ({ id: c.id, name: c.name })))

function showToast(msg) {
  toast.value = msg
  setTimeout(() => { toast.value = '' }, 2200)
}

async function loadMeta() {
  const [cats, st, tags] = await Promise.all([tiku.getCategories(), tiku.getBankStats(), tiku.listTags().catch(() => [])])
  categories.value = cats
  stats.value = st
  allTags.value = (tags || []).map(t => t.tag)
}

async function loadList() {
  loading.value = true
  try {
    list.value = await tiku.listQuestions({
      subjectId: subjectId.value ? Number(subjectId.value) : null,
      categoryId: categoryId.value ? Number(categoryId.value) : null,
      keyword: keyword.value.trim(),
      page: page.value,
      pageSize,
      tags: tagFilter.value.length ? tagFilter.value : null
    })
  } finally {
    loading.value = false
  }
}

async function refreshAll() {
  await loadMeta()
  await loadList()
  await loadNoted()
}

// 题库页内联笔记：从题库直接看/写某题笔记，与答题页共用同一张 notes 表
const notedIds = ref(new Set())
async function loadNoted() {
  try { notedIds.value = new Set(await tiku.getNotedQuestionIds()) }
  catch (e) { notedIds.value = new Set() }
}

const noteQ = ref(null)
const noteText = ref('')
const noteHint = ref('')
async function openNote(q) {
  noteQ.value = q
  noteText.value = ''
  noteHint.value = ''
  try {
    const n = await tiku.getNote(q.id)
    noteText.value = n.content || ''
  } catch (e) {}
}
async function saveNoteHere() {
  if (!noteQ.value) return
  await tiku.saveNote({ questionId: noteQ.value.id, content: noteText.value })
  noteHint.value = noteText.value.trim() ? '已保存' : '已清空'
  setTimeout(() => { noteHint.value = '' }, 1500)
  loadNoted()
}
function closeNote() { noteQ.value = null; noteText.value = '' }

watch(() => props.show, (v) => {
  if (v) {
    if (props.initialKeyword) { keyword.value = props.initialKeyword; page.value = 1 }
    refreshAll()
  }
})
onMounted(() => { if (props.show) refreshAll() })

// 切科目要清掉章节筛选，否则会出现"科目A + 科目B的章节"这种空结果
watch(subjectId, () => { categoryId.value = ''; page.value = 1; loadList() })
watch(categoryId, () => { page.value = 1; loadList() })

let searchTimer = null
watch(keyword, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; loadList() }, 300)
})

function goPage(p) {
  if (p < 1 || p > totalPages.value) return
  page.value = p
  loadList()
}

function openNew() {
  editing.value = null
  showEditor.value = true
}

function openEdit(q) {
  editing.value = q
  showEditor.value = true
}

async function onSaved({ isEdit }) {
  showToast(isEdit ? '已保存修改' : '已新增题目')
  await refreshAll()
  emit('changed')
}

async function doDelete(id) {
  await tiku.deleteQuestion(id)
  confirmId.value = null
  showToast('已删除')
  // 删到当前页空了就退一页，避免停在空白页
  if (list.value.items.length === 1 && page.value > 1) page.value--
  await refreshAll()
  emit('changed')
}

async function onImported(res) {
  const parts = [`新增 ${res.inserted} 题`]
  if (res.updated) parts.push(`覆盖 ${res.updated}`)
  if (res.duplicated) parts.push(`跳过重复 ${res.duplicated}`)
  if (res.skipped) parts.push(`跳过 ${res.skipped}`)
  showToast('导入完成：' + parts.join(' · '), 'ok')
  await refreshAll()
  emit('changed')
}

async function exportCsv() {
  const rows = await tiku.exportBank(subjectId.value ? Number(subjectId.value) : null)
  if (!rows.length) { showToast('当前范围没有题目'); return }
  // 注意：bankToCsv() 内部已带 UTF-8 BOM，不要重复添加（双 BOM 会导致导回时表头识别失败）
  const blob = new Blob([bankToCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `题库导出-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  showToast(`已导出 ${rows.length} 题`)
}

// 导出 Excel：主进程用零依赖 xlsx-lite 生成 .xlsx，这里拿到 base64 后转 blob 下载
async function exportExcel() {
  const rows = await tiku.exportBank(subjectId.value ? Number(subjectId.value) : null)
  if (!rows.length) { showToast('当前范围没有题目'); return }
  const b64 = await tiku.exportExcel(subjectId.value ? Number(subjectId.value) : null)
  if (!b64) { showToast('当前范围没有题目'); return }
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `题库导出-${new Date().toISOString().slice(0, 10)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
  showToast(`已导出 ${rows.length} 题（Excel）`)
}

function answerText(q) {
  if (q.type === 'essay') return '问答题（自评）'
  if (q.type === 'judge') return (q.answer || []).join('')
  return (q.answer || []).join('')
}
function keywordText(q) {
  return (q.keywords && q.keywords.length) ? '采分点：' + q.keywords.join('；') : ''
}

// ---- 标签系统 ----
const allTags = ref([])
const tagFilter = ref([])
function toggleTagFilter(t) {
  const i = tagFilter.value.indexOf(t)
  if (i >= 0) tagFilter.value.splice(i, 1)
  else tagFilter.value.push(t)
  page.value = 1
  loadList()
}

// 单题标签编辑
const tagQ = ref(null)
const tagDraft = ref([])
const tagInput = ref('')
function openTagEditor(q) {
  tagQ.value = q
  tagDraft.value = q.tags ? q.tags.slice() : []
  tagInput.value = ''
}
function addTagFromInput() {
  const t = tagInput.value.trim()
  if (!t) return
  if (!tagDraft.value.includes(t)) tagDraft.value.push(t)
  tagInput.value = ''
}
function removeTagFromDraft(t) {
  const i = tagDraft.value.indexOf(t)
  if (i >= 0) tagDraft.value.splice(i, 1)
}
async function saveTags() {
  if (!tagQ.value) return
  await tiku.setQuestionTags(tagQ.value.id, tagDraft.value)
  // 同步当前项显示，避免整表刷新
  const it = list.value.items.find(x => x.id === tagQ.value.id)
  if (it) it.tags = tagDraft.value.slice()
  loadMeta()
  tagQ.value = null
}
function closeTag() { tagQ.value = null; tagInput.value = '' }

// ---- 批量操作 ----
const batchMode = ref(false)
const selectedIds = ref(new Set())
const batchMoveCat = ref('')
const batchTagInput = ref('')
const batchDiff = ref('')
function toggleBatch() {
  batchMode.value = !batchMode.value
  if (!batchMode.value) selectedIds.value = new Set()
}
function toggleSelect(q) {
  const s = new Set(selectedIds.value)
  if (s.has(q.id)) s.delete(q.id)
  else s.add(q.id)
  selectedIds.value = s
}
function selectAll() {
  selectedIds.value = new Set(list.value.items.map(q => q.id))
}
function clearSel() { selectedIds.value = new Set() }
const selCount = computed(() => selectedIds.value.size)

async function applyBatchMove() {
  if (!selCount.value || !batchMoveCat.value) { showToast('请选择目标章节'); return }
  await tiku.batchUpdateQuestions([...selectedIds.value], { categoryId: Number(batchMoveCat.value) })
  showToast(`已移动 ${selCount.value} 题`)
  await refreshAll(); clearSel()
}
async function applyBatchTag() {
  const t = batchTagInput.value.trim()
  if (!selCount.value || !t) { showToast('请输入标签'); return }
  await tiku.batchUpdateQuestions([...selectedIds.value], { addTags: [t] })
  showToast(`已为 ${selCount.value} 题加标签 #${t}`)
  batchTagInput.value = ''; await refreshAll(); clearSel()
}
async function applyBatchDiff() {
  if (!selCount.value || !batchDiff.value) { showToast('请选择难度'); return }
  await tiku.batchUpdateQuestions([...selectedIds.value], { difficulty: Number(batchDiff.value) })
  showToast(`已调整 ${selCount.value} 题难度`)
  await refreshAll(); clearSel()
}
async function batchDelete() {
  if (!selCount.value) return
  await tiku.batchDeleteQuestions([...selectedIds.value])
  showToast(`已删除 ${selCount.value} 题`)
  await refreshAll(); clearSel()
}
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="bm-mask" :class="{ 'is-wide': wide }" @click.self="emit('close')">
      <div class="bm-panel" :class="{ 'is-wide': wide }">
        <div class="bm-header">
          <span class="close" @click="emit('close')">×</span>
          <span class="title">题库管理</span>
          <span class="count">{{ stats.total }} 题</span>
        </div>

        <div class="bm-body">
          <!-- 概览 -->
          <div class="stat-row">
            <div class="stat"><b>{{ stats.total }}</b><span>总题量</span></div>
            <div class="stat"><b>{{ stats.categories }}</b><span>分类数</span></div>
            <div
              v-for="t in stats.byType"
              :key="t.type"
              class="stat"
            ><b>{{ t.n }}</b><span>{{ TYPE_LABEL[t.type] || t.type }}</span></div>
          </div>

          <!-- 操作条 -->
          <div class="toolbar">
            <button class="btn btn-primary sm" @click="showImport = true">批量导入</button>
            <button class="btn btn-outline sm" @click="openNew">＋ 新增题目</button>
            <button class="btn btn-outline sm" @click="exportCsv">导出 CSV</button>
            <button class="btn btn-outline sm" @click="exportExcel">导出 Excel</button>
            <button class="btn btn-outline sm" :class="{ on: batchMode }" @click="toggleBatch">{{ batchMode ? '退出批量' : '批量操作' }}</button>
          </div>

          <!-- 筛选 -->
          <div class="filters">
            <select v-model="subjectId" class="input">
              <option value="">全部科目</option>
              <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <select v-model="categoryId" class="input" :disabled="!chapters.length">
              <option value="">全部章节</option>
              <option v-for="c in chapters" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <input v-model="keyword" class="input" placeholder="搜索题干关键词…" />
          </div>

          <!-- 标签筛选 -->
          <div v-if="allTags.length" class="tag-filter">
            <span class="tf-label">标签：</span>
            <button
              v-for="t in allTags"
              :key="t"
              class="tag-chip"
              :class="{ on: tagFilter.includes(t) }"
              @click="toggleTagFilter(t)"
            >#{{ t }}</button>
            <button v-if="tagFilter.length" class="tag-clear" @click="tagFilter = []">清空筛选</button>
          </div>

          <!-- 列表 -->
          <SkeletonCards v-if="loading" :count="3" />
          <div v-else-if="!list.items.length" class="empty">
            <div class="empty-icon">◇</div>
            <div>没有找到题目</div>
            <div class="empty-sub">点「批量导入」把你的真实题库导进来</div>
          </div>

          <div v-else class="q-list">
            <div v-for="q in list.items" :key="q.id" class="q-item" :class="{ sel: batchMode && selectedIds.has(q.id) }">
              <label v-if="batchMode" class="q-check">
                <input type="checkbox" :checked="selectedIds.has(q.id)" @change="toggleSelect(q)" />
              </label>
              <div class="q-top">
                <span class="q-type">{{ TYPE_LABEL[q.type] || q.type }}</span>
                <span class="q-cat">{{ q.category_name || '未分类' }}</span>
                <span
                  v-if="notedIds.has(q.id)"
                  class="q-note"
                  title="有笔记，点击查看/编辑"
                  @click.stop="openNote(q)"
                ><Icon name="note" :size="14"/></span>
                <span
                  v-if="q.images && q.images.length"
                  class="q-img-badge"
                  title="含题干配图"
                >图</span>
                <button v-if="!batchMode" class="mini tag-btn" @click="openTagEditor(q)"><Icon name="tag" :size="14"/> 标签</button>
                <span class="q-spacer"></span>
                <button v-if="!batchMode" class="mini" @click="openEdit(q)">编辑</button>
                <button
                  v-if="!batchMode"
                  class="mini danger"
                  @click="confirmId = confirmId === q.id ? null : q.id"
                >{{ confirmId === q.id ? '取消' : '删除' }}</button>
              </div>
              <div v-if="q.tags && q.tags.length" class="q-tags">
                <span v-for="t in q.tags" :key="t" class="q-tag" @click="toggleTagFilter(t)">#{{ t }}</span>
              </div>
              <div class="q-stem">{{ q.stem }}</div>
              <div class="q-bottom">
                <span class="q-ans">答案 {{ answerText(q) }}</span>
                <span class="q-diff">难度 {{ q.difficulty || 3 }}</span>
                <span v-if="q.source" class="q-src">{{ q.source }}</span>
              </div>
              <div v-if="q.type === 'essay' && keywordText(q)" class="q-kw">{{ keywordText(q) }}</div>
              <div v-if="confirmId === q.id" class="confirm">
                <span>确定删除这道题？答题记录会保留。</span>
                <button class="mini danger solid" @click="doDelete(q.id)">确认删除</button>
              </div>
            </div>
          </div>

          <!-- 分页 -->
          <div v-if="list.total > pageSize" class="pager">
            <button class="mini" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
            <span class="pg">{{ page }} / {{ totalPages }}</span>
            <button class="mini" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
          </div>
        </div>

        <div v-if="toast" class="bm-toast">{{ toast }}</div>
      </div>

      <ImportWizard
        :show="showImport"
        :wide="wide"
        :subjects="subjects"
        @close="showImport = false"
        @imported="onImported"
      />
      <QuestionEditor
        :show="showEditor"
        :wide="wide"
        :question="editing"
        :categories="categories"
        :defaultCategoryId="categoryId || subjectId"
        @close="showEditor = false"
        @saved="onSaved"
      />

      <!-- 题库内联笔记面板 -->
      <div v-if="noteQ" class="note-mask" @click.self="closeNote">
        <div class="note-box">
          <div class="note-head">
            <span class="note-title">笔记 · {{ noteQ.category_name || '未分类' }}</span>
            <span v-if="noteHint" class="note-hint">{{ noteHint }}</span>
            <span class="note-close" @click="closeNote">×</span>
          </div>
          <div class="note-stem">{{ noteQ.stem }}</div>
          <textarea
            v-model="noteText"
            class="note-input"
            rows="6"
            placeholder="写下你对这道题的理解、易错点…（失焦自动保存）"
            @blur="saveNoteHere"
          ></textarea>
          <div class="note-foot">
            <span class="note-tip">失焦自动保存 · 清空即删除</span>
            <button class="note-save" @click="saveNoteHere">保存</button>
          </div>
        </div>
      </div>

      <!-- 单题标签编辑 -->
      <div v-if="tagQ" class="tag-mask" @click.self="closeTag">
        <div class="tag-box">
          <div class="tag-head">
            <span class="tag-title">标签 · {{ tagQ.category_name || '未分类' }}</span>
            <span class="tag-close" @click="closeTag">×</span>
          </div>
          <div class="tag-stem">{{ tagQ.stem }}</div>
          <div class="tag-current">
            <span v-for="t in tagDraft" :key="t" class="tag-pill" @click="removeTagFromDraft(t)">#{{ t }} <Icon name="x" :size="14"/></span>
            <span v-if="!tagDraft.length" class="tag-empty">暂无标签，输入后回车添加</span>
          </div>
          <input
            v-model="tagInput"
            class="tag-input"
            placeholder="输入标签名，回车添加（如 高频 / 易错 / 必背）"
            @keyup.enter="addTagFromInput"
          />
          <div class="tag-sug" v-if="allTags.length">
            <span
              v-for="t in allTags"
              :key="t"
              class="tag-sug-chip"
              :class="{ on: tagDraft.includes(t) }"
              @click="tagDraft.includes(t) ? removeTagFromDraft(t) : tagDraft.push(t)"
            >#{{ t }}</span>
          </div>
          <div class="tag-foot">
            <span class="tag-tip">点击标签可移除 · 同步随题目传播</span>
            <button class="tag-save" @click="saveTags">保存</button>
          </div>
        </div>
      </div>

      <!-- 批量操作条 -->
      <div v-if="batchMode" class="batch-bar">
        <div class="bb-top">
          <span class="bb-count">已选 <b>{{ selCount }}</b> 题</span>
          <span class="bb-ops">
            <button class="bb-mini" @click="selectAll">全选本页</button>
            <button class="bb-mini" @click="clearSel">清空</button>
          </span>
        </div>
        <div class="bb-actions">
          <select v-model="batchMoveCat" class="bb-input">
            <option value="">移动至章节…</option>
            <option v-for="c in chapters" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <button class="bb-btn" @click="applyBatchMove">移动</button>
          <input v-model="batchTagInput" class="bb-input" placeholder="加标签…" @keyup.enter="applyBatchTag" />
          <button class="bb-btn" @click="applyBatchTag">打标签</button>
          <select v-model="batchDiff" class="bb-input">
            <option value="">改难度…</option>
            <option v-for="d in [1,2,3,4,5]" :key="d" :value="d">{{ d }}星</option>
          </select>
          <button class="bb-btn" @click="applyBatchDiff">改难度</button>
          <button class="bb-btn danger" @click="batchDelete">删除</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.bm-mask {
  position: fixed;
  inset: 0;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur));
  z-index: 190;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.bm-mask.is-wide { align-items: center; }

.bm-panel {
  position: relative;
  width: 100%;
  height: 92vh;
  display: flex;
  flex-direction: column;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: var(--radius) var(--radius) 0 0;
  box-shadow: var(--shadow), var(--glow-soft);
}
.bm-panel.is-wide {
  width: 860px;
  max-width: 94vw;
  height: 84vh;
  border-radius: var(--radius);
}

.bm-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.bm-header .title { flex: 1; font-size: 16px; font-weight: 700; color: var(--text); }
.bm-header .close { font-size: 22px; color: var(--muted); cursor: pointer; line-height: 1; }
.bm-header .close:hover { color: var(--brand); }
.bm-header .count { font-size: 12px; color: var(--brand); }

.bm-body { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }

.stat-row { display: flex; gap: 8px; flex-wrap: wrap; }
.stat {
  flex: 1;
  min-width: 72px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 9px 6px;
  text-align: center;
  background: rgba(91, 124, 250, 0.04);
}
.stat b { display: block; font-size: 17px; color: var(--brand); }
.stat span { font-size: 11px; color: var(--muted); }

.toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
.btn.sm { padding: 6px 14px; font-size: 12px; }

.filters { display: flex; gap: 8px; flex-wrap: wrap; }
.filters .input { flex: 1; min-width: 120px; }
.input {
  background: var(--input-solid-bg);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--text);
  padding: 8px 10px;
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
  font-family: inherit;
}
.input:focus { border-color: var(--brand); box-shadow: var(--glow-soft); }
.input:disabled { opacity: 0.45; }

.empty { text-align: center; color: var(--muted); font-size: 13px; padding: 40px 0; line-height: 2; }
.empty-icon { font-size: 30px; color: var(--brand); opacity: 0.5; }
.empty-sub { font-size: 12px; opacity: 0.75; }

.q-list { display: flex; flex-direction: column; gap: 10px; }
.q-item {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 11px 12px;
  background: rgba(91, 124, 250, 0.03);
}
.q-top { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.q-type {
  font-size: 11px;
  color: var(--brand);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 6px;
}
.q-cat { font-size: 11px; color: var(--muted); }
.q-note {
  font-size: 13px;
  color: #ffc154;
  cursor: pointer;
  padding: 1px 5px;
  border: 1px solid rgba(255, 193, 84, 0.45);
  border-radius: 4px;
  background: rgba(255, 193, 84, 0.12);
}
.q-note:hover { background: rgba(255, 193, 84, 0.22); }
.q-img-badge {
  font-size: 11px;
  color: var(--brand);
  cursor: default;
  padding: 1px 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: rgba(91, 124, 250, 0.10);
}
.q-spacer { flex: 1; }
.q-stem { font-size: 13px; color: var(--text); line-height: 1.65; }
.q-bottom { display: flex; gap: 12px; margin-top: 7px; font-size: 11px; color: var(--muted); }
.q-ans { color: var(--ok); }
.q-kw { font-size: 11px; color: var(--brand); margin-top: 5px; line-height: 1.6; opacity: 0.9; }

.mini {
  border: 1px solid var(--line);
  background: none;
  color: var(--muted);
  border-radius: 6px;
  padding: 3px 9px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.mini:hover { color: var(--brand); border-color: var(--brand); }
.mini.danger:hover { color: var(--bad); border-color: var(--bad); }
.mini.danger.solid { color: var(--bad); border-color: var(--bad); background: rgba(255, 77, 109, 0.1); }
.mini[disabled] { opacity: 0.4; cursor: not-allowed; }

.confirm {
  margin-top: 9px;
  padding-top: 9px;
  border-top: 1px dashed var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: #ffb3c1;
}

.pager { display: flex; align-items: center; justify-content: center; gap: 14px; padding: 6px 0 2px; }
.pg { font-size: 12px; color: var(--muted); }

.bm-toast {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  background: var(--toast-bg);
  color: var(--text);
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 12px;
  border: 1px solid var(--line);
  box-shadow: var(--glow-soft);
  z-index: 5;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.18s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* 题库内联笔记 */
.note-mask {
  position: fixed;
  inset: 0;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur));
  z-index: 210;
  display: flex;
  align-items: center;
  justify-content: center;
}
.note-box {
  width: 520px;
  max-width: 92vw;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow), var(--glow-soft);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.note-head { display: flex; align-items: center; gap: 10px; }
.note-title { flex: 1; font-size: 13px; color: var(--muted); }
.note-hint { font-size: 12px; color: var(--ok); }
.note-close { font-size: 20px; color: var(--muted); cursor: pointer; line-height: 1; }
.note-close:hover { color: var(--brand); }
.note-stem {
  font-size: 13px;
  color: var(--text);
  line-height: 1.6;
  max-height: 96px;
  overflow-y: auto;
  padding: 8px 10px;
  background: var(--input-solid-bg);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.note-input {
  background: var(--input-solid-bg);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--text);
  padding: 10px;
  font-size: 13px;
  line-height: 1.6;
  outline: none;
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
}
.note-input:focus { border-color: var(--brand); box-shadow: var(--glow-soft); }
.note-foot { display: flex; align-items: center; justify-content: space-between; }
.note-tip { font-size: 11px; color: var(--muted); }
.note-save {
  border: 1px solid var(--brand);
  background: none;
  color: var(--brand);
  border-radius: 6px;
  padding: 5px 16px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.note-save:hover { background: rgba(91, 124, 250, 0.12); box-shadow: var(--glow-soft); }

/* 标签筛选 */
.tag-filter { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.tf-label { font-size: 12px; color: var(--muted); }
.tag-chip {
  border: 1px solid var(--line); background: rgba(255,255,255,.03); color: var(--muted);
  border-radius: 20px; padding: 3px 10px; font-size: 12px; cursor: pointer; transition: all .15s;
}
.tag-chip:hover { border-color: var(--brand); color: var(--brand); }
.tag-chip.on { background: var(--brand); color: #021018; border-color: var(--brand); }
.tag-clear { font-size: 11px; color: var(--muted); background: none; border: none; cursor: pointer; text-decoration: underline; }

/* 题目项标签 */
.q-check { display: flex; align-items: center; padding-right: 4px; }
.q-check input { width: 18px; height: 18px; accent-color: var(--brand); }
.q-item.sel { border-color: var(--brand); box-shadow: var(--glow-soft); }
.q-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
.q-tag { font-size: 11px; color: var(--brand); border: 1px solid var(--line); border-radius: 12px; padding: 1px 8px; background: rgba(42,245,255,.08); cursor: pointer; }
.q-tag:hover { border-color: var(--brand); }
.tag-btn { color: var(--brand); border-color: rgba(42,245,255,.4); }

/* 单题标签编辑弹层 */
.tag-mask { position: fixed; inset: 0; background: rgba(3,6,14,.6); z-index: 210; display: flex; align-items: center; justify-content: center; }
.tag-box { width: 520px; max-width: 92vw; background: var(--card-solid); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow), var(--glow-soft); padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.tag-head { display: flex; align-items: center; justify-content: space-between; }
.tag-title { flex: 1; font-size: 13px; color: var(--muted); }
.tag-close { font-size: 20px; color: var(--muted); cursor: pointer; line-height: 1; }
.tag-close:hover { color: var(--brand); }
.tag-stem { font-size: 13px; color: var(--text); line-height: 1.6; max-height: 96px; overflow-y: auto; padding: 8px 10px; background: rgba(5,8,15,.6); border: 1px solid var(--line); border-radius: var(--radius-sm); }
.tag-current { display: flex; flex-wrap: wrap; gap: 6px; min-height: 28px; align-items: center; }
.tag-pill { font-size: 12px; color: var(--brand); border: 1px solid var(--brand); border-radius: 14px; padding: 2px 10px; cursor: pointer; background: var(--brand-light); }
.tag-empty { font-size: 12px; color: var(--muted); }
.tag-input { background: rgba(5,8,15,.8); border: 1px solid var(--line); border-radius: var(--radius-sm); color: var(--text); padding: 9px 12px; font-size: 13px; outline: none; font-family: inherit; box-sizing: border-box; }
.tag-input:focus { border-color: var(--brand); box-shadow: var(--glow-soft); }
.tag-sug { display: flex; flex-wrap: wrap; gap: 6px; }
.tag-sug-chip { font-size: 12px; color: var(--muted); border: 1px solid var(--line); border-radius: 14px; padding: 2px 10px; cursor: pointer; }
.tag-sug-chip.on { background: var(--brand); color: #021018; border-color: var(--brand); }
.tag-foot { display: flex; align-items: center; justify-content: space-between; }
.tag-tip { font-size: 11px; color: var(--muted); }
.tag-save { border: 1px solid var(--brand); background: none; color: var(--brand); border-radius: 6px; padding: 5px 16px; font-size: 12px; cursor: pointer; transition: all .15s; }
.tag-save:hover { background: var(--brand-light); box-shadow: var(--glow-soft); }

/* 批量操作条 */
.batch-bar { position: absolute; left: 0; right: 0; bottom: 0; background: var(--card-solid); border-top: 1px solid var(--brand); box-shadow: 0 -8px 24px rgba(0,0,0,.4); padding: 10px 16px; z-index: 6; display: flex; flex-direction: column; gap: 8px; }
.bb-top { display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
.bb-count b { color: var(--brand); }
.bb-ops { display: flex; gap: 8px; }
.bb-mini { background: none; border: 1px solid var(--line); color: var(--muted); border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
.bb-mini:hover { border-color: var(--brand); color: var(--brand); }
.bb-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.bb-input { background: rgba(5,8,15,.8); border: 1px solid var(--line); border-radius: 8px; color: var(--text); padding: 7px 10px; font-size: 12px; outline: none; font-family: inherit; }
.bb-input:focus { border-color: var(--brand); }
.bb-btn { background: rgba(255,255,255,.05); border: 1px solid var(--line); color: var(--text); border-radius: 8px; padding: 7px 12px; font-size: 12px; cursor: pointer; transition: all .15s; }
.bb-btn:hover { border-color: var(--brand); color: var(--brand); }
.bb-btn.danger { color: var(--bad); border-color: rgba(255,77,109,.4); }
.bb-btn.danger:hover { background: rgba(255,77,109,.12); }
.btn-outline.sm.on { background: var(--brand-light); border-color: var(--brand); color: var(--brand); }
</style>
