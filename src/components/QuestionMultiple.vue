<script setup>
// 多选组件：方块勾选，显示已选数量
const props = defineProps({
  question: Object,
  selected: Array,
  submitted: Boolean,
  correct: Boolean,
  answer: Array
})
const emit = defineEmits(['select'])

function isSelected(key) { return props.selected && props.selected.includes(key) }
function isCorrect(key) { return props.submitted && props.answer && props.answer.includes(key) }
function isWrong(key) { return props.submitted && isSelected(key) && !isCorrect(key) }
function isMissed(key) { return props.submitted && !isSelected(key) && props.answer && props.answer.includes(key) }

function toggle(key) {
  if (props.submitted) return
  const cur = [...(props.selected || [])]
  const i = cur.indexOf(key)
  if (i >= 0) cur.splice(i, 1)
  else cur.push(key)
  emit('select', cur)
}
</script>

<template>
  <div class="q-multiple">
    <div class="multi-hint" v-if="!submitted">已选 <b>{{ (selected || []).length }}</b> 项</div>
    <div
      v-for="opt in (question.options || [])"
      :key="opt.key"
      class="opt-item"
      :class="{
        selected: isSelected(opt.key),
        correct: isCorrect(opt.key),
        wrong: isWrong(opt.key),
        missed: isMissed(opt.key),
        disabled: submitted
      }"
      @click="toggle(opt.key)"
    >
      <span class="opt-check" :class="{ on: isSelected(opt.key) }">
        <span v-if="isSelected(opt.key)" class="check-mark">✓</span>
      </span>
      <span class="opt-prefix">{{ opt.key }}.</span>
      <span class="opt-text">{{ opt.text }}</span>
      <span v-if="submitted && isCorrect(opt.key)" class="opt-mark correct-mark">✓</span>
      <span v-if="submitted && isWrong(opt.key)" class="opt-mark wrong-mark">✗</span>
      <span v-if="submitted && isMissed(opt.key)" class="opt-mark missed-mark">漏</span>
    </div>
  </div>
</template>

<style scoped>
.q-multiple { display: flex; flex-direction: column; gap: 8px; }
.multi-hint { font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.multi-hint b { color: var(--brand); }
.opt-item {
  border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px;
  cursor: pointer; transition: all .15s; display: flex; align-items: center; gap: 10px;
}
.opt-item:hover:not(.disabled) { border-color: var(--brand); }
.opt-item.selected { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 8%, transparent); }
.opt-item.correct { border-color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); }
.opt-item.wrong { border-color: var(--bad); background: color-mix(in srgb, var(--bad) 10%, transparent); }
.opt-item.missed { border-color: #fbbf24; background: color-mix(in srgb, #fbbf24 10%, transparent); }
.opt-item.disabled { cursor: default; opacity: 0.85; }
.opt-check {
  width: 24px; height: 24px; border-radius: 6px; border: 2px solid var(--line);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: all .15s;
}
.opt-check.on { border-color: var(--brand); background: var(--brand); }
.check-mark { color: #fff; font-size: 13px; font-weight: 700; }
.opt-prefix { font-weight: 600; color: var(--muted); font-size: 13px; flex-shrink: 0; }
.opt-text { font-size: 14px; color: var(--text); line-height: 1.5; flex: 1; }
.opt-mark { font-size: 14px; font-weight: 700; flex-shrink: 0; }
.correct-mark { color: var(--ok); }
.wrong-mark { color: var(--bad); }
.missed-mark { color: #d97706; }
</style>