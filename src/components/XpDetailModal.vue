<script setup>
import { ref, watch } from 'vue'
import { tiku } from '../api/tiku.js'
import Icon from './Icon.vue'

const props = defineProps({ show: Boolean })
const emit = defineEmits(['close'])

const detail = ref(null)

watch(() => props.show, async v => {
  if (!v) return
  detail.value = await tiku.xpDetail()
})

function fmt(t) {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div v-if="show" class="xd-mask" @click.self="emit('close')">
    <div class="xd-box">
      <div class="xd-head">
        <span class="xd-title">XP 明细</span>
        <button class="btn xd-close" @click="emit('close')">关闭</button>
      </div>
      <div class="xd-body">
        <template v-if="detail">
          <div v-if="detail.bySource.length" class="xd-sec-title">今日 XP 来源</div>
          <div v-if="detail.bySource.length" class="xd-sources">
            <div v-for="s in detail.bySource" :key="s.source" class="xd-source">
              <span class="xd-label">{{ s.label }}</span>
              <span class="xd-count">{{ s.n }} 次</span>
              <span class="xd-total">+{{ s.total }}</span>
            </div>
          </div>
          <div v-else class="xd-empty">今天还没有 XP 收入，去刷几道题吧</div>
          <div class="xd-sec-title">最近记录</div>
          <div class="xd-recent">
            <div v-for="(r, i) in detail.recent" :key="i" class="xd-row">
              <Icon name="check" :size="13"/>
              <span class="xd-r-label">{{ r.label }}</span>
              <span class="xd-r-note">{{ r.note }}</span>
              <span class="xd-r-time">{{ fmt(r.created_at) }}</span>
              <span class="xd-r-xp">+{{ r.xp }}</span>
            </div>
          </div>
        </template>
        <div v-else class="xd-empty">加载中…</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.xd-mask {
  position: fixed;
  inset: 0;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur));
  -webkit-backdrop-filter: blur(var(--modal-blur));
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 380;
  padding: 16px;
}
.xd-box {
  width: min(420px, 92vw);
  max-height: 80vh;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}
.xd-head {
  display: flex;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}
.xd-title { font-size: 15px; font-weight: 600; color: var(--text); }
.xd-close { margin-left: auto; padding: 3px 12px; }
.xd-body { overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 8px; }
.xd-sec-title { font-size: 12px; font-weight: 600; color: var(--muted); margin-top: 6px; }
.xd-sources { display: flex; flex-direction: column; gap: 6px; }
.xd-source {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 13px;
}
.xd-label { flex: 1; color: var(--text); }
.xd-count { font-size: 11px; color: var(--muted); }
.xd-total { font-weight: 600; color: var(--brand); }
.xd-recent { display: flex; flex-direction: column; gap: 4px; }
.xd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 6px 4px;
  border-bottom: 1px dashed var(--line);
}
.xd-row:last-child { border-bottom: none; }
.xd-r-label { color: var(--text); flex-shrink: 0; }
.xd-r-note { flex: 1; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.xd-r-time { color: var(--muted); font-size: 11px; flex-shrink: 0; }
.xd-r-xp { color: var(--ok); font-weight: 600; flex-shrink: 0; }
.xd-empty { padding: 30px 10px; text-align: center; color: var(--muted); font-size: 13px; }
</style>
