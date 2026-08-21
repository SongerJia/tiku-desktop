// 跨端桥接层（P3）：统一 Electron IPC 与 Capacitor 桥的调用入口。
// 前端业务代码只通过 tiku.js 调用，不感知底层：
//   - Electron：preload 暴露的 window.electronAPI（IPC → main.js → service.js → db）
//   - APK：Capacitor 注入的 window.capacitorBridge（WebView 内直接跑 service.js + SQL.js 驱动；
//          18 个平台方法走 Capacitor 原生插件）——契约与 electronAPI 同形，P4 提供实现
//
// 判定规则：window.Capacitor 存在 → Capacitor 桥；否则 Electron API。

const isCapacitor = typeof window !== 'undefined' && !!(window.Capacitor && window.Capacitor.isNativePlatform)

// APK 数据层就绪等待：boot.js 异步加载 SQL.js wasm，Vue 应用可能在就绪前调用数据方法。
// Electron 分支无此问题（preload 同步注入）。
let capReadyPromise = null
function capacitorReady() {
  if (!isCapacitor) return Promise.resolve(null)
  if (!capReadyPromise) {
    // boot.js 设置 window.capacitorBridgeReady = boot()；尚未执行到则等待其出现（罕见时序）
    capReadyPromise = new Promise((resolve, reject) => {
      if (window.capacitorBridgeReady) { window.capacitorBridgeReady.then(resolve, reject); return }
      let tries = 0
      const timer = setInterval(() => {
        if (window.capacitorBridgeReady) { clearInterval(timer); window.capacitorBridgeReady.then(resolve, reject) }
        else if (++tries > 100) { clearInterval(timer); reject(new Error('capacitorBridge 启动超时（boot.js 未加载？）')) }
      }, 100)
    })
  }
  return capReadyPromise
}

// 取底层桥对象（方法集合，与 electronAPI 同形：每个方法返回 Promise）
function getBridge() {
  if (isCapacitor) return (window.capacitorBridge && window.capacitorBridge.api) || {}
  return window.electronAPI || {}
}

// 剥 Proxy + 序列化普通对象；二进制类型（ArrayBuffer/TypedArray/Buffer）原样保留
function deepSafe(v) {
  if (v === null || v === undefined) return v
  if (typeof v !== 'object') return v
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return v
  // 处理 Vue ref（解包 value）
  if (v.__v_isRef) return deepSafe(v.value)
  // 处理 Vue reactive（尝试 JSON 序列化剥 Proxy，失败则手动拷贝）
  try { return JSON.parse(JSON.stringify(v)) } catch (e) {
    if (Array.isArray(v)) return v.map(deepSafe)
    const out = {}
    for (const k of Object.keys(v)) {
      try { out[k] = deepSafe(v[k]) } catch (e) { out[k] = null }
    }
    return out
  }
}

// 统一调用：取方法 → 剥 Proxy → 调用 → 统一错误日志
// P5：APK 分支先等待数据层就绪（boot.js 的 SQL.js wasm 加载为异步）
async function bridgeCall(key, args) {
  await capacitorReady()
  const fn = getBridge()[key]
  if (typeof fn !== 'function') return undefined
  try {
    const safe = deepSafe(args)
    const r = fn(...safe)
    if (r && typeof r.then === 'function') {
      return r.catch(e => { console.error('[tiku]', key, e); throw e })
    }
    return r
  } catch (e) {
    console.error('[tiku]', key, e)
    throw e
  }
}

// 暴露桥能力给 tiku.js（保持 Proxy 形态，业务零改动）
export const bridge = {
  get isCapacitor() { return isCapacitor },
  call: bridgeCall,
  raw: getBridge
}
