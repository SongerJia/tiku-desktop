// 首帧主题预应用：从 localStorage 同步读取上次主题/字号（utils/appearance.js 会双写），
// 避免浅色主题用户启动时先渲染默认暗色再跳变（启动闪变）。
// 独立文件加载（CSP script-src 'self'，不用内联脚本）
(function () {
  try {
    var t = localStorage.getItem('tiku_theme')
    if (t !== 'light' && t !== 'eye') t = 'dark'
    document.documentElement.setAttribute('data-theme', t)
    // P6：移动端（<820px）禁用 zoom 字号缩放（整体缩放界面会破坏响应式 + 引发横向滑动条）
    if (window.innerWidth >= 820) {
      var z = parseFloat(localStorage.getItem('tiku_font_scale'))
      if (z && z > 0) document.documentElement.style.zoom = z
    }
  } catch (e) {}
})()
