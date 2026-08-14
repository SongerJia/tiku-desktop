<script setup>
import { toastMsg, toastType } from '../utils/toast.js'
</script>

<template>
  <Transition name="toast">
    <div v-if="toastMsg" class="app-toast" :class="toastType">{{ toastMsg }}</div>
  </Transition>
</template>

<style scoped>
.app-toast {
  position: fixed;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  z-index: 999;
  max-width: 84vw;
  padding: 10px 18px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  background: var(--toast-bg);
  border: 1px solid var(--line);
  color: var(--text);
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  text-align: center;
  pointer-events: none;
}
.app-toast.ok { border-color: var(--ok); color: var(--ok); }
.app-toast.err { border-color: var(--bad); color: var(--bad); }
[data-theme="light"] .app-toast.ok { color: #1a7f5c; }
[data-theme="light"] .app-toast.err { color: #c0392b; }
[data-theme="eye"] .app-toast.ok { color: #1f8a5b; }
[data-theme="eye"] .app-toast.err { color: #b8453f; }
.toast-enter-active, .toast-leave-active { transition: opacity .25s, transform .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
