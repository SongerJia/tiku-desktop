// 零依赖 ZIP 生成器（STORE 无压缩）：图片/音频/PDF 本身已是压缩格式，STORE 足够。
// 用法：makeZip([{ path: 'images/a.png', data: Buffer }, ...]) → Buffer（标准 ZIP，可被资源管理器/解压工具打开）
// P5：zlib 从 platform 取（Electron=node zlib 含 crc32；APK=pako shim + 手写 crc32）
const zlib = (require('./platform').platform.zlib) || require('zlib')

function crc32(buf) {
  return (zlib.crc32(buf) >>> 0)
}

function makeZip(files) {
  const chunks = []
  const central = []
  let offset = 0

  for (const f of files) {
    if (!f || !f.path) continue
    const nameBuf = Buffer.from(f.path, 'utf8')
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data || '')
    const crc = crc32(data)

    // 本地文件头
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed to extract
    local.writeUInt16LE(0x0800, 6) // UTF-8 flag
    local.writeUInt16LE(0, 8) // method: store
    local.writeUInt16LE(0, 10) // mod time
    local.writeUInt16LE(0x21, 12) // mod date 1980-01-01
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    chunks.push(local, nameBuf, data)

    // 中央目录条目
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(0, 10)
    cen.writeUInt16LE(0, 12)
    cen.writeUInt16LE(0x21, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(data.length, 20)
    cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt16LE(0, 30) // extra
    cen.writeUInt16LE(0, 32) // comment
    cen.writeUInt16LE(0, 34) // disk
    cen.writeUInt16LE(0, 36) // internal attrs
    cen.writeUInt32LE(0, 38) // external attrs
    cen.writeUInt32LE(offset, 42)
    central.push(cen, nameBuf)

    offset += 30 + nameBuf.length + data.length
  }

  const centralSize = central.reduce((s, b) => s + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, ...central, eocd])
}

module.exports = { makeZip }
