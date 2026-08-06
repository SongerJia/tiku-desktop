/**
 * xlsx-lite 自测
 *
 * 1) 读：吃下 Python 按 OOXML 规范造出来的标准文件（共享字符串 / deflate / 跳行跳列 / 布尔 / 非 sheet1.xml 命名）
 * 2) 写：产出文件交给 Python 严格校验（见 verify-xlsx.py）
 * 3) 往返：写出去再读回来，内容必须完全一致
 *
 * 运行：node scripts/test-xlsx.mjs
 */
import { createRequire } from 'module'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { bankToMatrix, parseMatrix } from '../src/utils/bankParser.js'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const { readXlsx, writeXlsx, colName, refToCol, unzip } = require('../electron/xlsx-lite.js')

// 测试产物写系统临时目录，不污染工作区
const TMP = path.join(os.tmpdir(), 'tiku-xlsx-test')
fs.mkdirSync(TMP, { recursive: true })

let pass = 0
let fail = 0
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log('  PASS  ' + label) }
  else { fail++; console.log('  FAIL  ' + label + (extra ? '  → ' + extra : '')) }
}

console.log('\n[1] 列名与引用换算')
{
  check('colName(0)=A', colName(0) === 'A')
  check('colName(25)=Z', colName(25) === 'Z')
  check('colName(26)=AA', colName(26) === 'AA', colName(26))
  check('colName(701)=ZZ', colName(701) === 'ZZ', colName(701))
  check('refToCol(A1)=0', refToCol('A1') === 0)
  check('refToCol(Z9)=25', refToCol('Z9') === 25)
  check('refToCol(AA1)=26', refToCol('AA1') === 26, String(refToCol('AA1')))
  check('往返一致 AB→27→AB', colName(refToCol('AB1')) === 'AB')
}

console.log('\n[2] 读取 Python 生成的标准 xlsx')
const fixture = process.env.XLSX_FIXTURE || path.join(TMP, 'fixture.xlsx')
if (!fs.existsSync(fixture)) {
  console.log('  跳过：未找到 fixture，请先运行 make-fixture-xlsx.py')
} else {
  const rows = readXlsx(fs.readFileSync(fixture))
  check('读出 5 行（含中间空行补位）', rows.length === 5, '实际 ' + rows.length)
  check('共享字符串解析正确', rows[0][0] === '科目', JSON.stringify(rows[0][0]))
  check('跳列补空（B 列整列为空）', rows[0][1] === '' && rows[0][2] === '题型', JSON.stringify(rows[0]))
  check('XML 实体还原 & < > "',
    rows[1][3] === '下列符号 & < > " \' 都要能原样读出', JSON.stringify(rows[1][3]))
  check('跳行补空行', Array.isArray(rows[2]) && rows[2].length === 0, JSON.stringify(rows[2]))
  check('单元格内换行保留', (rows[3][3].match(/\n/g) || []).length === 2, JSON.stringify(rows[3][3]))
  check('中文分号答案完整', rows[3][4] === '组织措施；技术措施；经济措施', JSON.stringify(rows[3][4]))
  check('数字单元格读为字符串 3', rows[1][5] === '3', JSON.stringify(rows[1][5]))
  check('布尔单元格 → TRUE', rows[4][4] === 'TRUE', JSON.stringify(rows[4][4]))
  check('工作表非 sheet1.xml 命名也能定位（走 rels 关系）', rows.length === 5)
}

console.log('\n[3] 生成 xlsx（交给 Python 严格校验）')
const longText = '这是一段超长的参考答案。'.repeat(4000) // 约 4.8 万字，超过 Excel 3.2 万上限
const outRows = [
  ['科目', '章节', '题型', '题干', '答案', '难度'],
  ['二级建造师', '施工管理', '单选', '含 & < > " 符号', 'A', 3],
  ['二级建造师', '施工管理', '问答', '第一行\n第二行\n第三行', '组织措施；技术措施', 5],
  ['二级建造师', '施工管理', '问答', longText, '参考答案', 2]
]
const outPath = process.env.XLSX_OUT || path.join(TMP, 'out.xlsx')
const buf = writeXlsx(outRows, { sheetName: '题库' })
fs.writeFileSync(outPath, buf)
check('生成文件非空', buf.length > 500, buf.length + ' bytes')
check('以 PK 开头（合法 zip）', buf[0] === 0x50 && buf[1] === 0x4b)
console.log('  → 已写出 ' + outPath + '（' + buf.length + ' bytes）')

console.log('\n[4] 写→读 往返一致性')
{
  const back = readXlsx(buf)
  check('行数一致', back.length === outRows.length, back.length + ' vs ' + outRows.length)
  check('表头一致', back[0].join('|') === outRows[0].join('|'), back[0].join('|'))
  check('特殊字符往返无损', back[1][3] === '含 & < > " 符号', JSON.stringify(back[1][3]))
  check('换行往返无损', back[2][3] === '第一行\n第二行\n第三行', JSON.stringify(back[2][3]))
  check('数字往返为 "3"', back[1][5] === '3', JSON.stringify(back[1][5]))
  check('超长文本被安全截断（不撑坏文件）',
    back[3][3].length === 32767 && back[3][3].endsWith('...'),
    'len=' + back[3][3].length)
}

console.log('\n[5] 边界与异常')
{
  check('空数据不崩', readXlsx(writeXlsx([])).length === 0)
  check('单行单列', readXlsx(writeXlsx([['只有一个格子']]))[0][0] === '只有一个格子')
  check('null/undefined 视为空串', readXlsx(writeXlsx([['a', null, undefined, 'd']]))[0][3] === 'd')

  // 从网页复制题干常混入不可见控制字符，必须剔除，否则 Excel 判定文件损坏
  const dirty = '正常文本\u0000\u0008带控制字符'
  const cleaned = readXlsx(writeXlsx([[dirty]]))[0][0]
  check('剔除 XML 非法控制字符', cleaned === '正常文本带控制字符', JSON.stringify(cleaned))

  let caught = ''
  try { readXlsx(Buffer.from('this is not a zip file at all')) } catch (e) { caught = e.message }
  check('非 xlsx 文件给出可读提示', /不是 \.xlsx 文件/.test(caught), caught)

  let caught2 = ''
  try { readXlsx(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])) } catch (e) { caught2 = e.message }
  check('损坏 zip 有明确报错', caught2.length > 0, caught2)

  // 工作表名里的非法字符必须替换，否则 Excel 打不开。
  // 注意：xlsx 是压缩包，必须解包后再核对，不能在压缩字节里搜明文。
  const sheetNameOf = (b) => {
    const wb = unzip(b)['xl/workbook.xml'].toString('utf8')
    return (wb.match(/<sheet name="([^"]*)"/) || [])[1]
  }
  check('工作表名非法字符被替换',
    sheetNameOf(writeXlsx([['x']], { sheetName: 'a/b\\c?d*e[f]g' })) === 'a_b_c_d_e_f_g',
    sheetNameOf(writeXlsx([['x']], { sheetName: 'a/b\\c?d*e[f]g' })))
  check('工作表名超 31 字被截断',
    sheetNameOf(writeXlsx([['x']], { sheetName: '名'.repeat(50) })).length === 31)
}

console.log('\n[6] 端到端：题库 → 导出 Excel → 重新读回 → 解析（含问答题）')
{
  // 模拟 BankManager 导出：db.exportBank 返回的扁平行 → bankToMatrix → writeXlsx
  const bank = [
    { subject: '二级建造师', chapter: '施工管理', type: 'single', stem: '项目管理的核心任务是（ ）。',
      options: [{ key: 'A', text: '目标控制' }, { key: 'B', text: '成本控制' }], answer: ['A'],
      keywords: [], analysis: '目标控制是核心。', difficulty: 2, source: '2024真题' },
    { subject: '二级建造师', chapter: '施工管理', type: 'essay', stem: '简述施工进度计划编制的主要步骤。',
      options: [], answer: ['① 收集资料；② 划分施工过程；③ 计算工程量与劳动量；④ 确定各工序持续时间；⑤ 绘制网络图/横道图；⑥ 检查关键线路并优化资源；⑦ 交底后动态调整。'],
      keywords: ['收集资料', '划分施工过程', '计算工程量', '绘制网络图', '优化关键线路'],
      analysis: '按采分点给分。', difficulty: 4, source: '教材例题' }
  ]
  const matrix = bankToMatrix(bank)
  const xlsxBuf = writeXlsx(matrix, { sheetName: '题库' })

  // 模拟 ImportWizard 导入：readXlsx → parseMatrix
  const back = readXlsx(xlsxBuf)
  const parsed = parseMatrix(back)
  check('无致命错误', !parsed.fatal, parsed.fatal)
  check('读出 2 行', parsed.summary.total === 2, 'total=' + parsed.summary.total)
  check('2 行全部合格', parsed.summary.ok === 2, JSON.stringify(parsed.results.filter(x => !x.ok).map(x => x.errors)))

  const single = parsed.results[0].data
  const essay = parsed.results[1].data
  check('单选题型保留', single.type === 'single', single.type)
  check('单选答案保留', JSON.stringify(single.answer) === '["A"]', JSON.stringify(single.answer))
  check('问答题型保留', essay.type === 'essay', essay.type)
  check('问答题无选项', essay.options.length === 0)
  check('问答题答案整段保留', essay.answer.length === 1 && essay.answer[0].includes('收集资料') && essay.answer[0].includes('网络图'), JSON.stringify(essay.answer))
  check('问答题关键词全部保留',
    Array.isArray(essay.keywords) && essay.keywords.length === 5 && essay.keywords.includes('绘制网络图'),
    JSON.stringify(essay.keywords))
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
process.exit(fail ? 1 : 0)
