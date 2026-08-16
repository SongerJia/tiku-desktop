// 渲染层统一 API（P3）：通过跨端桥调用主进程/WebView 内 service。
// Electron：bridge → window.electronAPI（IPC → main.js → service.js → db）
// APK：     bridge → window.capacitorBridge（WebView 内直接跑 service.js + SQL.js，平台方法走插件）
// 用 Proxy 转发所有方法并统一捕获错误日志（异常会传到主进程 error.log 便于排错）。
import { bridge } from './bridge.js'

export const tiku = new Proxy({}, {
  get(_, key) {
    if (key === 'then') return undefined // 配合 Promise.resolve 兼容性
    // P5 真机修复：不做同步存在性检查——APK 分支 boot（SQL.js wasm）完成前 raw() 为空，
    // 同步判断会误判方法不存在（TypeError: xxx is not a function）。
    // 方法是否可用由 bridge.call 在等待数据层就绪后判断；不存在的调用返回 undefined（与旧行为一致）。
    return (...args) => bridge.call(key, args)
  }
})
