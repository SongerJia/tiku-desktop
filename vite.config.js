import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

// Electron 主进程 + 预加载脚本由 vite-plugin-electron 构建；
// 渲染层是 Vue3（仅用 Chromium 画界面，用户看到的是独立桌面软件）。
export default defineConfig({
  plugins: [
    vue(),
    electron([
      { entry: 'electron/main.js' },
      { entry: 'electron/preload.js' }
    ]),
    renderer()
  ],
  server: {
    port: 5173,
    strictPort: false
  },
  build: {
    outDir: 'dist'
  }
})
