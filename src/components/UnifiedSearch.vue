<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { tiku } from '../api/tiku.js'
import KbReader from './KbReader.vue'
import SimpleQuestion from './SimpleQuestion.vue'

const props = defineProps({ show: Boolean })
const emit = defineEmits(['close'])

const keyword = ref('')
const loading = ref(false)
const qDocs = ref([])      // 文档命中
const qQuestions = ref([]) // 题目命中
const searched = ref(false)
const reader = ref({ show: false, doc: null })
const sq = ref({ show: false, q: null })

let timer = null
let seq = 0

watch(() => props.show, v => {
  if (v) {
    keyword.value = ''
    qDocs.value = []
    qQuestions.value = []
    searched.value = false
    setTimeout(() => document.getElementById('us-input')?.focus(), 50)
  }
})

function onInput() {
  clearTimeout(timer)
  const kw = keyword.value.trim()
  if (!kw) { qDocs.value = []; qQuestions.value = []; searched.value = false; loading.value = false; return }
  timer = setTimeout(() => doSearch(kw), 300)
}

async function doSearch(kw) {
  const my = ++seq
  loading.value = true
  const [docs, questions] = await Promise.all([
    tiku.kbSearch(kw, 20),
    tiku.getQuestions({ keyword: kw, limit: 10 })
  ])
  if (my !== seq) return
  qDocs.value = docs
  qQuestions.value = questions
  searched.value = true
  loading.value = false
}

function openDoc(d) {
  reader.value = { show: true, doc: { id: d.id, type: d.type || 'md', title: d.title } }
}

function openQuestion(q) {
  sq.value = { show: true, q }
}

function typeLabel(t) {
  return { single: '单选', multiple: '多选', judge: '判断', essay: '问答' }[t] || t
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div v-if="show" class="us-mask" @click.self="emit('close')">
    <div class="us-box">
      <div class="us-head">
        <input
          id="us-input"
          v-model="keyword"
          class="input us-input"
          placeholder="统一搜索：题目 / 知识文档（中英文均可）"
          @input="onInput"
        />
        <button class="btn" @click="emit('close')">关闭</button>
      </div>
      <div v-if="loading" class="us-loading">搜索中…</div>
      <div v-else class="us-body">
        <template v-if="keyword.trim() && searched && !qDocs.length && !qQuestions.length">
          <div class="us-empty">没有命中「{{ keyword.trim() }}」的题目或文档</div>
        </template>

        <section v-if="qQuestions.length" class="us-sec">
          <h3 class="us-sec-title">题目命中（{{ qQuestions.length }}）</h3>
          <div class="us-rows">
            <div
              v-for="q in qQuestions"
              :key="q.id"
              class="us-row"
              @click="openQuestion(q)"
            >
              <span class="badge">{{ typeLabel(q.type) }}</span>
              <span class="us-row-text">{{ q.stem }}</span>
              <span class="us-arrow">›</span>
            </div>
          </div>
        </section>

        <section v-if="qDocs.length" class="us-sec">
          <h3 class="us-sec-title">知识文档命中（{{ qDocs.length }}）</h3>
          <div class="us-rows">
            <div
              v-for="d in qDocs"
              :key="d.id"
              class="us-row"
              @click="openDoc(d)"
            >
              <span class="badge us-badge-pdf" :class="d.type">{{ d.type === 'pdf' ? 'PDF' : 'MD' }}</span>
              <div class="us-doc">
                <span class="us-row-text">{{ d.title }}</span>
                <span v-if="d.matchedBlocks && d.matchedBlocks.length" class="us-snip">{{ d.matchedBlocks[0].snippet }}</span>
              </div>
              <span class="us-arrow">›</span>
            </div>
          </div>
        </section>
      </div>
    </div>

    <KbReader :show="reader.show" :doc="reader.doc" @close="reader.show = false" />
    <SimpleQuestion :show="sq.show" :q="sq.q" @close="sq.show = false" />
  </div>
</template>

<style scoped>
.us-mask {
  position: fixed;
  inset: 0;
  background: rgba(2, 12, 24, 0.85);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  z-index: 500;
  padding: 8vh 16px 16px;
}
.us-box {
  width: min(680px, 96vw);
  max-height: 84vh;
  background: var(--bg, #06121f);
  border: 1px solid var(--line);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 0 40px rgba(42, 245, 255, 0.12);
}
.us-head { display: flex; gap: 10px; padding: 14px; border-bottom: 1px solid var(--line); }
.us-input { flex: 1; font-size: 14px; }
.us-loading { padding: 30px; text-align: center; color: var(--muted); font-size: 13px; }
.us-body { overflow-y: auto; padding: 14px; }
.us-empty { text-align: center; color: var(--muted); padding: 30px 0; font-size: 13px; }
.us-sec { margin-bottom: 18px; }
.us-sec-title { font-size: 13px; font-weight: 500; color: var(--brand); margin-bottom: 8px; }
.us-rows { display: flex; flex-direction: column; gap: 8px; }
.us-row {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color .2s, box-shadow .2s;
}
.us-row:hover { border-color: var(--brand); box-shadow: var(--glow-soft); }
.us-row-text {
  flex: 1;
  font-size: 13px;
  color: var(--text);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-line;
}
.us-doc { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.us-snip {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.us-arrow { font-size: 18px; color: var(--brand); }
.us-badge-pdf.pdf { background: rgba(232, 95, 61, 0.15); color: #e85f3d; }
</style>
