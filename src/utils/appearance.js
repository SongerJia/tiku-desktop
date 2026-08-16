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
  // P6 修复：字号缩放用 zoom 会「整体缩放界面」——移动端破坏响应式布局且引发横向滑动条
  // （zoom 不改布局 scrollWidth，元素超宽时滚动条仍出现）。移动端固定 zoom=1，
  // 界面始终等于手机屏幕大小；字号设置在移动端暂不缩放界面（后续可做 font-size 专项）。
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 820
  const z = parseFloat(fontScale)
  const applied = (z && z > 0 && !isMobile) ? z : 1
  document.documentElement.style.zoom = applied
}
