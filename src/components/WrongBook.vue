<script setup>
import { ref, computed, onMounted } from 'vue'
import { tiku } from '../api/tiku.js'
import { printHtml } from '../utils/print.js'

const emit = defineEmits(['start'])
const items = ref([])
const weakChapters = ref([])
const similarMap = ref({})   // question_id -> 相似题列表
const expanded = ref(new Set())

onMounted(async () => {
  items.value = await tiku.getWrongBook()
  try { weakChapters.value = await tiku.getWeakChapters(null, 5) } catch (e) { weakChapters.value = [] }
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

const typeLabel = (t) => ({ single: '单选', multiple: '多选', judge: '判断', essay: '问答' }[t] || t)
const answerText = (q) => (q.answer && q.answer.length) ? q.answer.join('、') : '（主观题）'
const REASONS = ['粗心', '知识点不懂', '时间不够', '审题不清', '其他']

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
    <!-- 薄弱章节识别：正确率升序，最弱的高亮 -->
    <div v-if="weakChapters.length" class="weak-chapters">
      <div class="wc-title">⚠️ 薄弱章节（正确率最低）</div>
      <div class="wc-list">
        <div
          v-for="c in weakChapters"
          :key="c.id"
          class="wc-item"
          :class="{ danger: c.rate < 50, warn: c.rate >= 50 && c.rate < 75 }"
        >
          <span class="wc-name">{{ c.name }}</span>
          <span class="wc-rate">{{ c.rate }}%</span>
          <span class="wc-wrong">错 {{ c.wrong }}</span>
        </div>
      </div>
    </div>

    <div class="wb-head">
      <h2>错题本（{{ items.length }}）</h2>
      <button v-if="items.length" class="ghost" @click="exportWrongPdf">导出错题PDF</button>
    </div>

    <!-- 复习节奏（记忆曲线） -->
    <div v-if="dueTotal" class="curve-card">
      <div class="curve-title">📈 复习节奏 · 未来 30 天到期 {{ dueTotal }} 题</div>
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

    <p v-if="!items.length" class="empty">暂无活跃错题，继续保持！</p>
    <div v-for="it in items" :key="it.question_id" class="card">
      <div class="stem">{{ it.stem }}</div>
      <div class="meta">答错 {{ it.wrong_count }} 次 · 已复习 {{ it.reviewed_count }} 次 <span v-if="it.wrong_count >= 3" class="stubborn">顽固 · 每日回顾优先</span></div>
      <div class="reason-row">
        <span class="reason-label">错因</span>
        <select class="reason-select" :value="it.reason || ''" @change="setReason(it, $event.target.value)">
          <option value="">未标记</option>
          <option v-for="r in REASONS" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>
      <div class="actions">
        <button class="primary" @click="emit('start', { mode: 'wrong' })">复习这批错题</button>
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
.curve-bar { width: 4px; border-radius: 2px 2px 0 0; background: rgba(91, 124, 250, 0.45); min-height: 2px; }
.curve-bar.today { background: var(--brand); }
.curve-list { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.curve-item { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 0; }
.cv-stem { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.cv-meta { flex: 0 0 auto; color: var(--muted); font-size: 11px; }
.weak-chapters { margin-bottom: 12px; border: 1px solid rgba(255, 77, 109, 0.3); border-radius: 10px; padding: 10px 12px; background: rgba(255, 77, 109, 0.06); }
.wc-title { font-size: 12px; color: var(--bad); margin-bottom: 8px; font-weight: 600; }
.wc-list { display: flex; flex-direction: column; gap: 6px; }
.wc-item { display: flex; align-items: center; gap: 10px; font-size: 12px; padding: 6px 8px; border-radius: 8px; transition: background .15s; }
.wc-item:hover { background: rgba(148, 163, 184, 0.08); }
.wc-name { flex: 1; color: var(--text); }
.wc-rate { font-weight: 700; }
.wc-wrong { color: var(--muted); font-size: 11px; }
.wc-item.danger .wc-rate { color: var(--bad); }
.wc-item.warn .wc-rate { color: var(--warn); }
.wc-item.danger { background: rgba(255, 77, 109, 0.08); border-radius: 6px; padding: 4px 6px; }

.empty { color: var(--muted); }
.wb-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.wb-head h2 { margin: 0; }
.stem { font-weight: 500; margin-bottom: 6px; }
.meta { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
.stubborn { color: var(--bad); border: 1px solid rgba(229, 83, 95, 0.4); background: rgba(229, 83, 95, 0.08); border-radius: 6px; padding: 0 6px; margin-left: 6px; font-size: 11px; }
.actions { display: flex; gap: 8px; }
button { border: none; padding: 7px 14px; border-radius: 8px; font-size: 13px; cursor: pointer; }
.primary { background: var(--brand); color: #021018; }
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
</style>
