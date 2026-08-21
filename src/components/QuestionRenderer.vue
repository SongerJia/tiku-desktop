<script setup>
// 题型分派器：根据 question.type 和 subjectConfig 渲染对应题型组件
import QuestionSingle from './QuestionSingle.vue'
import QuestionMultiple from './QuestionMultiple.vue'
import QuestionJudge from './QuestionJudge.vue'
import QuestionEssay from './QuestionEssay.vue'

const props = defineProps({
  question: Object,
  selected: Array,
  submitted: Boolean,
  correct: Boolean,
  answer: Array,
  essayText: String,
  reviewing: Boolean,
  config: Object,          // 科目配置（控制 UI 偏好）
  mode: String             // practice / exam / recite
})
const emit = defineEmits(['select', 'update:essayText', 'self-review'])

const cardMode = computed(() => props.config?.ui?.single_card !== false)
import { computed } from 'vue'
</script>

<template>
  <QuestionSingle
    v-if="question && question.type === 'single'"
    :question="question"
    :selected="selected"
    :submitted="submitted"
    :correct="correct"
    :answer="answer"
    :card-mode="cardMode"
    @select="emit('select', $event)"
  />
  <QuestionMultiple
    v-else-if="question && question.type === 'multiple'"
    :question="question"
    :selected="selected"
    :submitted="submitted"
    :correct="correct"
    :answer="answer"
    @select="emit('select', $event)"
  />
  <QuestionJudge
    v-else-if="question && question.type === 'judge'"
    :question="question"
    :selected="selected"
    :submitted="submitted"
    :correct="correct"
    :answer="answer"
    @select="emit('select', $event)"
  />
  <QuestionEssay
    v-else-if="question && question.type === 'essay'"
    :question="question"
    :essay-text="essayText"
    :reviewing="reviewing"
    :submitted="submitted"
    @update:essay-text="emit('update:essayText', $event)"
    @self-review="emit('self-review', $event)"
  />
  <div v-else class="q-unknown">暂不支持「{{ question?.type }}」题型</div>
</template>

<style scoped>
.q-unknown { padding: 30px; text-align: center; color: var(--muted); font-size: 13px; }
</style>