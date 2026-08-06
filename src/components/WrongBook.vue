<script setup>
import { ref, onMounted } from 'vue'
import { tiku } from '../api/tiku.js'

const emit = defineEmits(['start'])
const items = ref([])

onMounted(async () => {
  items.value = await tiku.getWrongBook()
})
</script>

<template>
  <div>
    <h2>错题本（{{ items.length }}）</h2>
    <p v-if="!items.length" class="empty">暂无活跃错题，继续保持！</p>
    <div v-for="it in items" :key="it.question_id" class="card">
      <div class="stem">{{ it.stem }}</div>
      <div class="meta">答错 {{ it.wrong_count }} 次 · 已复习 {{ it.reviewed_count }} 次</div>
      <button @click="emit('start', { mode: 'wrong' })">复习这批错题</button>
    </div>
  </div>
</template>

<style scoped>
.empty { color: var(--muted); }
.stem { font-weight: 500; margin-bottom: 6px; }
.meta { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
button { background: var(--brand); color: #fff; border: none; padding: 7px 16px; border-radius: 8px; font-size: 13px; }
</style>
