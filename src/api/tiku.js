// 渲染层统一 API（P3）：通过跨端桥调用主进程/WebView 内 service。
// Electron：bridge → window.electronAPI（IPC → main.js → service.js → db）
// APK：     bridge → window.capacitorBridge（WebView 内直接跑 service.js + SQL.js，平台方法走插件）
// 用 Proxy 转发所有方法并统一捕获错误日志（异常会传到主进程 error.log 便于排错）。
import { bridge } from './bridge.js'

export const tiku = new Proxy({}, {
  get(_, key) {
    if (key === 'then') return undefined // 配合 Promise.resolve 兼容性
    // 快速路径：方法存在才返回包装（不存在返回 undefined，与旧行为一致）
    if (typeof bridge.raw()[key] !== 'function') return undefined
    return (...args) => bridge.call(key, args)
  }
})
