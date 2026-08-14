// 题图 / 听力音频的本地文件存取模块（纯文件操作，不依赖 sqlite）。
// 从 db.js 拆出：拆分模式的渐进一步，行为与原实现完全一致。
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { app, nativeImage } = require('electron')

const uuid = () => crypto.randomUUID()

// getImage 内存缓存（name → dataURL），避免列表/试卷中重复读盘转 base64。
const imageCache = new Map()
const IMAGE_CACHE_MAX = 400
function cacheImage(name, dataUrl) {
  if (imageCache.size >= IMAGE_CACHE_MAX) imageCache.clear()
  imageCache.set(name, dataUrl)
}
function clearImageCache() { imageCache.clear() }

// getAudioUrl 内存缓存（听力音频播放时重复读盘转 base64 开销大，缓存 dataURL）
const audioCache = new Map()
const AUDIO_CACHE_MAX = 100
function cacheAudio(name, dataUrl) {
  if (audioCache.size >= AUDIO_CACHE_MAX) audioCache.clear()
  audioCache.set(name, dataUrl)
}

function imageDir() { return path.join(app.getPath('userData'), 'images') }
function audioDir() { return path.join(app.getPath('userData'), 'audio') }

module.exports = {
  clearImageCache,

  ensureImageDir() {
    const dir = imageDir()
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) } catch (e) {}
    return dir
  },

  saveImage(buffer, ext = 'png') {
    const dir = imageDir()
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) } catch (e) {}
    let data = Buffer.from(buffer)
    let outExt = String(ext || 'png').replace(/[^\w]/g, '').slice(0, 6) || 'png'
    // 导入时压缩：超过最大边长则等比缩放，并按原格式重编码以显著减小体积。
    try {
      const img = nativeImage.createFromBuffer(data)
      if (!img.isEmpty()) {
        const maxSide = 1600
        const size = img.getSize()
        if (size.width > maxSide || size.height > maxSide) {
          const scale = maxSide / Math.max(size.width, size.height)
          const rs = img.resize({
            width: Math.round(size.width * scale),
            height: Math.round(size.height * scale)
          })
          data = outExt === 'png' ? rs.toPNG() : rs.toJPEG(82)
        } else if (outExt !== 'png') {
          data = img.toJPEG(82)
        }
      }
    } catch (e) { /* 解码失败则保留原始数据 */ }
    const name = uuid() + '.' + outExt
    fs.writeFileSync(path.join(dir, name), data)
    return name
  },

  getImage(name) {
    if (!name) return null
    if (imageCache.has(name)) return imageCache.get(name)
    const full = path.join(imageDir(), path.basename(String(name)))
    try {
      if (!fs.existsSync(full)) return null
      const b64 = fs.readFileSync(full).toString('base64')
      const ext = path.extname(name).slice(1).toLowerCase() || 'png'
      const dataUrl = `data:image/${ext};base64,${b64}`
      cacheImage(name, dataUrl)
      return dataUrl
    } catch (e) { return null }
  },

  // 按文件魔数识别真实音频格式（注释曾承诺"统一转 mp3"，实际从未转码——
  // 直接按真实格式命名 + 正确 mime，避免 wav/ogg/webm 等被误标 .mp3 导致播放器解码失败）
  sniffAudioExt(buf) {
    const b = buf
    if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'm4a' // ISO BMFF (ftyp)
    if (b.length >= 4) {
      if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'wav'   // RIFF....
      if (b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'ogg'   // OggS
      if (b[0] === 0x66 && b[1] === 0x4C && b[2] === 0x61 && b[3] === 0x43) return 'flac'  // fLaC
      if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'webm'  // EBML (webm/mkv)
      if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x00 && b[3] === 0x18) return 'm4a'   // ISO BMFF
    }
    if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'mp3'     // ID3 tag
    if (b.length >= 2 && b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) return 'mp3'             // MPEG frame sync
    return 'mp3' // 兜底（含未知格式，保持原行为）
  },

  // 听力音频：存 userData/audio/，按真实格式命名；库里只存文件名。
  saveAudio(buffer) {
    const dir = audioDir()
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) } catch (e) {}
    const buf = Buffer.from(buffer)
    const realExt = this.sniffAudioExt(buf)
    const name = uuid() + '.' + realExt
    fs.writeFileSync(path.join(dir, name), buf)
    return name
  },

  getAudioUrl(name) {
    if (!name) return null
    if (audioCache.has(name)) return audioCache.get(name)
    const full = path.join(audioDir(), path.basename(String(name)))
    try {
      if (!fs.existsSync(full)) return null
      const b64 = fs.readFileSync(full).toString('base64')
      const ext = path.extname(name).slice(1).toLowerCase() || 'mp3'
      const dataUrl = `data:audio/${ext};base64,${b64}`
      cacheAudio(name, dataUrl)
      return dataUrl
    } catch (e) { return null }
  }
}
