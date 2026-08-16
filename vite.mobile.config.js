// 移动端（Capacitor WebView）构建配置（P4b/P5）：
// 打包 Vue 应用（src/，与桌面同款 UI）+ 数据层引导（electron-mobile/boot.js），
// 输出到 dist-mobile/，供 Capacitor webDir 引用。
// 入口为 electron-mobile/app-mobile.js（boot 数据层 + Vue 挂载），
// index.html 由下方 inline 插件在 generateBundle 阶段生成（引用 entry chunk 与样式表）。
// 与桌面 vite.config.js 隔离：不加载 vite-plugin-electron，仅生成 WebView 可加载的静态资源。
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 构建后生成 WebView 入口 html：引用 entry chunk（app-mobile）与样式表。
// 不用 html 入口的原因是 Vite 多页会把 html 输出到源同层相对路径，无法落到产物根。
function mobileIndexHtmlPlugin() {
  return {
    name: 'vite-mobile-index-html',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const entryJs = Object.keys(bundle).filter(f => /app-mobile-[^.]*\.js$/.test(f))
      const css = Object.keys(bundle).filter(f => f.endsWith('.css'))
      const scripts = entryJs.map(f => `<script type="module" src="./${f}"></script>`).join('\n  ')
      const links = css.map(f => `<link rel="stylesheet" href="./${f}">`).join('\n  ')
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
  <title>知识记忆小助手</title>
  <!-- Capacitor WebView 启动壳（P5）：boot.js 初始化 SQL.js db 后暴露
       window.capacitorBridgeReady；bridge.js 在数据方法调用前等待其就绪，
       Vue 组件无需感知启动时序。移动端触控/布局适配在 P6。 -->
  <style>
    html, body, #app { margin: 0; padding: 0; height: 100%; }
    #boot-status {
      position: fixed; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 12px;
      font: 14px/1.5 system-ui, -apple-system, sans-serif; color: #888;
      background: #f5f7fb; z-index: 99999;
    }
    #boot-status .spinner {
      width: 28px; height: 28px; border: 3px solid #dbe3f0; border-top-color: #4a7dff;
      border-radius: 50%; animation: spin 0.9s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
  ${links}
</head>
<body>
  <div id="app">
    <div id="boot-status"><div class="spinner"></div><div>数据初始化中…</div></div>
  </div>
  ${scripts}
</body>
</html>
`
      this.emitFile({ type: 'asset', fileName: 'index.html', source: html })
    }
  }
}

export default defineConfig({
  plugins: [vue(), mobileIndexHtmlPlugin()],
  build: {
    outDir: 'dist-mobile',
    emptyOutDir: true,
    // WebView 内不关心产物 hash（Capacitor 固定引用 index.html）
    sourcemap: false,
    // electron/ 下的 CJS 模块（db-*.js/platform/service 等）需经 commonjs 转换才能被 Rollup 消费；
    // Vite 默认只转 node_modules，这里显式覆盖本地目录。
    commonjsOptions: {
      include: [/electron[\\/].*\.js$/, /node_modules/]
    },
    rollupOptions: {
      input: {
        'app-mobile': 'electron-mobile/app-mobile.js',
        // boot 独立入口：app-mobile 引用同一模块（Rollup 去重），产物保留可单独加载的 boot chunk，
        // 供 dist 端到端验证（node 模拟 WebView 加载 boot 部分，Vue 挂载需真实 DOM 不在 node 验证范围）
        boot: 'electron-mobile/boot.js'
      },
      // Node 内建/原生模块不进 bundle：WebView 运行时无 require，全部由 platform 层 try/catch
      // 兜底降级（Electron 主进程/桌面端不受影响，仍用原生打包流程）。
      external: ['better-sqlite3', 'electron', 'fs', 'path', 'crypto', 'os', 'util', 'events', 'stream', 'buffer'],
      output: {
        // 懒加载 chunk（pdfjs 等）相对入口定位，Capacitor assets 全量拷贝可加载
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js'
      }
    }
  },
  // sql.js 的 wasm 原样拷贝到产物根（boot.js 用 locateFile: () => 'sql-wasm.wasm' 相对定位）
  publicDir: 'public-mobile',
  optimizeDeps: {
    exclude: ['sql.js']
  },
  define: {
    // WebView 无 process（Capacitor 8 的 WebView 不注入）；sql.js 内部有少量 process 判断
    'process.env.NODE_ENV': JSON.stringify('production')
  }
})
