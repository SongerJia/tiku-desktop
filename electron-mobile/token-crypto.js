// GitHub token 加密落盘（APK 端，P 建议项 S1）
// WebView 无 Node crypto，使用 WebCrypto（AES-GCM 256）做"静态加密"：
//   - 密钥随机生成，base64 存于 settings.gh_key（与密文同库，属混淆级防护；
//     如需 OS 级保护可改用 @capacitor/secure-storage 存密钥到 Android Keystore）
//   - 密文格式：base64(iv) + ':' + base64(ciphertext)
// 无 WebCrypto（非安全上下文等）时降级为明文存储并告警，保证功能不中断。
// 该模块为纯 ESM、零 Capacitor 依赖，可在 node（globalThis.crypto.subtle）下单测。

const te = new TextEncoder()
const td = new TextDecoder()
const gCrypto = globalThis.crypto // Web Crypto（浏览器 WebView / Node 20+ 均提供）

function b64FromBytes(u8) {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < u8.length; i += chunk) s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk))
  return btoa(s)
}
function bytesFromB64(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''))
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

export function webCryptoAvailable() {
  // subtle 是 SubtleCrypto 对象（typeof 'object'），其方法 generateKey/encrypt/decrypt 才是函数
  return !!(gCrypto && gCrypto.subtle && typeof gCrypto.subtle.generateKey === 'function')
}

// 生成 AES-GCM 256 密钥，导出 raw 后以 base64 返回（供持久化）
export async function generateKeyB64() {
  const k = await gCrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  return b64FromBytes(new Uint8Array(await gCrypto.subtle.exportKey('raw', k)))
}

// base64 密钥 → CryptoKey
export async function importKeyB64(b64) {
  return gCrypto.subtle.importKey('raw', bytesFromB64(b64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

// 加密 token → "ivB64:ctB64"
export async function encryptToken(key, token) {
  const iv = gCrypto.getRandomValues(new Uint8Array(12))
  const ct = await gCrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(String(token || '')))
  return b64FromBytes(iv) + ':' + b64FromBytes(new Uint8Array(ct))
}

// 解密（非本格式 / 密钥不符会抛错，调用方按"明文迁移"兜底）
export async function decryptToken(key, payload) {
  const s = String(payload || '')
  if (!s.includes(':')) throw new Error('非加密格式')
  const [ivB, ctB] = s.split(':')
  const iv = bytesFromB64(ivB)
  const ct = bytesFromB64(ctB)
  const pt = await gCrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return td.decode(pt)
}
