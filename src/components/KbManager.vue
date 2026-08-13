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
          <!-- 工具条 -->
          <div class="km-toolbar">
            <input v-model="keyword" class="input km-search" placeholder="搜索文档标题（中英文均可）" />
            <select v-model="folderFilter" class="input km-folder">
              <option value="">全部文件夹</option>
              <option value="__none">未分类</option>
              <option v-for="f in folders" :key="f" :value="f">{{ f }}</option>
            </select>
            <button class="btn btn-primary sm" @click="onImport">导入文档</button>
          </div>

          <!-- 列表 -->
          <div class="km-list">
            <div v-for="d in filteredDocs" :key="d.id" class="km-item">
              <div class="km-main" @click="openDoc(d)">
                <span class="km-ico"><Icon :name="d.type === 'pdf' ? 'doc' : 'note'" :size="15" /></span>
                <div class="km-info">
                  <span class="km-title">{{ d.title }}</span>
                  <span class="km-sub">{{ posLabel(d) }}</span>
                </div>
                <span class="km-meta">
                  <span :class="{ 'km-unread': !d.read_count }">{{ d.read_count ? '已读 ' + d.read_count + ' 次' : '未读' }}</span>
                  <i>·</i>
                  <span>{{ fmtSize(d.size) }}</span>
                  <i>·</i>
                  <span>{{ fmtTime(d.updated_at) }}</span>
                </span>
              </div>

              <div class="km-ops">
                <button class="km-op" @click="openDoc(d)">打开</button>
                <button class="km-op" @click="startRename(d)">重命名</button>
                <button class="km-op" @click="startMove(d)">移动</button>
                <button class="km-op danger" @click="onDelete(d)">删除</button>
              </div>

              <!-- 行内重命名 -->
              <div v-if="renaming === d.id" class="km-inline" @click.stop>
                <input v-model="renameVal" class="input" placeholder="新标题" @keyup.enter="doRename(d)" @keyup.esc="renaming = null" />
                <button class="btn btn-primary sm" @click="doRename(d)">确定</button>
                <button class="btn sm" @click="renaming = null">取消</button>
              </div>
              <!-- 行内移动 -->
              <div v-if="moving === d.id" class="km-inline" @click.stop>
                <select v-model="moveVal" class="input">
                  <option value="">未分类</option>
                  <option v-for="f in folders" :key="f" :value="f">{{ f }}</option>
                </select>
                <button class="btn btn-primary sm" @click="doMove(d)">确定</button>
                <button class="btn sm" @click="moving = null">取消</button>
              </div>
            </div>

            <div v-if="!filteredDocs.length" class="km-empty">
              {{ keyword ? '没有匹配的文档，换个关键词试试' : (docs.length ? '当前文件夹没有文档' : '还没有文档，点击「导入文档」添加（md / pdf）') }}
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

const props = defineProps({ show: Boolean })
const emit = defineEmits(['close', 'changed'])

const docs = ref([])
const subjects = ref([])
const keyword = ref('')
const folderFilter = ref('')
const renaming = ref(null)
const renameVal = ref('')
const moving = ref(null)
const moveVal = ref('')
const reader = ref({ show: false, doc: null })

// 打开时加载
watch(() => props.show, async (v) => {
  if (!v) return
  keyword.value = ''
  folderFilter.value = ''
  await load()
})

async function load() {
  const [list, cats] = await Promise.all([tiku.kbList(), tiku.getCategories().catch(() => [])])
  docs.value = list || []
  // 科目树：id → 名称（科目 + 章节两层）
  const m = {}
  const walk = (nodes) => nodes.forEach(n => { m[n.id] = n; if (n.children) walk(n.children) })
  walk(cats || [])
  subjects.value = m
}

function close() {
  renaming.value = null
  moving.value = null
  reader.value = { show: false, doc: null }
  emit('close')
}

// 文件夹列表（按出现顺序去重，未分类过滤）
const folders = computed(() => {
  const seen = new Set()
  const out = []
  docs.value.forEach(d => {
    if (d.folder && !seen.has(d.folder)) { seen.add(d.folder); out.push(d.folder) }
  })
  return out
})

// 位置标签：文件夹优先，其次 科目·章节，再未分类
function posLabel(d) {
  if (d.folder) return '文件夹 · ' + d.folder
  const subj = d.subject_id ? subjects.value[d.subject_id] : null
  const cat = d.category_id ? subjects.value[d.category_id] : null
  if (subj || cat) return (subj ? subj.name : '') + (cat && cat.parent_id ? ' · ' + cat.name : '')
  return '未分类'
}

const filteredDocs = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return docs.value.filter(d => {
    if (kw && !String(d.title).toLowerCase().includes(kw)) return false
    if (folderFilter.value === '__none') return !d.folder
    if (folderFilter.value && d.folder !== folderFilter.value) return false
    return true
  })
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

function startRename(d) { renaming.value = d.id; renameVal.value = d.title; moving.value = null }
async function doRename(d) {
  const t = renameVal.value.trim()
  if (!t || t === d.title) { renaming.value = null; return }
  await tiku.kbUpdate(d.id, { title: t })
  d.title = t
  renaming.value = null
  emit('changed')
  showToast('已重命名', 'ok')
}

function startMove(d) { moving.value = d.id; moveVal.value = d.folder || ''; renaming.value = null }
async function doMove(d) {
  const f = moveVal.value.trim()
  await tiku.kbMove(d.id, f)
  d.folder = f
  moving.value = null
  emit('changed')
  showToast(f ? `已移动到「${f}」` : '已移回未分类', 'ok')
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
}
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
.km-toolbar {
  display: flex; gap: 10px; padding: 12px 18px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.km-search { flex: 1; min-width: 0; }
.km-folder { width: 150px; flex-shrink: 0; }

.km-list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 12px 16px; }
.km-item {
  position: relative;
  border-bottom: 0.5px solid var(--line);
}
.km-main {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 6px;
  cursor: pointer;
  border-radius: 8px;
}
.km-main:hover { background: var(--hover-bg); }
.km-ico {
  width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(91, 124, 250, 0.12); color: var(--brand);
}
.km-info { flex: 1; min-width: 0; }
.km-title {
  display: block; font-size: 13px; font-weight: 500; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.km-sub { display: block; font-size: 11px; color: var(--muted); margin-top: 2px; }
.km-meta {
  display: flex; align-items: center; gap: 6px; flex-shrink: 0;
  font-size: 11.5px; color: var(--muted);
}
.km-meta i { font-style: normal; opacity: .5; }
.km-unread { color: var(--brand); font-weight: 500; }

.km-ops {
  position: absolute; right: 6px; top: 8px;
  display: flex; gap: 4px;
  opacity: 0; transition: opacity .15s ease;
}
.km-item:hover .km-ops { opacity: 1; }
.km-op {
  border: 1px solid var(--line); background: var(--card-solid);
  border-radius: 6px; padding: 3px 9px;
  font-size: 11.5px; color: var(--muted); cursor: pointer;
}
.km-op:hover { color: var(--brand); border-color: var(--brand); }
.km-op.danger:hover { color: #ff6b6b; border-color: #ff6b6b; }

.km-inline {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 6px 10px 48px;
  background: var(--hover-bg);
}
.km-inline .input { flex: 1; min-width: 0; }

.km-empty {
  text-align: center; padding: 48px 0;
  font-size: 12.5px; color: var(--muted);
}
</style>
