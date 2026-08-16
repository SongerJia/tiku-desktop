// 外观应用工具：从 settings 读取主题/字号并写入 documentElement。
// 主题支持 dark / light / eye（护眼绿）；字号用根元素 zoom 整体缩放。
// 双写 localStorage（index.html 首帧内联脚本同步读取），保证下次启动首帧即正确主题、无闪变。
import { tiku } from '../api/tiku.js'

const VALID_THEMES = ['light', 'eye']

export async function applyAppearance() {
  let theme = 'dark'
  let fontScale = '1'
  try {
    theme = await tiku.getSetting('theme') || 'dark'
    fontScale = await tiku.getSetting('font_scale') || '1'
  } catch (e) { /* settings 读取失败则用暗色默认 */ }
  const t = VALID_THEMES.includes(theme) ? theme : 'dark'
  try {
    localStorage.setItem('tiku_theme', t)
    localStorage.setItem('tiku_font_scale', fontScale)
  } catch (e) { /* 存储失败不影响本次应用 */ }
  document.documentElement.setAttribute('data-theme', t)
  // 字号缩放：根元素 zoom 整体缩放。范围限制 0.85~1.20（之前 0.8~1.4 过大触发溢出）。
  // 移动端也应用 zoom——之前 P6 第四轮因 .app 装饰背景 fixed 异常禁用，第七轮已去背景，安全。
  const z = parseFloat(fontScale)
  const applied = (z && z > 0) ? Math.min(1.20, Math.max(0.85, z)) : 1
  document.documentElement.style.zoom = applied
}
