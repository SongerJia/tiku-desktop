<script setup>
// 单选组件：卡片式选项，选中高亮，确认后显示对错
const props = defineProps({
  question: Object,
  selected: Array,       // 当前选中项 key（如 ['A']）
  submitted: Boolean,    // 已提交答案 → 显示对错
  correct: Boolean,      // 是否正确
  answer: Array,         // 正确答案 keys
  cardMode: Boolean      // 卡片式（vs 传统 A. B. C. D.）
})
const emit = defineEmits(['select'])

function isSelected(key) {
  return props.selected && props.selected[0] === key
}
function isCorrect(key) {
  if (!props.submitted) return false
  return props.answer && props.answer.includes(key)
}
function isWrong(key) {
  if (!props.submitted) return false
  return isSelected(key) && !isCorrect(key)
}
</script>

<template>
  <div class="q-single" :class="{ card: cardMode }">
    <div
      v-for="opt in (question.options || [])"
      :key="opt.key"
      class="opt-item"
      :class="{
        selected: isSelected(opt.key),
        correct: isCorrect(opt.key),
        wrong: isWrong(opt.key),
        disabled: submitted
      }"
      @click="!submitted && emit('select', [opt.key])"
    >
      <span v-if="cardMode" class="opt-badge" :class="{ on: isSelected(opt.key) }">{{ opt.key }}</span>
      <span v-else class="opt-prefix">{{ opt.key }}.</span>
      <span class="opt-text">{{ opt.text }}</span>
      <span v-if="submitted && isCorrect(opt.key)" class="opt-mark correct-mark">✓</span>
      <span v-if="submitted && isWrong(opt.key)" class="opt-mark wrong-mark">✗</span>
    </div>
  </div>
</template>

<style scoped>
.q-single { display: flex; flex-direction: column; gap: 8px; }
.q-single.card .opt-item {
  border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px;
  cursor: pointer; transition: all .15s; display: flex; align-items: center; gap: 10px;
}
.q-single.card .opt-item:hover:not(.disabled) { border-color: var(--brand); }
.q-single.card .opt-item.selected { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 8%, transparent); }
.q-single.card .opt-item.correct { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); }
.q-single.card .opt-item.wrong { border-color: var(--bad); background: color-mix(in srgb, var(--bad) 10%, transparent); }
.q-single.card .opt-item.disabled { cursor: default; opacity: 0.85; }
.opt-badge {
  width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--line);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; color: var(--muted); flex-shrink: 0;
  transition: all .15s;
}
.opt-badge.on { border-color: var(--brand); background: var(--brand); color: #fff; }
.opt-prefix { font-weight: 600; color: var(--muted); font-size: 13px; flex-shrink: 0; }
.opt-text { font-size: 14px; color: var(--text); line-height: 1.5; flex: 1; }
.opt-mark { font-size: 16px; font-weight: 700; flex-shrink: 0; }
.correct-mark { color: var(--ok); }
.wrong-mark { color: var(--bad); }
</style>