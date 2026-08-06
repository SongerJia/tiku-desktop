// 题库解析层自测：不依赖 Electron / 原生模块，node 直接跑
// 用法：node scripts/test-parser.mjs
import { parseCsv, parseMatrix, buildTemplateCsv, parseJsonBank, bankToCsv } from '../src/utils/bankParser.js'

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')) }
}

console.log('\n[1] 模板自解析（模板必须自己能过）')
{
  const m = parseCsv(buildTemplateCsv())
  const EXPECT = m.length - 1   // 从模板动态推导，以后加示例行不用改测试
  const r = parseMatrix(m)
  check('无致命错误', !r.fatal, r.fatal)
  check(`解析出 ${EXPECT} 行`, r.summary.total === EXPECT, 'total=' + r.summary.total)
  check(`${EXPECT} 行全部合格`, r.summary.ok === EXPECT, JSON.stringify(r.results.filter(x => !x.ok).map(x => x.errors)))
  const [q1, q2, q3, q4] = r.results.map(x => x.data)
  check('单选 answer=[A]', q1.type === 'single' && JSON.stringify(q1.answer) === '["A"]', JSON.stringify(q1.answer))
  check('多选 ABD 拆成三个 key', q2.type === 'multiple' && JSON.stringify(q2.answer) === '["A","B","D"]', JSON.stringify(q2.answer))
  check('判断题选项归一为 对/错', q3.type === 'judge' && JSON.stringify(q3.options.map(o => o.key)) === '["对","错"]')
  check('判断题 answer=[对]', JSON.stringify(q3.answer) === '["对"]', JSON.stringify(q3.answer))
  check('选项结构为 {key,text}', q1.options[0].key === 'A' && q1.options[0].text === '目标控制')
  check('模板含问答题示例', q4 && q4.type === 'essay', q4 && q4.type)
  check('问答题无选项', q4 && Array.isArray(q4.options) && q4.options.length === 0)
  check('问答题答案为整段参考答案', q4 && q4.answer.length === 1 && q4.answer[0].length > 10, q4 && JSON.stringify(q4.answer))
  check('问答题解析出得分关键词', q4 && Array.isArray(q4.keywords) && q4.keywords.length >= 2, q4 && JSON.stringify(q4.keywords))
}

console.log('\n[2] 表头别名与乱序列')
{
  const csv = ['题目,类型,A,B,C,D,正确答案,答案解析,所属科目,所属章节',
    '1+1=?,单选题,1,2,3,4,B,显然,数学,加法'].join('\n')
  const r = parseMatrix(parseCsv(csv))
  check('别名表头可识别', !r.fatal, r.fatal)
  check('行合格', r.summary.ok === 1, JSON.stringify(r.results[0] && r.results[0].errors))
  const d = r.results[0].data
  check('科目/章节取到', d.subject === '数学' && d.chapter === '加法', d.subject + '/' + d.chapter)
  check('裸字母列识别为选项', d.options.length === 4)
  check('答案 B', JSON.stringify(d.answer) === '["B"]')
}

console.log('\n[3] 答案写法容错')
{
  const mk = (ans, type = '多选') => {
    const csv = `科目,题型,题干,选项A,选项B,选项C,选项D,答案\n测,${type},T,a,b,c,d,${ans}`
    return parseMatrix(parseCsv(csv)).results[0]
  }
  check('"A,B,C" 逗号分隔', JSON.stringify(mk('"A,B,C"').data.answer) === '["A","B","C"]')
  check('"A、C" 顿号分隔', JSON.stringify(mk('A、C').data.answer) === '["A","C"]')
  check('"ACB" 连写自动排序', JSON.stringify(mk('ACB').data.answer) === '["A","B","C"]')
  check('"1,3" 数字转字母', JSON.stringify(mk('"1,3"').data.answer) === '["A","C"]')
  check('小写 "ab" 可识别', JSON.stringify(mk('ab').data.answer) === '["A","B"]')
}

console.log('\n[4] 错误必须被拦下（不能静默写脏数据）')
{
  const rows = [
    '科目,题型,题干,选项A,选项B,选项C,选项D,答案',
    '测,单选,题干正常,a,b,c,d,E',      // 答案越界
    '测,单选,,a,b,c,d,A',              // 题干空
    '测,单选,只有一个选项,a,,,,A',      // 选项不足
    '测,火星题型,题干,a,b,c,d,A',       // 题型非法
    '测,单选,双答案单选,a,b,c,d,AB',    // 单选多答案
    '测,判断,判断题,,,,,也许'           // 判断答案不可识别
  ].join('\n')
  const r = parseMatrix(parseCsv(rows))
  check('5 行被判失败', r.summary.failed === 5, 'failed=' + r.summary.failed + ' ok=' + r.summary.ok)
  check('答案越界有提示', /超出选项范围/.test(r.results[0].errors.join()), r.results[0].errors.join())
  check('题干空有提示', /题干为空/.test(r.results[1].errors.join()))
  check('选项不足有提示', /选项不足/.test(r.results[2].errors.join()), r.results[2].errors.join())
  check('单选多答案有提示', /单选题却有/.test(r.results[4].errors.join()), r.results[4].errors.join())
  check('判断答案有提示', /判断题答案无法识别/.test(r.results[5].errors.join()), r.results[5].errors.join())
  // 非标准题型：允许猜，但必须留下警告，不能闷声改数据
  check('非标准题型被猜为单选', r.results[3].ok && r.results[3].data.type === 'single', r.results[3].errors.join())
  check('且给出警告', /不是标准写法/.test(r.results[3].warnings.join()), r.results[3].warnings.join())
}

console.log('\n[5] CSV 边界：引号、逗号、字段内换行')
{
  const csv = '科目,题型,题干,选项A,选项B,答案\n' +
    '测,判断,"题干里有,逗号和""引号""",,,对\n' +
    '测,判断,"题干里\n有换行",,,错'
  const r = parseMatrix(parseCsv(csv))
  check('两行都解析出来', r.summary.total === 2, 'total=' + r.summary.total)
  check('逗号与转义引号还原', r.results[0].data.stem === '题干里有,逗号和"引号"', r.results[0].data.stem)
  check('字段内换行保留', r.results[1].data.stem.includes('\n'))
  check('判断题 对/错 都对', JSON.stringify(r.results[0].data.answer) === '["对"]' && JSON.stringify(r.results[1].data.answer) === '["错"]')
}

console.log('\n[6] 缺表头 / 空文件的兜底')
{
  check('空文件给 fatal', !!parseMatrix(parseCsv('')).fatal)
  check('无题干列给 fatal', /题干/.test(parseMatrix(parseCsv('姓名,年龄\n张三,18')).fatal || ''))
}

console.log('\n[7] 题型缺省时的推断')
{
  const csv = '科目,题干,选项A,选项B,选项C,选项D,答案\n测,推断单选,a,b,c,d,A\n测,推断多选,a,b,c,d,AC'
  const r = parseMatrix(parseCsv(csv))
  check('无题型列也能推断', r.summary.ok === 2, JSON.stringify(r.results.map(x => x.errors)))
  check('推断为 single', r.results[0].data.type === 'single', r.results[0].data.type)
  check('推断为 multiple', r.results[1].data.type === 'multiple', r.results[1].data.type)
}

console.log('\n[8] JSON 题库导入')
{
  const json = JSON.stringify([
    { subject: '数学', chapter: '代数', type: '单选', stem: 'x=?', options: ['1', '2'], answer: 'A' },
    { subject: '数学', type: 'judge', stem: '真命题', answer: '对' }
  ])
  const r = parseJsonBank(json)
  check('两题都合格', r.summary.ok === 2, JSON.stringify(r.results.map(x => x.errors)))
  check('字符串选项数组转 {key,text}', r.results[0].data.options[0].key === 'A' && r.results[0].data.options[0].text === '1')
  check('judge 归一', JSON.stringify(r.results[1].data.answer) === '["对"]')
}

console.log('\n[9] 导出 CSV 能被自己重新解析（往返一致）')
{
  const bank = [{
    subject: '数学', chapter: '代数', type: 'multiple', stem: '含"引号,逗号"的题干',
    options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }, { key: 'C', text: 'c' }],
    answer: ['A', 'C'], analysis: '解析', difficulty: 4, source: '自建'
  }]
  const r = parseMatrix(parseCsv(bankToCsv(bank)))
  check('往返后仍合格', r.summary.ok === 1, JSON.stringify(r.results[0] && r.results[0].errors))
  const d = r.results[0].data
  check('题干原样还原', d.stem === '含"引号,逗号"的题干', d.stem)
  check('答案原样还原', JSON.stringify(d.answer) === '["A","C"]')
  check('难度原样还原', d.difficulty === 4)
}

console.log('\n[10] BOM 契约：模板/导出各自只带一个 BOM（组件层不得重复添加）')
{
  const tpl = buildTemplateCsv()
  check('模板以 BOM 开头', tpl.charCodeAt(0) === 0xFEFF)
  check('模板只有一个 BOM', tpl.charCodeAt(1) !== 0xFEFF, '第二字符=' + tpl.charCodeAt(1))
  const exp = bankToCsv([{
    subject: 'S', chapter: 'C', type: 'single', stem: '题',
    options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], answer: ['A'], difficulty: 3
  }])
  check('导出以 BOM 开头', exp.charCodeAt(0) === 0xFEFF)
  check('导出只有一个 BOM', exp.charCodeAt(1) !== 0xFEFF, '第二字符=' + exp.charCodeAt(1))
  // 兜底：万一哪天组件层不小心又加了一个 BOM，解析层也不能崩
  // （normalizeHeader 的 \s+ 按 ECMAScript 规范会匹配 U+FEFF，所以多余 BOM 会被洗掉）
  const dbl = parseMatrix(parseCsv('\uFEFF' + tpl))
  check('解析层容忍双 BOM（首列表头仍能识别）', dbl.headerMap && dbl.headerMap.subject === 0,
    'headerMap.subject=' + (dbl.headerMap && dbl.headerMap.subject))
  const tplRows = parseCsv(tpl).length - 1
  check(`解析层容忍双 BOM（${tplRows} 行仍全合格）`, dbl.summary.ok === tplRows, 'ok=' + dbl.summary.ok)
}

console.log('\n[11] 判断题往返（无选项 + 中文答案）')
{
  const r = parseMatrix(parseCsv(bankToCsv([{
    subject: '法规', chapter: '建筑法', type: 'judge', stem: '未取证擅自施工可罚款。',
    options: [{ key: '对', text: '对' }, { key: '错', text: '错' }],
    answer: ['对'], analysis: '依据建筑法', difficulty: 1, source: '教材'
  }])))
  check('判断题往返后合格', r.summary.ok === 1, JSON.stringify(r.results[0] && r.results[0].errors))
  const d = r.results[0].data
  check('type 仍为 judge', d.type === 'judge', d.type)
  check('答案仍为 ["对"]', JSON.stringify(d.answer) === '["对"]', JSON.stringify(d.answer))
  check('选项被还原为 对/错', JSON.stringify((d.options || []).map(o => o.key)) === '["对","错"]',
    JSON.stringify(d.options))
}

console.log('\n[12] 问答题：识别 / 校验放行 / 关键词 / 往返')
{
  // 显式写「问答」
  const csv1 = ['科目,章节,题型,题干,答案,得分关键词,解析,难度',
    '法规,合同,问答,简述施工合同的主要条款。,"工期、质量、价款、违约责任","工期;质量;价款;违约责任",要点齐全即可,4'].join('\n')
  const r1 = parseMatrix(parseCsv(csv1))
  check('问答题合格（不因无选项被拦）', r1.summary.ok === 1, JSON.stringify(r1.results[0] && r1.results[0].errors))
  const d1 = r1.results[0].data
  check('type=essay', d1.type === 'essay', d1.type)
  check('答案整段保留', d1.answer[0].includes('违约责任'), JSON.stringify(d1.answer))
  check('关键词按分号拆分', JSON.stringify(d1.keywords) === '["工期","质量","价款","违约责任"]', JSON.stringify(d1.keywords))

  // 别名：简述题 / 论述 / 案例分析 / 名词解释
  for (const label of ['简答', '论述题', '案例分析', '名词解释']) {
    const c = ["科目,题型,题干,答案", `测,${label},说明理由。,因为如此这般所以这样那样`].join('\n')
    const rr = parseMatrix(parseCsv(c))
    check(`别名「${label}」识别为 essay`, rr.results[0].ok && rr.results[0].data.type === 'essay',
      JSON.stringify(rr.results[0].errors) + ' ' + (rr.results[0].data && rr.results[0].data.type))
  }

  // 不写题型：无选项 + 长文本答案 → 推断 essay
  const csv2 = ['科目,题干,答案', '测,简述项目管理三大目标及其相互关系。,进度、成本、质量三者相互制约，需统筹平衡取得最优解。'].join('\n')
  const r2 = parseMatrix(parseCsv(csv2))
  check('无题型列时长答案推断为 essay', r2.results[0].ok && r2.results[0].data.type === 'essay',
    (r2.results[0].data && r2.results[0].data.type) + ' ' + JSON.stringify(r2.results[0].errors))

  // 关键词多种分隔符
  const seps = ['a;b;c', 'a；b；c', 'a|b|c', 'a、b、c', 'a,b,c']
  for (const s of seps) {
    const c = ['题型,题干,答案,得分关键词', `问答,题,参考答案,"${s}"`].join('\n')
    const rr = parseMatrix(parseCsv(c))
    check(`关键词分隔「${s}」拆成 3 个`, JSON.stringify(rr.results[0].data.keywords) === '["a","b","c"]',
      JSON.stringify(rr.results[0].data.keywords))
  }

  // 往返：导出再导入，keywords 不能丢
  const round = parseMatrix(parseCsv(bankToCsv([{
    subject: '法规', chapter: '合同', type: 'essay',
    stem: '简述施工合同的主要条款。', options: [],
    answer: ['工期、质量、价款、违约责任'],
    keywords: ['工期', '质量', '价款'],
    analysis: '要点齐全即可', difficulty: 4, source: '教材'
  }])))
  check('问答题往返后合格', round.summary.ok === 1, JSON.stringify(round.results[0] && round.results[0].errors))
  const d3 = round.results[0].data
  check('往返后 type 仍 essay', d3.type === 'essay', d3.type)
  check('往返后答案不丢', d3.answer[0] === '工期、质量、价款、违约责任', JSON.stringify(d3.answer))
  check('往返后关键词不丢', JSON.stringify(d3.keywords) === '["工期","质量","价款"]', JSON.stringify(d3.keywords))
  check('往返后选项仍为空', Array.isArray(d3.options) && d3.options.length === 0, JSON.stringify(d3.options))

  // 问答题答案为空必须拦下
  const r4 = parseMatrix(parseCsv(['题型,题干,答案', '问答,只有题干没答案,'].join('\n')))
  check('问答题缺参考答案被拦下', !r4.results[0].ok, JSON.stringify(r4.results[0].errors))
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
process.exit(fail ? 1 : 0)
