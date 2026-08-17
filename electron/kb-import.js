// 知识库文档导入共享逻辑（P5）：Electron（main.js）与 APK（boot.js）共用同一套
// 去重 → 副本落盘 → 切块 → 入库 流程，文件字节来源由各端负责：
//   Electron：渲染层选路径 → 主进程读磁盘
//   APK：原生插件（TikuBridgePlugin.kbPickFiles）返回 { name, ext, base64 } → WebView 解出字节
// 全部文件操作走 platform（Electron=node fs；APK=Capacitor 内存 fs）。

const { platform, fs, path, crypto } = require('./platform')
const { extractMd, extractPdf, uniqueRelPath } = require('./kbExtract')

// 编码自适应：中文 Windows 的 md 可能是 GBK，先严格试 UTF-8 失败回落 GBK（与渲染层 decodeText 一致）
function decodeBuf(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch (e) {
    try { return new TextDecoder('gbk').decode(buf) } catch (e2) { return buf.toString('utf8') }
  }
}

// files: [{ name, ext, data: Uint8Array }]
// target: { subjectId, categoryId }（推荐，外部已明确科目+章节）或单 id（兼容旧调用：科目/章节）
async function importKbFiles(db, files, target) {
  const dir = path.join(platform.userDataDir(), 'kb')
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) } catch (e) {}
  const results = []
  // 解析导入落点：优先用显式传入的 subjectId/categoryId（前端已同时持有父科目与章节）；
  // 单 id（旧调用）按类型判定——章节需回溯父科目补 subjectId，否则科目会丢失
  let subjectId = null
  let categoryId = null
  if (target && typeof target === 'object') {
    subjectId = target.subjectId != null ? Number(target.subjectId) : null
    categoryId = target.categoryId != null ? Number(target.categoryId) : null
  } else if (target != null) {
    const id = Number(target)
    const kind = db.categoryKind(id)
    if (kind === 'subject') {
      subjectId = id
    } else if (kind === 'chapter') {
      categoryId = id
      subjectId = db.categoryParent ? db.categoryParent(id) : null
    }
  }
  // 库中已占用 rel_path（含软删行）：去重必须同时避开磁盘文件与库记录，否则 INSERT 撞 UNIQUE(rel_path)
  const occupiedRel = new Set(db.listKbRelPaths())
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
      const rel = uniqueRelPath(dir, title, ext, occupiedRel)
      occupiedRel.add(rel)
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
      const docId = db.addKbDoc({
        title, type: ext, relPath: rel, size: raw.length, hash, blocks,
        subjectId, categoryId
      })
      results.push({ ok: true, docId, title, type: ext, blocks: blocks.length, error })
    } catch (e) {
      results.push({ ok: false, file: display, error: String((e && e.message) || e) })
    }
  }
  return results
}

module.exports = { importKbFiles, decodeBuf }
