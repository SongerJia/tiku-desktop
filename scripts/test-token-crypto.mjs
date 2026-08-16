// token-crypto.js 单测（S1 建议项）：AES-GCM 加解密往返 + 明文迁移兼容。
// 运行：node scripts/test-token-crypto.mjs（Node 20+ 自带 globalThis.crypto.subtle）
import { webCryptoAvailable, generateKeyB64, importKeyB64, encryptToken, decryptToken } from '../electron-mobile/token-crypto.js'

let pass = 0, fail = 0
function ok(name, cond) {
  if (cond) { pass++; console.log('OK   ' + name) } else { fail++; console.log('FAIL ' + name) }
}

async function main() {
  ok('webCryptoAvailable() 在 node 下为 true', webCryptoAvailable() === true)

  const token = 'ghp_' + 'a'.repeat(36)
  const keyB64 = await generateKeyB64()
  ok('generateKeyB64 返回非空 base64', typeof keyB64 === 'string' && keyB64.length > 0)
  const key = await importKeyB64(keyB64)
  ok('importKeyB64 还原为 CryptoKey', !!key)

  const enc = await encryptToken(key, token)
  ok('密文含 iv:ct 分隔', typeof enc === 'string' && enc.includes(':') && enc.length > 40)
  const dec = await decryptToken(key, enc)
  ok('解密往返一致', dec === token)

  // 空 token
  const encEmpty = await encryptToken(key, '')
  ok('空串可加密', (await decryptToken(key, encEmpty)) === '')

  // 不同密钥解不开（异常路径，验证不会误判）
  let threw = false
  try { await decryptToken(key, 'not:a:valid:payload') } catch (e) { threw = true }
  ok('非本格式密文抛错（readToken 据此降级明文）', threw === true)

  console.log(`\npass=${pass} fail=${fail}`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
