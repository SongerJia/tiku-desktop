// 首帧主题预应用：从 localStorage 同步读取上次主题/字号（utils/appearance.js 会双写），
// 避免浅色主题用户启动时先渲染默认暗色再跳变（启动闪变）。
// 独立文件加载（CSP script-src 'self'，不用内联脚本）
(function () {
  try {
    var t = localStorage.getItem('tiku_theme')
    if (t !== 'light' && t !== 'eye') t = 'dark'
    document.documentElement.setAttribute('data-theme', t)
    // 字号缩放：根 zoom。窗口跟随由 mobile-sim 处理（窗口 = base_size / zoom 让内容视觉铺满）
    var z = parseFloat(localStorage.getItem('tiku_font_scale'))
    if (z && z > 0) {
      z = Math.min(1.20, Math.max(0.85, z))
      document.documentElement.style.zoom = z
      document.documentElement.style.setProperty('--ui-zoom', String(z))
    }
  } catch (e) {}
})()
