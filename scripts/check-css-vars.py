#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CSS 变量引用/定义一致性检查（项目规则 23 的落地脚本）。

用途：找出所有 `var(--xxx)` 引用但全项目都没有 `--xxx:` 定义（或 @property 注册）的变量。
这类引用在运行时 var() 解析失败 → 颜色/尺寸静默失效（历史事故：--good 从未定义，
答题卡"答对"状态/标记掌握按钮颜色失效，抽查式审查没抓到）。

运行：
    python scripts/check-css-vars.py            # 默认扫 src/
    python scripts/check-css-vars.py --exit1    # 有未定义引用时退出码 1（CI 用）

判定规则：
1. 定义来源：任何文件里出现 `--name:`（:root/[data-theme]/组件 scoped/模板内联 style 均可）；
   `@property --name` 全局注册也算定义。
2. 引用：`var(--name)`；带 fallback（`var(--name,`）的引用不报（有兜底值）。
3. 白名单：JS 运行期 setProperty 动态注入的变量（tiltRx/tiltRy 等），静态扫描看不到定义，
   放白名单避免误报；白名单项应尽量少，新增需在下方注释说明理由。
4. fallback 里再引用 var(--other) 且 --other 未定义：也报（链条断裂）。
"""
import re
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'src'
EXT = ('*.vue', '*.css', '*.js')

# JS 运行期动态注入的 CSS 变量（静态扫描无法看到定义，逐一注释理由）
DYNAMIC_VARS = {
    '--tiltrx': 'tilt.js setProperty --tiltRx（3D 倾斜重力）',
    '--tiltry': 'tilt.js setProperty --tiltRy（3D 倾斜重力）',
    '--ang': 'style.css @property --ang（应被 @property 捕获，兜底白名单）',
    '--kb-md-fs': 'KbReader 模板 :style 动态绑定（{\'--kb-md-fs\': fontSize+\'px\'}）',
    '--ui-zoom': 'appearance.js setProperty --ui-zoom（移动端字号缩放，zoom<1 时布局反向放大）',
}

DEF_RE = re.compile(r'--([a-zA-Z][\w-]*)\s*:')
PROPERTY_RE = re.compile(r'@property\s+--([a-zA-Z][\w-]*)')
REF_RE = re.compile(r'var\(\s*--([a-zA-Z][\w-]*)\s*\)')
REF_FALLBACK_RE = re.compile(r'var\(\s*--([a-zA-Z][\w-]*)\s*,')


def collect(files):
    defined = set()
    prop_reg = set()
    refs = []  # (file, lineno, name)
    fallback_refs = []  # (file, lineno, name) fallback 内引用的变量名
    for f in files:
        try:
            text = f.read_text(encoding='utf-8')
        except (OSError, UnicodeDecodeError):
            continue
        for m in DEF_RE.finditer(text):
            defined.add(m.group(1).lower())
        for m in PROPERTY_RE.finditer(text):
            prop_reg.add(m.group(1).lower())
        for i, line in enumerate(text.splitlines(), 1):
            for m in REF_RE.finditer(line):
                refs.append((f, i, m.group(1).lower()))
            for m in REF_FALLBACK_RE.finditer(line):
                fallback_refs.append((f, i, m.group(1).lower()))
    return defined, prop_reg, refs, fallback_refs


def main():
    files = []
    for e in EXT:
        files.extend(ROOT.rglob(e))
    defined, prop_reg, refs, fallback_refs = collect(files)

    available = defined | prop_reg
    problems = []

    # 无 fallback 且未定义的引用（--good 式真 bug：var() 解析失败 → 样式静默失效）
    for f, i, name in refs:
        if name not in available and name not in DYNAMIC_VARS and ('--' + name) not in DYNAMIC_VARS:
            problems.append((f, i, name, 'var(--%s) 无 fallback 且无定义' % name))
    # 注：带 fallback 的引用（var(--x, 兜底值)）有兜底，不算问题；
    #     若 fallback 值本身是 var() 且该变量未定义（链条断裂），会被上面的 refs 捕获。

    if not problems:
        print('OK：全部 var() 引用均有定义（%d 个定义 / %d 个 @property / %d 个引用）'
              % (len(defined), len(prop_reg), len(refs)))
        return 0

    problems.sort(key=lambda p: str(p[0]))
    print('发现 %d 处未定义变量引用：' % len(problems))
    for f, i, name, msg in problems:
        print('  %s:%d  --%s  %s' % (f.relative_to(ROOT.parent), i, name, msg))
    return 1


if __name__ == '__main__':
    sys.exit(main())
