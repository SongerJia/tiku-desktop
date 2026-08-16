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
  // 关键：环境检测——
  //   - mobile-sim / 桌面 Electron：依赖窗口联动（窗口按 base_size/zoom 等比放大），只设 zoom
  //   - 真机 APK WebView：没有 BrowserWindow 联动，必须配合 layout 反向补偿
  //     （html/body 宽度 = 100vw/zoom，让内容视觉恒等于视口，无留空/溢出）
  // 之前 A 方案只解决 mobile-sim，导致真机 zoom<1 右侧留空（用户报"窗口变小"）。
  const z = parseFloat(fontScale)
  const applied = (z && z > 0) ? Math.min(1.20, Math.max(0.85, z)) : 1
  document.documentElement.style.zoom = applied
  document.documentElement.style.setProperty('--ui-zoom', String(applied))
  const hasWindowControl = typeof window !== 'undefined' && !!(window.electronAPI && window.electronAPI.__host)
  if (!hasWindowControl && typeof document !== 'undefined') {
    // 真机 WebView：layout 反向补偿
    const w = `calc(100vw / ${applied})`
    document.documentElement.style.width = w
    if (document.body) document.body.style.width = w
  }
}
