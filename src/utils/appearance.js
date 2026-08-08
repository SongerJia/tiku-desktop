// 外观应用工具：从 settings 读取主题/字号并写入 documentElement。
// 浅色主题靠 [data-theme="light"] 覆盖 CSS 变量；字号用根元素 zoom 整体缩放。
// 双写 localStorage（index.html 首帧内联脚本同步读取），保证下次启动首帧即正确主题、无闪变。
import { tiku } from '../api/tiku.js'

export async function applyAppearance() {
  let theme = 'dark'
  let fontScale = '1'
  try {
    theme = await tiku.getSetting('theme') || 'dark'
    fontScale = await tiku.getSetting('font_scale') || '1'
  } catch (e) { /* settings 读取失败则用暗色默认 */ }
  try {
    localStorage.setItem('tiku_theme', theme === 'light' ? 'light' : 'dark')
    localStorage.setItem('tiku_font_scale', fontScale)
  } catch (e) { /* 存储失败不影响本次应用 */ }
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark')
  const z = parseFloat(fontScale)
  document.documentElement.style.zoom = (z && z > 0) ? z : 1
}
