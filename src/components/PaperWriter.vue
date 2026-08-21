<script setup>
// 论文写作组件：软考架构师论文专用
// 120 分钟倒计时 · 2500 字目标 · 提纲区
import { ref, computed, watch, onUnmounted } from 'vue'

const props = defineProps({
  question: Object,      // paper 类型题目
  submitted: Boolean,
  durationMin: { type: Number, default: 120 }
})
const emit = defineEmits(['submit'])

// 提纲
const outline = ref('')
const body = ref('')
const timeLeft = ref(props.durationMin * 60) // 秒
let timer = null
const wordCount = computed(() => body.value.replace(/\s/g, '').length)
const targetWords = 2500
const wordPct = computed(() => Math.min(100, Math.round((wordCount.value / targetWords) * 100)))
const timeDisplay = computed(() => {
  const m = Math.floor(timeLeft.value / 60)
  const s = timeLeft.value % 60
  return `${m}:${String(s).padStart(2, '0')}`
})
const isUrgent = computed(() => timeLeft.value < 300 && timeLeft.value > 0)
const isTimeUp = computed(() => timeLeft.value <= 0)

function startTimer() {
  if (timer) return
  timer = setInterval(() => {
    if (timeLeft.value > 0) timeLeft.value--
    if (timeLeft.value <= 0) { clearInterval(timer); timer = null }
  }, 1000)
}

function submit() {
  clearInterval(timer)
  timer = null
  emit('submit', { outline: outline.value, body: body.value, wordCount: wordCount.value })
}

watch(() => props.question, (q) => {
  if (q) { timeLeft.value = props.durationMin * 60; outline.value = ''; body.value = ''; startTimer() }
}, { immediate: false })

onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <div class="paper-writer">
    <!-- 顶部：计时 + 字数 -->
    <div class="pw-bar">
      <div class="pw-timer" :class="{ urgent: isUrgent, timeup: isTimeUp }">
        ⏱ {{ timeDisplay }}
      </div>
      <div class="pw-words">
        <span class="pw-word-num" :class="{ full: wordCount >= targetWords }">{{ wordCount }}</span>
        <span class="pw-word-target">/ {{ targetWords }} 字</span>
        <span class="pw-word-bar">
          <span class="pw-word-fill" :style="{ width: wordPct + '%' }"></span>
        </span>
      </div>
    </div>

    <!-- 题目 -->
    <div class="pw-stem">{{ question?.stem }}</div>

    <!-- 提纲区 -->
    <div class="pw-section">
      <div class="pw-sec-label">📝 提纲（先列大纲再写正文）</div>
      <textarea
        v-model="outline"
        class="pw-outline"
        :disabled="submitted || isTimeUp"
        placeholder="1. 引言\n2. 主体论述\n3. 案例分析\n4. 总结"
        rows="4"
      ></textarea>
    </div>

    <!-- 正文区 -->
    <div class="pw-section">
      <div class="pw-sec-label">✍️ 正文</div>
      <textarea
        v-model="body"
        class="pw-body"
        :disabled="submitted || isTimeUp"
        placeholder="在此撰写论文正文…"
        rows="16"
      ></textarea>
    </div>

    <!-- 提交 -->
    <div v-if="!submitted && !isTimeUp" class="pw-actions">
      <button class="pw-submit" :disabled="wordCount < 500" @click="submit">
        {{ wordCount < 500 ? '至少写 500 字才能提交' : '交卷' }}
      </button>
    </div>
    <div v-else-if="isTimeUp && !submitted" class="pw-timeup-msg">
      ⏰ 时间到！请提交你的论文
      <button class="pw-submit" @click="submit">提交</button>
    </div>
  </div>
</template>

<style scoped>
.paper-writer { display: flex; flex-direction: column; gap: 12px; }
.pw-bar { display: flex; align-items: center; gap: 16px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 10px; background: color-mix(in srgb, var(--brand) 4%, transparent); }
.pw-timer { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text); }
.pw-timer.urgent { color: var(--bad); animation: pulse 1s infinite; }
.pw-timer.timeup { color: var(--bad); }
.pw-words { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.pw-word-num { font-size: 18px; font-weight: 700; color: var(--text); }
.pw-word-num.full { color: var(--ok); }
.pw-word-target { font-size: 12px; color: var(--muted); }
.pw-word-bar { width: 60px; height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.pw-word-fill { height: 100%; border-radius: 3px; background: var(--brand); transition: width .3s; }
.pw-stem { font-size: 15px; font-weight: 600; line-height: 1.6; color: var(--text); padding: 8px 0; }
.pw-section { display: flex; flex-direction: column; gap: 6px; }
.pw-sec-label { font-size: 12px; font-weight: 600; color: var(--muted); }
.pw-outline, .pw-body {
  width: 100%; border: 1px solid var(--line); border-radius: 10px;
  background: var(--bg-faint); color: var(--text); padding: 12px;
  font-size: 14px; line-height: 1.6; font-family: inherit; resize: vertical;
  transition: border-color .2s;
}
.pw-outline:focus, .pw-body:focus { border-color: var(--brand); outline: none; }
.pw-body:disabled, .pw-outline:disabled { opacity: .6; }
.pw-actions { display: flex; justify-content: flex-end; }
.pw-submit {
  background: var(--brand); color: #fff; border: none; border-radius: 24px;
  padding: 10px 28px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all .2s;
}
.pw-submit:hover { filter: brightness(1.1); }
.pw-submit:disabled { opacity: .4; cursor: not-allowed; }
.pw-timeup-msg { text-align: center; padding: 12px; color: var(--bad); font-weight: 600; display: flex; flex-direction: column; gap: 8px; align-items: center; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
</style>