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
  // 字号缩放：根元素 zoom 整体缩放。范围 0.85~1.20 限幅。
  // 内容视觉铺满窗口由 mobile-sim 主进程的 applyZoom 实现：窗口按 base_size / zoom 等比放大，
  // 内容 layout 尺寸 = base_size 不变，渲染视觉 = base_size × zoom × 1/zoom = base_size（铺满窗口）。
  // 这样 zoom 0.85 → 窗口 485 宽，内容 layout 412 视觉 412 填满窗口（与手机等比缩放体验一致）。
  const z = parseFloat(fontScale)
  const applied = (z && z > 0) ? Math.min(1.20, Math.max(0.85, z)) : 1
  document.documentElement.style.zoom = applied
  document.documentElement.style.setProperty('--ui-zoom', String(applied))
}
