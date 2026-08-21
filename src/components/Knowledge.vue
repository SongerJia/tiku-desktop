<script setup>
import { ref, onMounted, watch, onBeforeUnmount } from 'vue'
import SkeletonCards from './SkeletonCards.vue'
import QuestionDetail from './QuestionDetail.vue'
import { tiku } from '../api/tiku.js'

const props = defineProps({ subject: Object, subjectConfig: { default: () => ({}) }, refreshToken: { type: Number, default: 0 }, currentChapterId: { type: [Number, String], default: null } })
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
const yearFilter = ref('') // 年份筛选（年份维度启用时）
const diffFilter = ref('') // 难度筛选（难度维度启用时）
const tagFilter = ref('') // 标签筛选（标签维度启用时）

const hasDim = (key) => props.subjectConfig.dims && props.subjectConfig.dims.includes(key)
const yearOptions = Array.from({ length: 10 }, (_, i) => String(2026 - i))
const chapterMastery = ref({}) // { chapterId: { answered, correct, pct } }
function masteryClass(pct) {
  if (pct >= 80) return 'mastery-high'
  if (pct >= 50) return 'mastery-mid'
  return 'mastery-low'
}

let alive = true // 卸载后作废在途请求结果（须在 watch/onMounted 之前声明，避免 setup 同步触发时 TDZ）
let fetchSeq = 0 // 代际计数：快速切章节/搜索/加载更多并发时旧请求作废，防慢响应覆盖
onMounted(load)
watch(() => props.subject.id, load) // 切科目：重载章节列表 + 题目
watch(() => props.refreshToken, () => { if (props.refreshToken) load() }) // 题库管理弹窗变更 → 刷新（导入/增删改）
watch(() => props.currentChapterId, (v) => { currentChapterId.value = v ?? null }) // 顶部选择章节 → 同步本页章节筛选
watch(currentChapterId, fetchQuestions) // 切章节：拉该章题目

async function load() {
  loading.value = true
  const tree = await tiku.getCategories()
  // 取当前科目下的二级分类作为章节
  const subjectNode = tree.find(n => n.id === props.subject.id)
  chapters.value = subjectNode ? subjectNode.children : (tree[0]?.children || [])
  showAllCh.value = false // 切科目重置章节展开态
  // 顶部若选了章节则跟随（同步到本页章节筛选），否则清空；值未变时手动补拉一次
  const target = props.currentChapterId ?? null
  const was = currentChapterId.value
  currentChapterId.value = target
  if (was === target) await fetchQuestions()
  loading.value = false
  // 加载章节掌握度
  fetchMastery()
}

async function fetchMastery() {
  const sid = props.subject.id
  if (!sid) return
  try {
    const m = await tiku.getChapterMastery(sid)
    if (m) chapterMastery.value = m
  } catch (e) {
    // 后端不支持则静默降级
  }
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
      year: yearFilter.value || undefined,
      difficulty: diffFilter.value || undefined,
      tags: tagFilter.value || undefined,
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
      year: yearFilter.value || undefined,
      difficulty: diffFilter.value || undefined,
      tags: tagFilter.value || undefined,
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
  return { single: '单选', multiple: '多选', judge: '判断', essay: '问答' }[t] || t
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
        <button class="btn manage-btn" @click="$emit('manage', currentChapterId)" title="增删改查 / 批量导入导出题目">管理题库</button>
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
        >
          <span class="ch-name">{{ ch.name }}</span>
          <span v-if="chapterMastery[ch.id]" class="ch-mastery" :class="masteryClass(chapterMastery[ch.id].pct)">
            {{ chapterMastery[ch.id].pct }}%
          </span>
          <span v-if="chapterMastery[ch.id]" class="ch-bar">
            <span class="ch-bar-fill" :style="{ width: chapterMastery[ch.id].pct + '%' }"></span>
          </span>
        </button>
        <button v-if="chapters.length > 6" class="filter-chip more-chip" @click="showAllCh = !showAllCh">
          {{ showAllCh ? '收起 ▴' : `更多 (${chapters.length - 6}) ▾` }}
        </button>
      </div>

      <!-- 动态筛选维度（根据科目配置） -->
      <div v-if="hasDim('year') || hasDim('difficulty') || hasDim('tag')" class="dim-filter">
        <select v-if="hasDim('year')" v-model="yearFilter" class="dim-select" @change="fetchQuestions">
          <option value="">全部年份</option>
          <option v-for="y in yearOptions" :key="y" :value="y">{{ y }}</option>
        </select>
        <select v-if="hasDim('difficulty')" v-model="diffFilter" class="dim-select" @change="fetchQuestions">
          <option value="">全部难度</option>
          <option value="1">★ 简单</option>
          <option value="2">★★ 中等</option>
          <option value="3">★★★ 困难</option>
          <option value="4">★★★★ 较难</option>
          <option value="5">★★★★★ 极难</option>
        </select>
        <input v-if="hasDim('tag')" v-model="tagFilter" class="dim-input" placeholder="标签筛选" @keyup.enter="fetchQuestions" />
      </div>
    </div>

    <SkeletonCards v-if="loading" :count="4" />
    <div v-else-if="!questions.length" class="empty card">暂无知识点</div>
    <div v-else class="question-list">
      <div v-for="q in questions" :key="q.id" class="card q-card" @click="openDetail(q)">
        <div class="q-meta">
          <span class="badge" :class="'badge-' + q.type">{{ typeLabel(q.type) }}</span>
          <span class="q-stem">{{ q.stem }}</span>
        </div>
        <div class="q-info">
          <span v-if="q.year" class="qi-year">{{ q.year }}</span>
          <span v-if="q.difficulty" class="qi-diff">{{ '★'.repeat(Number(q.difficulty)) }}</span>
          <span v-if="q.tags && q.tags.length" class="qi-tag">{{ q.tags[0] }}{{ q.tags.length > 1 ? ' +' + (q.tags.length - 1) : '' }}</span>
          <span class="qi-arrow">›</span>
        </div>
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
.search-card { padding: 16px; }
.search-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}
.search-row .input { flex: 1; }
/* 与工具条按钮一致：全局胶囊圆角（24px），不用小圆角 */
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
.ch-name { white-space: nowrap; }
.ch-mastery { font-size: 10px; font-weight: 700; margin-left: 4px; flex-shrink: 0; }
.ch-mastery.mastery-high { color: var(--ok); }
.ch-mastery.mastery-mid { color: var(--warn); }
.ch-mastery.mastery-low { color: var(--bad); }
.ch-bar { display: inline-flex; width: 40px; height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; margin-left: 4px; vertical-align: middle; }
.ch-bar-fill { height: 100%; border-radius: 2px; transition: width .4s ease; background: var(--brand); }
.filter-chip.active .ch-bar { background: rgba(255,255,255,0.3); }
.filter-chip.active .ch-bar-fill { background: #fff; }
.more-chip {
  border-style: dashed;
  border-color: rgba(255, 184, 77, 0.5);
  color: var(--warn);
  background: rgba(255, 184, 77, 0.06);
  font-weight: 600;
}
.more-chip:hover { border-color: var(--warn); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18); }

.dim-filter { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.dim-select {
  border: 1px solid var(--line); border-radius: 16px; padding: 5px 12px;
  background: var(--bg-faint); color: var(--text); font-size: 12px;
  cursor: pointer; font-family: inherit; transition: border-color .2s;
  min-width: 90px;
}
.dim-select:hover, .dim-select:focus { border-color: var(--brand); outline: none; }
.dim-input {
  border: 1px solid var(--line); border-radius: 16px; padding: 5px 12px;
  background: var(--bg-faint); color: var(--text); font-size: 12px;
  font-family: inherit; width: 100px; transition: border-color .2s;
}
.dim-input:focus { border-color: var(--brand); outline: none; }

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
  flex-direction: column;
  padding: 14px 16px;
  margin-bottom: 0;
  cursor: pointer;
  transition: all .2s;
  border-radius: 12px;
}
.q-card:hover { border-color: var(--brand); box-shadow: 0 4px 16px color-mix(in srgb, var(--brand) 10%, transparent); }
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
.badge-single { background: color-mix(in srgb, var(--brand) 14%, transparent); color: var(--brand); }
.badge-multiple { background: color-mix(in srgb, #a78bfa 14%, transparent); color: #a78bfa; }
.badge-judge { background: color-mix(in srgb, var(--ok) 14%, transparent); color: var(--ok); }
.badge-essay { background: color-mix(in srgb, var(--warn) 14%, transparent); color: var(--warn); }
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
.q-info { display: flex; align-items: center; gap: 6px; margin-left: 12px; flex-shrink: 0; }
.qi-year { font-size: 11px; color: var(--muted); background: var(--bg-faint); padding: 1px 6px; border-radius: 4px; }
.qi-diff { font-size: 11px; color: var(--warn); }
.qi-tag { font-size: 10px; color: var(--brand); background: color-mix(in srgb, var(--brand) 10%, transparent); padding: 1px 6px; border-radius: 4px; }
.qi-arrow { font-size: 20px; color: var(--brand); margin-left: 4px; text-shadow: var(--glow-soft); }
.q-arrow { font-size: 20px; color: var(--brand); margin-left: 8px; text-shadow: var(--glow-soft); }

/* 铺开（2026-08-12）：题目卡渐变边框 + hover 流光 */
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

/* 加浓（2026-08-12）：stagger 交错入场 */
.knowledge > * { animation: riseIn .4s cubic-bezier(.2, .7, .3, 1) both; }
.knowledge > *:nth-child(2) { animation-delay: .06s; }
.knowledge > *:nth-child(3) { animation-delay: .12s; }
.knowledge > *:nth-child(4) { animation-delay: .18s; }

</style>