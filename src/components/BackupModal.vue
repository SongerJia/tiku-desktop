<script setup>
import { ref, watch } from 'vue'
import { useBodyLock } from '../composables/useBodyLock.js'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import { tiku } from '../api/tiku.js'
import { showConfirm } from '../utils/confirm.js'
import { showToast } from '../utils/toast.js'
import { useEsc } from '../utils/useEsc.js'

const props = defineProps({ show: Boolean })
useBodyLock(() => props.show)
useFocusTrap(() => props.show, '.bk-box')
const emit = defineEmits(['close'])

const backups = ref([])
const restoring = ref(false)

async function load() {
  backups.value = await tiku.listBackups()
}

watch(() => props.show, v => { if (v) load() })
useEsc(() => emit('close'))

function fmtSize(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}
function fmtTime(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function restore(b) {
  const ok = await showConfirm(`用 ${fmtTime(b.mtime)} 的备份恢复？\n将覆盖当前全部本地数据，应用会自动重启。`, { title: '恢复备份', danger: true })
  if (!ok) return
  restoring.value = true
  try {
    const r = await tiku.restoreBackup(b.file)
    if (!r.ok) { showToast('恢复失败：' + (r.error || '未知错误'), 'err'); return }
    // 主进程会自动 relaunch；这里不再提示
  } catch (err) {
    showToast('恢复失败：' + (err && err.message ? err.message : err), 'err')
  } finally {
    restoring.value = false
  }
}
</script>

<template>
  <div v-if="show" class="bk-mask" @click.self="emit('close')">
    <div class="bk-box">
      <div class="bk-head">
        <span class="bk-title">备份管理</span>
        <span class="bk-sub">启动时自动备份 · 保留最近 5 份</span>
        <button class="btn bk-close" @click="emit('close')">关闭</button>
      </div>
      <div class="bk-body">
        <div v-if="!backups.length" class="bk-empty">还没有备份（每次启动应用会自动生成一份）</div>
        <div v-for="b in backups" :key="b.file" class="bk-item">
          <div class="bk-info">
            <div class="bk-name">{{ b.file }}</div>
            <div class="bk-meta">{{ fmtTime(b.mtime) }} · {{ fmtSize(b.size) }}</div>
          </div>
          <button class="bk-restore" :disabled="restoring" @click="restore(b)">{{ restoring ? '恢复中…' : '恢复' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bk-mask {
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
.bk-box {
  width: min(480px, 92vw);
  max-height: 80vh;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}
.bk-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}
.bk-title { font-size: 15px; font-weight: 600; color: var(--text); }
.bk-sub { font-size: 12px; color: var(--muted); }
.bk-close { margin-left: auto; padding: 3px 12px; }
.bk-body { overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 8px; }
.bk-empty { padding: 30px 10px; text-align: center; color: var(--muted); font-size: 13px; }
.bk-item {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 14px;
  transition: border-color .15s;
}
.bk-item:hover { border-color: var(--brand); }
.bk-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.bk-name { font-size: 13px; color: var(--text); font-family: Consolas, monospace; }
.bk-meta { font-size: 11px; color: var(--muted); }
.bk-restore {
  font-size: 12px;
  color: var(--brand);
  border: 1px solid var(--brand);
  background: transparent;
  border-radius: 8px;
  padding: 5px 14px;
  cursor: pointer;
  transition: all .15s;
}
.bk-restore:hover { background: var(--brand-light); }
.bk-restore:disabled { opacity: .5; cursor: not-allowed; }
</style>
