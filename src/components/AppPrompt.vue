<script setup>
// 全局输入弹层（替代 window.prompt）：Teleport 到 body，脱离组件树；自动聚焦 + Enter 确定 + Esc 取消
import { ref, watch, nextTick } from 'vue'
import { promptState, resolvePrompt } from '../utils/prompt.js'

const val = ref('')
const inputEl = ref(null)

watch(() => promptState.value.show, async (v) => {
  if (!v) return
  val.value = promptState.value.value
  await nextTick()
  if (inputEl.value) inputEl.value.focus()
})

function ok() {
  resolvePrompt(val.value.trim())
}
</script>

<template>
  <Teleport to="body">
    <Transition name="pp">
      <div v-if="promptState.show" class="pp-mask" @click.self="resolvePrompt(null)">
        <div class="card pp-box">
          <h3 class="pp-title">{{ promptState.title }}</h3>
          <p v-if="promptState.msg" class="pp-msg">{{ promptState.msg }}</p>
          <input
            ref="inputEl"
            v-model="val"
            class="input pp-input"
            :placeholder="promptState.placeholder"
            maxlength="40"
            @keyup.enter="ok"
            @keydown.esc="resolvePrompt(null)"
          />
          <div class="pp-actions">
            <button class="btn" @click="resolvePrompt(null)">取消</button>
            <button class="btn btn-primary" @click="ok">确定</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.pp-mask {
  position: fixed;
  inset: 0;
  background: var(--modal-mask);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 910;
  padding: 20px;
}
.pp-box {
  width: min(380px, 90vw);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}
.pp-title { margin: 0; font-size: 15px; color: var(--text); }
.pp-msg { margin: 0; font-size: 13px; line-height: 1.7; color: var(--muted); white-space: pre-line; }
.pp-input { width: 100%; box-sizing: border-box; }
.pp-actions { display: flex; gap: 10px; justify-content: flex-end; }
.pp-actions .btn { min-width: 80px; }
.pp-enter-active, .pp-leave-active { transition: opacity .2s; }
.pp-enter-active .pp-box, .pp-leave-active .pp-box { transition: transform .2s; }
.pp-enter-from, .pp-leave-to { opacity: 0; }
.pp-enter-from .pp-box, .pp-leave-to .pp-box { transform: scale(0.94); }
</style>
