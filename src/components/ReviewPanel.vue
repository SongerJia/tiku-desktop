<script setup>
import { ref, watch } from 'vue'
import { tiku } from '../api/tiku.js'

const props = defineProps({ show: Boolean })
const emit = defineEmits(['close'])

const items = ref([])
const idx = ref(0)
const flipped = ref(false)
const loading = ref(false)
const done = ref(0)
const forgot = ref(0)

watch(() => props.show, async v => {
  if (!v) return
  loading.value = true
  items.value = []
  idx.value = 0
  flipped.value = false
  done.value = 0
  forgot.value = 0
  const r = await tiku.getDailyReview(8)
  items.value = [
    ...r.questions.map(q => ({ type: 'question', id: q.questionId, front: q.stem, back: renderQ(q), kind: '题目' })),
    ...r.blocks.map(b => ({ type: 'block', id: b.blockId, front: b.content, back: `来自文档《${b.docTitle}》${b.heading ? ' · ' + b.heading : ''}`, kind: '知识块' }))
  ]
  loading.value = false
})

function renderQ(q) {
  const opts = q.options && q.options.length
    ? q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n') + '\n'
    : ''
  return `${opts}正确答案：${(q.answer || []).join('、')}\n${q.analysis ? '解析：' + q.analysis : ''}`
}

const cur = () => items.value[idx.value] || null

async function grade(result) {
  const it = cur()
  if (!it) return
  await tiku.logReview(it.type, it.id, result)
  if (result) done.value++
  else forgot.value++
  idx.value++
  flipped.value = false
}

function flip() { flipped.value = !flipped.value }

function fmt(q) {
  const parts = String(q.front || '').split('\n')
  return parts.slice(0, 6).join('\n')
}
</script>

<template>
  <div v-if="show" class="rv-mask" @click.self="emit('close')">
    <div class="rv-box">
      <div class="rv-head">
        <span class="rv-title">每日回顾 · 主动回忆</span>
        <span class="rv-prog">{{ idx }} / {{ items.length }}</span>
        <button class="btn rv-close" @click="emit('close')">关闭</button>
      </div>

      <div v-if="loading" class="rv-empty">加载中…</div>
      <div v-else-if="!items.length" class="rv-empty">
        <p>今天没有到期回顾</p>
        <p class="rv-hint">先刷几道题 / 导入几篇文档，明天就有得回顾了</p>
      </div>
      <div v-else-if="idx >= items.length" class="rv-empty">
        <p>🎉 今日回顾完成</p>
        <p class="rv-hint">想起来 {{ done }} 条 · 没想起来 {{ forgot }} 条（没想起的已记入，明天会再来）</p>
        <button class="btn btn-primary" @click="emit('close')">完成</button>
      </div>

      <div v-else class="rv-card-wrap">
        <div class="rv-card" :class="{ flipped }" @click="flip">
          <div class="rv-face rv-front">
            <span class="rv-kind">{{ cur().kind }}</span>
            <pre class="rv-text">{{ cur().front }}</pre>
            <span class="rv-tip">点击翻面看答案</span>
          </div>
          <div class="rv-face rv-back">
            <pre class="rv-text">{{ cur().back }}</pre>
          </div>
        </div>
        <div class="rv-actions">
          <button class="rv-no" @click="grade(false)">✗ 没想起来</button>
          <button class="rv-yes" @click="grade(true)">✓ 想起来</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rv-mask {
  position: fixed;
  inset: 0;
  background: rgba(2, 12, 24, 0.85);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 350;
  padding: 16px;
}
.rv-box {
  width: min(560px, 94vw);
  background: var(--bg, #06121f);
  border: 1px solid var(--line);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 0 40px rgba(42, 245, 255, 0.12);
}
.rv-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
}
.rv-title { font-size: 14px; font-weight: 500; color: var(--brand); }
.rv-prog { font-size: 12px; color: var(--muted); }
.rv-close { margin-left: auto; padding: 3px 12px; }
.rv-empty { padding: 50px 20px; text-align: center; color: var(--text); }
.rv-hint { font-size: 12px; color: var(--muted); margin-top: 8px; }
.rv-card-wrap { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.rv-card {
  min-height: 260px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--card-solid);
  cursor: pointer;
  position: relative;
  overflow: hidden;
  display: flex;
}
.rv-face {
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  width: 100%;
}
.rv-kind {
  font-size: 11px;
  color: var(--brand);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 0 8px;
  align-self: flex-start;
  margin-bottom: 12px;
}
.rv-text {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.8;
  color: var(--text);
  margin: 0;
}
.rv-tip { font-size: 11px; color: var(--muted); text-align: center; margin-top: 10px; }
.rv-back .rv-text { color: var(--ok); }
.rv-actions { display: flex; gap: 12px; }
.rv-yes, .rv-no {
  flex: 1;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  transition: all .15s;
}
.rv-yes:hover { border-color: var(--ok); color: var(--ok); box-shadow: 0 0 12px rgba(44, 229, 168, 0.2); }
.rv-no:hover { border-color: var(--bad); color: var(--bad); }
</style>
