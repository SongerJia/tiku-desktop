<script setup>
import { ref, computed, onMounted } from 'vue'
import EmptyState from './EmptyState.vue'
import { tiku } from '../api/tiku.js'
import { printHtml } from '../utils/print.js'
import { showToast } from '../utils/toast.js'

const emit = defineEmits(['start'])
const items = ref([])
const similarMap = ref({})   // question_id -> 相似题列表
const expanded = ref(new Set())

// 错题自动分组（方向 5）：全部 / 今日到期 / 本周到期 / 常错 Top
const wrongGroup = ref('all')
const groupCounts = computed(() => {
  const now = Date.now()
  const week = now + 7 * 86400000
  let today = 0, weekN = 0, stubborn = 0
  items.value.forEach(it => {
    if (it.next_review_at && it.next_review_at <= now) today++
    if (it.next_review_at && it.next_review_at <= week) weekN++
    if (it.wrong_count >= 3) stubborn++
  })
  return { all: items.value.length, today, week: weekN, stubborn }
})
const filteredItems = computed(() => {
  const now = Date.now()
  const week = now + 7 * 86400000
  const kw = filterKw.value.trim().toLowerCase()
  const sid = Number(filterSubject.value)
  const cid = Number(filterCategory.value)
  return items.value.filter(it => {
    // 分组条件（组合式，不能提前 return，否则跳过科目/章节/搜索筛选）
    if (wrongGroup.value === 'today' && !(it.next_review_at && it.next_review_at <= now)) return false
    if (wrongGroup.value === 'week' && !(it.next_review_at && it.next_review_at <= week)) return false
    if (wrongGroup.value === 'stubborn' && !(it.wrong_count >= 3)) return false
    if (sid && Number(it.subject_id) !== sid) return false
    if (cid && Number(it.category_id) !== cid) return false
    if (kw && !String(it.stem || '').toLowerCase().includes(kw)) return false
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
async function loadSubjects() {
  try { subjects.value = await tiku.getCategories() } catch (e) { subjects.value = [] }
}

onMounted(async () => {
  items.value = await tiku.getWrongBook()
  await loadSubjects()
  await loadReviewCurve()
})

// 复习节奏（记忆曲线）：未来 30 天到期分布 + 逐题下次复习日
const reviewCurve = ref({ dist: [], items: [] })
const curveMax = computed(() => Math.max(1, ...(reviewCurve.value.dist || []).map(d => d.count)))
const curveBars = computed(() => (reviewCurve.value.dist || []).map(d => ({ ...d, h: d.count ? Math.max(3, Math.round(d.count / curveMax.value * 40)) : 0 })))
const dueTotal = computed(() => (reviewCurve.value.dist || []).reduce((s, d) => s + d.count, 0))
const stemByQid = computed(() => { const m = {}; items.value.forEach(i => { if (i.question_id != null) m[i.question_id] = i.stem }); return m })
const curveTop = computed(() => (reviewCurve.value.items || []).slice(0, 8).map(it => ({ ...it, stem: stemByQid.value[it.questionId] || '（题目已删除）' })))
async function loadReviewCurve() {
  try { reviewCurve.value = await tiku.getReviewCurve(30) } catch (e) { reviewCurve.value = { dist: [], items: [] } }
}

// 一键生成记忆卡（方向 10）
const cardBusy = ref(new Set())
async function genCard(it) {
  if (cardBusy.value.has(it.question_id)) return
  cardBusy.value = new Set(cardBusy.value).add(it.question_id)
  try {
    const r = await tiku.addCardFromQuestion(it.question_id)
    if (r.ok) showToast(r.duplicate ? '该题已有记忆卡（未重复生成）' : '已生成记忆卡，可在「卡片记忆」复习', 'ok')
    else showToast('生成失败：' + (r.error || '未知错误'), 'err')
  } catch (e) { showToast('生成失败：' + (e.message || '未知错误'), 'err') }
  cardBusy.value = new Set(cardBusy.value); cardBusy.value.delete(it.question_id)
}

const typeLabel = (t) => ({ single: '单选', multiple: '多选', judge: '判断', essay: '问答' }[t] || t)
const answerText = (q) => (q.answer && q.answer.length) ? q.answer.join('、') : '（主观题）'
const REASONS = ['粗心', '知识点不懂', '时间不够', '审题不清', '其他']

// 记忆状态徽标（E-1）：按 SM-2 interval/status 分级——记忆可解释
function memBadge(it) {
  if (it.status === 'mastered') return { cls: 'ok', text: '已掌握' }
  const iv = it.interval || 0
  if (iv >= 7) return { cls: 'ok', text: `稳定 · 间隔 ${iv} 天` }
  if (iv >= 1) return { cls: 'mid', text: `巩固中 · 间隔 ${iv} 天` }
  return { cls: 'bad', text: '脆弱 · 明天重点看' }
}

async function setReason(it, reason) {
  it.reason = reason
  await tiku.setWrongReason(it.question_id, reason)
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 导出错题本 PDF（打印）：含题干/选项/答案/解析，便于纸质复盘
async function exportWrongPdf() {
  if (!items.value.length) return
  const imgCache = {}
  for (const it of items.value) {
    if (it.images && it.images.length) {
      const urls = await Promise.all(it.images.map(n => tiku.getImage(n)))
      imgCache[it.question_id] = urls.filter(Boolean)
    }
  }
  let body = `<h1>错题本</h1><p class="doc-sub">共 ${items.value.length} 道活跃错题</p>`
  body += `<div class="section-title">错题与解析</div>`
  items.value.forEach((it, i) => {
    body += `<div class="q"><span class="q-no">${i + 1}.</span> <span class="q-stem">${escapeHtml(it.stem)}</span>`
    if (imgCache[it.question_id] && imgCache[it.question_id].length) body += imgCache[it.question_id].map(u => `<img class="q-img" src="${u}"/>`).join('')
    if (it.options && it.options.length) body += '<ul class="opts">' + it.options.map(o => `<li>${escapeHtml(o.key)}. ${escapeHtml(o.text)}</li>`).join('') + '</ul>'
    body += `<div class="ans-key">答错 ${it.wrong_count} 次 · 已复习 ${it.reviewed_count} 次</div>`
    body += `<div class="analysis">答案：${escapeHtml((it.answer || []).join('、'))}${it.analysis ? ' ｜ 解析：' + escapeHtml(it.analysis) : ''}</div>`
    body += `</div>`
  })
  printHtml('错题本', body)
}

async function toggleSimilar(qid) {
  const s = new Set(expanded.value)
  if (s.has(qid)) { s.delete(qid); expanded.value = s; return }
  if (!similarMap.value[qid]) {
    try { similarMap.value = { ...similarMap.value, [qid]: await tiku.getSimilarQuestions(qid, 3) } }
    catch (e) { similarMap.value = { ...similarMap.value, [qid]: [] } }
  }
  s.add(qid); expanded.value = s
}
</script>

<template>
  <div>
    <div class="wb-head">
      <h2>错题本（{{ items.length }}）</h2>
      <button v-if="items.length" class="ghost" @click="exportWrongPdf">导出错题PDF</button>
    </div>

    <!-- 筛选：科目 → 章节（联动）→ 题干模糊搜索 -->
    <div v-if="items.length" class="wb-filter">
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

    <!-- 错题分组（今日/本周/常错） -->
    <div v-if="items.length" class="wb-groups">
      <button class="wb-group" :class="{ on: wrongGroup === 'all' }" @click="wrongGroup = 'all'">全部 <em>{{ groupCounts.all }}</em></button>
      <button class="wb-group" :class="{ on: wrongGroup === 'today' }" @click="wrongGroup = 'today'">今日到期 <em>{{ groupCounts.today }}</em></button>
      <button class="wb-group" :class="{ on: wrongGroup === 'week' }" @click="wrongGroup = 'week'">本周到期 <em>{{ groupCounts.week }}</em></button>
      <button class="wb-group" :class="{ on: wrongGroup === 'stubborn' }" @click="wrongGroup = 'stubborn'">常错 Top <em>{{ groupCounts.stubborn }}</em></button>
    </div>

    <!-- 复习节奏（记忆曲线） -->
    <div v-if="dueTotal" class="curve-card">
      <div class="curve-title">复习节奏 · 未来 30 天到期 {{ dueTotal }} 题</div>
      <div class="curve-bars">
        <div v-for="(b, i) in curveBars" :key="i" class="curve-bar-wrap" :title="b.date + ' 到期 ' + b.count + ' 题'">
          <div class="curve-bar" :class="{ today: i === curveBars.length - 1 }" :style="{ height: b.h + 'px' }"></div>
        </div>
      </div>
      <div v-if="curveTop.length" class="curve-list">
        <div v-for="(it, i) in curveTop" :key="i" class="curve-item">
          <span class="cv-stem">{{ it.stem }}</span>
          <span class="cv-meta">{{ it.next }} · 间隔 {{ it.interval }} 天 · E{{ it.ease }}</span>
        </div>
      </div>
    </div>

    <EmptyState v-if="!items.length" icon="check" text="暂无活跃错题" sub="继续保持！答错的题会自动进错题本并按遗忘曲线排期" />
    <EmptyState v-else-if="!filteredItems.length" icon="folder" text="该分组下暂无错题" />
    <div v-for="it in filteredItems" :key="it.question_id" class="card">
      <div class="stem">{{ it.stem }}</div>
      <div class="meta">
        <span class="mem-badge" :class="memBadge(it).cls">{{ memBadge(it).text }}</span>
        答错 {{ it.wrong_count }} 次 · 已复习 {{ it.reviewed_count }} 次 <span v-if="it.wrong_count >= 3" class="stubborn">顽固 · 复习优先</span>
      </div>
      <div class="reason-row">
        <span class="reason-label">错因</span>
        <select class="reason-select" :value="it.reason || ''" @change="setReason(it, $event.target.value)">
          <option value="">未标记</option>
          <option v-for="r in REASONS" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>
      <div class="actions">
        <button class="primary" @click="emit('start', { mode: 'wrong' })">复习这批错题</button>
        <button class="ghost" @click="genCard(it)">生成记忆卡</button>
        <button class="ghost" @click="toggleSimilar(it.question_id)">
          {{ expanded.has(it.question_id) ? '收起相似题' : '相似题推荐' }}
        </button>
      </div>

      <div v-if="expanded.has(it.question_id)" class="similar">
        <div v-if="!similarMap[it.question_id] || !similarMap[it.question_id].length" class="sim-empty">
          该题所属章节暂无其他题目
        </div>
        <div v-for="s in similarMap[it.question_id]" :key="s.id" class="sim-item">
          <div class="sim-stem">· {{ s.stem }}</div>
          <div class="sim-ans">答案：{{ answerText(s) }}（{{ typeLabel(s.type) }}）</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.curve-card { margin-bottom: 12px; border: 1px solid var(--line); border-radius: 12px; padding: 12px; background: var(--card); }
.curve-title { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 10px; }
.curve-bars { display: flex; align-items: flex-end; gap: 2px; height: 44px; overflow-x: auto; padding-bottom: 2px; }
.curve-bar-wrap { flex: 0 0 5px; display: flex; align-items: flex-end; height: 100%; }
.curve-bar { width: 4px; border-radius: 2px 2px 0 0; background: color-mix(in srgb, var(--brand) 45%, transparent); min-height: 2px; }
.curve-bar.today { background: var(--brand); }
.curve-list { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.curve-item { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 0; }
.cv-stem { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.cv-meta { flex: 0 0 auto; color: var(--muted); font-size: 11px; }
.wb-groups { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.wb-filter { display: flex; gap: 8px; margin: 10px 0 12px; flex-wrap: wrap; }
.wb-filter .input { flex: 1; min-width: 110px; }
.wb-group { font-size: 12px; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; transition: all .15s; display: inline-flex; align-items: center; gap: 5px; }
.wb-group em { font-style: normal; font-size: 11px; opacity: .8; }
.wb-group.on { background: rgba(255, 77, 109, 0.12); color: var(--bad); border-color: rgba(255, 77, 109, 0.4); font-weight: 600; }
.wb-group.on em { opacity: 1; }

.empty { color: var(--muted); }
.wb-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.wb-head h2 { margin: 0; }
.stem { font-weight: 500; margin-bottom: 6px; }
.meta { color: var(--muted); font-size: 12px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.stubborn { color: var(--bad); border: 1px solid rgba(229, 83, 95, 0.4); background: rgba(229, 83, 95, 0.08); border-radius: 6px; padding: 0 6px; margin-left: 6px; font-size: 11px; }
/* 记忆状态徽标（E-1） */
.mem-badge { font-size: 10.5px; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.mem-badge.ok { background: rgba(47, 191, 143, 0.12); border: 1px solid rgba(47, 191, 143, 0.45); color: var(--ok-soft); }
.mem-badge.mid { background: color-mix(in srgb, var(--brand) 15%, transparent); border: 1px solid color-mix(in srgb, var(--brand) 50%, transparent); color: var(--brand-soft); }
.mem-badge.bad { background: rgba(229, 83, 95, 0.15); border: 1px solid rgba(229, 83, 95, 0.5); color: var(--bad-soft); }
.actions { display: flex; gap: 8px; }
button { border: none; padding: 7px 14px; border-radius: 8px; font-size: 13px; cursor: pointer; }
.primary { background: var(--brand); color: #fff; }
.ghost { background: rgba(255, 255, 255, 0.05); border: 1px solid var(--line); color: var(--text); }
.ghost:hover { border-color: var(--brand); color: var(--brand); }

.similar { margin-top: 10px; border-top: 1px dashed var(--line); padding-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.sim-empty { font-size: 12px; color: var(--muted); }
.reason-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
.reason-label { font-size: 12px; color: var(--muted); }
.reason-select {
  background: var(--input-solid-bg);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  outline: none;
}
.reason-select:focus { border-color: var(--brand); }
.sim-item { border-left: 2px solid var(--brand); padding-left: 8px; }
.sim-stem { font-size: 12px; color: var(--text); line-height: 1.5; }
.sim-ans { font-size: 11px; color: var(--ok); margin-top: 2px; }

/* 次级组件铺开（2026-08-12）：列表卡 hover 渐变底 */
.card:hover { background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 6%, transparent), color-mix(in srgb, var(--brand2) 3%, transparent)); }

</style>