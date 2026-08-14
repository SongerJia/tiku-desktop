import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
// 精致本地字体：英文/数字 Inter，中文 思源黑体 Noto Sans SC（离线可用）
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/500.css'
import '@fontsource/noto-sans-sc/700.css'

// 全局错误兜底：任何未被业务代码捕获的异常（IPC 调用 reject、渲染层崩溃等）
// 都会在这里弹出一个可读的错误浮层，避免 SQL 错误静默失败、
// 只出现在 devtools。固定深色卡片 + 白字，深浅主题下都清晰。
;(function installGlobalErrorGuard() {
  let lastKey = ''
  let lastAt = 0
  function reportError(err) {
    const e = err && err.error ? err.error : err
    const msg = (e && (e.stack || e.message)) || String(err)
    const now = Date.now()
    const key = String(msg).slice(0, 200)
    if (key === lastKey && now - lastAt < 3000) return // 3s 内相同错误去重
    lastKey = key
    lastAt = now
    showErrorOverlay(msg)
  }
  function showErrorOverlay(msg) {
    let box = document.getElementById('global-error-overlay')
    if (!box) {
      box = document.createElement('div')
      box.id = 'global-error-overlay'
      box.setAttribute('style',
        'position:fixed;right:16px;bottom:16px;max-width:min(420px,92vw);z-index:99999;' +
        'background:#1c2330;color:#eef2f8;border:1px solid #3a4658;border-radius:12px;' +
        'box-shadow:0 12px 40px rgba(0,0,0,.5);font:13px/1.5 system-ui,sans-serif;' +
        'padding:14px 16px;display:flex;flex-direction:column;gap:10px;')
      document.body.appendChild(box)
    }
    const id = 'err-' + Date.now()
    const pre = document.createElement('pre')
    pre.textContent = '⚠️ 出错了\n' + String(msg).slice(0, 600)
    pre.setAttribute('style',
      'margin:0;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto;' +
      'font:12px/1.5 ui-monospace,Consolas,monospace;color:#ffd7d7;')
    const bar = document.createElement('div')
    bar.setAttribute('style', 'display:flex;gap:8px;justify-content:flex-end;')
    const copy = document.createElement('button')
    copy.textContent = '复制'
    copy.setAttribute('style', 'background:#2b3b54;color:#eef2f8;border:1px solid #3a4658;border-radius:8px;padding:4px 12px;cursor:pointer;font-size:12px;')
    copy.onclick = () => { try { navigator.clipboard.writeText(msg) } catch (_) {} copy.textContent = '已复制' }
    const close = document.createElement('button')
    close.textContent = '关闭'
    close.setAttribute('style', 'background:transparent;color:#9fb0c8;border:1px solid #3a4658;border-radius:8px;padding:4px 12px;cursor:pointer;font-size:12px;')
    close.onclick = () => box.remove()
    bar.appendChild(copy)
    bar.appendChild(close)
    box.innerHTML = ''
    box.appendChild(pre)
    box.appendChild(bar)
  }
  window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason))
  window.addEventListener('error', (ev) => reportError(ev))
  window.__reportError = reportError
})()

const app = createApp(App)
// 接住 Vue 渲染/setup 阶段的未捕获异常，复用本文件已安装的全局错误浮层，避免白屏
app.config.errorHandler = (err) => {
  if (typeof window !== 'undefined' && window.__reportError) window.__reportError(err)
  else console.error('[vue-error]', err)
}
app.mount('#app')
