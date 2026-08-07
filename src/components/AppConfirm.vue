<script setup>
import { confirmState, resolveConfirm } from '../utils/confirm.js'
</script>

<template>
  <Transition name="cf">
    <div v-if="confirmState.show" class="cf-mask" @click.self="resolveConfirm(false)">
      <div class="card cf-box">
        <h3 class="cf-title">{{ confirmState.title }}</h3>
        <p class="cf-msg">{{ confirmState.msg }}</p>
        <div class="cf-actions">
          <button class="btn" @click="resolveConfirm(false)">取消</button>
          <button class="btn cf-danger" @click="resolveConfirm(true)">确定</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.cf-mask {
  position: fixed;
  inset: 0;
  background: rgba(2, 12, 24, 0.72);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 900;
  padding: 20px;
}
.cf-box {
  width: min(360px, 90vw);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 0 40px rgba(91, 124, 250, 0.12);
}
.cf-title { margin: 0; font-size: 15px; color: var(--text); }
.cf-msg { margin: 0; font-size: 13px; line-height: 1.7; color: var(--muted); white-space: pre-line; }
.cf-actions { display: flex; gap: 10px; justify-content: flex-end; }
.cf-danger {
  border-color: var(--bad);
  color: var(--bad);
  background: rgba(255, 77, 109, 0.1);
}
.cf-danger:hover { background: rgba(255, 77, 109, 0.2); box-shadow: 0 0 12px rgba(255, 77, 109, 0.25); }
.cf-enter-active, .cf-leave-active { transition: opacity .2s; }
.cf-enter-active .cf-box, .cf-leave-active .cf-box { transition: transform .2s; }
.cf-enter-from, .cf-leave-to { opacity: 0; }
.cf-enter-from .cf-box, .cf-leave-to .cf-box { transform: scale(0.94); }
</style>
