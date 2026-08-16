// 知识库文档导入共享逻辑（P5）：Electron（main.js）与 APK（boot.js）共用同一套
// 去重 → 副本落盘 → 切块 → 入库 流程，文件字节来源由各端负责：
//   Electron：渲染层选路径 → 主进程读磁盘
//   APK：原生插件（TikuBridgePlugin.kbPickFiles）返回 { name, ext, base64 } → WebView 解出字节
// 全部文件操作走 platform（Electron=node fs；APK=Capacitor 内存 fs）。

const { platform } = require('./platform')
const path = platform.path
const fs = platform.fs
const crypto = platform.crypto
const { extractMd, extractPdf, uniqueRelPath } = require('./kbExtract')

// 编码自适应：中文 Windows 的 md 可能是 GBK，先严格试 UTF-8 失败回落 GBK（与渲染层 decodeText 一致）
function decodeBuf(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch (e) {
    try { return new TextDecoder('gbk').decode(buf) } catch (e2) { return buf.toString('utf8') }
  }
}

// files: [{ name, ext, data: Uint8Array }]
async function importKbFiles(db, files, subjectId) {
  const dir = path.join(platform.userDataDir(), 'kb')
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) } catch (e) {}
  const results = []
  for (const f of files || []) {
    const display = f && f.name ? f.name : '未知文件'
    try {
      const ext = String(f.ext || '').toLowerCase().replace('.', '')
      if (ext !== 'md' && ext !== 'pdf') {
        results.push({ ok: false, file: display, error: '仅支持 md / pdf 文档' })
        continue
      }
      const title = path.basename(display, '.' + ext)
      const raw = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data || [])
      const hash = crypto.createHash('sha1').update(raw).digest('hex')
      const dup = db.findKbDocByHash(hash)
      if (dup) {
        results.push({ ok: true, duplicated: true, docId: dup.id, title: dup.title, type: dup.type })
        continue
      }
      const rel = uniqueRelPath(dir, title, ext)
      fs.writeFileSync(path.join(dir, rel), raw)
      let blocks = []
      let error = null
      if (ext === 'md') {
        blocks = extractMd(decodeBuf(raw))
      } else {
        const r = await extractPdf(path.join(dir, rel)) // pdfjs 逐页抽文本；无文本层降级空块+error
        blocks = r.blocks || []
        error = r.error
      }
      const kind = db.categoryKind(subjectId) // 导入位置可能是科目或章节
      const docId = db.addKbDoc({
        title, type: ext, relPath: rel, size: raw.length, hash, blocks,
        subjectId: kind === 'subject' ? subjectId : null,
        categoryId: kind === 'chapter' ? subjectId : null
      })
      results.push({ ok: true, docId, title, type: ext, blocks: blocks.length, error })
    } catch (e) {
      results.push({ ok: false, file: display, error: String((e && e.message) || e) })
    }
  }
  return results
}

module.exports = { importKbFiles, decodeBuf }
