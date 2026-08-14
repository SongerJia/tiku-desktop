<script setup>
import Icon from './Icon.vue'
import EmptyState from './EmptyState.vue'
import { ref, computed, watch } from 'vue'
import { tiku } from '../api/tiku.js'

const props = defineProps({
  show: Boolean,
  wide: Boolean
})
const emit = defineEmits(['close'])

const list = ref([])
const toast = ref('')

// 筛选：科目 → 章节（联动）→ 题干模糊搜索
const filterSubject = ref('')
const filterCategory = ref('')
const filterKw = ref('')
const subjects = ref([])
const filterChapters = computed(() => {
  const s = subjects.value.find(x => String(x.id) === String(filterSubject.value))
  return (s && s.children) || []
})
const filtered = computed(() => {
  const kw = filterKw.value.trim().toLowerCase()
  const sid = Number(filterSubject.value)
  const cid = Number(filterCategory.value)
  return list.value.filter(n => {
    if (sid && Number(n.subject_id) !== sid) return false
    if (cid && Number(n.category_id) !== cid) return false
    if (kw && !String(n.stem || '').toLowerCase().includes(kw)) return false
    return true
  })
})

function showToast(m) {
  toast.value = m
  setTimeout(() => { toast.value = '' }, 2000)
}

function fmt(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  try { list.value = await tiku.listNotes() } catch (e) { list.value = [] }
  try { subjects.value = await tiku.getCategories() } catch (e) { subjects.value = [] }
}

watch(() => props.show, (v) => { if (v) load() })

async function delNote(item) {
  await tiku.saveNote({ questionId: item.question_id, content: '' })
  showToast('已删除该笔记')
  await load()
}
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="nl-mask" :class="{ 'is-wide': wide }" @click.self="emit('close')">
      <div class="nl-panel" :class="{ 'is-wide': wide }">
        <div class="nl-header">
          <span class="close" @click="emit('close')">×</span>
          <span class="title">我的笔记</span>
          <span class="count">{{ list.length }} 条</span>
        </div>

        <div class="nl-body">
          <EmptyState v-if="!list.length" icon="note" text="还没有笔记" sub="在答题页点「笔记」写下你的理解" />

          <template v-else>
            <!-- 筛选：科目 → 章节（联动）→ 题干模糊搜索 -->
            <div class="nl-filter">
              <select v-model="filterSubject" class="input" @change="filterCategory = ''">
                <option value="">全部科目</option>
                <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
              <select v-model="filterCategory" class="input" :disabled="!filterChapters.length">
                <option value="">全部章节</option>
                <option v-for="c in filterChapters" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
              <input v-model="filterKw" class="input" placeholder="搜索题干关键词…" />
            </div>

            <EmptyState v-if="!filtered.length" icon="search" text="没有匹配的笔记" sub="换个关键词或清空筛选试试" />
            <div v-else class="nl-list">
              <div v-for="n in filtered" :key="n.question_id" class="nl-item">
                <div class="nl-top">
                  <span class="nl-cat">{{ n.category || '未分类' }}</span>
                  <span class="nl-date">{{ fmt(n.updated_at) }}</span>
                </div>
                <div class="nl-stem">{{ n.stem }}</div>
                <div class="nl-content">{{ n.content }}</div>
                <div class="nl-foot">
                  <button class="mini danger" @click="delNote(n)">删除笔记</button>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div v-if="toast" class="nl-toast">{{ toast }}</div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.nl-mask {
  position: fixed;
  inset: 0;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur));
  -webkit-backdrop-filter: blur(var(--modal-blur));
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.nl-mask.is-wide { align-items: center; }

.nl-panel {
  position: relative;
  width: 780px;
  max-width: 94vw;
  height: 84vh;
  display: flex;
  flex-direction: column;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow), var(--glow-soft);
  overflow: hidden;
  animation: nlPanelIn .26s cubic-bezier(.2, .7, .3, 1);
}
@keyframes nlPanelIn { from { opacity: 0; transform: translateY(18px) scale(.98); } to { opacity: 1; transform: none; } }
.nl-panel.is-wide { width: 780px; max-width: 94vw; height: 84vh; }

.nl-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.nl-header .title { flex: 1; font-size: 15px; font-weight: 600; color: var(--text); }
.nl-header .close { font-size: 18px; color: var(--muted); cursor: pointer; line-height: 1; padding: 4px 8px; border-radius: 6px; }
.nl-header .close:hover { color: var(--text); background: var(--hover-bg); }
.nl-header .count { font-size: 12px; color: var(--muted); }

.nl-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 18px; }

/* 筛选行 */
.nl-filter { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.nl-filter .input { flex: 1; min-width: 110px; }

.empty { text-align: center; color: var(--muted); font-size: 13px; padding: 40px 0; line-height: 2; }
.empty-icon { font-size: 30px; color: #ffc154; opacity: 0.6; }
.empty-sub { font-size: 12px; opacity: 0.75; }

.nl-list { display: flex; flex-direction: column; gap: 10px; }
.nl-item {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 11px 12px;
  background: rgba(255, 193, 84, 0.04);
}
.nl-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.nl-cat { font-size: 11px; color: var(--brand); border: 1px solid var(--line); border-radius: 4px; padding: 1px 6px; }
.nl-date { font-size: 11px; color: var(--muted); margin-left: auto; }
.nl-stem { font-size: 13px; color: var(--text); line-height: 1.6; margin-bottom: 6px; }
.nl-content {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 8px 10px;
  background: var(--input-solid-bg);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.nl-foot { display: flex; justify-content: flex-end; margin-top: 8px; }

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

.nl-toast {
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

/* 次级组件铺开（2026-08-12）：笔记行 hover 渐变底 */
.nl-item { transition: background .15s ease, border-color .15s ease; }
.nl-item:hover { background: linear-gradient(135deg, rgba(91, 124, 250, 0.06), rgba(122, 92, 255, 0.03)); }


/* 次级组件铺开（2026-08-12）：笔记行 hover 渐变底 */
.nl-item { transition: background .15s ease, border-color .15s ease; }
.nl-item:hover { background: linear-gradient(135deg, rgba(91, 124, 250, 0.06), rgba(122, 92, 255, 0.03)); }

</style>