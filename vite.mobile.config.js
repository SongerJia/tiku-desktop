// 移动端（Capacitor WebView）构建配置（P4b）：
// 把 electron-mobile/boot.js 打包为浏览器 bundle 输出到 dist-mobile/，供 Capacitor webDir 引用。
// 与桌面 vite.config.js 隔离：不加载 Vue 插件、不打 Electron 主进程，仅生成 APK WebView 的引导脚本。
import { defineConfig } from 'vite'

export default defineConfig({
  // 入口：electron-mobile/boot.js（WebView 启动引导，初始化 SQL.js db + 暴露 window.capacitorBridge）
  build: {
    outDir: 'dist-mobile',
    emptyOutDir: true,
    lib: {
      entry: 'electron-mobile/boot.js',
      formats: ['iife'],
      name: 'TikuMobileBoot',
      fileName: () => 'boot.js'
    },
    // WebView 内不关心产物 hash（Capacitor 固定引用 boot.js）
    sourcemap: false,
    // electron/ 下的 CJS 模块（db-*.js/platform/service 等）需经 commonjs 转换才能被 Rollup 消费；
    // Vite 默认只转 node_modules，这里显式覆盖本地目录。
    commonjsOptions: {
      include: [/electron[\\/].*\.js$/, /node_modules/]
    },
    // 移动端不预构建（避免产物里出现 Node 环境分支）
    rollupOptions: {
      // Node 内建/原生模块不进 bundle：WebView 运行时无 require，全部由 platform 层 try/catch
      // 兜底降级（Electron 主进程/桌面端不受影响，仍用原生打包流程）。
      external: ['better-sqlite3', 'electron', 'fs', 'path', 'crypto', 'os', 'util', 'events', 'stream', 'buffer'],
      output: {
        // sql.js 是 CJS + wasm，体积大且只在启动期用到；保持原样注入
        inlineDynamicImports: false
      }
    }
  },
  // sql.js 的 wasm 与 WebView 启动壳（index.html）放 public-mobile/，构建时原样拷贝到产物根——
  // boot.js 用 locateFile: () => 'sql-wasm.wasm' 相对定位
  publicDir: 'public-mobile',
  optimizeDeps: {
    exclude: ['sql.js']
  },
  define: {
    // WebView 无 process（Capacitor 8 的 WebView 不注入）；sql.js 内部有少量 process 判断
    'process.env.NODE_ENV': JSON.stringify('production')
  }
})
