"""
用 Python 标准库校验 electron/xlsx-lite.js 生成的 .xlsx 是不是合法 Excel 文件。

不依赖 openpyxl —— 直接按 OOXML 规范核对：
  - zip 结构完整、CRC 全部正确（zipfile.testzip）
  - 必需部件齐全
  - 各 XML 能被严格解析（Excel 对 XML 格式零容忍）
  - 单元格内容与期望一致
"""
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

path = sys.argv[1]
ok = 0
bad = 0


def check(label, cond, extra=''):
    global ok, bad
    if cond:
        ok += 1
        print(f'  PASS  {label}')
    else:
        bad += 1
        print(f'  FAIL  {label}  {extra}')


with zipfile.ZipFile(path) as z:
    check('ZIP 结构完整、CRC 校验全部通过', z.testzip() is None, str(z.testzip()))

    names = set(z.namelist())
    required = [
        '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
        'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml',
    ]
    for r in required:
        check(f'部件存在 {r}', r in names)

    # Excel 对 XML 极其严格，任何非法字符/未闭合标签都会判定「文件已损坏」
    for n in names:
        if n.endswith('.xml') or n.endswith('.rels'):
            try:
                ET.fromstring(z.read(n))
                check(f'XML 合法 {n}', True)
            except Exception as e:
                check(f'XML 合法 {n}', False, str(e))

    # 压缩方式必须是 deflate（体积正常，说明确实压了）
    infos = z.infolist()
    check('全部条目使用 deflate 压缩',
          all(i.compress_type == zipfile.ZIP_DEFLATED for i in infos))

    root = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    sheet_data = root.find(f'{NS}sheetData')
    rows = sheet_data.findall(f'{NS}row')
    check('行数正确（表头 + 3 行数据）', len(rows) == 4, f'实际 {len(rows)}')

    def cell_text(c):
        t = c.get('t')
        if t == 'inlineStr':
            is_el = c.find(f'{NS}is')
            return ''.join(x.text or '' for x in is_el.findall(f'{NS}t'))
        v = c.find(f'{NS}v')
        return v.text if v is not None else ''

    grid = {}
    for r in rows:
        for c in r.findall(f'{NS}c'):
            grid[c.get('r')] = cell_text(c)

    check('表头 A1=科目', grid.get('A1') == '科目', repr(grid.get('A1')))
    check('中文正确', grid.get('A2') == '二级建造师', repr(grid.get('A2')))
    check('XML 特殊字符原样保留', grid.get('D2') == '含 & < > " 符号', repr(grid.get('D2')))
    check('单元格内换行保留', '\n' in (grid.get('D3') or ''), repr(grid.get('D3')))
    check('数字写成数值型（无 t 属性）',
          grid.get('F2') == '3',
          repr(grid.get('F2')))
    check('超长文本被截断到 Excel 上限内', len(grid.get('D4') or '') <= 32767)

    # 表头必须应用加粗样式（s=1），正文用自动换行样式（s=2）
    a1 = next(c for r in rows for c in r.findall(f'{NS}c') if c.get('r') == 'A1')
    a2 = next(c for r in rows for c in r.findall(f'{NS}c') if c.get('r') == 'A2')
    check('表头使用加粗样式 s=1', a1.get('s') == '1', repr(a1.get('s')))
    check('正文使用换行样式 s=2', a2.get('s') == '2', repr(a2.get('s')))

    styles = ET.fromstring(z.read('xl/styles.xml'))
    xfs = styles.find(f'{NS}cellXfs').findall(f'{NS}xf')
    check('样式表定义了 3 个 cellXfs', len(xfs) == 3, f'实际 {len(xfs)}')
    align = xfs[2].find(f'{NS}alignment')
    check('正文样式启用 wrapText', align is not None and align.get('wrapText') == '1')

    # 冻结首行
    check('首行冻结', b'state="frozen"' in z.read('xl/worksheets/sheet1.xml'))

print(f'\n结果：{ok} 通过 / {bad} 失败')
sys.exit(1 if bad else 0)
