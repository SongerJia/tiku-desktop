<template>
  <transition name="fade">
    <div v-if="show" class="km-mask" @click.self="close">
      <div class="km-panel">
        <div class="km-header">
          <span class="close" @click="close">×</span>
          <span class="title">文档管理</span>
          <span class="count">{{ docs.length }} 篇</span>
        </div>

        <div class="km-body">
          <!-- 概览 -->
          <div class="km-stats">
            <div class="km-stat"><b style="animation-delay: 0s">{{ kmStats.total }}</b><span>总文档</span></div>
            <div class="km-stat"><b style="animation-delay: .06s">{{ kmStats.unread }}</b><span>未读</span></div>
            <div class="km-stat"><b style="animation-delay: .12s">{{ kmStats.reads }}</b><span>总阅读次数</span></div>
          </div>

          <!-- 操作条 -->
          <div class="km-toolbar">
            <button class="btn btn-primary btn-sm" @click="openImport">导入文档</button>
            <button class="btn btn-sm" @click="onExport">导出</button>
            <span class="km-fmt">md / pdf</span>
            <span class="km-count">{{ filteredDocs.length }} / {{ docs.length }} 篇</span>
          </div>

          <!-- 筛选：科目 → 章节（联动）→ 搜索 -->
          <div class="km-filters">
            <select v-model="subjectFilter" class="input" @change="categoryFilter = ''">
              <option value="">全部科目</option>
              <option v-for="s in subjectOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <select v-model="categoryFilter" class="input" :disabled="!filterChapters.length">
              <option value="">全部章节</option>
              <option v-for="c in filterChapters" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <input v-model="keyword" class="input km-search" placeholder="搜索文档标题…" />
          </div>

          <!-- 列表 -->
          <div class="km-list">
            <div v-for="(d, i) in filteredDocs" :key="d.id" class="km-item" :style="{ animationDelay: (i * 0.035) + 's' }">
              <div class="km-top" @click="openDoc(d)">
                <span class="km-ico"><Icon :name="d.type === 'pdf' ? 'doc' : 'note'" :size="15" /></span>
                <span class="km-title">{{ d.title }}</span>
                <span class="km-cat">{{ posLabel(d) }}</span>
                <span class="km-spacer"></span>
                <div class="km-ops" @click.stop>
                  <button class="km-op" @click="toggleEdit(d)">{{ editDoc === d ? '收起' : '编辑' }}</button>
                  <button class="km-op danger" @click="onDelete(d)">删除</button>
                </div>
              </div>

              <div class="km-bottom">
                <span class="km-meta">
                  <span :class="{ 'km-unread': !d.read_count }">{{ d.read_count ? '已读 ' + d.read_count + ' 次' : '未读' }}</span>
                  <i>·</i>
                  <span>{{ fmtSize(d.size) }}</span>
                  <i>·</i>
                  <span>{{ fmtTime(d.updated_at) }}</span>
                </span>
              </div>
            </div>

            <div v-if="!filteredDocs.length" class="km-empty">
              {{ keyword ? '没有匹配的文档，换个关键词试试' : (docs.length ? '当前筛选没有文档' : '还没有文档，点击「导入文档」添加（md / pdf）') }}
            </div>
          </div>
        </div>

        <!-- 阅读器（管理弹窗内打开） -->
        <KbReader :show="reader.show" :doc="reader.doc" @close="reader.show = false" />

        <!-- 导入文档弹窗 -->
        <div v-if="importStep" class="km-import-mask" @click.self="closeImport">
          <div class="km-import">
            <div class="ki-head">
              <span class="ki-title">导入知识文档</span>
              <span class="ki-close" @click="closeImport">×</span>
            </div>

            <div v-if="importStep === 'pick'" class="ki-body">
              <div class="ki-target">
                <span class="ki-target-label">导入到</span>
                <span class="ki-target-val">{{ importTargetLabel }}</span>
              </div>
              <div class="ki-drop" @click="pickImportFiles">
                <Icon name="download" :size="22" />
                <div class="ki-dz-title">选择要导入的文档</div>
                <div class="ki-dz-sub">支持 .md / .pdf，可多选；选择后预览确认</div>
              </div>
            </div>

            <div v-else-if="importStep === 'preview'" class="ki-body">
              <div class="ki-target">
                <span class="ki-target-label">导入到</span>
                <span class="ki-target-val">{{ importTargetLabel }}</span>
              </div>
              <div class="ki-preview">
                <div v-for="(f, i) in importFiles" :key="i" class="ki-row">
                  <span class="ki-ext">{{ f.ext.toUpperCase() }}</span>
                  <span class="ki-name" :title="f.name">{{ f.name }}</span>
                  <span class="ki-rm" @click="removeImportFile(i)">×</span>
                </div>
                <div class="ki-add" @click="pickImportFiles">＋ 再选文件</div>
              </div>
              <div class="ki-actions">
                <button class="btn" @click="importStep = 'pick'">重新选择</button>
                <button class="btn btn-primary" :disabled="importBusy" @click="confirmImport">{{ importBusy ? '导入中…' : '确认导入 ' + importFiles.length + ' 篇' }}</button>
              </div>
            </div>

            <div v-else class="ki-body">
              <div class="ki-done">
                <div class="ki-done-ico">✓</div>
                <div class="ki-done-text">
                  <template v-if="importResult.ok">导入 {{ importResult.ok }} 篇</template>
                  <template v-if="importResult.dup"> · 已存在跳过 {{ importResult.dup }} 篇</template>
                  <template v-if="importResult.failed"> · 失败 {{ importResult.failed }} 篇</template>
                </div>
              </div>
              <div class="ki-actions">
                <button class="btn btn-primary" @click="closeImport">完成</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>

  <!-- 编辑弹窗（Teleport 到 body，独立于管理面板） -->
  <Teleport to="body">
    <transition name="fade">
      <div v-if="editDoc" class="km-emask" @click.self="editDoc = null">
        <div class="km-ebox">
          <div class="km-ehead">
            <span class="km-etitle">编辑文档</span>
            <span class="close" @click="editDoc = null">×</span>
          </div>
          <div class="km-ebody">
            <div class="km-edit-row">
              <span class="km-edit-label">文档</span>
              <span class="km-edoc" :title="editDoc.title">{{ editDoc.title }}</span>
              <button class="btn btn-sm" @click="openFromEdit">阅读全文</button>
            </div>
            <div class="km-edit-row">
              <span class="km-edit-label">重命名</span>
              <input v-model="renameVal" class="input" placeholder="新标题" @keyup.enter="saveEdit" />
            </div>
            <div class="km-edit-row">
              <span class="km-edit-label">移动</span>
              <select v-model="moveSubjectId" class="input" @change="moveCategoryId = ''">
                <option value="">不设科目</option>
                <option v-for="s in subjectOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
              <select v-if="moveSubjectId" v-model="moveCategoryId" class="input">
                <option value="">（章节）</option>
                <option v-for="c in moveChapters" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
          </div>
          <div class="km-efoot">
            <button class="btn" @click="editDoc = null">取消</button>
            <button class="btn btn-primary" @click="saveEdit">保存</button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useBodyLock } from '../composables/useBodyLock.js'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import Icon from './Icon.vue'
import KbReader from './KbReader.vue'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { showConfirm } from '../utils/confirm.js'
import { useEsc } from '../utils/useEsc.js'

const props = defineProps({
  show: Boolean,
  initialSubjectId: { type: [Number, String], default: null }
})
useBodyLock(() => props.show)
useFocusTrap(() => props.show, '.km-panel')
const emit = defineEmits(['close', 'changed'])

const docs = ref([])
const subjects = ref({})
const keyword = ref('')
const subjectFilter = ref('')
const categoryFilter = ref('')
const editDoc = ref(null) // 编辑弹窗中的文档对象
const renameVal = ref('')
const moveSubjectId = ref('')
const moveCategoryId = ref('')
const reader = ref({ show: false, doc: null })

// 打开时加载（入口决定初始筛选：tab 页传当前科目，我的页不传 = 全部科目）
watch(() => props.show, async (v) => {
  if (!v) return
  keyword.value = ''
  subjectFilter.value = props.initialSubjectId != null ? String(props.initialSubjectId) : ''
  categoryFilter.value = ''
  await load()
})

async function load() {
  const [list, cats] = await Promise.all([tiku.kbList(), tiku.getCategories().catch(() => [])])
  docs.value = list || []
  // 科目树展平：id → 节点（含 children）
  const m = {}
  const walk = (nodes) => nodes.forEach(n => { m[n.id] = n; if (n.children) walk(n.children) })
  walk(cats || [])
  subjects.value = m
}

function close() {
  editDoc.value = null
  reader.value = { show: false, doc: null }
  emit('close')
}

// 科目列表（parent 为空的根节点）
const subjectOptions = computed(() => Object.values(subjects.value).filter(n => !n.parent_id))
// 筛选时选定科目的章节（联动下拉）
const filterChapters = computed(() => {
  const s = subjects.value[Number(subjectFilter.value)]
  return (s && s.children) || []
})
// 移动时当前科目的章节
const moveChapters = computed(() => {
  const s = subjects.value[Number(moveSubjectId.value)]
  return (s && s.children) || []
})

// 位置标签：科目 · 章节 / 科目 / 未分类
function posLabel(d) {
  const subj = d.subject_id ? subjects.value[d.subject_id] : null
  const cat = d.category_id ? subjects.value[d.category_id] : null
  if (subj || cat) return (subj ? subj.name : '') + (cat && cat.parent_id ? ' · ' + cat.name : '')
  return '未分类'
}

const filteredDocs = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const sid = Number(subjectFilter.value)
  const cid = Number(categoryFilter.value)
  return docs.value.filter(d => {
    if (kw && !String(d.title).toLowerCase().includes(kw)) return false
    if (sid && Number(d.subject_id) !== sid) return false
    if (cid && Number(d.category_id) !== cid) return false
    return true
  })
})

// 概览统计：总文档 / 未读 / 总阅读次数
const kmStats = computed(() => {
  const total = docs.value.length
  const unread = docs.value.filter(d => !d.read_count).length
  const reads = docs.value.reduce((s, d) => s + (d.read_count || 0), 0)
  return { total, unread, reads }
})

// 打开：拉完整文档进阅读器
async function openDoc(d) {
  const full = await tiku.kbGet(d.id).catch(() => null)
  reader.value = { show: true, doc: full || d }
}

// ---- 导入弹窗（参照记忆卡导入：导入到提示 + 选文件预览 + 确认）----
const importStep = ref('')          // '' 未开 | 'pick' 选文件 | 'preview' 预览 | 'done' 完成
const importFiles = ref([])         // [{path, name, ext}]
const importBusy = ref(false)
const importResult = ref(null)      // {ok, dup, failed}
// 导入目标 = 当前筛选（章节优先，其次科目）；未筛选时 = 全部（主进程按 null 处理，文档不挂科目）
const importTargetLabel = computed(() => {
  const sid = Number(subjectFilter.value)
  const cid = Number(categoryFilter.value)
  const s = subjects.value[sid]
  const c = subjects.value[cid]
  if (c && c.parent_id) return (s ? s.name : '') + ' · ' + c.name
  if (s) return s.name
  return '全部科目（导入后按文档归属整理）'
})
function openImport() {
  importStep.value = 'pick'
  importFiles.value = []
  importResult.value = null
}
async function pickImportFiles() {
  try {
    const files = await tiku.kbPickFiles()
    // P6 诊断：区分「原生桥缺失」（插件未注册）与「选择器未返回」（用户取消/读取失败）
    if (files && files.bridgeMissing) {
      showToast('文件选择器未就绪（原生插件未注册，需重新打包）', 'err')
      return
    }
    if (!files || !files.length) {
      showToast('未选择文件（若已选却无反应，请检查文件选择器返回）', 'err')
      return
    }
    importFiles.value = files
    importStep.value = 'preview'
  } catch (e) {
    showToast('选择文件失败：' + (e.message || '未知错误'), 'err')
  }
}
function removeImportFile(i) {
  importFiles.value.splice(i, 1)
  if (!importFiles.value.length) importStep.value = 'pick'
}
async function confirmImport() {
  if (!importFiles.value.length) return
  importBusy.value = true
  try {
    // 导入目标：章节/科目 id（与筛选一致）；未筛选传 null = 不挂科目
    const sid = Number(subjectFilter.value) || null
    const cid = Number(categoryFilter.value) || null
    const target = cid || sid || null
    // P6 修复：APK 端直接传预览文件对象（含 base64），Electron 端传 {path} 路径数组——
    // 由桥层 kbImportFiles 按元素类型区分（对象=复用字节，字符串=读磁盘路径）
    const paths = importFiles.value.map(f => (f.path ? f.path : f))
    const res = (await tiku.kbImportFiles(paths, target)) || []
    const ok = res.filter(r => r.ok && !r.duplicated)
    const dup = res.filter(r => r.duplicated)
    const failed = res.filter(r => !r.ok)
    importResult.value = { ok: ok.length, dup: dup.length, failed: failed.length }
    importStep.value = 'done'
    if (ok.length || dup.length) {
      await load()
      emit('changed')
    }
  } catch (e) {
    showToast('导入失败：' + (e.message || '未知错误'), 'err')
    importStep.value = 'preview'
  } finally {
    importBusy.value = false
  }
}
function closeImport() { importStep.value = ''; importFiles.value = []; importResult.value = null }
useEsc(() => {
  if (importStep.value) { closeImport(); return }
  if (editDoc.value) { editDoc.value = null; return }
  close()
})

// 导出：整库导出到指定目录（与原工具条「导出」按钮一致，迁入管理弹窗）
async function onExport() {
  const r = await tiku.kbExport()
  if (r && r.ok) showToast(`已导出 ${r.files} 个文件 / ${r.docs} 篇文档到：${r.target}`, 'ok')
  else if (r && !r.canceled) showToast('导出失败', 'err')
}

// 编辑：打开/关闭编辑弹窗，预填当前值
function toggleEdit(d) {
  if (editDoc.value === d) { editDoc.value = null; return }
  editDoc.value = d
  renameVal.value = d.title
  moveSubjectId.value = d.subject_id ? String(d.subject_id) : ''
  moveCategoryId.value = d.category_id ? String(d.category_id) : ''
}
// 保存：一次性应用重命名 + 移动
async function saveEdit() {
  const d = editDoc.value
  if (!d) return
  const t = renameVal.value.trim()
  if (t && t !== d.title) {
    await tiku.kbUpdate(d.id, { title: t })
    d.title = t
  }
  const subjectId = moveSubjectId.value ? Number(moveSubjectId.value) : null
  const categoryId = moveCategoryId.value ? Number(moveCategoryId.value) : null
  if (subjectId !== d.subject_id || categoryId !== d.category_id) {
    await tiku.kbUpdate(d.id, { subjectId, categoryId })
    d.subject_id = subjectId
    d.category_id = categoryId
  }
  editDoc.value = null
  emit('changed')
  showToast('已保存', 'ok')
}
// 从编辑弹窗打开阅读（关弹窗，阅读器盖在管理面板上）
function openFromEdit() {
  const d = editDoc.value
  if (!d) return
  editDoc.value = null
  openDoc(d)
}

async function onDelete(d) {
  const ok = await showConfirm(`确定删除「${d.title}」？
将同时移除其文本块与题目关联（副本文件一并删除，不影响你的原始文件）。`)
  if (!ok) return
  await tiku.kbDelete(d.id)
  docs.value = docs.value.filter(x => x.id !== d.id)
  emit('changed')
}

function fmtSize(s) {
  const n = Number(s) || 0
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB'
  if (n >= 1024) return Math.round(n / 1024) + ' KB'
  return n + ' B'
}

function fmtTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - Number(ts)
  if (diff < 60000) return '刚刚'
  const min = Math.floor(diff / 60000)
  if (min < 60) return min + ' 分钟前'
  const hr = Math.floor(min / 60)
  if (hr < 24) return hr + ' 小时前'
  const day = Math.floor(hr / 24)
  return day + ' 天前'
}
</script>

<style scoped>
/* 遮罩/弹窗淡入（管理面板 + 编辑弹窗共用） */
.fade-enter-active, .fade-leave-active { transition: opacity .18s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.km-mask {
  position: fixed; inset: 0; z-index: 195;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur));
  -webkit-backdrop-filter: blur(var(--modal-blur));
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.km-panel {
  position: relative;
  width: 860px; max-width: 94vw; height: 84vh;
  display: flex; flex-direction: column;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow), var(--glow-soft);
  overflow: hidden;
  animation: kmPanelIn .26s cubic-bezier(.2, .7, .3, 1);
}
/* 特效（2026-08-14）：面板上浮入场 / 数字弹入 / 列表项 stagger */
@keyframes kmPanelIn { from { opacity: 0; transform: translateY(18px) scale(.98); } to { opacity: 1; transform: none; } }
@keyframes kmNumPop { from { opacity: 0; transform: scale(.4); } 70% { transform: scale(1.18); } to { opacity: 1; transform: scale(1); } }
@keyframes kmItemIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.km-header {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.km-header .close {
  font-size: 18px; color: var(--muted); cursor: pointer; line-height: 1;
  padding: 4px 8px; border-radius: 6px;
}
.km-header .close:hover { color: var(--text); background: var(--hover-bg); }
.km-header .title { font-size: 15px; font-weight: 600; color: var(--text); }
.km-header .count { margin-left: auto; font-size: 12px; color: var(--muted); }

.km-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
/* 概览三格（与题库管理 stat-row 同语言） */
.km-stats {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
  padding: 14px 18px 0;
  flex-shrink: 0;
}
.km-stat {
  background: color-mix(in srgb, var(--brand) 4%, transparent);
  border: 1px solid var(--line); border-radius: 10px;
  padding: 9px 6px; text-align: center;
  transition: border-color .15s ease, transform .15s ease, box-shadow .15s ease;
}
.km-stat:hover { border-color: var(--brand); transform: translateY(-1px); box-shadow: var(--glow-soft); }
.km-stat b {
  display: block; font-size: 17px; font-weight: 700;
  background: var(--num-grad);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  animation: kmNumPop .5s cubic-bezier(.2, .7, .3, 1) both;
}
.km-stat span { font-size: 11px; color: var(--muted); }
/* 操作条：导入 + 计数 */
.km-toolbar {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 18px 0;
  flex-shrink: 0;
}
.km-fmt { font-size: 11px; color: var(--muted); }
.km-count { margin-left: auto; font-size: 12px; color: var(--muted); }
/* 筛选行：科目 → 章节（联动）→ 搜索 */
.km-filters {
  display: flex; gap: 10px; padding: 10px 18px 12px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.km-filters select { width: 150px; flex-shrink: 0; }
.km-search { flex: 1; min-width: 0; }

.km-list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 12px 16px; }
.km-item {
  position: relative;
  border-bottom: 0.5px solid var(--line);
  animation: kmItemIn .3s ease both;
}
/* 顶部行：图标 + 标题 + 位置 + 右侧操作（hover 显示） */
.km-top {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 6px 4px;
  cursor: pointer;
  border-radius: 8px;
}
.km-top:hover { background: var(--hover-bg); }
.km-ico {
  width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--brand) 12%, transparent); color: var(--brand);
}
.km-title {
  font-size: 13px; font-weight: 500; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex-shrink: 1;
}
.km-cat {
  font-size: 11px; color: var(--muted);
  background: var(--bg-soft); border: 1px solid var(--line);
  border-radius: 999px; padding: 1px 8px;
  flex-shrink: 0;
}
.km-spacer { flex: 1; }
.km-ops {
  display: flex; gap: 4px; flex-shrink: 0;
}
.km-op {
  border: 1px solid var(--line); background: var(--card-solid);
  border-radius: 6px; padding: 3px 9px;
  font-size: 11.5px; color: var(--muted); cursor: pointer;
  transition: all .15s ease;
}
.km-op:hover { color: var(--brand); border-color: var(--brand); background: color-mix(in srgb, var(--brand) 8%, transparent); }
.km-op.danger:hover { color: var(--bad); border-color: var(--bad); background: color-mix(in srgb, var(--bad) 8%, transparent); }
/* 底部行：统计信息右下角 */
.km-bottom {
  display: flex; justify-content: flex-end;
  padding: 2px 6px 9px;
}
.km-meta {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--muted);
}
.km-meta i { font-style: normal; opacity: .5; }
.km-unread { color: var(--brand); font-weight: 500; }

/* 编辑弹窗（Teleport 到 body） */
.km-emask {
  position: fixed; inset: 0; z-index: 220;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur));
  -webkit-backdrop-filter: blur(var(--modal-blur));
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.km-ebox {
  width: 460px; max-width: 92vw;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow), var(--glow-soft);
  animation: kmEditIn .2s cubic-bezier(.2, .7, .3, 1);
}
@keyframes kmEditIn { from { opacity: 0; transform: translateY(12px) scale(.97); } to { opacity: 1; transform: none; } }
.km-ehead {
  display: flex; align-items: center; gap: 8px;
  padding: 13px 16px; border-bottom: 1px solid var(--line);
}
.km-etitle { font-size: 14px; font-weight: 600; color: var(--text); }
.km-ehead .close { font-size: 17px; color: var(--muted); cursor: pointer; margin-left: auto; padding: 2px 8px; border-radius: 6px; }
.km-ehead .close:hover { color: var(--text); background: var(--hover-bg); }
.km-ebody {
  display: flex; flex-direction: column; gap: 12px;
  padding: 14px 16px;
}
.km-efoot {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 12px 16px; border-top: 1px solid var(--line);
}
.km-edit-row {
  display: flex; align-items: center; gap: 8px;
}
.km-edit-label {
  width: 46px; flex-shrink: 0;
  font-size: 11.5px; color: var(--muted);
}
.km-edit-row .input { flex: 1; min-width: 0; }
.km-edoc {
  flex: 1; min-width: 0;
  font-size: 13px; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.km-empty {
  text-align: center; padding: 48px 0;
  font-size: 12.5px; color: var(--muted);
}

/* 导入文档弹窗 */
.km-import-mask {
  position: fixed; inset: 0; z-index: 220;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur));
  display: flex; align-items: center; justify-content: center;
}
.km-import {
  width: 480px; max-width: 92vw;
  max-height: 88dvh; overflow-y: auto; /* 移动端内容高时滚动，防止超出屏幕 */
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow), var(--glow-soft);
  padding: 18px;
  display: flex; flex-direction: column; gap: 14px;
}
.ki-head { display: flex; align-items: center; justify-content: space-between; }
.ki-title { font-size: 15px; font-weight: 600; color: var(--text); }
.ki-close { font-size: 20px; color: var(--muted); cursor: pointer; line-height: 1; transition: color .15s; }
.ki-close:hover { color: var(--brand); }
.ki-body { display: flex; flex-direction: column; gap: 12px; }
.ki-target {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; padding: 8px 12px;
  background: color-mix(in srgb, var(--brand) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--brand) 25%, transparent);
  border-radius: var(--radius-sm);
}
.ki-target-label { color: var(--muted); flex-shrink: 0; }
.ki-target-val { color: var(--brand); font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ki-drop {
  border: 2px dashed var(--line);
  border-radius: var(--radius-sm);
  padding: 26px 16px;
  text-align: center;
  display: flex; flex-direction: column; gap: 6px; align-items: center;
  color: var(--brand); cursor: pointer; opacity: .85;
  transition: border-color .2s, background .2s;
}
.ki-drop:hover { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 4%, transparent); opacity: 1; }
.ki-dz-title { font-size: 13px; color: var(--text); }
.ki-dz-sub { font-size: 11px; color: var(--muted); }
.ki-preview {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  max-height: 220px; overflow-y: auto;
  display: flex; flex-direction: column;
}
.ki-row {
  display: flex; gap: 8px; align-items: center;
  padding: 7px 10px; border-bottom: 1px dashed var(--line); font-size: 12px;
}
.ki-row:last-child { border-bottom: none; }
.ki-ext {
  font-size: 10px; color: var(--brand);
  border: 1px solid color-mix(in srgb, var(--brand) 40%, transparent);
  border-radius: 4px; padding: 0 4px; flex-shrink: 0;
}
.ki-name { flex: 1; min-width: 0; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ki-rm { color: var(--muted); cursor: pointer; font-size: 14px; padding: 0 4px; }
.ki-rm:hover { color: var(--bad); }
.ki-add {
  padding: 8px 10px; font-size: 12px; color: var(--brand); cursor: pointer; text-align: center;
}
.ki-add:hover { background: color-mix(in srgb, var(--brand) 6%, transparent); }
.ki-actions { display: flex; gap: 8px; justify-content: flex-end; }
.ki-done { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px 0; }
.ki-done-ico {
  width: 42px; height: 42px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; color: var(--ok);
  background: rgba(47, 191, 143, 0.12); border: 1px solid rgba(47, 191, 143, 0.45);
}
.ki-done-text { font-size: 13px; color: var(--text); }
</style>
