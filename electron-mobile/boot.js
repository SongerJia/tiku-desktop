// APK WebView 启动引导（P4b）：Capacitor 环境下初始化 SQL.js db + 数据服务，暴露 window.capacitorBridge。
// 由 Vite 单独打包为浏览器 bundle（electron-mobile），Capacitor WebView 加载后执行。
//
// 契约：window.capacitorBridge = { api: { <109 个数据方法>, <18 个平台方法> } }
//   - 数据方法：直接调 service（WebView 内跑 SQL.js 驱动，见 db-driver createSqlJsDriver）
//   - 平台方法：Electron 端在 main.js，APK 端由 Capacitor 原生插件实现（P5 对齐；未实现前返回占位错误）
//
// 关键点：必须「先 setPlatform 注入 Capacitor shim，再加载 db 模块」——db.js/db-assets.js 在模块
// 顶层就解构了 platform.fs/path/crypto 快照。因此第一个 import 是副作用模块 platform-init（顶层执行
// setPlatform），随后 db 求值时 platform 已指向 Capacitor。禁止把 db 相关模块移到 platform-init 之前。

import './platform-init' // 副作用：注入平台（须保持为第一个 import）

import platformModule from '../electron/platform'
import driverModule from '../electron/db-driver'
import db from '../electron/db'
import serviceModule from '../electron/service'

const { platform } = platformModule
const { createSqlJsDriver } = driverModule
const { createDataService } = serviceModule

const isCapacitorEnv = typeof window !== 'undefined' && !!window.Capacitor

// 数据目录：WebView 沙箱内无真实 fs，用内存 fs（root = /data 前缀）
const ROOT = '/data'
const DB_FILE = '/data/tiku.db'

// 平台方法占位（P5 逐个用 Capacitor 插件实现；数据方法已全量可用）
const PLATFORM_METHODS_PLACEHOLDER = [
  'checkUpdate', 'saveImage', 'kbImportFiles', 'kbPickFiles', 'openPath',
  'restoreBackup', 'getVersion', 'openExternal', 'kbExport', 'kbOpen',
  'parseSheet', 'exportExcel', 'exportExcelTemplate', 'exportCardTemplate',
  'ghGetConfig', 'ghSaveConfig', 'ghTest', 'ghSync'
]
const platformStub = {}
for (const m of PLATFORM_METHODS_PLACEHOLDER) {
  platformStub[m] = (...args) => Promise.reject(new Error('[' + m + '] 平台方法将在 APK 集成中由原生插件提供'))
}

let bootPromise = null
let driverRef = null // 当前 SQL.js 驱动（persist 落盘用）

// 写后防抖持久化：APK 是内存库（SQL.js），不落盘杀进程即丢数据。
// 每个 api 调用后调度一次，3 秒内合并（export 全库拷贝有开销）；真实落盘（内存 fs → Capacitor
// 文件系统）在 P5 替换 driver.persist 的实现为 Capacitor 插件写入。
let persistTimer = null
function schedulePersist() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    try { if (driverRef && driverRef.persist) driverRef.persist() } catch (e) { console.error('[capacitor-bridge] persist 失败', e) }
  }, 3000)
}

async function boot() {
  if (bootPromise) return bootPromise
  bootPromise = (async () => {
    // 1) 初始化 SQL.js 驱动 + db（建表/迁移/种子/回填，与 Electron 同一套逻辑）
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
    // 3) 暴露桥
    window.capacitorBridge = {
      api: { ...api, ...platformStub },
      db, // 调试/诊断
      persist: () => { try { driverRef && driverRef.persist() } catch (e) {} } // 显式落盘（P5 接 Capacitor 文件系统）
    }
    console.log('[capacitor-bridge] 数据层就绪，方法数 =', Object.keys(dataSvc).length)
  })()
  return bootPromise
}

// 自动启动（WebView 加载即初始化；失败打日志不阻塞 UI）
if (isCapacitorEnv) {
  boot().catch(e => console.error('[capacitor-bridge] 启动失败', e))
}

export { boot }
