<script setup>
const props = defineProps({ count: { default: 3 } })
</script>

<template>
  <div class="sk-list">
    <div v-for="i in count" :key="i" class="card sk-card">
      <div class="skeleton sk-line" style="width:55%"></div>
      <div class="skeleton sk-line" style="width:92%"></div>
      <div class="skeleton sk-line" style="width:70%"></div>
    </div>
  </div>
</template>

<style scoped>
.sk-list { display: flex; flex-direction: column; gap: 12px; }
.sk-card { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
.sk-line { height: 14px; border-radius: 6px; }
.sk-line:first-child { height: 18px; }
</style>
