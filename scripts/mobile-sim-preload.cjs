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
