// 覆盖层统一 Esc 关闭
import { onMounted, onUnmounted } from 'vue'

export function useEsc(fn) {
  const h = (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') fn()
  }
  onMounted(() => window.addEventListener('keydown', h))
  onUnmounted(() => window.removeEventListener('keydown', h))
}
