<script setup>
import Icon from './Icon.vue'
import { ref, watch } from 'vue'
import { tiku } from '../api/tiku.js'

const props = defineProps({ show: Boolean })
const emit = defineEmits(['close'])

const info = ref({ name: '知识记忆小助手', version: '0.6.0' })

watch(() => props.show, async v => {
  if (!v) return
  try { info.value = await tiku.getVersion() } catch (e) { /* 保持默认 */ }
})

const STACK = ['Electron 31', 'Vue 3', 'Vite 5', 'SQLite · better-sqlite3', 'GitHub Gist 零后端同步']

function openRepo() {
  tiku.openExternal('https://github.com/SongerJia/tiku-desktop')
}

// 手动更新状态：'' | checking | up-to-date | downloading | error
const updState = ref('')
async function checkUpdate() {
  if (updState.value === 'checking') return
  updState.value = 'checking'
  try {
    const r = await tiku.checkUpdate()
    if (!r || !r.ok) {
      // 开发模式或不可用：引导手动下载
      updState.value = 'error'
      setTimeout(() => { updState.value = '' }, 4000)
      return
    }
    // 检查已触发：结果通过系统通知反馈（update-available/downloaded/error 事件）
    // 这里只提示已开始检查；发现新版会弹通知
    updState.value = 'up-to-date' // 临时态，3s 后恢复（实际结果看通知）
    setTimeout(() => { updState.value = '' }, 3000)
  } catch (e) {
    updState.value = 'error'
    setTimeout(() => { updState.value = '' }, 4000)
  }
}

// 手动下载兜底（自动更新失败时）：打开 GitHub Releases 页面
function openReleases() {
  tiku.openExternal('https://github.com/SongerJia/tiku-desktop/releases')
}
</script>

<template>
  <div v-if="show" class="ab-mask" @click.self="emit('close')">
    <div class="ab-box">
      <div class="ab-logo"><Icon name="book" :size="14"/></div>
      <h3 class="ab-name">{{ info.name }}</h3>
      <div class="ab-ver">v{{ info.version }}</div>
      <p class="ab-desc">
        本地优先的刷题 + 知识库 all-in-one 学习工具。<br />
        数据全存本机 SQLite，零后端、可离线，多端用 GitHub Gist 同步。
      </p>
      <div class="ab-stack">
        <span v-for="s in STACK" :key="s" class="ab-tag">{{ s }}</span>
      </div>
      <div class="ab-update">
        <button class="btn ab-repo" :disabled="updState === 'checking'" @click="checkUpdate">
          {{ updState === 'checking' ? '检查中…' : '检查更新' }}
        </button>
        <button v-if="updState === 'error'" class="btn ghost ab-repo" @click="openReleases">自动更新不可用 → 手动下载</button>
        <span v-if="updState === 'up-to-date'" class="ab-upd-tip">已检查，如有新版会弹通知</span>
      </div>
      <button class="btn ab-repo" @click="openRepo">GitHub 仓库 ↗</button>
      <div class="ab-foot">Made with 💙 · 祝备考顺利</div>
    </div>
  </div>
</template>

<style scoped>
.ab-mask {
  position: fixed;
  inset: 0;
  background: var(--modal-mask); backdrop-filter: blur(var(--modal-blur)); -webkit-backdrop-filter: blur(var(--modal-blur));
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 380;
  padding: 16px;
}
.ab-box {
  width: min(360px, 90vw);
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  text-align: center;
}
.ab-logo {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(91, 124, 250, 0.25), rgba(122, 92, 255, 0.2));
  border: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
}
.ab-name { margin: 6px 0 0; font-size: 17px; font-weight: 600; color: var(--text); }
.ab-ver {
  font-size: 12px;
  color: var(--brand);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 1px 10px;
}
.ab-desc { margin: 6px 0; font-size: 12px; line-height: 1.8; color: var(--muted); }
.ab-stack { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin: 4px 0 12px; }
.ab-tag {
  font-size: 11px;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 2px 10px;
  background: rgba(255, 255, 255, 0.03);
}
.ab-repo { margin-top: 4px; }
.ab-update { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-top: 2px; }
.ab-upd-tip { font-size: 11px; color: var(--muted); }
.ab-foot { margin-top: 10px; font-size: 11px; color: var(--muted); }
</style>
