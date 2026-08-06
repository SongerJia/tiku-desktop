"""
用 Python 标准库（zipfile + 手写 XML）造一个「真实 Excel 结构」的 .xlsx，
用来验证 electron/xlsx-lite.js 的读取器能吃下标准文件。

刻意覆盖这些真实场景：
  - sharedStrings 共享字符串（Excel 默认就是这么存的，不是 inlineStr）
  - deflate 压缩（不是 stored）
  - 中文、英文、特殊字符 & < > " '
  - 单元格内换行
  - 数字单元格（无 t 属性）
  - 跳列（B 列整列为空）
  - 跳行（中间空一行）
  - 布尔值
"""
import zipfile
import sys
from xml.sax.saxutils import escape

# (行号, 列字母, 值, 类型)  类型: s=共享串, n=数字, b=布尔
DATA = [
    (1, 'A', '科目', 's'), (1, 'C', '题型', 's'), (1, 'D', '题干', 's'), (1, 'E', '答案', 's'), (1, 'F', '难度', 's'),
    (2, 'A', '二级建造师', 's'), (2, 'C', '单选', 's'),
    (2, 'D', '下列符号 & < > " \' 都要能原样读出', 's'), (2, 'E', 'A', 's'), (2, 'F', 3, 'n'),
    # 第 3 行整行留空，验证跳行补位
    (4, 'A', '二级建造师', 's'), (4, 'C', '问答', 's'),
    (4, 'D', '简述施工进度控制的措施。\n第二行\n第三行', 's'),
    (4, 'E', '组织措施；技术措施；经济措施', 's'), (4, 'F', 5, 'n'),
    (5, 'A', 'TRUE 测试', 's'), (5, 'C', '判断', 's'), (5, 'D', '布尔单元格', 's'), (5, 'E', True, 'b'), (5, 'F', 1, 'n'),
]

# 收集共享字符串
shared = []
index = {}
for _, _, v, t in DATA:
    if t == 's':
        if v not in index:
            index[v] = len(shared)
            shared.append(v)

rows = {}
for r, c, v, t in DATA:
    rows.setdefault(r, []).append((c, v, t))

sheet_rows = []
for r in sorted(rows):
    cells = []
    for c, v, t in rows[r]:
        ref = f'{c}{r}'
        if t == 's':
            cells.append(f'<c r="{ref}" t="s"><v>{index[v]}</v></c>')
        elif t == 'b':
            cells.append(f'<c r="{ref}" t="b"><v>{1 if v else 0}</v></c>')
        else:
            cells.append(f'<c r="{ref}"><v>{v}</v></c>')
    sheet_rows.append(f'<row r="{r}">{"".join(cells)}</row>')

sheet_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    f'<sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
)

sst_items = ''.join(
    f'<si><t xml:space="preserve">{escape(s, {chr(34): "&quot;"})}</t></si>' for s in shared
)
sst_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(shared)}" uniqueCount="{len(shared)}">'
    f'{sst_items}</sst>'
)

content_types = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
    '</Types>'
)
root_rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    '</Relationships>'
)
# 注意：这里刻意把工作表命名为 sheet_main.xml（不是 sheet1.xml），
# 强制读取器必须走 workbook.xml.rels 关系解析，而不是靠猜文件名。
workbook = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    '<sheets><sheet name="题库" sheetId="1" r:id="rId1"/></sheets></workbook>'
)
wb_rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet_main.xml"/>'
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
    '</Relationships>'
)

out = sys.argv[1] if len(sys.argv) > 1 else 'fixture.xlsx'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', content_types)
    z.writestr('_rels/.rels', root_rels)
    z.writestr('xl/workbook.xml', workbook)
    z.writestr('xl/_rels/workbook.xml.rels', wb_rels)
    z.writestr('xl/sharedStrings.xml', sst_xml)
    z.writestr('xl/worksheets/sheet_main.xml', sheet_xml)

print('fixture written:', out)
