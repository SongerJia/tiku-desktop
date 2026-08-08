<script setup>
import { ref, onMounted, watch } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import { tiku } from '../api/tiku.js'

const props = defineProps({ subject: Object })
const emit = defineEmits(['start'])

const keyword = ref('')
const chapters = ref([])
const currentChapterId = ref(null)
const questions = ref([])
const loading = ref(true)
const PAGE = 50
const visibleCount = ref(PAGE)

onMounted(load)
watch(() => props.subject.id, load)
watch(currentChapterId, fetchQuestions)

async function load() {
  loading.value = true
  const tree = await tiku.getCategories()
  // 取当前科目下的二级分类作为章节
  const subjectNode = tree.find(n => n.id === props.subject.id)
  chapters.value = subjectNode ? subjectNode.children : (tree[0]?.children || [])
  currentChapterId.value = null
  await fetchQuestions()
  loading.value = false
}

async function fetchQuestions() {
  loading.value = true
  visibleCount.value = PAGE
  questions.value = await tiku.getQuestions({
    categoryId: currentChapterId.value,
    keyword: keyword.value.trim() || undefined
  })
  loading.value = false
}

function search() {
  fetchQuestions()
}

function typeLabel(t) {
  return { single: '单选', multiple: '多选', judge: '判断' }[t] || t
}
</script>

<template>
  <div class="knowledge">
    <div class="card search-card">
      <div class="search-row">
        <input
          v-model="keyword"
          class="input"
          placeholder="搜索关键词"
          @keyup.enter="search"
        />
        <button class="btn btn-primary" @click="search">搜索</button>
      </div>
      <div class="chapter-filter">
        <button
          class="filter-chip"
          :class="{ active: !currentChapterId }"
          @click="currentChapterId = null"
        >全部</button>
        <button
          v-for="ch in chapters"
          :key="ch.id"
          class="filter-chip"
          :class="{ active: currentChapterId === ch.id }"
          @click="currentChapterId = ch.id"
        >{{ ch.name }}</button>
      </div>
    </div>

    <SkeletonCards v-if="loading" :count="4" />
    <div v-else-if="!questions.length" class="empty card">暂无知识点</div>
    <div v-else class="question-list">
      <div
        v-for="q in questions.slice(0, visibleCount)"
        :key="q.id"
        class="card q-card"
        @click="$emit('start', { categoryId: q.category_id, mode: 'practice' })"
      >
        <div class="q-meta">
          <span class="badge">{{ typeLabel(q.type) }}</span>
          <span class="q-stem">{{ q.stem }}</span>
        </div>
        <div class="q-arrow">›</div>
      </div>
      <button v-if="questions.length > visibleCount" class="load-more" @click="visibleCount += PAGE">
        加载更多（{{ questions.length - visibleCount }} 道）
      </button>
    </div>
  </div>
</template>

<style scoped>
.search-card { padding: 14px; }
.search-row {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.search-row .input { flex: 1; }
.search-row .btn { border-radius: var(--radius-sm); }

.chapter-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.filter-chip {
  padding: 5px 12px;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
  transition: all .2s;
}
.filter-chip:hover { border-color: var(--brand); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18); }
.filter-chip.active {
  background: var(--brand);
  color: #ffffff;
  border-color: var(--brand);
  font-weight: 600;
  box-shadow: 0 2px 10px rgba(91, 124, 250, 0.32);
}

.question-list { display: flex; flex-direction: column; gap: 10px; }
.load-more {
  padding: 10px;
  border: 1px dashed var(--line);
  border-radius: 10px;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  transition: all .15s;
}
.load-more:hover { border-color: var(--brand); color: var(--brand); background: var(--brand-light); }
.q-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px;
  margin-bottom: 0;
  cursor: pointer;
  transition: transform .1s, border-color .2s, box-shadow .2s;
}
.q-card:hover { border-color: var(--brand); box-shadow: var(--glow-soft); }
.q-card:active { transform: scale(0.99); }
.q-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.q-meta .badge { white-space: nowrap; flex-shrink: 0; }
.q-stem {
  font-size: 14px;
  color: var(--text);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-width: 0;
}
.q-arrow { font-size: 20px; color: var(--brand); margin-left: 8px; text-shadow: var(--glow-soft); }
</style>
