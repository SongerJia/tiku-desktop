<script setup>
// 记忆卡管理弹窗（我的 → 内容整理 → 记忆卡管理）
// 与题库管理同设计语言：统计条 + 科目/章节筛选 + 列表属性展示 + 添加/导入
import Icon from './Icon.vue'
import { useBodyLock } from '../composables/useBodyLock.js'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import EmptyState from './EmptyState.vue'
import SkeletonCards from './SkeletonCards.vue'
import { ref, computed, watch, onMounted } from 'vue'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { showConfirm } from '../utils/confirm.js'
import { useEsc } from '../utils/useEsc.js'

const props = defineProps({ show: Boolean })
useBodyLock(() => props.show)
useFocusTrap(() => props.show, '.cm-panel')
const emit = defineEmits(['close', 'changed'])

// ---- 数据 ----
const cards = ref([])
const stats = ref({ total: 0, due: 0 })
const categories = ref([])      // 科目树（科目 → 章节）
const loading = ref(false)
const subjectId = ref('')
const categoryId = ref('')

const subjects = computed(() => categories.value.map(c => ({ id: c.id, name: c.name })))
const chapters = computed(() => {
  const s = categories.value.find(c => String(c.id) === String(subjectId.value))
  return s ? (s.children || []) : []
})
// 表单里的章节下拉：跟随表单所选科目
function chaptersFor(sid) {
  const s = categories.value.find(c => String(c.id) === String(sid))
  return s ? (s.children || []) : []
}

// 统计条：按当前筛选范围
async function loadStats() {
  try {
    stats.value = await tiku.cardsStats({ subjectId: subjectId.value ? Number(subjectId.value) : undefined, categoryId: categoryId.value ? Number(categoryId.value) : undefined })
  } catch (e) { stats.value = { total: 0, due: 0 } }
}
async function loadList() {
  loading.value = true
  try {
    cards.value = await tiku.listCards({
      subjectId: subjectId.value ? Number(subjectId.value) : undefined,
      categoryId: categoryId.value ? Number(categoryId.value) : undefined
    })
  } catch (e) { cards.value = [] }
  loading.value = false
}
async function refreshAll() { await Promise.all([loadMeta(), loadStats(), loadList()]) }

async function loadMeta() {
  try { categories.value = await tiku.getCategories() } catch (e) { categories.value = [] }
}

watch(subjectId, () => { categoryId.value = ''; loadList(); loadStats() })
watch(categoryId, () => { loadList(); loadStats() })
watch(() => props.show, (v) => { if (v) refreshAll() })
onMounted(() => { if (props.show) refreshAll() })
useEsc(() => emit('close'))

// ---- 记忆状态徽标（与首页 CardsPanel 同口径）----
function cardBadge(c) {
  if (c.lapses >= 2 && (c.review_count || 0) < 5) return { cls: 'warn', text: `易忘 · 忘过 ${c.lapses} 次` }
  if ((c.review_count || 0) >= 5) return { cls: 'ok', text: `稳定 · 记过 ${c.review_count} 次` }
  if ((c.review_count || 0) >= 1) return { cls: 'mid', text: `复习中 · ${c.review_count} 次` }
  return { cls: 'new', text: '新卡' }
}
function fmtDate(t) {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

// ---- 添加 / 编辑（行内展开表单）----
const form = ref({ id: null, front: '', back: '', category: '', subjectId: null, categoryId: null })
const formOpen = ref(false)
function startAdd() {
  form.value = { id: null, front: '', back: '', category: '', subjectId: subjectId.value ? Number(subjectId.value) : null, categoryId: categoryId.value ? Number(categoryId.value) : null }
  formOpen.value = true
}
function editCard(c) {
  form.value = { id: c.id, front: c.front, back: c.back, category: c.category || '', subjectId: c.subject_id ?? null, categoryId: c.category_id ?? null }
  formOpen.value = true
}
function cancelForm() { formOpen.value = false; form.value = { id: null, front: '', back: '', category: '', subjectId: null, categoryId: null } }
// 表单换科目时清掉不属于该科目的章节选择（防跨科目挂错章节）
watch(() => form.value.subjectId, (v) => {
  if (form.value.categoryId && !chaptersFor(v).some(c => String(c.id) === String(form.value.categoryId))) {
    form.value.categoryId = null
  }
})
async function saveCard() {
  const f = form.value.front.trim()
  const b = form.value.back.trim()
  if (!f || !b) { showToast('正面和背面都不能为空'); return }
  try {
    if (form.value.id) await tiku.updateCard(form.value.id, f, b, form.value.category.trim(), form.value.subjectId, form.value.categoryId)
    else await tiku.addCard(f, b, form.value.category.trim(), form.value.subjectId, form.value.categoryId)
    showToast(form.value.id ? '已保存修改' : '已添加卡片', 'ok')
    cancelForm()
    await refreshAll()
    emit('changed')
  } catch (e) { showToast('保存失败：' + (e.message || '未知错误'), 'err') }
}
async function removeCard(c) {
  const ok = await showConfirm(`删除卡片「${c.front}」？复习记录一并清除。`)
  if (!ok) return
  try {
    await tiku.deleteCard(c.id)
    showToast('已删除', 'ok')
    await refreshAll()
    emit('changed')
  } catch (e) { showToast('删除失败：' + (e.message || '未知错误'), 'err') }
}

// ---- CSV/Excel 导入（参照题库导入的预览-确认流程，简化版）----
const importStep = ref('')      // '' 未开 | 'pick' 选文件 | 'preview' 预览 | 'done' 完成
const importRows = ref([])      // [{front, back, category}]
const importFile = ref('')
const importSkipped = ref(0)
const importing = ref(false)
const dragOver = ref(false)
function onDrop(e) {
  dragOver.value = false
  const f = e.dataTransfer.files && e.dataTransfer.files[0]
  if (f) {
    // 复用文件选择逻辑：构造事件对象
    const ev = { target: { files: [f], value: '' } }
    onPickFile(ev)
  }
}
function parseCsvText(text) {
  const rows = []
  let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(c => String(c).trim())) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some(c => String(c).trim())) rows.push(row)
  return rows
}
function onPickFile(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  const isExcel = ext === 'xlsx' || ext === 'xls'
  const parse = isExcel
    ? file.arrayBuffer().then(buf => tiku.parseSheet(new Uint8Array(buf)).then(rows => rows))
    : file.text().then(text => parseCsvText(text))
  parse.then(rows => {
    let skipped = 0
    const parsed = []
    ;(rows || []).forEach(r => {
      const front = String(r[0] || '').trim()
      const back = String(r[1] || '').trim()
      if (!front || !back) { skipped++; return }
      parsed.push({ front, back, category: String(r[2] || '').trim() })
    })
    importRows.value = parsed
    importSkipped.value = skipped
    importFile.value = file.name
    importStep.value = 'preview'
  }).catch(err => {
    showToast('解析失败：' + (err.message || String(err)), 'err')
  })
}
async function doImport() {
  if (!importRows.value.length) return
  importing.value = true
  try {
    let n = 0
    for (const r of importRows.value) {
      await tiku.addCard(r.front, r.back, r.category, subjectId.value ? Number(subjectId.value) : null, categoryId.value ? Number(categoryId.value) : null)
      n++
    }
    showToast(`导入完成：新增 ${n} 张卡片${importSkipped.value ? '，跳过 ' + importSkipped.value + ' 行' : ''}`, 'ok')
    importStep.value = 'done'
    await refreshAll()
    emit('changed')
  } catch (e) {
    showToast('导入失败：' + (e.message || '未知错误'), 'err')
  } finally {
    importing.value = false
  }
}
function closeImport() { importStep.value = ''; importRows.value = []; importFile.value = ''; importSkipped.value = 0 }
function downloadTemplateCsv() {
  const blob = new Blob(['\ufeff正面,背面,分类\napple,n. 苹果；苹果树,词汇\nabandon,v. 放弃；抛弃,词汇\nりんご,苹果,単語'], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '记忆卡导入模板.csv'
  a.click()
  URL.revokeObjectURL(url)
}
async function downloadTemplateXlsx() {
  try {
    const base64 = await tiku.exportCardTemplate()
    if (!base64) throw new Error('模板生成失败')
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '记忆卡导入模板.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    showToast('Excel 模板生成失败：' + (err.message || String(err)), 'err')
  }
}
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="cm-mask" @click.self="emit('close')">
      <div class="cm-panel">
        <div class="cm-header">
          <span class="close" @click="emit('close')">×</span>
          <span class="title"><span class="hd-ico"><Icon name="bookmark" :size="16" /></span>记忆卡管理</span>
          <span class="count">{{ stats.total }} 张 · {{ stats.due }} 到期</span>
        </div>

        <div class="cm-body">
          <!-- 统计条 -->
          <div class="stat-row">
            <div class="stat"><b>{{ stats.total }}</b><span>总卡数</span></div>
            <div class="stat due"><b>{{ stats.due }}</b><span>今日到期</span></div>
            <div class="stat ok"><b>{{ stats.total - stats.due }}</b><span>未到期</span></div>
          </div>

          <!-- 工具栏 -->
          <div class="toolbar">
            <button class="btn btn-primary sm" @click="startAdd">＋ 添加卡片</button>
            <button class="btn btn-outline sm" @click="importStep = 'pick'">导入记忆卡</button>
          </div>

          <!-- 筛选：科目 → 章节 -->
          <div class="filters">
            <select v-model="subjectId" class="input">
              <option value="">全部科目</option>
              <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <select v-model="categoryId" class="input" :disabled="!chapters.length">
              <option value="">全部章节</option>
              <option v-for="c in chapters" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <span v-if="stats.total" class="filter-hint">{{ stats.total }} 张卡片{{ categoryId ? ' · 当前章节' : (subjectId ? ' · 当前科目' : ' · 全部科目') }}</span>
          </div>

          <!-- 行内添加/编辑表单 -->
          <div v-if="formOpen" class="form-card">
            <div class="form-grid">
              <input v-model="form.front" class="input" placeholder="正面（单词 / 问题）" @keyup.enter="saveCard" />
              <input v-model="form.back" class="input" placeholder="背面（释义 / 答案）" @keyup.enter="saveCard" />
            </div>
            <div class="form-grid">
              <select v-model.number="form.subjectId" class="input">
                <option :value="null">未选科目</option>
                <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
              <select v-model.number="form.categoryId" class="input">
                <option :value="null">未选章节</option>
                <option v-for="c in chaptersFor(form.subjectId)" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
              <input v-model="form.category" class="input" placeholder="分类（如：词汇）" />
            </div>
            <div class="form-actions">
              <button class="btn btn-primary sm" @click="saveCard">{{ form.id ? '保存修改' : '添加卡片' }}</button>
              <button class="btn sm" @click="cancelForm">取消</button>
            </div>
          </div>

          <!-- 列表 -->
          <SkeletonCards v-if="loading" :count="3" />
          <EmptyState v-else-if="!cards.length" icon="bookmark" text="没有卡片" sub="点「添加卡片」手动录入，或「导入 CSV」批量导入（正面,背面,分类）" />

          <div v-else class="card-list">
            <div v-for="c in cards" :key="c.id" class="card-item">
            <div class="card-main">
              <div class="card-front">{{ c.front }}</div>
              <div class="card-back">{{ c.back }}</div>
            </div>
            <div class="card-side">
              <div class="card-meta">
                <span class="mem-badge" :class="cardBadge(c).cls">{{ cardBadge(c).text }}</span>
                <span v-if="c.source_question_id" class="cat-badge src">来自题目</span>
                <span v-if="c.category_name" class="cat-badge">{{ c.category_name }}</span>
                <span v-else-if="c.category" class="cat-badge">{{ c.category }}</span>
                <span v-if="!c.subject_id" class="cat-badge uncat">未分类</span>
                <span class="state" :class="{ due: c.due }">
                  {{ c.due ? '待复习' : (c.review_count ? '已安排' : '新卡') }}
                  <template v-if="c.review_count"> · 记过 {{ c.review_count }} 次</template>
                  <template v-if="c.lapses"> · 忘过 {{ c.lapses }} 次</template>
                  <template v-if="c.review_at && !c.due"> · {{ fmtDate(c.review_at) }} 再见</template>
                </span>
              </div>
              <div class="card-actions">
                <button class="act" @click="editCard(c)">编辑</button>
                <button class="act del" @click="removeCard(c)">删除</button>
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>

      <!-- CSV/Excel 导入弹层 -->
      <div v-if="importStep" class="cm-import-mask" @click.self="closeImport">
        <div class="cm-import">
          <div class="ci-head">
            <span class="ci-title">导入记忆卡</span>
            <span class="ci-close" @click="closeImport">×</span>
          </div>

          <div v-if="importStep === 'pick'" class="ci-body">
            <div class="ci-target">
              <span class="ci-target-label">导入到</span>
              <span class="ci-target-val">{{ subjectId ? (subjects.find(s => String(s.id) === String(subjectId)) || {}).name || '当前科目' : '全部科目' }}{{ categoryId ? ' · ' + ((chapters.find(c => String(c.id) === String(categoryId)) || {}).name || '') : '' }}</span>
            </div>
            <div class="dropzone" @dragover.prevent="dragOver = true" @dragleave.prevent="dragOver = false" @drop.prevent="onDrop">
              <div class="dz-ico"><Icon name="download" :size="22" /></div>
              <div class="dz-title">把文件拖到这里，或点击选择</div>
              <div class="dz-sub">支持 .xlsx / .xls / .csv，每行：正面, 背面, 分类</div>
              <label class="btn btn-primary dz-btn">
                选择文件
                <input type="file" accept=".xlsx,.xls,.csv,.txt" hidden @change="onPickFile" />
              </label>
            </div>
            <div class="ci-guide">
              <div class="ci-guide-head">
                <span>模板下载</span>
                <div class="ci-guide-actions">
                  <button class="btn btn-outline sm" @click="downloadTemplateCsv">CSV 模板</button>
                  <button class="btn btn-outline sm" @click="downloadTemplateXlsx">Excel 模板</button>
                </div>
              </div>
              <div class="ci-tip">第一列正面（单词/问题）、第二列背面（释义/答案）、第三列分类（可留空）。</div>
            </div>
          </div>

          <div v-else-if="importStep === 'preview'" class="ci-body">
            <div class="ci-preview-head">
              <span class="ci-file">{{ importFile }}</span>
              <span class="ci-summary">{{ importRows.length }} 行可导入</span>
              <span v-if="importSkipped" class="ci-skip">跳过 {{ importSkipped }} 行</span>
            </div>
            <div class="ci-preview">
              <div v-for="(r, i) in importRows.slice(0, 8)" :key="i" class="ci-row">
                <span class="ci-front">{{ r.front }}</span>
                <span class="ci-sep">→</span>
                <span class="ci-back">{{ r.back }}</span>
                <span v-if="r.category" class="ci-cat">{{ r.category }}</span>
              </div>
              <div v-if="importRows.length > 8" class="ci-more">… 还有 {{ importRows.length - 8 }} 行</div>
            </div>
            <div class="ci-actions">
              <button class="btn" @click="importStep = 'pick'">重新选择</button>
              <button class="btn btn-primary" :disabled="importing" @click="doImport">{{ importing ? '导入中…' : '确认导入 ' + importRows.length + ' 张' }}</button>
            </div>
          </div>

          <div v-else class="ci-body done">
            <div class="ci-done">✓ 导入完成</div>
            <div class="ci-actions">
              <button class="btn btn-primary" @click="closeImport">完成</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.cm-mask {
  position: fixed;
  inset: 0;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur));
  z-index: 190;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.cm-panel {
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
.cm-panel { animation: cmIn .26s cubic-bezier(.2, .7, .3, 1); }
@keyframes cmIn { from { opacity: 0; transform: translateY(18px) scale(.98); } to { opacity: 1; transform: none; } }

.cm-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.cm-header .title { flex: 1; font-size: 16px; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 8px; }
.cm-header .title .hd-ico { color: var(--brand); display: inline-flex; }
.cm-header .close { font-size: 22px; color: var(--muted); cursor: pointer; line-height: 1; }
.cm-header .close:hover { color: var(--brand); }
.cm-header .count { font-size: 12px; color: var(--brand); }

.cm-body { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }

.stat-row { display: flex; gap: 8px; flex-wrap: wrap; }
.stat {
  flex: 1; min-width: 72px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 9px 6px;
  text-align: center;
  background: color-mix(in srgb, var(--brand) 4%, transparent);
  transition: border-color .15s ease, transform .15s ease;
}
.stat:hover { border-color: var(--brand); transform: translateY(-1px); }
.stat b {
  display: block; font-size: 17px;
  background: var(--num-grad);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
}
.stat.due b { -webkit-text-fill-color: var(--warn-soft); color: var(--warn-soft); background: none; }
.stat.ok b { -webkit-text-fill-color: var(--ok); color: var(--ok); background: none; }
.stat span { font-size: 11px; color: var(--muted); }

.toolbar { display: flex; gap: 8px; flex-wrap: wrap; }
.btn.sm { padding: 6px 14px; font-size: 12px; }

.filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.filters .input { flex: 1; min-width: 120px; }
.filter-hint { font-size: 11px; color: var(--muted); }
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

.form-card {
  border: 1px dashed color-mix(in srgb, var(--brand) 45%, transparent);
  border-radius: var(--radius-sm);
  padding: 12px;
  background: color-mix(in srgb, var(--brand) 4%, transparent);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.form-grid { display: flex; gap: 8px; flex-wrap: wrap; }
.form-grid .input { flex: 1; min-width: 120px; }
.form-actions { display: flex; gap: 8px; }

.card-list { display: flex; flex-direction: column; gap: 10px; }
.card-item {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  background: color-mix(in srgb, var(--brand) 3%, transparent);
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.card-front { font-size: 15px; font-weight: 600; color: var(--text); word-break: break-word; }
.card-back { font-size: 13px; color: var(--muted); word-break: break-word; line-height: 1.5; }
.card-side { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; align-items: flex-end; }
.card-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; max-width: 200px; }
.card-actions { display: flex; gap: 6px; }
.act {
  border: 1px solid var(--line); background: transparent; color: var(--muted);
  border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; transition: all .15s;
}
.act:hover { color: var(--brand); border-color: var(--brand); }
.act.del:hover { color: var(--bad); border-color: var(--bad); }
.card-item { transition: background .15s ease, border-color .15s ease, box-shadow .15s ease; }
.card-item:hover { background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 8%, transparent), color-mix(in srgb, var(--brand2) 4%, transparent)); }

.mem-badge { font-size: 11px; border-radius: 6px; padding: 2px 8px; white-space: nowrap; }
.mem-badge.ok { background: rgba(47, 191, 143, 0.12); border: 1px solid rgba(47, 191, 143, 0.45); color: var(--ok-soft); }
.mem-badge.mid { background: color-mix(in srgb, var(--brand) 15%, transparent); border: 1px solid color-mix(in srgb, var(--brand) 50%, transparent); color: var(--brand-soft); }
.mem-badge.warn { background: rgba(217, 154, 61, 0.12); border: 1px solid rgba(217, 154, 61, 0.45); color: var(--warn-soft); }
.mem-badge.new { background: rgba(148, 163, 184, 0.12); border: 1px solid rgba(148, 163, 184, 0.35); color: var(--muted); }
.cat-badge { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 1px 8px; }
.cat-badge.src { color: var(--brand); border-color: color-mix(in srgb, var(--brand) 40%, transparent); }
.cat-badge.uncat { color: var(--warn-soft); }
.state { font-size: 11px; color: var(--muted); }
.state.due { color: var(--warn-soft); }

/* CSV/Excel 导入弹层 */
.cm-import-mask {
  position: fixed; inset: 0; z-index: 220;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur));
  display: flex; align-items: center; justify-content: center;
}
.cm-import {
  width: 500px; max-width: 92vw;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow), var(--glow-soft);
  padding: 18px;
  display: flex; flex-direction: column; gap: 14px;
}
.ci-head { display: flex; align-items: center; justify-content: space-between; }
.ci-title { font-size: 15px; font-weight: 600; color: var(--text); }
.ci-close { font-size: 20px; color: var(--muted); cursor: pointer; line-height: 1; transition: color .15s; }
.ci-close:hover { color: var(--brand); }
.ci-body { display: flex; flex-direction: column; gap: 12px; }
.ci-target {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; padding: 8px 12px;
  background: color-mix(in srgb, var(--brand) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--brand) 25%, transparent);
  border-radius: var(--radius-sm);
}
.ci-target-label { color: var(--muted); flex-shrink: 0; }
.ci-target-val { color: var(--brand); font-weight: 500; }
.dropzone {
  border: 2px dashed var(--line);
  border-radius: var(--radius-sm);
  padding: 26px 16px;
  text-align: center;
  display: flex; flex-direction: column; gap: 6px; align-items: center;
  transition: border-color .2s, background .2s;
}
.dropzone.over, .dropzone:hover { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 4%, transparent); }
.dz-ico { color: var(--brand); opacity: .7; margin-bottom: 2px; }
.dz-title { font-size: 13px; color: var(--text); }
.dz-sub { font-size: 11px; color: var(--muted); }
.dz-btn { margin-top: 6px; }
.ci-guide {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.ci-guide-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--text); }
.ci-guide-actions { display: flex; gap: 6px; }
.ci-tip { font-size: 11px; color: var(--muted); line-height: 1.6; }
.ci-preview-head { display: flex; gap: 10px; align-items: center; font-size: 12px; color: var(--text); flex-wrap: wrap; }
.ci-file { color: var(--brand); font-weight: 500; word-break: break-all; }
.ci-summary { color: var(--text); }
.ci-skip { color: var(--warn-soft); }
.ci-preview {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  max-height: 220px; overflow-y: auto;
  display: flex; flex-direction: column;
}
.ci-row { display: flex; gap: 8px; align-items: baseline; padding: 7px 10px; border-bottom: 1px dashed var(--line); font-size: 12px; }
.ci-row:last-child { border-bottom: none; }
.ci-front { color: var(--text); font-weight: 500; }
.ci-sep { color: var(--muted); }
.ci-back { color: var(--muted); flex: 1; }
.ci-cat { color: var(--brand); font-size: 11px; }
.ci-more { padding: 7px 10px; font-size: 11px; color: var(--muted); }
.ci-actions { display: flex; gap: 8px; justify-content: flex-end; }
.ci-done { text-align: center; font-size: 15px; color: var(--ok); padding: 12px 0; }

.fade-enter-active, .fade-leave-active { transition: opacity .18s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
