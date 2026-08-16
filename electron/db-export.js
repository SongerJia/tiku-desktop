// 导出/工具模块：错题本/笔记 Markdown 导出、_writeExport、孤儿图片清理。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite/LOCAL_USER；
// _writeExport 为内部辅助，方法互调走 this（合并后 this=api）。
// P4a：平台能力从 platform 单例取。
const { platform } = require('./platform')
const path = platform.path
const fs = platform.fs
const app = { getPath: () => platform.userDataDir() }

module.exports = function exportModule(ctx) {
  const { sqlite, LOCAL_USER } = ctx

  return {
    exportWrongBookMarkdown() {
      const rows = sqlite.prepare(`SELECT q.stem, q.type, q.analysis, q.category_id, c.name AS cat, wb.wrong_count
        FROM wrong_books wb JOIN questions q ON q.id=wb.question_id
        LEFT JOIN categories c ON c.id=q.category_id
        WHERE wb.user_id=? AND wb.status='wrong' AND wb.deleted=0 AND q.deleted=0
        ORDER BY c.name, q.id`).all(LOCAL_USER)
      const lines = ['# 错题本导出', '']
      if (!rows.length) lines.push('_暂无错题_', '')
      rows.forEach((r, i) => {
        lines.push(`## ${i + 1}. ${r.stem}`)
        if (r.cat) lines.push(`**科目/章节**：${r.cat}　**错次**：${r.wrong_count}`)
        if (r.analysis) lines.push(`**解析**：${r.analysis}`)
        lines.push('')
      })
      return this._writeExport('错题本', lines.join('\n'))
    },

    exportNotesMarkdown() {
      const rows = sqlite.prepare(`SELECT n.content, q.stem, c.name AS cat
        FROM notes n LEFT JOIN questions q ON q.id=n.question_id
        LEFT JOIN categories c ON c.id=q.category_id
        WHERE n.user_id=? AND n.deleted=0 AND TRIM(IFNULL(n.content,''))<>''
        ORDER BY n.created_at DESC`).all(LOCAL_USER)
      const lines = ['# 笔记导出', '']
      if (!rows.length) lines.push('_暂无笔记_', '')
      rows.forEach((r, i) => {
        lines.push(`## ${i + 1}. ${r.stem || '（独立笔记）'}`)
        if (r.cat) lines.push(`**科目/章节**：${r.cat}`)
        lines.push(r.content, '')
      })
      return this._writeExport('笔记', lines.join('\n'))
    },

    _writeExport(prefix, content) {
      const dir = path.join(app.getPath('userData'), 'exports')
      try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) } catch (e) {}
      // 时间戳精确到秒，同日多次导出不互相覆盖
      const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now() % 86400000).padStart(5, '0')
      const file = path.join(dir, `${prefix}-${ts}.md`)
      fs.writeFileSync(file, content, 'utf8')
      return file
    },

    // 回收孤儿图片：删除 userData/images 中不被任何题目 images_json 引用的文件。
    // 默认只统计「未删除题目」引用的图（软删题目仍可恢复，其图保留）；
    // opts.includeSoftDeleted=true 时连软删题目的图也视为可回收（用于彻底清空）。
    cleanupOrphanImages(opts = {}) {
      const dir = path.join(app.getPath('userData'), 'images')
      if (!fs.existsSync(dir)) return { removed: 0, freedBytes: 0 }
      const files = fs.readdirSync(dir).filter(f => {
        try { return fs.statSync(path.join(dir, f)).isFile() } catch (e) { return false }
      })
      if (!files.length) return { removed: 0, freedBytes: 0 }
      const used = new Set()
      const collect = `SELECT images_json FROM questions WHERE images_json IS NOT NULL AND images_json<>'[]'${opts.includeSoftDeleted ? '' : ' AND deleted=0'}`
      sqlite.prepare(collect).all().forEach(r => {
        try { JSON.parse(r.images_json || '[]').forEach(n => used.add(path.basename(String(n)))) } catch (e) {}
      })
      let removed = 0, freedBytes = 0
      for (const f of files) {
        if (used.has(f)) continue
        const full = path.join(dir, f)
        try {
          const st = fs.statSync(full)
          fs.unlinkSync(full)
          removed++; freedBytes += st.size
        } catch (e) {}
      }
      return { removed, freedBytes }
    },

    // 回收孤儿听力音频：删除 userData/audio 中不被任何未删除题目 audio_url 引用的文件
    // （与 cleanupOrphanImages 同口径：软删题目音频保留，可恢复）
    cleanupOrphanAudio(opts = {}) {
      const dir = path.join(app.getPath('userData'), 'audio')
      if (!fs.existsSync(dir)) return { removed: 0, freedBytes: 0 }
      const files = fs.readdirSync(dir).filter(f => {
        try { return fs.statSync(path.join(dir, f)).isFile() } catch (e) { return false }
      })
      if (!files.length) return { removed: 0, freedBytes: 0 }
      const used = new Set()
      const collect = `SELECT audio_url FROM questions WHERE audio_url IS NOT NULL AND audio_url<>''${opts.includeSoftDeleted ? '' : ' AND deleted=0'}`
      sqlite.prepare(collect).all().forEach(r => {
        if (r.audio_url) used.add(path.basename(String(r.audio_url)))
      })
      // 记忆卡真人发音音频也存 userData/audio（cards.audio_url 引用），不收集会被误删
      const cardCollect = `SELECT audio_url FROM cards WHERE audio_url IS NOT NULL AND audio_url<>''${opts.includeSoftDeleted ? '' : ' AND deleted=0'}`
      sqlite.prepare(cardCollect).all().forEach(r => {
        if (r.audio_url) used.add(path.basename(String(r.audio_url)))
      })
      let removed = 0, freedBytes = 0
      for (const f of files) {
        if (used.has(f)) continue
        const full = path.join(dir, f)
        try {
          const st = fs.statSync(full)
          fs.unlinkSync(full)
          removed++; freedBytes += st.size
        } catch (e) {}
      }
      return { removed, freedBytes }
    }
  }
}
