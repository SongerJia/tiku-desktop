// APK WebView 启动引导（P4b/P5）：Capacitor 环境下初始化 SQL.js db + 数据服务，
// 暴露 window.capacitorBridge（109 数据方法 + 18 平台方法）。
// 由 Vite 单独打包为浏览器 bundle（electron-mobile），Capacitor WebView 加载后执行。
//
// 契约：window.capacitorBridge = { api: { <109 个数据方法>, <18 个平台方法> }, db, persist }
//   - 数据方法：直接调 service（WebView 内跑 SQL.js 驱动，见 db-driver createSqlJsDriver）
//   - 平台方法：electron-mobile/platform-methods.js 实现（JS 直接实现 + Capacitor 原生桥）
//
// 关键点：必须「先 setPlatform 注入 Capacitor shim，再加载 db 模块」——db.js/db-assets.js 在模块
// 顶层就解构了 platform.fs/path/crypto 快照。因此第一个 import 是副作用模块 platform-init（顶层执行
// setPlatform），随后 db 求值时 platform 已指向 Capacitor。禁止把 db 相关模块移到 platform-init 之前。

import './platform-init' // 副作用：注入平台（须保持为第一个 import）

import platformModule from '../electron/platform.js'
import driverModule from '../electron/db-driver.js'
import db from '../electron/db.js'
import serviceModule from '../electron/service.js'
import { createPlatformMethods } from './platform-methods.js'

const { platform } = platformModule
const { createSqlJsDriver } = driverModule
const { createDataService } = serviceModule

const isCapacitorEnv = typeof window !== 'undefined' && !!window.Capacitor

// 数据目录：WebView 沙箱内无真实 fs，用内存 fs（root = /data 前缀）
const ROOT = '/data'
const DB_FILE = '/data/tiku.db'

let bootPromise = null
let driverRef = null // 当前 SQL.js 驱动（persist 落盘用）

// 写后防抖持久化：APK 是内存库（SQL.js），不落盘杀进程即丢数据。
// 每个 api 调用后调度一次，3 秒内合并（export 全库拷贝有开销）。
let persistTimer = null
function schedulePersist() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      if (driverRef && driverRef.persist) driverRef.persist() // 写回内存 fs（Map）
      // 兜底层落盘：优先设备文件（TikuBridge.fsWrite），localStorage 兜底，保证进程被杀后冷启动不丢数据
      if (platform && platform.fs && platform.fs._persistToStorage) platform.fs._persistToStorage().catch(e => console.warn('[capacitor-bridge] 持久化失败', e))
    } catch (e) { console.error('[capacitor-bridge] persist 失败', e) }
  }, 3000)
}

async function boot() {
  if (bootPromise) return bootPromise
  bootPromise = (async () => {
    // 1) 初始化 SQL.js 驱动 + db（建表/迁移/种子/回填，与 Electron 同一套逻辑）
    //    先尝试从设备文件（TikuBridge.fsRead）/ localStorage 还原上一会话的内存 fs（含 tiku.db），
    //    避免冷启动丢数据。_loadFromStorage 为异步（设备文件经原生桥），须 await 后再读 db。
    try { if (platform && platform.fs && platform.fs._loadFromStorage) await platform.fs._loadFromStorage() } catch (e) { console.warn('[capacitor-bridge] 还原本地存储失败', e) }
    const driver = await createSqlJsDriver({ file: DB_FILE, locateFile: () => 'sql-wasm.wasm' })
    driverRef = driver
    await db.initAsync(driver)
    // 2) 数据服务（109 个方法跨端复用），包装一层写后防抖持久化
    const dataSvc = createDataService(db)
    const api = {}
    for (const k of Object.keys(dataSvc)) {
      api[k] = (...args) => {
        const r = dataSvc[k](...args)
        if (r && typeof r.then === 'function') {
          return r.then(v => { schedulePersist(); return v })
        }
        schedulePersist()
        return r
      }
    }
    // 3) 平台方法（18 个：JS 直接实现 + Capacitor 原生桥 + 首版占位）
    const platformMethods = createPlatformMethods(db)
    // 4) 暴露桥
    window.capacitorBridge = {
      api: { ...api, ...platformMethods },
      db, // 调试/诊断
      persist: () => { try { driverRef && driverRef.persist() } catch (e) {} } // 显式落盘
    }
    console.log('[capacitor-bridge] 数据层就绪，方法数 =', Object.keys(dataSvc).length + ' 数据 + ' + Object.keys(platformMethods).length + ' 平台')
  })()
  return bootPromise
}

// 自动启动（WebView 加载即初始化；失败打日志不阻塞 UI）。
// 同时暴露 window.capacitorBridgeReady（Promise）：Vue 应用通过 bridge.js 等待数据层就绪后再调用。
if (isCapacitorEnv) {
  window.capacitorBridgeReady = boot().catch(e => {
    console.error('[capacitor-bridge] 启动失败', e)
    // 失败时把错误显示在启动页（#boot-status），无需 DevTools 即可见完整堆栈
    try {
      const el = document.getElementById('boot-status')
      if (el) {
        el.innerHTML =
          '<div style="color:#e34;font-weight:600">启动失败</div>' +
          '<div style="font-size:11px;color:#888;max-width:340px;word-break:break-all;white-space:pre-wrap;text-align:left;line-height:1.6;padding:8px 14px">' +
          ((e && (e.stack || e.message)) || String(e)).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) +
          '</div>'
      }
    } catch (err) { /* 显示失败忽略 */ }
    throw e
  })
}

export { boot }
