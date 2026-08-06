<script setup>
import { ref, onMounted } from 'vue'
import { tiku } from '../api/tiku.js'

const emit = defineEmits(['start'])
const items = ref([])

onMounted(async () => {
  items.value = await tiku.getFavorites()
})

async function remove(id) {
  await tiku.toggleFavorite(id)
  items.value = items.value.filter(i => i.question_id !== id)
}
</script>

<template>
  <div>
    <h2>收藏（{{ items.length }}）</h2>
    <p v-if="!items.length" class="empty">还没有收藏题目。</p>
    <div v-for="it in items" :key="it.question_id" class="card">
      <div class="stem">{{ it.stem }}</div>
      <div class="btns">
        <button class="review" @click="emit('start', { mode: 'favorite' })">复习</button>
        <button class="del" @click="remove(it.question_id)">取消收藏</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.empty { color: var(--muted); }
.stem { font-weight: 500; margin-bottom: 8px; }
.btns { display: flex; gap: 8px; }
.review { background: var(--brand); color: #fff; border: none; padding: 7px 16px; border-radius: 8px; font-size: 13px; }
.del { background: #fff; color: var(--bad); border: 1px solid var(--bad); padding: 7px 16px; border-radius: 8px; font-size: 13px; }
</style>
