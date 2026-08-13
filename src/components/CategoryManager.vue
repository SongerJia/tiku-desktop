<script setup>
// 科目管理弹窗：新建科目/章节、改名、删除（删除级联其下题目，强确认）
// 入口：我的 → 数据管理 → 科目管理
import Icon from './Icon.vue'
import { ref, onMounted, watch } from 'vue'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { showConfirm } from '../utils/confirm.js'

const props = defineProps({ show: Boolean })
const emit = defineEmits(['close'])

const tree = ref([])
const expanded = ref(new Set())
const loading = ref(false)
const newSubject = ref('')
const newChapter = ref('')       // 待挂章节的科目 id
const chapterFor = ref(null)     // 当前正在添加章节的科目 id

async function load() {
  loading.value = true
  try { tree.value = await tiku.getCategories() } catch (e) { tree.value = [] }
  loading.value = false
}

onMounted(load)
watch(() => props.show, (v) => { if (v) { load(); newSubject.value = ''; newChapter.value = ''; chapterFor.value = null } })

function toggle(id) {
  const s = new Set(expanded.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  expanded.value = s
}

async function addSubject() {
  const name = newSubject.value.trim()
  if (!name) { showToast('请输入科目名称'); return }
  try {
    await tiku.addCategory({ name, parentId: null })
    showToast(`已新建科目「${name}」`, 'ok')
    newSubject.value = ''
    await load()
  } catch (e) { showToast('新建失败：' + (e.message || '未知错误'), 'err') }
}

async function addChapter(subject) {
  const name = newChapter.value.trim()
  if (!name) { showToast('请输入章节名称'); return }
  try {
    await tiku.addCategory({ name, parentId: subject.id })
    showToast(`已新建章节「${name}」`, 'ok')
    newChapter.value = ''
    chapterFor.value = null
    expanded.value.add(subject.id)
    expanded.value = new Set(expanded.value)
    await load()
  } catch (e) { showToast('新建失败：' + (e.message || '未知错误'), 'err') }
}

async function rename(node) {
  const name = window.prompt(`重命名「${node.name}」为：`, node.name)
  if (name == null || !name.trim() || name.trim() === node.name) return
  try {
    await tiku.renameCategory({ id: node.id, name: name.trim() })
    showToast('已重命名', 'ok')
    await load()
  } catch (e) { showToast('重命名失败：' + (e.message || '未知错误'), 'err') }
}

async function remove(node) {
  const isSubject = !node.parent_id
  const ok = await showConfirm(
    `确定删除「${node.name}」？${isSubject ? '\n其下所有章节与题目将被一并删除（软删，可从备份恢复）。' : '\n该章节下所有题目将被一并删除（软删，可从备份恢复）。'}`,
    { title: '删除' + (isSubject ? '科目' : '章节'), danger: true }
  )
  if (!ok) return
  try {
    await tiku.deleteCategory(node.id)
    showToast('已删除', 'ok')
    await load()
  } catch (e) { showToast('删除失败：' + (e.message || '未知错误'), 'err') }
}
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="cat-mask" @click.self="emit('close')">
      <div class="cat-panel">
        <div class="cat-head">
          <span class="cat-title"><Icon name="folder" :size="15"/> 科目管理</span>
          <span class="cat-close" @click="emit('close')">×</span>
        </div>
        <p class="cat-tip">科目是全局维度（题库 / 复习 / 每日一题 / 知识库都跟随科目）。</p>

        <!-- 新建科目 -->
        <div class="cat-add-row">
          <input v-model="newSubject" class="input" placeholder="新建科目名称（如：建设工程法规及相关知识）" @keyup.enter="addSubject" />
          <button class="btn btn-primary" @click="addSubject">添加科目</button>
        </div>

        <!-- 树列表 -->
        <div v-if="loading" class="cat-empty">加载中…</div>
        <div v-else-if="!tree.length" class="cat-empty">还没有科目，用上面的输入框新建一个吧</div>
        <div v-else class="cat-tree">
          <div v-for="s in tree" :key="s.id" class="cat-node">
            <div class="cat-row">
              <span class="cat-caret" @click="toggle(s.id)">{{ (s.children && s.children.length) ? (expanded.has(s.id) ? '▾' : '▸') : '·' }}</span>
              <span class="cat-name" @click="toggle(s.id)">{{ s.name }}</span>
              <span class="cat-count" v-if="s.children && s.children.length">{{ s.children.length }} 章节</span>
              <span class="cat-ops">
                <button class="op-btn" @click="chapterFor = chapterFor === s.id ? null : s.id">+ 章节</button>
                <button class="op-btn" @click="rename(s)">改名</button>
                <button class="op-btn danger" @click="remove(s)">删除</button>
              </span>
            </div>
            <div v-if="chapterFor === s.id" class="cat-add-row chapter">
              <input v-model="newChapter" class="input" :placeholder="`在「${s.name}」下新建章节`" @keyup.enter="addChapter(s)" />
              <button class="btn" @click="addChapter(s)">添加</button>
            </div>
            <div v-if="expanded.has(s.id) && s.children && s.children.length" class="cat-children">
              <div v-for="ch in s.children" :key="ch.id" class="cat-row child">
                <span class="cat-caret">·</span>
                <span class="cat-name">{{ ch.name }}</span>
                <span class="cat-ops">
                  <button class="op-btn" @click="rename(ch)">改名</button>
                  <button class="op-btn danger" @click="remove(ch)">删除</button>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.cat-mask {
  position: fixed; inset: 0; z-index: 90;
  background: var(--modal-mask, rgba(0,0,0,.5));
  display: flex; align-items: center; justify-content: center;
}
.cat-panel {
  width: 520px; max-width: 92vw; max-height: 78vh;
  background: var(--bg, #0b1526); border: 1px solid var(--line);
  border-radius: 14px; padding: 18px;
  display: flex; flex-direction: column; gap: 12px; overflow: hidden;
}
[data-theme="light"] .cat-panel { background: #fff; }
[data-theme="eye"] .cat-panel { background: #f2f7ef; }
.cat-head { display: flex; align-items: center; justify-content: space-between; }
.cat-title { font-size: 15px; font-weight: 600; color: var(--text); display: inline-flex; align-items: center; gap: 6px; }
.cat-close { font-size: 20px; color: var(--muted); cursor: pointer; line-height: 1; }
.cat-tip { font-size: 11px; color: var(--muted); margin: 0; }
.cat-add-row { display: flex; gap: 8px; }
.cat-add-row .input { flex: 1; }
.cat-add-row.chapter { margin: 4px 0 8px 22px; }
.cat-empty { font-size: 12px; color: var(--muted); text-align: center; padding: 18px 0; }
.cat-tree { overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.cat-row {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 8px; border-radius: 8px; transition: background .15s;
}
.cat-row:hover { background: rgba(91, 124, 250, 0.06); }
.cat-row.child { padding-left: 26px; }
.cat-caret { width: 14px; font-size: 11px; color: var(--muted); cursor: pointer; flex-shrink: 0; }
.cat-name { font-size: 13px; color: var(--text); cursor: pointer; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cat-count { font-size: 11px; color: var(--muted); flex-shrink: 0; }
.cat-ops { display: flex; gap: 4px; flex-shrink: 0; }
.op-btn {
  background: none; border: 1px solid var(--line); border-radius: 6px;
  font-size: 11px; color: var(--muted); padding: 2px 8px; cursor: pointer;
}
.op-btn:hover { color: var(--brand); border-color: var(--brand); }
.op-btn.danger:hover { color: var(--bad); border-color: var(--bad); }
.cat-children { display: flex; flex-direction: column; }
</style>
