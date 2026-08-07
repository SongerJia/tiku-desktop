<script setup>
import Icon from './Icon.vue'
import { ref } from 'vue'
import { tiku } from '../api/tiku.js'

const props = defineProps({ show: Boolean })
const emit = defineEmits(['close'])

const step = ref(0)
const STEPS = [
  { icon: '📚', title: '导入你的题库', desc: '支持 CSV / Excel / JSON 批量导入（我的 → 题库管理），也可以先用内置「二级建造师」样题体验。', btn: '知道了' },
  { icon: '🗂️', title: '导入知识文档', desc: '把教材 md / pdf 拖进「知识库」，自动切块、全文搜索，还能和题目双向联动。', btn: '知道了' },
  { icon: '🎯', title: '设定目标与同步', desc: '在「我的」里设定每日目标、开启学习提醒；多台设备用 GitHub Gist 零后端同步。', btn: '开始使用' }
]

async function next() {
  if (step.value < STEPS.length - 1) {
    step.value++
    return
  }
  await tiku.setSetting('seen_welcome', '1')
  emit('close')
}

async function skip() {
  await tiku.setSetting('seen_welcome', '1')
  emit('close')
}
</script>

<template>
  <Transition name="wg">
    <div v-if="show" class="wg-mask" @click.self="skip">
      <div class="card wg-box">
        <div class="wg-head">
          <span class="wg-logo"><Icon name="book" :size="16"/></span>
          <span class="wg-title">欢迎使用知识记忆小助手</span>
        </div>
        <div class="wg-body">
          <div class="wg-step">
            <span class="wg-icon">{{ STEPS[step].icon }}</span>
            <h3>{{ STEPS[step].title }}</h3>
            <p>{{ STEPS[step].desc }}</p>
          </div>
          <div class="wg-dots">
            <span v-for="(s, i) in STEPS" :key="i" class="wg-dot" :class="{ on: i === step }"></span>
          </div>
        </div>
        <div class="wg-actions">
          <button class="btn wg-skip" @click="skip">跳过</button>
          <button class="btn btn-primary" @click="next">{{ STEPS[step].btn }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.wg-mask {
  position: fixed;
  inset: 0;
  background: var(--modal-mask); backdrop-filter: blur(var(--modal-blur)); -webkit-backdrop-filter: blur(var(--modal-blur));
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 950;
  padding: 20px;
}
.wg-box {
  width: min(420px, 92vw);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}
.wg-head { display: flex; align-items: center; gap: 10px; }
.wg-logo { font-size: 26px; }
.wg-title { font-size: 16px; font-weight: 600; color: var(--text); }
.wg-body { display: flex; flex-direction: column; gap: 16px; min-height: 150px; }
.wg-step { text-align: center; }
.wg-icon { font-size: 42px; display: block; margin-bottom: 10px; }
.wg-step h3 { margin: 0 0 8px; font-size: 15px; color: var(--text); }
.wg-step p { margin: 0; font-size: 13px; line-height: 1.8; color: var(--muted); }
.wg-dots { display: flex; justify-content: center; gap: 6px; }
.wg-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(127, 127, 127, 0.3); transition: all .2s; }
.wg-dot.on { background: var(--brand); box-shadow: 0 0 8px var(--brand); width: 18px; border-radius: 4px; }
.wg-actions { display: flex; justify-content: flex-end; gap: 10px; }
.wg-skip { color: var(--muted); }
.wg-enter-active, .wg-leave-active { transition: opacity .25s; }
.wg-enter-from, .wg-leave-to { opacity: 0; }
</style>
