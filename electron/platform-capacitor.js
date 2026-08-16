// WebView 平台 shim（P4b）：APK 端替代 electron/Node 内置模块，供 db 层 platform 单例注入。
// 提供：userDataDir / fs(内存文件系统，SQL.js 驱动落盘用) / path / crypto(WebCrypto) / nativeImage(空)
// fs 用内存 Map 模拟（SQL.js 是内存库 + persist 导出字节；图片/音频文件在 APK 端走 Capacitor Filesystem 插件，
// 但为了 db 层 API 兼容，这里提供内存 fs 实现，真实落盘由上层 persist 到 Capacitor 目录）。

// ---- path shim（Node path 的常用子集）----
const pathShim = {
  join(...parts) {
    return parts.filter(p => p != null && p !== '').join('/').replace(/\/+/g, '/')
  },
  basename(p, ext) {
    let b = String(p || '').split('/').pop().split('\\').pop()
    if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length)
    return b
  },
  extname(p) {
    const b = String(p || '').split('/').pop().split('\\').pop()
    const i = b.lastIndexOf('.')
    return i > 0 ? b.slice(i) : ''
  },
  dirname(p) {
    const s = String(p || '').split('/')
    s.pop()
    return s.join('/') || '.'
  },
  resolve(p) { return String(p || '') },
  sep: '/',
  delimiter: ':',
  normalize(p) { return String(p || '').replace(/\/+/g, '/') }
}

// ---- Buffer polyfill（WebView 无 Node Buffer；db 层 base64/utf8 转换、byte 包装依赖它）----
// 提供 Buffer.from(utf8/base64/Uint8Array) 与 .toString('base64'|'utf8')，Uint8Array 子类保持兼容。
function installBufferPolyfill() {
  if (typeof globalThis.Buffer !== 'undefined') return
  const hasTextEncoder = typeof TextEncoder !== 'undefined'
  const hasTextDecoder = typeof TextDecoder !== 'undefined'
  function toBase64(u8) {
    let bin = ''
    const chunk = 0x8000
    for (let i = 0; i < u8.length; i += chunk) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk))
    }
    return btoa(bin)
  }
  function fromBase64(b64) {
    const bin = atob(String(b64 || '').replace(/\s+/g, ''))
    const u8 = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    return u8
  }
  class BufferPoly extends Uint8Array {
    static from(input, encoding) {
      if (typeof input === 'string') {
        if (encoding === 'base64') return new BufferPoly(fromBase64(input))
        if (hasTextEncoder) return new BufferPoly(new TextEncoder().encode(input))
        return new BufferPoly(Uint8Array.from([...input].map(c => c.charCodeAt(0) & 0xff)))
      }
      if (input instanceof Uint8Array) return new BufferPoly(input)
      if (input instanceof ArrayBuffer) return new BufferPoly(new Uint8Array(input))
      if (Array.isArray(input)) return new BufferPoly(Uint8Array.from(input))
      throw new Error('Buffer.from: 不支持的输入类型')
    }
    static isBuffer(x) { return x instanceof Uint8Array }
    static concat(list, total) {
      const u8 = Uint8Array.from(list.reduce((a, b) => a.concat(Array.from(b)), []))
      return new BufferPoly(u8.slice(0, total || u8.length))
    }
    toString(encoding) {
      if (encoding === 'base64') return toBase64(this)
      if (hasTextDecoder) return new TextDecoder().decode(this)
      return String.fromCharCode.apply(null, this)
    }
    slice(...a) { return new BufferPoly(super.slice(...a)) }
    subarray(...a) { return new BufferPoly(super.subarray(...a)) }
  }
  globalThis.Buffer = BufferPoly
}

// ---- 内存文件系统（SQL.js 驱动 persist/export 用；key 为绝对路径，值 Uint8Array）----
function createMemoryFs(rootPrefix) {
  installBufferPolyfill() // 确保字节可 base64/utf8 转换（db 层 readFileSync().toString('base64') 依赖）
  const files = new Map() // path -> Uint8Array
  const dirs = new Set([rootPrefix])
  const norm = (p) => {
    const s = String(p || '')
    // 已是 rootPrefix 下绝对路径则直接用（避免 '/data/tiku.db' 被 join 成 '/data/data/tiku.db'）
    if (s === rootPrefix || s.startsWith(rootPrefix + '/')) return s
    return pathShim.join(rootPrefix, s)
  }
  const parentOf = (p) => { const s = p.split('/'); s.pop(); return s.join('/') }
  const ensureDirs = (p) => {
    let cur = rootPrefix
    const parts = p.slice(rootPrefix.length).split('/').filter(Boolean)
    parts.pop() // 最后一段是文件名
    for (const seg of parts) { cur += '/' + seg; dirs.add(cur) }
  }
  return {
    existsSync(p) { return files.has(norm(p)) || dirs.has(norm(p)) },
    mkdirSync(p, opts) { ensureDirs(norm(p)); if (opts && opts.recursive) dirs.add(norm(p)); },
    readFileSync(p) {
      const v = files.get(norm(p))
      if (v === undefined) return undefined
      // 统一包装成 Buffer 兼容对象：db 层常直接 .toString('base64')/'utf8'，普通 Uint8Array 没有该方法
      return (typeof globalThis.Buffer !== 'undefined' && globalThis.Buffer.from) ? globalThis.Buffer.from(v) : v
    },
    writeFileSync(p, data) {
      const full = norm(p)
      ensureDirs(full)
      files.set(full, data instanceof Uint8Array ? data : new Uint8Array(data))
    },
    readdirSync(p) {
      const base = norm(p)
      const seen = new Set()
      for (const f of files.keys()) {
        if (f.startsWith(base + '/')) {
          const rest = f.slice(base.length + 1).split('/')[0]
          if (rest) seen.add(rest)
        }
      }
      for (const d of dirs) {
        if (d.startsWith(base + '/')) {
          const rest = d.slice(base.length + 1).split('/')[0]
          if (rest) seen.add(rest)
        }
      }
      return [...seen]
    },
    statSync(p) {
      const full = norm(p)
      if (files.has(full)) return { size: files.get(full).length, mtimeMs: 0, isFile: () => true }
      if (dirs.has(full)) return { size: 0, mtimeMs: 0, isFile: () => false }
      throw new Error('ENOENT: ' + p)
    },
    unlinkSync(p) { files.delete(norm(p)) },
    renameSync(a, b) { const v = files.get(norm(a)); if (v !== undefined) { files.delete(norm(a)); files.set(norm(b), v) } },
    copyFileSync(a, b) { const v = files.get(norm(a)); if (v !== undefined) files.set(norm(b), v.slice()) },
    // 供上层持久化：导出全部字节
    _dump() {
      const out = {}
      for (const [k, v] of files) out[k] = v
      return out
    },
    _load(entries) {
      files.clear()
      for (const [k, v] of Object.entries(entries || {})) {
        files.set(k, v instanceof Uint8Array ? v : new Uint8Array(v))
      }
    }
  }
}

// ---- crypto shim（WebCrypto 提供 randomUUID；同步 API 用兜底）----
const cryptoShim = {
  randomUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
  },
  createHash() { throw new Error('crypto.createHash 需由 Capacitor 桥提供（同步指纹走 db 层 hex 缓存）') },
  // 提供同步 hex 指纹的简单实现（用于 hash 去重，非安全场景）
  _simpleHash(str) {
    let h = 2166136261
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
    return (h >>> 0).toString(16).padStart(8, '0')
  }
}

// ---- 组装 APK 平台实现（供 db 层 setPlatform 注入）----
function createCapacitorPlatform({ rootDir }) {
  const memFs = createMemoryFs(rootDir)
  return {
    userDataDir: () => rootDir,
    fs: memFs,
    path: pathShim,
    crypto: cryptoShim,
    nativeImage: null, // APK 跳过图片压缩（存原始字节）
    isElectron: false
  }
}

module.exports = { createCapacitorPlatform, createMemoryFs, pathShim }
