import { ref } from 'vue'

// 响应式断点：>= 820px 视为「宽屏（PC/平板横屏）」，走左侧导航布局；
// < 820px 视为「窄屏（手机/APK）」，走底部 Tab 布局。
// 模块级单例：整个应用共享同一个 isWide，并只挂一个 resize 监听。
const BREAKPOINT = 820

const isWide = ref(typeof window !== 'undefined' ? window.innerWidth >= BREAKPOINT : false)

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    isWide.value = window.innerWidth >= BREAKPOINT
  })
}

export function useResponsive() {
  return { isWide }
}
