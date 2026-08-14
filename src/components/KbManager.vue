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
            <button class="btn btn-primary sm" @click="onImport">导入文档</button>
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
                  <button class="km-op" @click="toggleEdit(d)">{{ editing === d.id ? '收起' : '编辑' }}</button>
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

              <!-- 行内编辑区：打开 / 重命名 / 移动 -->
              <div v-if="editing === d.id" class="km-edit" @click.stop>
                <div class="km-edit-row">
                  <span class="km-edit-label">打开</span>
                  <button class="btn sm" @click="openDoc(d)">阅读全文</button>
                </div>
                <div class="km-edit-row">
                  <span class="km-edit-label">重命名</span>
                  <input v-model="renameVal" class="input" placeholder="新标题" @keyup.enter="doRename(d)" @keyup.esc="editing = null" />
                  <button class="btn btn-primary sm" @click="doRename(d)">确定</button>
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
                  <button class="btn btn-primary sm" @click="doMove(d)">应用</button>
                </div>
              </div>
            </div>

            <div v-if="!filteredDocs.length" class="km-empty">
              {{ keyword ? '没有匹配的文档，换个关键词试试' : (docs.length ? '当前筛选没有文档' : '还没有文档，点击「导入文档」添加（md / pdf）') }}
            </div>
          </div>
        </div>

        <!-- 阅读器（管理弹窗内打开） -->
        <KbReader :show="reader.show" :doc="reader.doc" @close="reader.show = false" />
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import Icon from './Icon.vue'
import KbReader from './KbReader.vue'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { showConfirm } from '../utils/confirm.js'

const props = defineProps({
  show: Boolean,
  initialSubjectId: { type: [Number, String], default: null }
})
const emit = defineEmits(['close', 'changed'])

const docs = ref([])
const subjects = ref({})
const keyword = ref('')
const subjectFilter = ref('')
const categoryFilter = ref('')
const editing = ref(null) // 行内编辑中的文档 id
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
  editing.value = null
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

// 导入（复用 KbLibrary 逻辑：null=弹选择框）
async function onImport() {
  const res = (await tiku.kbImportFiles(null, null)) || []
  const ok = res.filter(r => r.ok && !r.duplicated)
  const dup = res.filter(r => r.duplicated)
  const failed = res.filter(r => !r.ok)
  if (ok.length || dup.length) await load()
  const msgs = []
  if (ok.length) msgs.push(`导入 ${ok.length} 篇`)
  if (dup.length) msgs.push(`已存在跳过 ${dup.length} 篇`)
  if (failed.length) msgs.push(`失败 ${failed.length} 篇（${failed[0].error || '仅支持 md/pdf'}）`)
  if (msgs.length) showToast(msgs.join('；'), failed.length ? 'err' : 'ok')
}

// 编辑：展开/收起行内编辑区，预填当前值
function toggleEdit(d) {
  if (editing.value === d.id) { editing.value = null; return }
  editing.value = d.id
  renameVal.value = d.title
  moveSubjectId.value = d.subject_id ? String(d.subject_id) : ''
  moveCategoryId.value = d.category_id ? String(d.category_id) : ''
}
async function doRename(d) {
  const t = renameVal.value.trim()
  if (!t || t === d.title) { editing.value = null; return }
  await tiku.kbUpdate(d.id, { title: t })
  d.title = t
  editing.value = null
  emit('changed')
  showToast('已重命名', 'ok')
}

async function doMove(d) {
  const subjectId = moveSubjectId.value ? Number(moveSubjectId.value) : null
  const categoryId = moveCategoryId.value ? Number(moveCategoryId.value) : null
  await tiku.kbUpdate(d.id, { subjectId, categoryId })
  d.subject_id = subjectId
  d.category_id = categoryId
  editing.value = null
  emit('changed')
  showToast('已移动', 'ok')
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
  background: rgba(91, 124, 250, 0.04);
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
  background: rgba(91, 124, 250, 0.12); color: var(--brand);
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
.km-op:hover { color: var(--brand); border-color: var(--brand); background: rgba(91, 124, 250, 0.08); }
.km-op.danger:hover { color: #ff6b6b; border-color: #ff6b6b; background: rgba(255, 107, 107, 0.08); }
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

.km-edit {
  display: flex; flex-direction: column; gap: 8px;
  margin: 4px 6px 12px;
  padding: 10px 12px;
  background: var(--hover-bg);
  border: 1px solid var(--line); border-radius: 10px;
  animation: kmEditIn .18s ease;
}
@keyframes kmEditIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.km-edit-row {
  display: flex; align-items: center; gap: 8px;
}
.km-edit-label {
  width: 46px; flex-shrink: 0;
  font-size: 11.5px; color: var(--muted);
}
.km-edit-row .input { flex: 1; min-width: 0; }

.km-empty {
  text-align: center; padding: 48px 0;
  font-size: 12.5px; color: var(--muted);
}
</style>
