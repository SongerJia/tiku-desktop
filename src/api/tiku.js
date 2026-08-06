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
        const r = fn(...args)
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
