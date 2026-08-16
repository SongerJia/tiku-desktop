// 移动端模拟器 preload：在页面脚本执行前注入 window.Capacitor shim。
// 使 bridge.js（isNativePlatform=true → APK 分支）与 boot.js（自动 boot）生效，
// TikuBridge 插件方法走 ipcRenderer 到主进程（系统对话框真实模拟文件选择）。

const { ipcRenderer } = require('electron')

// 与真机 Capacitor.Plugins.TikuBridge 同形的插件模拟（方法均返回 Promise）
const TikuBridge = {
  kbPickFiles: (opts) => ipcRenderer.invoke('sim:kbPickFiles', opts),
  pickBackup: () => ipcRenderer.invoke('sim:pickBackup'),
  getVersion: () => ipcRenderer.invoke('sim:getVersion'),
  openExternal: (opts) => ipcRenderer.invoke('sim:openExternal', opts)
}

window.Capacitor = {
  isNativePlatform: true, // bridge.js APK 分支判定
  Plugins: { TikuBridge }
}

// 启动失败时也在控制台可见（模拟器 DevTools 里看得到）
window.addEventListener('error', (e) => {
  console.error('[mobile-sim] 页面错误:', e.message, e.filename, e.lineno)
})

// 移动端兜底：隐藏 webkit 滚动条 + 禁止页面级横向溢出
// 单独元素 overflow-x hidden 有时漏掉某些伪元素/阴影，强制 root 隐藏更稳
function injectSimGuard() {
  const s = document.createElement('style')
  s.textContent = `
    ::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
    html, body { overflow: hidden !important; overscroll-behavior: none; }
    html, body, #app { max-width: 100vw; }
  `
  ;(document.head || document.documentElement).appendChild(s)
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectSimGuard)
} else {
  injectSimGuard()
}

// 缩放联动：documentElement.style.zoom 改变时通知主进程调整 BrowserWindow 尺寸，
// 否则窗口不变 + 内容缩小 → 右侧空白（与真机/手机用户体验一致：整体等比）
function notifyZoom() {
  const z = parseFloat(document.documentElement.style.zoom) || 1
  try { ipcRenderer.send('sim:zoom-changed', z) } catch (e) {}
}
// 首次加载立即同步（启动时已设 zoom）
setTimeout(notifyZoom, 50)
// 监听 style 属性变化（appearance.js / theme-init.js 设置 zoom 时）
new MutationObserver(notifyZoom).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
