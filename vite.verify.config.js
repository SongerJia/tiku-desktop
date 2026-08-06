// 仅用于「校验渲染层能否编译」的临时配置：不挂 electron 插件，
// 输出到独立目录，避免和 npm run build 的产物互相占用。
// 用法：node node_modules/vite/bin/vite.js build --config vite.verify.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  logLevel: 'info',
  build: {
    outDir: '.verify-out',
    emptyOutDir: true,
    write: false          // 只编译不落盘，纯语法/模板校验
  }
})
