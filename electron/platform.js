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

const nodePath = require('path')
const nodeFs = require('fs')
const nodeCrypto = require('crypto')

let _userDataDir = null
let _fs = nodeFs
let _path = nodePath
let _crypto = nodeCrypto
let _nativeImage = null
let _isElectron = false

try {
  const { app, nativeImage } = require('electron')
  _nativeImage = nativeImage
  _userDataDir = () => app.getPath('userData')
  _isElectron = true
} catch (e) {
  // 非 Electron 环境（WebView/测试）：默认降级为当前目录，APK 会 setPlatform 覆盖
  _userDataDir = () => '.'
}

// 单例：业务代码统一从 platform.* 取平台能力（getter 读内部变量，setPlatform 可替换）
const platform = {
  get userDataDir() { return _userDataDir },
  get fs() { return _fs },
  get path() { return _path },
  get crypto() { return _crypto },
  get nativeImage() { return _nativeImage },
  get isElectron() { return _isElectron }
}

// APK/测试注入自定义平台实现（部分覆盖即可）
function setPlatform(overrides = {}) {
  if (overrides.userDataDir) _userDataDir = overrides.userDataDir
  if (overrides.fs) _fs = overrides.fs
  if (overrides.path) _path = overrides.path
  if (overrides.crypto) _crypto = overrides.crypto
  if (overrides.nativeImage) _nativeImage = overrides.nativeImage
  if (typeof overrides.isElectron === 'boolean') _isElectron = overrides.isElectron
}

module.exports = { platform, setPlatform }
