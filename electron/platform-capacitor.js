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
  isAbsolute(p) { return /^[a-zA-Z]:[\\/]|^\//.test(String(p || '')) },
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

// ---- 同步 SHA-1 / SHA-256（纯 JS，WebView 无 node crypto；db 层 createHash 依赖）----
// 标准算法实现，用于内容指纹（db-kb sha1、db-sync/runner sha256），非安全敏感场景但需跨端一致。

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])
function sha256Sync(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const bitLenHi = Math.floor(bytes.length / 536870912)
  const bitLenLo = (bytes.length << 3) >>> 0
  const paddedLen = (((bytes.length + 8) >> 6) + 1) << 6
  const m = new Uint8Array(paddedLen)
  m.set(bytes)
  m[bytes.length] = 0x80
  const dv = new DataView(m.buffer)
  dv.setUint32(paddedLen - 8, bitLenHi)
  dv.setUint32(paddedLen - 4, bitLenLo)
  const w = new Uint32Array(64)
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3)
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('')
}

function sha1Sync(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const bitLen = bytes.length * 8
  const paddedLen = (((bytes.length + 8) >> 6) + 1) << 6
  const m = new Uint8Array(paddedLen)
  m.set(bytes)
  m[bytes.length] = 0x80
  const dv = new DataView(m.buffer)
  dv.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000))
  dv.setUint32(paddedLen - 4, bitLen >>> 0)
  const w = new Uint32Array(80)
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4)
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let i = 0; i < 80; i++) {
      let f, k
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999 }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1 }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc }
      else { f = b ^ c ^ d; k = 0xca62c1d6 }
      const tmp = (rotl(a, 5) + f + e + k + w[i]) >>> 0
      e = d; d = c; c = rotl(b, 30); b = a; a = tmp
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0
  }
  return [h0, h1, h2, h3, h4].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('')
}

// ---- crypto shim（WebCrypto 提供 randomUUID；createHash 用上方纯 JS 同步实现）----
const cryptoShim = {
  randomUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
  },
  createHash(alg) {
    const fn = String(alg).toLowerCase() === 'sha1' ? sha1Sync : sha256Sync
    return {
      update(buf) { this._buf = buf instanceof Uint8Array ? buf : new Uint8Array(buf); return this },
      digest(enc) {
        const hex = fn(this._buf || new Uint8Array(0))
        return enc === 'hex' ? hex : new TextEncoder().encode(hex)
      }
    }
  },
  // 提供同步 hex 指纹的简单实现（用于 hash 去重，非安全场景）
  _simpleHash(str) {
    let h = 2166136261
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
    return (h >>> 0).toString(16).padStart(8, '0')
  }
}

// ---- zlib shim（WebView 无 node zlib；xlsx-lite/zip.js/sync 的 deflate/inflate/crc32 依赖）----
// 接口与 node zlib 同步 API 对齐：inflateRawSync/deflateRawSync/gzipSync/gunzipSync/crc32
function createZlibShim() {
  let pako = null
  try { pako = require('pako') } catch (e) { pako = null }
  function crc32(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    let crc = 0xFFFFFFFF
    for (let i = 0; i < u8.length; i++) {
      let c = (crc ^ u8[i]) & 0xFF
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      crc = (crc >>> 8) ^ c
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
  }
  const toBuf = (u8) => (typeof globalThis.Buffer !== 'undefined' && globalThis.Buffer.from) ? globalThis.Buffer.from(u8) : u8
  return {
    inflateRawSync: (d) => toBuf(pako ? pako.inflateRaw(d) : new Uint8Array(0)),
    deflateRawSync: (d, opts) => toBuf(pako ? pako.deflateRaw(d, opts) : new Uint8Array(0)),
    gzipSync: (d) => toBuf(pako ? pako.gzip(d) : new Uint8Array(0)),
    gunzipSync: (d) => toBuf(pako ? pako.ungzip(d) : new Uint8Array(0)),
    crc32
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
    zlib: createZlibShim(),
    nativeImage: null, // APK 跳过图片压缩（存原始字节）
    isElectron: false
  }
}

module.exports = { createCapacitorPlatform, createMemoryFs, pathShim }
