// 弹窗焦点管理（Focus Trap）：Tab 循环圈定在弹窗面板内，防焦点逃逸到背景
// 用法：useFocusTrap(active, '.km-panel')  // active 可为 ref 或 getter；selector 为面板选择器（null 则跳过）
// 行为：打开记录打开前焦点 → 聚焦面板首个可聚焦元素 → Tab/Shift+Tab 在面板内循环 → 关闭/卸载还原焦点
import { watch, onUnmounted, nextTick } from 'vue'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(active, panelSelector) {
  let prevFocus = null
  let cleanup = null

  function resolvePanel() {
    return typeof panelSelector === 'function' ? panelSelector() : (panelSelector ? document.querySelector(panelSelector) : null)
  }

  function onKeydown(e) {
    if (e.key !== 'Tab') return
    const panel = resolvePanel()
    if (!panel) return
    const els = panel.querySelectorAll(FOCUSABLE)
    if (!els.length) return
    const first = els[0]
    const last = els[els.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  function engage() {
    prevFocus = document.activeElement
    cleanup = () => { window.removeEventListener('keydown', onKeydown, true) }
    window.addEventListener('keydown', onKeydown, true)
  }

  function release() {
    if (cleanup) { cleanup(); cleanup = null }
    // 清理弹窗无可聚焦元素时设置的临时 tabindex（避免残留污染 DOM）
    if (panelSelector && typeof panelSelector === 'string') {
      const panel = document.querySelector(panelSelector)
      if (panel && panel.getAttribute('data-trap-tabindex') === '1') {
        panel.removeAttribute('tabindex')
        panel.removeAttribute('data-trap-tabindex')
      }
    }
    if (prevFocus && prevFocus.focus && document.body.contains(prevFocus)) prevFocus.focus()
    prevFocus = null
  }

  watch(active, async (v) => {
    if (v) {
      engage()
      await nextTick()
      const panel = resolvePanel()
      if (panel) {
        const first = panel.querySelector(FOCUSABLE)
        if (first) first.focus()
        else if (panel.focus) { panel.setAttribute('tabindex', '-1'); panel.setAttribute('data-trap-tabindex', '1'); panel.focus() }
      }
    } else {
      release()
    }
  }, { immediate: true })

  onUnmounted(release)
}
