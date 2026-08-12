<script setup>
// 统一空状态（尾 1）：渐变圆底图标 + 文案 + 副文案 + 可选行动按钮
import Icon from './Icon.vue'
defineProps({
  icon: { type: String, default: 'doc' },
  text: { type: String, default: '暂无数据' },
  sub: { type: String, default: '' },
  action: { type: String, default: '' }
})
const emit = defineEmits(['action'])
</script>

<template>
  <div class="empty-state">
    <div class="es-icon"><Icon :name="icon" :size="24" /></div>
    <div class="es-text">{{ text }}</div>
    <div v-if="sub" class="es-sub">{{ sub }}</div>
    <button v-if="action" class="es-btn" @click="emit('action')">{{ action }}</button>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex; flex-direction: column; align-items: center;
  gap: 6px; padding: 30px 12px; text-align: center;
}
.es-icon {
  width: 54px; height: 54px; border-radius: 50%; margin-bottom: 6px;
  background: linear-gradient(135deg, rgba(91, 124, 250, 0.14), rgba(122, 92, 255, 0.08));
  border: 1px solid rgba(91, 124, 250, 0.3);
  display: flex; align-items: center; justify-content: center;
  color: var(--brand);
}
.es-text { font-size: 13.5px; color: var(--text); font-weight: 500; }
.es-sub { font-size: 12px; color: var(--muted); line-height: 1.6; max-width: 300px; }
.es-btn {
  margin-top: 8px; background: var(--brand-light); color: var(--brand);
  border: 1px solid rgba(91, 124, 250, 0.4); border-radius: 999px;
  padding: 7px 18px; font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: all .15s;
}
.es-btn:hover { background: var(--brand); color: #fff; box-shadow: var(--glow); }
</style>
