<script setup>
// 判断组件：✓ 正确 / ✗ 错误 大按钮
import { computed } from 'vue'

const props = defineProps({
  question: Object,
  selected: Array,
  submitted: Boolean,
  correct: Boolean,
  answer: Array
})
const emit = defineEmits(['select'])

const selKey = computed(() => props.selected && props.selected[0] || null)
// answer: 正确选项的 key（如 'A' 对应「正确」）
const ansKey = computed(() => props.answer && props.answer[0] || null)
</script>

<template>
  <div class="q-judge">
    <div
      class="j-btn true-btn"
      :class="{
        selected: selKey === 'A',
        correct: submitted && ansKey === 'A' && selKey === 'A',
        wrong: submitted && ansKey !== 'A' && selKey === 'A',
        highlight: submitted && ansKey === 'A',
        disabled: submitted
      }"
      @click="!submitted && emit('select', ['A'])"
    >
      <span class="j-icon">✓</span>
      <span class="j-label">正确</span>
    </div>
    <div
      class="j-btn false-btn"
      :class="{
        selected: selKey === 'B',
        correct: submitted && ansKey === 'B' && selKey === 'B',
        wrong: submitted && ansKey !== 'B' && selKey === 'B',
        highlight: submitted && ansKey === 'B',
        disabled: submitted
      }"
      @click="!submitted && emit('select', ['B'])"
    >
      <span class="j-icon">✗</span>
      <span class="j-label">错误</span>
    </div>
  </div>
</template>

<style scoped>
.q-judge { display: flex; gap: 16px; }
.j-btn {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 24px 16px; border-radius: 14px; border: 2px solid var(--line);
  cursor: pointer; transition: all .2s; font-size: 15px;
}
.j-btn:hover:not(.disabled) { border-color: var(--brand); transform: translateY(-2px); }
.j-btn.selected { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 8%, transparent); }
.j-btn.correct { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); }
.j-btn.wrong { border-color: var(--bad); background: color-mix(in srgb, var(--bad) 10%, transparent); }
.j-btn.highlight { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 6%, transparent); }
.j-btn.disabled { cursor: default; opacity: 0.85; }
.j-icon { font-size: 32px; line-height: 1; }
.true-btn .j-icon { color: var(--ok); }
.false-btn .j-icon { color: var(--bad); }
.j-label { font-weight: 600; color: var(--text); }
</style>