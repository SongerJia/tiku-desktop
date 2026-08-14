<script setup>
import { ref, computed, onMounted } from 'vue'
import EmptyState from './EmptyState.vue'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'

const emit = defineEmits(['start'])
const items = ref([])
const groupFilter = ref('all')

// 收藏分组（方向 9）：全部 + 去重分组名
const groups = computed(() => {
  const s = new Set()
  items.value.forEach(i => { if (i.fav_group) s.add(i.fav_group) })
  return Array.from(s)
})
const filtered = computed(() => {
  const kw = filterKw.value.trim().toLowerCase()
  const sid = Number(filterSubject.value)
  const cid = Number(filterCategory.value)
  return items.value.filter(i => {
    // 收藏分组（组合式，不提前 return，保证与科目/章节/搜索叠加）
    if (groupFilter.value === '' && !!i.fav_group) return false
    if (groupFilter.value !== 'all' && groupFilter.value !== '' && i.fav_group !== groupFilter.value) return false
    // 科目/章节/题干搜索
    if (sid && Number(i.subject_id) !== sid) return false
    if (cid && Number(i.category_id) !== cid) return false
    if (kw && !String(i.stem || '').toLowerCase().includes(kw)) return false
    return true
  })
})

// 筛选：科目 → 章节（联动）→ 题干模糊搜索
const filterSubject = ref('')
const filterCategory = ref('')
const filterKw = ref('')
const subjects = ref([])
const filterChapters = computed(() => {
  const s = subjects.value.find(x => String(x.id) === String(filterSubject.value))
  return (s && s.children) || []
})

onMounted(async () => {
  items.value = await tiku.getFavorites()
  try { subjects.value = await tiku.getCategories() } catch (e) { subjects.value = [] }
})

async function remove(id) {
  await tiku.toggleFavorite(id)
  items.value = items.value.filter(i => i.question_id !== id)
}

async function setGroup(it, val) {
  let g = val
  if (val === '__new') {
    const name = window.prompt('新建分组名称：')
    if (!name || !name.trim()) return
    g = name.trim()
  }
  await tiku.setFavoriteGroup(it.question_id, g)
  it.fav_group = g
  if (groupFilter.value !== 'all' && groupFilter.value !== '' && groupFilter.value !== g) {
    items.value = items.value.filter(i => i.question_id !== it.question_id)
  }
  showToast(g ? `已加入「${g}」` : '已移回未分组', 'ok')
}
</script>

<template>
  <div>
    <h2>收藏（{{ items.length }}）</h2>

    <!-- 筛选：科目 → 章节（联动）→ 题干模糊搜索 -->
    <div v-if="items.length" class="fav-filter">
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

    <div v-if="groups.length || items.some(i => !i.fav_group)" class="fav-groups">
      <button class="fav-group" :class="{ on: groupFilter === 'all' }" @click="groupFilter = 'all'">全部 <em>{{ items.length }}</em></button>
      <button class="fav-group" :class="{ on: groupFilter === '' }" @click="groupFilter = ''">未分组 <em>{{ items.filter(i => !i.fav_group).length }}</em></button>
      <button v-for="g in groups" :key="g" class="fav-group" :class="{ on: groupFilter === g }" @click="groupFilter = g">{{ g }} <em>{{ items.filter(i => i.fav_group === g).length }}</em></button>
    </div>

    <EmptyState v-if="!items.length" icon="star" text="还没有收藏题目" sub="答题时点「收藏」或按 F，重点题目会出现在这里" />
    <EmptyState v-else-if="!filtered.length" icon="star" text="该分组下暂无收藏" />
    <div v-for="it in filtered" :key="it.question_id" class="card">
      <div class="stem">{{ it.stem }}</div>
      <div class="group-row">
        <select class="group-select" :value="it.fav_group || ''" @change="setGroup(it, $event.target.value)">
          <option value="">未分组</option>
          <option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
          <option value="__new">＋ 新建分组…</option>
        </select>
      </div>
      <div class="btns">
        <button class="review" @click="emit('start', { mode: 'favorite' })">复习</button>
        <button class="del" @click="remove(it.question_id)">取消收藏</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.empty { color: var(--muted); font-size: 13px; }
.stem { font-weight: 500; margin-bottom: 8px; font-size: 14px; }
.btns { display: flex; gap: 8px; margin-top: 8px; }
.review { background: var(--brand); color: #fff; border: none; padding: 7px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; }
.del { background: transparent; color: var(--bad); border: 1px solid var(--bad); padding: 7px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; }
.fav-groups { display: flex; gap: 8px; margin: 10px 0 14px; flex-wrap: wrap; }
.fav-filter { display: flex; gap: 8px; margin: 10px 0 8px; flex-wrap: wrap; }
.fav-filter .input { flex: 1; min-width: 110px; }
.fav-group { font-size: 12px; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; transition: all .15s; display: inline-flex; align-items: center; gap: 4px; }
.fav-group em { font-style: normal; font-size: 11px; opacity: .8; }
.fav-group.on { background: color-mix(in srgb, var(--brand) 12%, transparent); color: var(--brand); border-color: color-mix(in srgb, var(--brand) 40%, transparent); font-weight: 600; }
.group-row { margin-top: 6px; }
.group-select { font-size: 12px; color: var(--muted); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 3px 8px; }

/* 次级组件铺开（2026-08-12）：列表卡 hover 渐变底 */
.card:hover { background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 6%, transparent), color-mix(in srgb, var(--brand2) 3%, transparent)); }

</style>