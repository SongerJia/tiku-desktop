// 移动端应用入口（P5）：数据层引导 + Vue 应用 打包进同一入口。
// 执行顺序：
//   1) import './boot.js'（副作用）：设置 window.capacitorBridgeReady（异步初始化 SQL.js db）
//   2) import '../src/main.js'（副作用）：Vue 应用挂载——组件数据调用经 bridge.js 等待
//      capacitorBridgeReady 后再执行，无需感知启动时序。
// Vite 以本文件为入口产出 dist-mobile 的 entry chunk，index.html 由 vite.mobile.config.js
// 的 generateBundle 插件生成（引用该 chunk 与样式表）。

import './boot.js'
import '../src/main.js'
