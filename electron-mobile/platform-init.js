// 平台注入（P4b，必须最先被加载）：
// 在 boot.js 的静态 import 链中作为第一个依赖求值，顶层立即 setPlatform 注入 Capacitor shim，
// 保证后续 db.js/db-assets.js 等模块求值时（它们模块顶层解构 platform.fs/path/crypto 快照）
// 拿到的已是 Capacitor 内存 fs，而非 Node 内建模块（WebView 内不存在）。
import platformModule from '../electron/platform'
import capacitorModule from '../electron/platform-capacitor'

const { setPlatform } = platformModule
const { createCapacitorPlatform } = capacitorModule

// 与 boot.js 保持同一常量：数据根目录 + SQL.js 库文件（内存 fs key 前缀）
setPlatform(createCapacitorPlatform({ rootDir: '/data' }))
