// 外观应用工具：从 settings 读取主题/字号并写入 documentElement。
// 浅色主题靠 [data-theme="light"] 覆盖 CSS 变量；字号用根元素 zoom 整体缩放。
import { tiku } from '../api/tiku.js'

export async function applyAppearance() {
  let theme = 'dark'
  let fontScale = '1'
  try {
    theme = await tiku.getSetting('theme') || 'dark'
    fontScale = await tiku.getSetting('font_scale') || '1'
  } catch (e) { /* settings 读取失败则用暗色默认 */ }
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark')
  const z = parseFloat(fontScale)
  document.documentElement.style.zoom = (z && z > 0) ? z : 1
}
