<script setup>
import { ref, onMounted, watch, onBeforeUnmount } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import QuestionDetail from './QuestionDetail.vue'
import { tiku } from '../api/tiku.js'

const props = defineProps({ subject: Object, refreshToken: { type: Number, default: 0 } })
const emit = defineEmits(['start', 'manage'])

const keyword = ref('')
const chapters = ref([])
const currentChapterId = ref(null)
const questions = ref([])
const total = ref(0) // 服务端总数（listQuestions 返回），驱动「加载更多」显示
const page = ref(1)
const loading = ref(true)
const loadingMore = ref(false)
const PAGE = 50
const showAllCh = ref(false) // 章节筛选：折叠「更多」展开态（方案②）
const detailId = ref(null) // 当前查看详情的题目 id

let alive = true // 卸载后作废在途请求结果（须在 watch/onMounted 之前声明，避免 setup 同步触发时 TDZ）
let fetchSeq = 0 // 代际计数：快速切章节/搜索/加载更多并发时旧请求作废，防慢响应覆盖
onMounted(load)
watch(() => props.subject.id, load) // 切科目：重载章节列表 + 题目
watch(() => props.refreshToken, () => { if (props.refreshToken) load() }) // 题库管理弹窗变更 → 刷新（导入/增删改）
watch(currentChapterId, fetchQuestions) // 切章节：拉该章题目

async function load() {
  loading.value = true
  const tree = await tiku.getCategories()
  // 取当前科目下的二级分类作为章节
  const subjectNode = tree.find(n => n.id === props.subject.id)
  chapters.value = subjectNode ? subjectNode.children : (tree[0]?.children || [])
  showAllCh.value = false // 切科目重置章节展开态
  const was = currentChapterId.value
  currentChapterId.value = null
  // 仅当值未变（不会触发 watch）时手动补拉一次；非 null→null 已由 watch 触发，避免并发双请求
  if (was === null) await fetchQuestions()
  loading.value = false
}

onBeforeUnmount(() => { alive = false })

async function fetchQuestions() {
  if (!alive) return
  const seq = ++fetchSeq // 代际计数：快速切章节/搜索时旧请求返回作废，防慢响应覆盖新结果
  loading.value = true
  page.value = 1
  try {
    // 服务端分页：万题级不全量拉取，IPC 只传当前页（listQuestions 返回 total 驱动「加载更多」）
    const res = await tiku.listQuestions({
      subjectId: props.subject.id || undefined,
      categoryId: currentChapterId.value || undefined,
      keyword: keyword.value.trim() || undefined,
      page: 1,
      pageSize: PAGE
    })
    if (alive && seq === fetchSeq) {
      questions.value = (res && res.items) || []
      total.value = (res && res.total) || 0
    }
  } finally {
    if (alive && seq === fetchSeq) loading.value = false
  }
}

// 加载更多：按服务端总数判断是否还有，翻页追加（避免前端 slice 大数组）
async function loadMore() {
  if (!alive || loading.value || loadingMore.value) return
  const seq = ++fetchSeq // 加载更多也占代际：fetchQuestions（切章节/搜索）进行中时作废本请求
  loadingMore.value = true
  const next = page.value + 1
  try {
    const res = await tiku.listQuestions({
      subjectId: props.subject.id || undefined,
      categoryId: currentChapterId.value || undefined,
      keyword: keyword.value.trim() || undefined,
      page: next,
      pageSize: PAGE
    })
    if (alive && seq === fetchSeq) {
      questions.value = questions.value.concat((res && res.items) || [])
      total.value = (res && res.total) || total.value
      page.value = next
    }
  } finally {
    if (alive && seq === fetchSeq) loadingMore.value = false
  }
}

function search() {
  fetchQuestions()
}

// 点题目卡 → 打开详情弹层（不再直接开刷，消除歧义）；详情里「开始练习」才进答题
function openDetail(q) {
  detailId.value = q.id
}
function onDetailStart(payload) {
  detailId.value = null
  emit('start', payload)
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
        <button class="btn manage-btn" @click="$emit('manage')" title="增删改查 / 批量导入导出题目">管理题库</button>
      </div>
      <div class="chapter-filter">
        <button
          class="filter-chip"
          :class="{ active: !currentChapterId }"
          @click="currentChapterId = null"
        >全部</button>
        <button
          v-for="ch in (showAllCh ? chapters : chapters.slice(0, 6))"
          :key="ch.id"
          class="filter-chip"
          :class="{ active: currentChapterId === ch.id }"
          @click="currentChapterId = ch.id"
        >{{ ch.name }}</button>
        <button v-if="chapters.length > 6" class="filter-chip more-chip" @click="showAllCh = !showAllCh">
          {{ showAllCh ? '收起 ▴' : `更多 (${chapters.length - 6}) ▾` }}
        </button>
      </div>
    </div>

    <SkeletonCards v-if="loading" :count="4" />
    <div v-else-if="!questions.length" class="empty card">暂无知识点</div>
    <div v-else class="question-list">
      <div
        v-for="q in questions"
        :key="q.id"
        class="card q-card"
        @click="openDetail(q)"
      >
        <div class="q-meta">
          <span class="badge">{{ typeLabel(q.type) }}</span>
          <span class="q-stem">{{ q.stem }}</span>
        </div>
        <div class="q-arrow">›</div>
      </div>
      <button v-if="questions.length < total" class="load-more" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? '加载中…' : `加载更多（${total - questions.length} 道）` }}
      </button>
    </div>

    <QuestionDetail
      :show="!!detailId"
      :question-id="detailId"
      @close="detailId = null"
      @start="onDetailStart"
    />
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
/* 与知识库工具条按钮一致：全局胶囊圆角（24px），不用小圆角 */
.manage-btn { flex-shrink: 0; }

.chapter-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.filter-chip {
  padding: 5px 12px;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: var(--bg-faint);
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
  transition: all .2s;
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif;
  line-height: 1.5;
}
.filter-chip:hover { border-color: var(--brand); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18); }
.filter-chip.active {
  background: var(--brand);
  color: #ffffff;
  border-color: var(--brand);
  font-weight: 600;
  box-shadow: 0 2px 10px color-mix(in srgb, var(--brand) 32%, transparent);
}
.more-chip {
  border-style: dashed;
  border-color: rgba(255, 184, 77, 0.5);
  color: var(--warn);
  background: rgba(255, 184, 77, 0.06);
  font-weight: 600;
}
.more-chip:hover { border-color: var(--warn); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18); }

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

/* 知识库铺开（2026-08-12）：题目卡渐变边框 + hover 流光 */
.q-card {
  border: 1px solid transparent;
  background-image:
    linear-gradient(var(--card), var(--card)),
    linear-gradient(135deg, color-mix(in srgb, var(--brand) 35%, transparent), color-mix(in srgb, var(--brand2) 35%, transparent));
  background-origin: border-box;
  background-clip: padding-box, border-box;
  position: relative;
}
.q-card:hover { box-shadow: var(--glow-soft); }

/* 知识库加浓（2026-08-12）：stagger 交错入场 */
.knowledge > * { animation: riseIn .4s cubic-bezier(.2, .7, .3, 1) both; }
.knowledge > *:nth-child(2) { animation-delay: .06s; }
.knowledge > *:nth-child(3) { animation-delay: .12s; }
.knowledge > *:nth-child(4) { animation-delay: .18s; }

</style>