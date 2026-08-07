/**
 * 题库解析层（纯 JS、零依赖，渲染层与脚本可共用）
 *
 * 职责：把 CSV / Excel 读出来的二维数组，转成与数据库完全一致的标准题目对象，
 * 并逐行给出人能看懂的错误原因。输出格式必须严格对齐 sampleData.js：
 *   type    : 'single' | 'multiple' | 'judge' | 'essay'
 *   options : [{ key: 'A', text: '...' }]      判断题固定为 对/错；问答题为 []
 *   answer  : ['A', 'C']                        判断题为 ['对'] 或 ['错']
 *                                               问答题为 ['参考答案全文']（只有一个元素）
 *   keywords: ['采分点1', '采分点2']            仅问答题使用，自评时提示命中情况
 *
 * 容错设计原则：老师/自己整理的表格千奇百怪，能猜的一律猜，猜不了才报错。
 */

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

// 表头别名。归一化后做等值匹配（去空格、去全角、转小写、去标点）
const HEADER_ALIASES = {
  subject: ['科目', '科目名称', '课程', '学科', '所属科目', 'subject', 'course'],
  chapter: ['章节', '章', '节', '目录', '知识点', '所属章节', 'chapter', 'section'],
  type: ['题型', '类型', '题目类型', '试题类型', 'type'],
  stem: ['题干', '题目', '问题', '试题', '题目内容', 'stem', 'question', 'title'],
  answer: ['答案', '正确答案', '参考答案', '标准答案', 'answer', 'key'],
  keywords: ['得分关键词', '关键词', '采分点', '得分点', '要点', '关键点', 'keywords', 'keyword', 'points'],
  analysis: ['解析', '答案解析', '试题解析', '解释', '说明', '分析', 'analysis', 'explanation', 'explain'],
  difficulty: ['难度', '难度系数', '难易度', 'difficulty', 'level'],
  source: ['来源', '出处', '年份', 'source', 'from'],
  audio: ['听力音频', '音频', '音频地址', 'audio', 'audio_url'],
  material: ['材料', '背景材料', '案例材料', '资料', 'material']
}

function normalizeHeader(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\s+/g, '')
    .replace(/[（）()【】\[\]:：*·.。、]/g, '')
    .toLowerCase()
}

// 识别选项列：支持 "选项A" / "A" / "A选项" / "optionA" / "选项1"
function matchOptionKey(normalized) {
  let m = normalized.match(/^(?:选项|option|opt)?([a-h])(?:选项)?$/)
  if (m) return m[1].toUpperCase()
  m = normalized.match(/^(?:选项|option|opt)([1-8])$/)
  if (m) return LETTERS[Number(m[1]) - 1]
  return null
}

/** 表头行 → 列索引映射 */
export function buildHeaderMap(headerRow) {
  const map = { options: [] }
  ;(headerRow || []).forEach((raw, idx) => {
    const h = normalizeHeader(raw)
    if (!h) return
    for (const field of Object.keys(HEADER_ALIASES)) {
      if (map[field] != null) continue
      if (HEADER_ALIASES[field].some(a => normalizeHeader(a) === h)) {
        map[field] = idx
        return
      }
    }
    const key = matchOptionKey(h)
    if (key && !map.options.some(o => o.key === key)) map.options.push({ index: idx, key })
  })
  map.options.sort((a, b) => LETTERS.indexOf(a.key) - LETTERS.indexOf(b.key))
  return map
}

/** 表头是否可用（至少要能认出题干列） */
export function isHeaderUsable(map) {
  return map && map.stem != null
}

const JUDGE_TRUE = ['对', '正确', '是', '真', 't', 'true', 'y', 'yes', '√', '1', 'a']
const JUDGE_FALSE = ['错', '错误', '否', '假', 'f', 'false', 'n', 'no', '×', 'x', '0', 'b']

const TYPE_ALIASES = {
  single: ['单选', '单选题', '单项选择', '单项选择题', 'single', 'radio', '1'],
  multiple: ['多选', '多选题', '多项选择', '多项选择题', '不定项', '不定项选择', 'multiple', 'multi', 'checkbox', '2'],
  judge: ['判断', '判断题', '对错', '对错题', 'judge', 'boolean', 'bool', 'tf', '3'],
  // 主观题一律归到 essay：简答/论述/案例/名词解释/填空，判分逻辑都是「看参考答案自评」
  essay: [
    '问答', '问答题', '简答', '简答题', '论述', '论述题', '案例', '案例分析', '案例分析题',
    '名词解释', '解答', '解答题', '主观题', '填空', '填空题', '计算', '计算题',
    'essay', 'text', 'qa', 'shortanswer', 'subjective', '4'
  ]
}
const KNOWN_TYPES = new Set(
  Object.keys(TYPE_ALIASES).reduce((acc, k) => acc.concat(TYPE_ALIASES[k].map(normalizeHeader)), [])
)

/** 表里写的题型是不是我们明确认识的（不认识但能猜时要给用户警告，不能闷声猜） */
export function isKnownTypeLabel(raw) {
  const t = normalizeHeader(raw)
  return t !== '' && KNOWN_TYPES.has(t)
}

export function normalizeType(raw, optionCount, answerRaw) {
  const t = normalizeHeader(raw)
  if (TYPE_ALIASES.single.map(normalizeHeader).includes(t)) return 'single'
  if (TYPE_ALIASES.multiple.map(normalizeHeader).includes(t)) return 'multiple'
  if (TYPE_ALIASES.judge.map(normalizeHeader).includes(t)) return 'judge'
  if (TYPE_ALIASES.essay.map(normalizeHeader).includes(t)) return 'essay'

  // 没写题型 → 猜：先看答案像不像对错，再看答案长度
  const a = normalizeHeader(answerRaw)
  if (optionCount < 2 && (JUDGE_TRUE.includes(a) || JUDGE_FALSE.includes(a))) return 'judge'
  const letters = String(answerRaw || '').toUpperCase().replace(/[^A-H]/g, '')
  const rawAnswer = String(answerRaw == null ? '' : answerRaw).trim()
  // 没有选项 + 答案是一段长文本（不是 ABCD 那种字母组合）→ 只能是问答题
  if (optionCount < 2 && rawAnswer && !/^[A-H][A-H\s,，、;；\/|]*$/i.test(rawAnswer)) return 'essay'
  if (letters.length > 1) return 'multiple'
  if (optionCount >= 2) return 'single'
  if (JUDGE_TRUE.includes(a) || JUDGE_FALSE.includes(a)) return 'judge'
  return null
}

/** 答案字符串 → key 数组。支持 "ABC" / "A,B,C" / "A、B" / "1,2" / "对" */
export function parseAnswer(raw, type, options) {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return { answer: [], error: '答案为空' }

  // 问答题没有唯一解，整段参考答案原样存为唯一元素
  if (type === 'essay') return { answer: [s] }

  if (type === 'judge') {
    const t = normalizeHeader(s)
    if (JUDGE_TRUE.includes(t)) return { answer: ['对'] }
    if (JUDGE_FALSE.includes(t)) return { answer: ['错'] }
    return { answer: [], error: `判断题答案无法识别："${s}"（可填 对/错、正确/错误、T/F、√/×）` }
  }

  const tokens = s.toUpperCase().split(/[,，、;；\/|\s]+/).filter(Boolean)
  let keys = []
  if (tokens.length === 1 && /^[A-H]+$/.test(tokens[0])) {
    keys = tokens[0].split('')
  } else {
    for (const tk of tokens) {
      if (/^[A-H]$/.test(tk)) keys.push(tk)
      else if (/^[1-8]$/.test(tk)) keys.push(LETTERS[Number(tk) - 1])
      else return { answer: [], error: `答案含无法识别的内容："${tk}"` }
    }
  }
  keys = Array.from(new Set(keys))

  const valid = options.map(o => o.key)
  const outOfRange = keys.filter(k => !valid.includes(k))
  if (outOfRange.length) {
    return { answer: [], error: `答案 ${outOfRange.join('')} 超出选项范围（当前只有 ${valid.join('') || '无'} 选项）` }
  }
  keys.sort((a, b) => LETTERS.indexOf(a) - LETTERS.indexOf(b))
  return { answer: keys }
}

/**
 * 单行 → 校验结果
 * @returns {{ rowNo, ok, data, errors: string[], warnings: string[] }}
 */
export function rowToQuestion(row, map, rowNo, ctx = {}) {
  const cell = (field) => (map[field] != null ? String(row[map[field]] == null ? '' : row[map[field]]).trim() : '')
  const errors = []
  const warnings = []

  const stem = cell('stem')
  const answerRaw = cell('answer')

  let options = map.options
    .map(o => ({ key: o.key, text: String(row[o.index] == null ? '' : row[o.index]).trim() }))
    .filter(o => o.text !== '')

  const rawType = cell('type')
  const type = normalizeType(rawType, options.length, answerRaw)

  if (!stem) errors.push('题干为空')
  if (!type) errors.push(`题型无法识别："${rawType}"（可填 单选/多选/判断/问答）`)
  else if (rawType && !isKnownTypeLabel(rawType)) {
    // 能猜出来就别拦人，但必须让用户看见我们猜了什么
    warnings.push(`题型 "${rawType}" 不是标准写法，已按「${TYPE_LABEL[type]}」处理`)
  }

  if (type === 'judge') {
    // 判断题统一成 对/错 两个选项，忽略表里可能写的其他选项
    options = [{ key: '对', text: '对' }, { key: '错', text: '错' }]
  } else if (type === 'essay') {
    // 问答题不存选项；表里若误填了选项列，提示一下但不拦人
    if (options.length) warnings.push(`问答题不需要选项，已忽略填写的 ${options.length} 个选项`)
    options = []
  } else if (type && options.length < 2) {
    errors.push(`选项不足 2 个（识别到 ${options.length} 个），请检查选项列是否填写`)
  }

  let answer = []
  if (type && !errors.length) {
    const r = parseAnswer(answerRaw, type, options)
    if (r.error) errors.push(r.error)
    else answer = r.answer
  }

  if (!errors.length && type === 'single' && answer.length > 1) {
    errors.push(`单选题却有 ${answer.length} 个答案，请改成多选题或只保留一个答案`)
  }
  if (!errors.length && type === 'multiple' && answer.length === 1) {
    warnings.push('多选题只有 1 个答案，确认无误可继续导入')
  }

  // 得分关键词：仅问答题有意义，支持 分号/竖线/顿号/逗号/换行 分隔
  const keywords = type === 'essay' ? splitKeywords(cell('keywords')) : []
  if (type === 'essay' && !keywords.length) {
    warnings.push('问答题未填「得分关键词」，自评时不会提示采分点')
  }

  let difficulty = parseInt(cell('difficulty'), 10)
  if (!Number.isFinite(difficulty) || difficulty < 1 || difficulty > 5) {
    if (cell('difficulty')) warnings.push(`难度 "${cell('difficulty')}" 不在 1-5，已按 3 处理`)
    difficulty = 3
  }

  const subject = cell('subject') || ctx.defaultSubjectName || ''
  const chapter = cell('chapter')
  if (!subject && !ctx.defaultSubjectId) {
    errors.push('未填「科目」列，且未在下一步指定目标科目')
  }

  return {
    rowNo,
    ok: errors.length === 0,
    errors,
    warnings,
    data: {
      subject: cell('subject'),
      chapter,
      type,
      stem,
      options,
      answer,
      keywords,
      analysis: cell('analysis'),
      difficulty,
      source: cell('source') || ctx.defaultSource || '',
      audio: cell('audio'),
      material: cell('material')
    }
  }
}

/** 关键词串 → 数组。分号/竖线/顿号/逗号/换行都当分隔符 */
export function splitKeywords(raw) {
  return String(raw == null ? '' : raw)
    .split(/[;；|｜、,，\n\r]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * 二维数组（含表头） → 全量解析结果
 */
export function parseMatrix(matrix, ctx = {}) {
  const rows = (matrix || []).filter(r => Array.isArray(r) && r.some(c => String(c == null ? '' : c).trim() !== ''))
  if (!rows.length) {
    return { headerMap: null, header: [], results: [], summary: { total: 0, ok: 0, failed: 0, warned: 0 }, fatal: '文件里没有任何数据' }
  }
  const header = rows[0]
  const headerMap = buildHeaderMap(header)
  if (!isHeaderUsable(headerMap)) {
    return {
      headerMap, header, results: [], summary: { total: 0, ok: 0, failed: 0, warned: 0 },
      fatal: '没有识别到「题干」列。请确认第一行是表头，且包含「题干」（或 题目/问题/stem）这一列。可下载模板对照。'
    }
  }
  const results = rows.slice(1).map((r, i) => rowToQuestion(r, headerMap, i + 2, ctx))
  return {
    headerMap,
    header,
    results,
    summary: {
      total: results.length,
      ok: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      warned: results.filter(r => r.ok && r.warnings.length).length
    },
    fatal: null
  }
}

/* ---------------- CSV ---------------- */

/** CSV/TSV → 二维数组。处理 BOM、双引号转义、字段内换行、\r\n */
export function parseCsv(text) {
  const s = String(text || '').replace(/^\uFEFF/, '')
  // 自动判定分隔符：看首行逗号多还是制表符多
  const firstLine = s.slice(0, s.indexOf('\n') === -1 ? s.length : s.indexOf('\n'))
  const tabs = (firstLine.match(/\t/g) || []).length
  const commas = (firstLine.match(/,/g) || []).length
  const delim = tabs > commas ? '\t' : ','

  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delim) {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

function csvEscape(v) {
  const s = String(v == null ? '' : v)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export const TEMPLATE_HEADER = [
  '科目', '章节', '题型', '题干',
  '选项A', '选项B', '选项C', '选项D', '选项E', '选项F',
  '答案', '得分关键词', '解析', '难度', '来源', '材料', '听力音频'
]

/** 题库扁平行 → 二维数组（表头 + 数据行）。CSV 与 Excel 导出共用同一份行数据 */
export function bankToMatrix(list) {
  const body = (list || []).map(q => {
    const opt = {}
    ;(q.options || []).forEach(o => { opt[o.key] = o.text })
    // 判断题的选项固定是 对/错，问答题没有选项，都不需要往选项列里写
    const noOpt = q.type === 'judge' || q.type === 'essay'
    return [
      q.subject || '',
      q.chapter || '',
      TYPE_LABEL[q.type] || q.type,
      q.stem || '',
      noOpt ? '' : (opt.A || ''),
      noOpt ? '' : (opt.B || ''),
      noOpt ? '' : (opt.C || ''),
      noOpt ? '' : (opt.D || ''),
      noOpt ? '' : (opt.E || ''),
      noOpt ? '' : (opt.F || ''),
      (q.answer || []).join(''),
      (q.keywords || []).join('；'),
      q.analysis || '',
      q.difficulty == null ? 3 : q.difficulty,
      q.source || '',
      q.material || '',
      q.audio || ''
    ]
  })
  return [TEMPLATE_HEADER, ...body]
}

/** 模板的示例行（表头 + 4 种题型各一行），CSV 与 Excel 模板共用 */
export function buildTemplateMatrix() {
  return [
    TEMPLATE_HEADER,
    ['二级建造师', '施工管理', '单选', '项目管理的核心任务是（ ）。',
      '目标控制', '成本控制', '进度控制', '质量控制', '', '',
      'A', '', '项目管理的核心任务是项目的目标控制。', '2', '2024真题', '【材料】某项目管理案例……', ''],
    ['二级建造师', '工程法规', '多选', '下列属于非营利法人的有（ ）。',
      '事业单位', '社会团体', '有限责任公司', '基金会', '', '',
      'ABD', '', '有限责任公司属于营利法人。', '3', '2023真题', '【材料】某公司设立纠纷案……', ''],
    ['二级建造师', '工程法规', '判断', '未取得施工许可证擅自施工的，可以并处罚款。',
      '', '', '', '', '', '',
      '对', '', '依据《建筑法》第六十四条。', '1', '教材例题', '', ''],
    ['二级建造师', '施工管理', '问答', '简述施工进度计划编制的主要步骤。',
      '', '', '', '', '', '',
      '① 收集资料；② 划分施工过程；③ 计算工程量与劳动量；④ 确定各工序持续时间；⑤ 绘制网络图/横道图；⑥ 检查关键线路并优化资源；⑦ 交底后动态调整。',
      '收集资料；划分施工过程；计算工程量；持续时间；网络图；关键线路',
      '问答题按采分点给分，答到关键词即可。', '4', '教材例题', '', '']
  ]
}

/** 生成带示例的 CSV 模板（带 BOM，Excel 直接双击不乱码） */
export function buildTemplateCsv() {
  return '\uFEFF' + buildTemplateMatrix().map(r => r.map(csvEscape).join(',')).join('\r\n')
}

/** 题库扁平行 → CSV（导出，可在 Excel 改完再导回来） */
export function bankToCsv(list) {
  return '\uFEFF' + bankToMatrix(list).map(r => r.map(csvEscape).join(',')).join('\r\n')
}

/* ---------------- JSON ---------------- */

/**
 * JSON 题库 → 与 parseMatrix 相同结构的结果。
 * 接受 [ {...} ] 或 { questions: [ {...} ] }
 */
export function parseJsonBank(text, ctx = {}) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { headerMap: null, header: [], results: [], summary: { total: 0, ok: 0, failed: 0, warned: 0 }, fatal: 'JSON 格式错误：' + e.message }
  }
  const list = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.items || [])
  if (!Array.isArray(list) || !list.length) {
    return { headerMap: null, header: [], results: [], summary: { total: 0, ok: 0, failed: 0, warned: 0 }, fatal: 'JSON 里没有找到题目数组（应为数组，或对象里的 questions 字段）' }
  }

  const results = list.map((q, i) => {
    const rowNo = i + 1
    const errors = []
    const warnings = []
    const stem = String(q.stem || q.题干 || q.question || '').trim()
    if (!stem) errors.push('题干为空')

    let options = []
    if (Array.isArray(q.options)) {
      options = q.options.map((o, idx) => (typeof o === 'string'
        ? { key: LETTERS[idx], text: o.trim() }
        : { key: String(o.key || LETTERS[idx]), text: String(o.text == null ? '' : o.text).trim() }))
        .filter(o => o.text !== '')
    }

    const answerRaw = Array.isArray(q.answer) ? q.answer.join(',') : String(q.answer == null ? '' : q.answer)
    const type = normalizeType(q.type || q.题型 || '', options.length, answerRaw)
    if (!type) errors.push(`题型无法识别："${q.type || ''}"`)

    if (type === 'judge') options = [{ key: '对', text: '对' }, { key: '错', text: '错' }]
    else if (type === 'essay') options = []
    else if (type && options.length < 2) errors.push(`选项不足 2 个（识别到 ${options.length} 个）`)

    let answer = []
    if (type && !errors.length) {
      const r = parseAnswer(answerRaw, type, options)
      if (r.error) errors.push(r.error)
      else answer = r.answer
    }

    let difficulty = parseInt(q.difficulty, 10)
    if (!Number.isFinite(difficulty) || difficulty < 1 || difficulty > 5) difficulty = 3

    const subject = String(q.subject || q.科目 || '').trim()
    if (!subject && !ctx.defaultSubjectId) errors.push('缺少 subject 字段，且未指定目标科目')

    return {
      rowNo,
      ok: errors.length === 0,
      errors,
      warnings,
      data: {
        subject,
        chapter: String(q.chapter || q.章节 || '').trim(),
        type,
        stem,
        options,
        answer,
        keywords: type === 'essay'
          ? (Array.isArray(q.keywords) ? q.keywords.map(s => String(s).trim()).filter(Boolean) : splitKeywords(q.keywords || q.关键词 || ''))
          : [],
        analysis: String(q.analysis || q.解析 || '').trim(),
        difficulty,
        source: String(q.source || q.来源 || ctx.defaultSource || '').trim()
      }
    }
  })

  return {
    headerMap: null,
    header: [],
    results,
    summary: {
      total: results.length,
      ok: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      warned: results.filter(r => r.ok && r.warnings.length).length
    },
    fatal: null
  }
}

export const TYPE_LABEL = { single: '单选', multiple: '多选', judge: '判断', essay: '问答' }
