// 渲染层（Vue）通过 preload 暴露的 window.electronAPI 与主进程通信。
// 用 Proxy 转发所有方法并统一捕获错误日志（异常会传到主进程 error.log 便于排错）。
const raw = window.electronAPI || {}

export const tiku = new Proxy({}, {
  get(_, key) {
    if (key === 'then') return undefined // 配合 Promise.resolve 兼容性
    const fn = raw[key]
    if (typeof fn !== 'function') return undefined
    return (...args) => {
      try {
        // Vue 响应式 Proxy 无法通过 Electron IPC 的 structuredClone 跨进程传输。
        // 递归剥掉 Proxy/序列化普通对象，但 ArrayBuffer/TypedArray（文件/图片/音频字节）
        // 原样透传——structuredClone 原生支持二进制，JSON 往返会把它毁成 {}。
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
  }
})

// 剥 Proxy + 序列化普通对象；二进制类型（ArrayBuffer/TypedArray/Buffer）原样保留
function deepSafe(v) {
  if (v === null || v === undefined) return v
  if (typeof v !== 'object') return v
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return v // 二进制透传（IPC 原生支持）
  if (Array.isArray(v)) return v.map(deepSafe)
  const out = {}
  for (const k of Object.keys(v)) out[k] = deepSafe(v[k])
  return out
}
