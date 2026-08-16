/**
 * xlsx-lite —— 零依赖的 Excel(.xlsx) 读写器
 *
 * 为什么不用 SheetJS：
 *   第三方 xlsx 包在部分环境装不上（网络/权限），一旦缺失整个导入导出就废了。
 *   而 .xlsx 本质只是「zip + 几个 XML」，Node 内置 zlib 就能解决 deflate，
 *   所以这里手写一份最小实现，保证功能永远可用、不受依赖安装影响。
 *
 * 支持：
 *   readXlsx(buffer)        → string[][]   （.xlsx / .xlsm，含共享字符串、内联串、数字、跳行跳列）
 *   writeXlsx(rows, opts)   → Buffer       （表头加粗、正文自动换行、列宽自适应）
 *
 * 不支持（题库场景用不到）：公式重算、图表、多工作表读取（只读第一个）、单元格样式还原。
 */

// P5：zlib 从 platform 取（Electron=node zlib；APK=platform-capacitor 的 pako shim）
const zlib = (require('./platform').platform.zlib) || require('zlib')

/* ============================== 通用工具 ============================== */

let CRC_TABLE = null
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      CRC_TABLE[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF]
  return (crc ^ -1) >>> 0
}

/** XML 实体解码（含十进制/十六进制数字实体） */
function xmlDecode(s) {
  if (s.indexOf('&') === -1) return s
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * XML 转义。
 * 关键：必须剔除 XML 1.0 非法控制字符，否则 Excel 会报「文件已损坏」——
 * 从网页或 PDF 复制题干时经常混入 \x00-\x08 这类看不见的字符。
 */
function xmlEscape(s) {
  return String(s == null ? '' : s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 列号(0基) → 字母，25 → 'Z'，26 → 'AA' */
function colName(n) {
  let s = ''
  n += 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** 单元格引用 'BC12' → 列索引(0基) 54 */
function refToCol(ref) {
  let n = 0
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i)
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64)
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96)
    else break
  }
  return n - 1
}

/* ============================== ZIP 读取 ============================== */

/**
 * 解析 zip，返回 { 文件名: Buffer }。
 * 走中央目录（而不是顺序扫本地头），这样能正确处理带数据描述符、
 * 以及 WPS/Numbers 导出时字段顺序略有差异的包。
 */
function unzip(buf) {
  // 从尾部回找 EOCD（可能带注释，最多回退 64KB）
  let eocd = -1
  const minEnd = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= minEnd; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 Excel 文件（没有找到 ZIP 结束标记）')

  let count = buf.readUInt16LE(eocd + 10)
  let cdSize = buf.readUInt32LE(eocd + 12)
  let cdOff = buf.readUInt32LE(eocd + 16)

  // ZIP64：字段被写成 0xFFFFFFFF 时要去 ZIP64 EOCD 拿真实值
  if (cdOff === 0xFFFFFFFF || count === 0xFFFF) {
    for (let i = eocd - 20; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x07064b50) {
        const z64 = Number(buf.readBigUInt64LE(i + 8))
        if (buf.readUInt32LE(z64) === 0x06064b50) {
          count = Number(buf.readBigUInt64LE(z64 + 32))
          cdSize = Number(buf.readBigUInt64LE(z64 + 40))
          cdOff = Number(buf.readBigUInt64LE(z64 + 48))
        }
        break
      }
    }
  }

  const files = {}
  let p = cdOff
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen

    if (buf.readUInt32LE(localOff) !== 0x04034b50) continue
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(dataStart, dataStart + compSize)

    try {
      files[name] = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw)
    } catch (e) {
      // 单个条目坏掉不该让整份文件读不了（例如缩略图）
      files[name] = Buffer.alloc(0)
    }
  }
  return files
}

/* ============================== 读 xlsx ============================== */

/** 解析 sharedStrings.xml → 字符串数组 */
function parseSharedStrings(xml) {
  const out = []
  if (!xml) return out
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g
  let m
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1] || ''
    // rich text 会拆成多个 <t>，需要全部拼接；<t/> 自闭合表示空串
    let text = ''
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g
    let t
    while ((t = tRe.exec(inner)) !== null) text += xmlDecode(t[1] || '')
    out.push(text)
  }
  return out
}

/** 从 workbook 关系里找出第一个工作表的路径；失败则回落到 sheet 文件名排序 */
function firstSheetPath(files) {
  const wb = files['xl/workbook.xml'] && files['xl/workbook.xml'].toString('utf8')
  const rels = files['xl/_rels/workbook.xml.rels'] && files['xl/_rels/workbook.xml.rels'].toString('utf8')
  if (wb && rels) {
    const sm = wb.match(/<sheet\b[^>]*\/?>/)
    if (sm) {
      const rid = (sm[0].match(/r:id="([^"]+)"/) || [])[1]
      if (rid) {
        const re = new RegExp('<Relationship\\b[^>]*Id="' + rid + '"[^>]*>')
        const rm = rels.match(re)
        if (rm) {
          let target = (rm[0].match(/Target="([^"]+)"/) || [])[1] || ''
          target = target.replace(/^\/xl\//, '').replace(/^\.\//, '')
          const path = target.startsWith('xl/') ? target : 'xl/' + target
          if (files[path]) return path
        }
      }
    }
  }
  const sheets = Object.keys(files)
    .filter(n => /^xl\/worksheets\/[^/]+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt((a.match(/(\d+)\.xml$/) || [])[1] || '0', 10)
      const nb = parseInt((b.match(/(\d+)\.xml$/) || [])[1] || '0', 10)
      return na - nb || a.localeCompare(b)
    })
  return sheets[0] || null
}

/**
 * 读取 .xlsx，返回二维字符串数组（只读第一个工作表）
 * @param {Buffer|Uint8Array|ArrayBuffer} input
 * @returns {string[][]}
 */
function readXlsx(input) {
  let buf
  if (Buffer.isBuffer(input)) buf = input
  else if (input instanceof ArrayBuffer) buf = Buffer.from(new Uint8Array(input))
  else buf = Buffer.from(input)

  if (buf.length < 4 || buf.readUInt16LE(0) !== 0x4b50) {
    // 'PK' 开头才是 zip；老的 .xls 是 OLE2 复合文档，这里给出明确指引
    throw new Error('这不是 .xlsx 文件。若是老版 .xls，请在 Excel 里「另存为」→ 选择 .xlsx 或 .csv 后再导入。')
  }

  const files = unzip(buf)
  const shared = parseSharedStrings(files['xl/sharedStrings.xml'] && files['xl/sharedStrings.xml'].toString('utf8'))
  const sheetPath = firstSheetPath(files)
  if (!sheetPath) throw new Error('Excel 文件里没有找到工作表')
  const xml = files[sheetPath].toString('utf8')

  const rows = []
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g
  let rm
  while ((rm = rowRe.exec(xml)) !== null) {
    const attrs = rm[1] || rm[3] || ''
    const inner = rm[2] || ''
    const rNum = parseInt((attrs.match(/\br="(\d+)"/) || [])[1] || '0', 10)
    // 行号跳跃（中间有完全空行）时补空行，保证「第 N 行」提示与 Excel 里看到的一致
    if (rNum > 0) while (rows.length < rNum - 1) rows.push([])

    const cells = []
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cm
    while ((cm = cellRe.exec(inner)) !== null) {
      const cAttr = cm[1] || ''
      const cInner = cm[2] || ''
      const ref = (cAttr.match(/\br="([A-Za-z]+\d+)"/) || [])[1]
      const type = (cAttr.match(/\bt="([^"]+)"/) || [])[1] || 'n'
      const ci = ref ? refToCol(ref) : cells.length
      while (cells.length < ci) cells.push('')

      let val = ''
      if (type === 'inlineStr') {
        let t
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g
        while ((t = tRe.exec(cInner)) !== null) val += xmlDecode(t[1] || '')
      } else {
        const vm = cInner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)
        const raw = vm ? xmlDecode(vm[1]) : ''
        if (type === 's') {
          const i = parseInt(raw, 10)
          val = Number.isFinite(i) && shared[i] != null ? shared[i] : ''
        } else if (type === 'b') {
          val = raw === '1' ? 'TRUE' : 'FALSE'
        } else if (type === 'e') {
          val = raw // 错误值如 #N/A，原样带出让用户自己看见
        } else {
          val = raw
        }
      }
      cells[ci] = val
    }
    rows.push(cells)
  }
  return rows
}

/* ============================== 写 xlsx ============================== */

const ZIP_TIME = 0        // 00:00:00
const ZIP_DATE = 20513    // 1980-01-01，固定值保证同样输入产出同样文件

function zipEntry(name, content) {
  const nameBuf = Buffer.from(name, 'utf8')
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
  const comp = zlib.deflateRawSync(data, { level: 9 })
  return { nameBuf, crc: crc32(data), size: data.length, comp }
}

function buildZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const e of entries) {
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)          // version needed
    lh.writeUInt16LE(0x0800, 6)      // UTF-8 文件名
    lh.writeUInt16LE(8, 8)           // deflate
    lh.writeUInt16LE(ZIP_TIME, 10)
    lh.writeUInt16LE(ZIP_DATE, 12)
    lh.writeUInt32LE(e.crc, 14)
    lh.writeUInt32LE(e.comp.length, 18)
    lh.writeUInt32LE(e.size, 22)
    lh.writeUInt16LE(e.nameBuf.length, 26)
    lh.writeUInt16LE(0, 28)
    locals.push(lh, e.nameBuf, e.comp)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)          // version made by
    cd.writeUInt16LE(20, 6)          // version needed
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt16LE(ZIP_TIME, 12)
    cd.writeUInt16LE(ZIP_DATE, 14)
    cd.writeUInt32LE(e.crc, 16)
    cd.writeUInt32LE(e.comp.length, 20)
    cd.writeUInt32LE(e.size, 24)
    cd.writeUInt16LE(e.nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)          // extra
    cd.writeUInt16LE(0, 32)          // comment
    cd.writeUInt16LE(0, 34)          // disk
    cd.writeUInt16LE(0, 36)          // internal attrs
    cd.writeUInt32LE(0, 38)          // external attrs
    cd.writeUInt32LE(offset, 42)
    centrals.push(cd, e.nameBuf)

    offset += 30 + e.nameBuf.length + e.comp.length
  }

  const cdBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, cdBuf, eocd])
}

const MAX_CELL = 32767   // Excel 单元格字符上限，超了会被判定文件损坏

/**
 * 生成 .xlsx
 * @param {Array<Array<any>>} rows      二维数组，第一行视为表头
 * @param {object} opts
 * @param {string} opts.sheetName       工作表名
 * @param {number[]} opts.colWidths     各列宽度（字符数）
 * @param {boolean} opts.header         首行是否加粗+冻结，默认 true
 * @returns {Buffer}
 */
function writeXlsx(rows, opts = {}) {
  const sheetName = String(opts.sheetName || 'Sheet1').replace(/[\\/*?:[\]]/g, '_').slice(0, 31)
  const useHeader = opts.header !== false
  const data = Array.isArray(rows) ? rows : []
  const maxCols = data.reduce((m, r) => Math.max(m, (r || []).length), 1)

  // 列宽：优先用传入值，否则按内容估算（中文按 2 个字符宽）
  let widths = opts.colWidths
  if (!widths) {
    widths = []
    for (let c = 0; c < maxCols; c++) {
      let w = 8
      for (let r = 0; r < Math.min(data.length, 200); r++) {
        const v = String((data[r] || [])[c] == null ? '' : (data[r] || [])[c])
        let len = 0
        for (const ch of v) len += ch.charCodeAt(0) > 255 ? 2 : 1
        w = Math.max(w, Math.min(len + 2, 60))
      }
      widths.push(w)
    }
  }

  const colsXml = '<cols>' + widths.map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>'

  const rowsXml = data.map((row, ri) => {
    const cells = (row || []).map((val, ci) => {
      const ref = colName(ci) + (ri + 1)
      const s = val == null ? '' : String(val)
      if (s === '') return ''
      // 样式：1=表头(加粗+居中)，2=正文(自动换行+顶对齐)
      const style = (useHeader && ri === 0) ? 1 : 2
      // 纯数字直接写成数值，方便在 Excel 里排序/筛选（避免"数字存为文本"的绿三角）
      if (/^-?\d+(\.\d+)?$/.test(s) && s.length < 15) {
        return `<c r="${ref}" s="${style}"><v>${s}</v></c>`
      }
      const text = s.length > MAX_CELL ? s.slice(0, MAX_CELL - 3) + '...' : s
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`
    }).join('')
    return `<row r="${ri + 1}">${cells}</row>`
  }).join('')

  const dimension = `A1:${colName(Math.max(0, maxCols - 1))}${Math.max(1, data.length)}`
  const freeze = useHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimension}"/>${freeze}${colsXml}<sheetData>${rowsXml}</sheetData></worksheet>`

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

  const entries = [
    zipEntry('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    zipEntry('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    zipEntry('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    zipEntry('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    zipEntry('xl/styles.xml', stylesXml),
    zipEntry('xl/worksheets/sheet1.xml', sheetXml)
  ]

  return buildZip(entries)
}

module.exports = { readXlsx, writeXlsx, crc32, colName, refToCol, unzip }
