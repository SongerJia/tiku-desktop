// 跨端平台适配层（P4a）：把 db 层对 electron/Node 内置模块的依赖集中到单例，
// Electron 用默认实现，APK 端在 WebView 启动时 setPlatform() 注入 Capacitor shim。
//
// 接口：
//   userDataDir()          → 数据根目录（Electron: app.getPath('userData')；APK: Capacitor Filesystem 目录）
//   fs / path / crypto     → 文件系统/路径/加密（Electron: node 内置；APK: shim）
//   nativeImage            → 图片对象（Electron: 原生压缩；APK: 可空——跳过压缩直接存原始字节）
//   isElectron             → 环境标记
//
// 用法：
//   Electron:  const { platform } = require('./platform')   // 默认即 Electron 实现
//   APK:       const { platform, setPlatform } = require('./platform')
//              setPlatform(require('./platform-capacitor')) // WebView 启动最早处调用

// P4b：WebView（APK）无 Node 内建模块，顶层 require 加保护——
// 非 Node 环境置 null，boot 会 setPlatform 注入 Capacitor shim 覆盖；Electron 环境正常取值。
let nodePath = null
let nodeFs = null
let nodeCrypto = null
let nodeZlib = null
try {
  nodePath = require('path')
  nodeFs = require('fs')
  nodeCrypto = require('crypto')
  nodeZlib = require('zlib') // P5：xlsx-lite/zip.js/sync 的 deflate/inflate/crc32（APK 用 pako shim）
} catch (e) { /* 非 Node 环境：等待 setPlatform 注入 */ }

// P7 修复：Rollup/Vite 打包时会把共享模块拆分到多个 chunk（platform-init 在 chunk A，
// kb-import/db 在 chunk B），不同 chunk 引用 platform 模块会拿到各自独立的实例——
// platform-init 在 chunk A 调 setPlatform 注入 memFs，chunk B 的 platform 实例仍是
// null（db.js/kb-import.js 顶层 const fs = platform.fs 拿到 null）→ 后续 fs.existsSync 报错。
// 修复：所有状态变量挂到 globalThis 上单例化，所有 chunk 引用 platform 模块共享同一份。
const G = globalThis
const _p = G.__tikuPlatform = G.__tikuPlatform || {
  _userDataDir: null,
  _fs: nodeFs,
  _path: nodePath,
  _crypto: nodeCrypto,
  _zlib: nodeZlib,
  _nativeImage: null,
  _isElectron: false
}

try {
  // 注意：纯 Node 下 require('electron') 不会抛错（npm 包仅导出二进制路径字符串），
  // 必须校验 app/nativeImage 是真实对象才算 Electron 环境。
  const electron = require('electron')
  const { app, nativeImage } = (electron && typeof electron === 'object') ? electron : {}
  if (app && typeof app.getPath === 'function' && nativeImage) {
    _p._nativeImage = nativeImage
    _p._userDataDir = () => app.getPath('userData')
    _p._isElectron = true
  }
} catch (e) {
  // 非 Electron 环境（WebView/测试）：默认降级为当前目录，APK 会 setPlatform 覆盖
  if (!_p._userDataDir) _p._userDataDir = () => '.'
}
if (!_p._userDataDir) _p._userDataDir = () => '.' // electron 存在但无 app（纯 Node）也降级

// 单例：业务代码统一从 platform.* 取平台能力（getter 读 globalThis 单例，setPlatform 可替换）
const platform = {
  get userDataDir() { return _p._userDataDir },
  get fs() { return _p._fs },
  get path() { return _p._path },
  get crypto() { return _p._crypto },
  get zlib() { return _p._zlib },
  get nativeImage() { return _p._nativeImage },
  get isElectron() { return _p._isElectron }
}

// APK/测试注入自定义平台实现（部分覆盖即可；nativeImage 允许显式置 null 表示"跳过图片压缩"）
function setPlatform(overrides = {}) {
  if (overrides.userDataDir) _p._userDataDir = overrides.userDataDir
  if (overrides.fs) _p._fs = overrides.fs
  if (overrides.path) _p._path = overrides.path
  if (overrides.crypto) _p._crypto = overrides.crypto
  if (overrides.zlib) _p._zlib = overrides.zlib
  if ('nativeImage' in overrides) _p._nativeImage = overrides.nativeImage
  if (typeof overrides.isElectron === 'boolean') _p._isElectron = overrides.isElectron
}

// P7 修复（配套）：fs/path/crypto/zlib 导出为 Proxy（懒绑定，实时从 _p 读最新值）——
// 解决「kb-import.js 等模块顶层 const fs = platform.fs 快照时 setPlatform 尚未执行」
// 导致 fs=null 的问题。改成 const { fs } = require('./platform') 后，fs 是 Proxy，
// 每次 fs.existsSync(p) 调用都从 _p 实时读（setPlatform 之后再调就能拿到 memFs）。
function _bind(name) {
  return new Proxy({}, { get(_, k) { return _p['_' + name][k] } })
}
const fs = _bind('fs')
const path = _bind('path')
const crypto = _bind('crypto')
const zlib = _bind('zlib')

module.exports = { platform, setPlatform, fs, path, crypto, zlib }
