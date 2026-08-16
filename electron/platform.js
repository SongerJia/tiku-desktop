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

let _userDataDir = null
let _fs = nodeFs
let _path = nodePath
let _crypto = nodeCrypto
let _zlib = nodeZlib
let _nativeImage = null
let _isElectron = false

try {
  // 注意：纯 Node 下 require('electron') 不会抛错（npm 包仅导出二进制路径字符串），
  // 必须校验 app/nativeImage 是真实对象才算 Electron 环境。
  const electron = require('electron')
  const { app, nativeImage } = (electron && typeof electron === 'object') ? electron : {}
  if (app && typeof app.getPath === 'function' && nativeImage) {
    _nativeImage = nativeImage
    _userDataDir = () => app.getPath('userData')
    _isElectron = true
  }
} catch (e) {
  // 非 Electron 环境（WebView/测试）：默认降级为当前目录，APK 会 setPlatform 覆盖
  _userDataDir = () => '.'
}
if (!_userDataDir) _userDataDir = () => '.' // electron 存在但无 app（纯 Node）也降级

// 单例：业务代码统一从 platform.* 取平台能力（getter 读内部变量，setPlatform 可替换）
const platform = {
  get userDataDir() { return _userDataDir },
  get fs() { return _fs },
  get path() { return _path },
  get crypto() { return _crypto },
  get zlib() { return _zlib },
  get nativeImage() { return _nativeImage },
  get isElectron() { return _isElectron }
}

// APK/测试注入自定义平台实现（部分覆盖即可；nativeImage 允许显式置 null 表示"跳过图片压缩"）
function setPlatform(overrides = {}) {
  if (overrides.userDataDir) _userDataDir = overrides.userDataDir
  if (overrides.fs) _fs = overrides.fs
  if (overrides.path) _path = overrides.path
  if (overrides.crypto) _crypto = overrides.crypto
  if (overrides.zlib) _zlib = overrides.zlib
  if ('nativeImage' in overrides) _nativeImage = overrides.nativeImage
  if (typeof overrides.isElectron === 'boolean') _isElectron = overrides.isElectron
}

module.exports = { platform, setPlatform }
