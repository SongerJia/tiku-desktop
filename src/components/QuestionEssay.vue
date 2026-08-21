<script setup>
// 问答组件：文本输入框 + 自评
import { ref, watch } from 'vue'

const props = defineProps({
  question: Object,
  essayText: String,
  reviewing: Boolean,    // 已提交，等待自评
  submitted: Boolean
})
const emit = defineEmits(['update:essayText', 'self-review'])

const localText = ref(props.essayText || '')
watch(() => props.essayText, v => { localText.value = v || '' })
watch(localText, v => emit('update:essayText', v))
</script>

<template>
  <div class="q-essay">
    <textarea
      v-model="localText"
      class="essay-input"
      :placeholder="(question.placeholder || '') || '输入你的答案…'"
      :disabled="submitted"
      rows="6"
    ></textarea>
    <div class="essay-foot">
      <span class="essay-count">{{ localText.length }} 字</span>
      <span v-if="!submitted" class="essay-hint">提交后请根据参考答案自评</span>
    </div>
    <div v-if="reviewing" class="essay-self">
      <div class="essay-self-title">请根据参考答案为你自己的作答打分：</div>
      <div class="essay-self-btns">
        <button class="self-btn" @click="emit('self-review', true)">✓ 答对了</button>
        <button class="self-btn no" @click="emit('self-review', false)">✗ 答错了</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.q-essay { display: flex; flex-direction: column; gap: 8px; }
.essay-input {
  width: 100%; min-height: 120px; resize: vertical;
  border: 1px solid var(--line); border-radius: 10px;
  background: var(--bg-faint); color: var(--text);
  padding: 12px; font-size: 14px; line-height: 1.6;
  font-family: inherit; transition: border-color .2s;
}
.essay-input:focus { border-color: var(--brand); outline: none; }
.essay-input:disabled { opacity: 0.6; }
.essay-foot { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); }
.essay-hint { font-style: italic; }
.essay-self { border: 1px solid var(--line); border-radius: 10px; padding: 14px; background: color-mix(in srgb, var(--brand) 4%, transparent); }
.essay-self-title { font-size: 13px; color: var(--text); margin-bottom: 10px; }
.essay-self-btns { display: flex; gap: 10px; }
.self-btn {
  flex: 1; border: 1px solid var(--line); border-radius: 10px;
  padding: 10px; font-size: 13px; cursor: pointer;
  background: var(--bg-faint); color: var(--text); transition: all .15s;
}
.self-btn:hover { border-color: var(--brand); }
.self-btn.no:hover { border-color: var(--bad); }
</style>