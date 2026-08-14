// 弹窗背景滚动锁定（计数器式）：多层弹窗叠加时，全部关闭才恢复滚动
// 用法：useBodyLock(showRef) 或 useBodyLock(() => props.show)
// 说明：实际滚动容器是 .page-content（html/body 不滚动），锁它即可；找不到时兜底 body
import { watch, onUnmounted } from 'vue'

let lockCount = 0

function apply() {
  const el = document.querySelector('.page-content') || document.body
  el.style.overflow = lockCount > 0 ? 'hidden' : 'auto'
}

export function useBodyLock(active) {
  let last = false // 记录最近一次状态，卸载兜底判断用（getter 形式取不到 .value）
  watch(active, (v) => {
    last = !!v
    lockCount = Math.max(0, lockCount + (v ? 1 : -1))
    apply()
  }, { immediate: true })
  // 卸载兜底：弹窗未关闭就销毁（如切 Tab 强制重建）时释放自己的锁
  onUnmounted(() => {
    if (last) {
      lockCount = Math.max(0, lockCount - 1)
      apply()
    }
  })
}
