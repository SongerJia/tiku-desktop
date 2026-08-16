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

// 标记：这是 mobile-sim（宿主环境支持 BrowserWindow 联动），区别于真机 APK WebView
// appearance.js / theme-init.js 据此决定是否需要 layout 反向补偿（真机需要，模拟器不需要）
window.electronAPI = window.electronAPI || {}
window.electronAPI.__host = true

// 全局错误捕获：错误直接显示在页面上（无需 DevTools），方便定位
function showGlobalError(tag, err) {
  const msg = (err && (err.stack || err.message)) || String(err)
  console.error('[mobile-sim] ' + tag, msg)
  try {
    let el = document.getElementById('sim-error-banner')
    if (!el) {
      el = document.createElement('div')
      el.id = 'sim-error-banner'
      el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#7f1d1d;color:#fee2e2;font:11px/1.5 monospace;padding:8px 10px;max-height:40vh;overflow:auto;word-break:break-all;white-space:pre-wrap'
      document.documentElement.appendChild(el)
    }
    el.textContent = '[' + tag + '] ' + msg
  } catch (e) { /* 显示失败忽略 */ }
}
window.addEventListener('error', (e) => showGlobalError('页面错误', e.error || e.message))
window.addEventListener('unhandledrejection', (e) => showGlobalError('未处理 Promise 错误', e.reason))

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

// 缩放联动：document zoom 变化时通知主进程调整 BrowserWindow 尺寸（让内容视觉铺满窗口）
function notifyZoom() {
  const z = parseFloat(document.documentElement.style.zoom) || 1
  try { ipcRenderer.send('sim:zoom-changed', z) } catch (e) {}
}
setTimeout(notifyZoom, 50)
new MutationObserver(notifyZoom).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
