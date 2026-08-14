<script setup>
import Icon from './Icon.vue'
import LogoMark from './LogoMark.vue'
import { ref, watch } from 'vue'
import { tiku } from '../api/tiku.js'

const props = defineProps({ show: Boolean })
const emit = defineEmits(['close'])

const info = ref({ name: '知识记忆小助手', version: '0.6.0' })

watch(() => props.show, async v => {
  if (!v) return
  try { info.value = await tiku.getVersion() } catch (e) { /* 保持默认 */ }
})

const STACK = ['Electron 31', 'Vue 3', 'Vite 5', 'SQLite · better-sqlite3', 'GitHub 仓库同步']

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
  <Transition name="fade">
    <div v-if="show" class="ab-mask" @click.self="emit('close')">
      <div class="ab-box">
        <div class="ab-logo"><LogoMark :size="40" /></div>
        <h3 class="ab-name">{{ info.name }}</h3>
        <div class="ab-ver">v{{ info.version }}</div>
        <p class="ab-desc">
          本地优先的刷题 + 知识库 all-in-one 学习工具。<br />
          数据全存本机 SQLite，可离线，多端用 GitHub 仓库同步。
        </p>
        <div class="ab-stack">
          <span v-for="s in STACK" :key="s" class="ab-tag">{{ s }}</span>
        </div>
        <div class="ab-update">
          <div class="ab-row">
            <button class="btn ab-repo" :disabled="updState === 'checking'" @click="checkUpdate">
              {{ updState === 'checking' ? '检查中…' : '检查更新' }}
            </button>
            <button class="btn ab-repo" @click="openRepo">GitHub 仓库 ↗</button>
          </div>
          <button v-if="updState === 'error'" class="btn ghost ab-repo ab-download" @click="openReleases">自动更新不可用 → 手动下载</button>
          <span v-if="updState === 'up-to-date'" class="ab-upd-tip">已检查，如有新版会弹通知</span>
        </div>
        <div class="ab-foot"><Icon name="heart" :size="11" class="ab-heart" /> Made with · 祝备考顺利</div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* 遮罩淡入 + 面板上浮缩放入场（对齐全站管理弹窗语言） */
.fade-enter-active, .fade-leave-active { transition: opacity .2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.ab-box { animation: abBoxIn .28s cubic-bezier(.2, .7, .3, 1); }
@keyframes abBoxIn { from { opacity: 0; transform: translateY(16px) scale(.96); } to { opacity: 1; transform: none; } }

.ab-mask {
  position: fixed;
  inset: 0;
  background: var(--modal-mask);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
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
/* logo 容器：透明承接（logo 自带底座），保留呼吸光晕 + 旋转流光环（静态 conic + rotate，不依赖 --ang 插值） */
.ab-logo {
  position: relative;
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: abLogoBreathe 3s ease-in-out infinite;
}
.ab-logo::before {
  content: '';
  position: absolute; inset: -3px;
  border-radius: 19px;
  padding: 1.5px;
  background: conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--brand) 70%, transparent) 80deg, transparent 160deg);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  animation: abRingSpin 3.5s linear infinite;
  pointer-events: none;
}
@keyframes abLogoBreathe {
  0%, 100% { box-shadow: 0 0 10px color-mix(in srgb, var(--brand) 18%, transparent); }
  50% { box-shadow: 0 0 24px color-mix(in srgb, var(--brand) 42%, transparent); }
}
@keyframes abRingSpin { to { transform: rotate(360deg); } }
.ab-name { margin: 6px 0 0; font-size: 17px; font-weight: 600; color: var(--text); }
.ab-ver {
  font-size: 12px;
  color: var(--brand);
  border: 1px solid color-mix(in srgb, var(--brand) 35%, transparent);
  border-radius: 10px;
  padding: 1px 10px;
  background: color-mix(in srgb, var(--brand) 8%, transparent);
}
.ab-desc { margin: 6px 0; font-size: 11.5px; line-height: 1.7; color: var(--muted); }
.ab-stack { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin: 4px 0 12px; }
.ab-tag {
  font-size: 10.5px;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 2px 10px;
  background: rgba(255, 255, 255, 0.03);
  transition: all .15s ease;
  cursor: default;
}
.ab-tag:hover {
  color: var(--text);
  border-color: color-mix(in srgb, var(--brand) 45%, transparent);
  transform: translateY(-1px);
}
.ab-repo { margin-top: 4px; font-size: 12px; font-weight: 500; padding: 6px 14px; }
.ab-update { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-top: 2px; }
.ab-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.ab-download { font-size: 11px; padding: 4px 10px; }
.ab-upd-tip { font-size: 11px; color: var(--muted); }
/* footer 心跳（emoji 换主题色心形图标 + 心跳动效） */
.ab-foot {
  margin-top: 10px;
  font-size: 11px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 5px;
}
.ab-heart { color: #fb7185; animation: abHeart 1.6s ease-in-out infinite; }
@keyframes abHeart {
  0%, 100% { transform: scale(1); }
  25% { transform: scale(1.3); }
  40% { transform: scale(1); }
}
</style>
