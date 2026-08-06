<script setup>
import { ref, onMounted } from 'vue'
import { tiku } from '../api/tiku.js'

const tree = ref([])
const emit = defineEmits(['start'])

onMounted(async () => {
  tree.value = await tiku.getCategories()
})
</script>

<template>
  <div class="tree">
    <h2>选择章节开始刷题</h2>
    <div v-if="!tree.length" class="empty">题库为空，请到「数据」页导入题目。</div>
    <div v-for="subj in tree" :key="subj.id" class="subject">
      <div class="subject-name">{{ subj.name }}</div>
      <div class="chapters">
        <button
          v-for="ch in (subj.children || [])"
          :key="ch.id"
          class="chapter"
          @click="emit('start', ch.id)"
        >{{ ch.name }}</button>
        <span v-if="!subj.children || !subj.children.length" class="empty">暂无章节</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.subject { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; margin-bottom: 12px; }
.subject-name { font-weight: 600; margin-bottom: 10px; }
.chapters { display: flex; flex-wrap: wrap; gap: 8px; }
.chapter { border: 1px solid var(--line); background: #f7faf9; color: var(--brand); padding: 7px 14px; border-radius: 8px; font-size: 13px; }
.chapter:hover { background: var(--brand); color: #fff; border-color: var(--brand); }
.empty { color: var(--muted); font-size: 13px; }
</style>
