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

  // 听力音频：存 userData/audio/，统一转 mp3 便于播放器兼容；库里只存文件名。
  saveAudio(buffer, ext = 'mp3') {
    const dir = audioDir()
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) } catch (e) {}
    const name = uuid() + '.mp3'
    fs.writeFileSync(path.join(dir, name), Buffer.from(buffer))
    return name
  },

  getAudioUrl(name) {
    if (!name) return null
    const full = path.join(audioDir(), path.basename(String(name)))
    try {
      if (!fs.existsSync(full)) return null
      const b64 = fs.readFileSync(full).toString('base64')
      const ext = path.extname(name).slice(1).toLowerCase() || 'mp3'
      return `data:audio/${ext};base64,${b64}`
    } catch (e) { return null }
  }
}
