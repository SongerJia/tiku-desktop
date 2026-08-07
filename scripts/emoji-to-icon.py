# 批量：组件 template 内功能 emoji → Icon 组件（装饰性 emoji 保留）
import io, re, glob

MAP = {
    '📚': 'book', '🎯': 'target', '⭐': 'star', '★': 'star', '✎': 'note', '📒': 'note',
    '🔥': 'fire', '🔁': 'refresh', '🏷': 'tag', '⚙': 'settings', '☁': 'cloud',
    '🧠': 'pulse', '🗂': 'folder', '📝': 'paper', '📄': 'doc', '🔍': 'search',
    '🏆': 'trophy', '⏱': 'clock', '📊': 'chart', '📈': 'chart', '📋': 'paper',
    '💡': 'bulb', '📅': 'calendar', '🗑': 'trash', '🔗': 'link',
    '🔃': 'refresh', '🔄': 'refresh', '✗': 'x', '✕': 'x', '✓': 'check'
}
KEEP = set('🎉💙🎊✨📖💪🤔📕🎈🧠')  # 装饰性保留

def to_icon(emoji, size=16):
    return f'<Icon name="{MAP[emoji]}" :size="{size}"/>'

changed = []
for path in glob.glob('src/components/*.vue') + ['src/App.vue']:
    t = io.open(path, encoding='utf-8').read()
    m = re.search(r'<template>([\s\S]*?)</template>', t)
    if not m:
        continue
    tmpl = m.group(1)
    orig = tmpl
    # 模式 A：<span class="xx">emoji</span>
    for e, name in MAP.items():
        pat = re.compile(r'(<span[^>]*class="[^"]*")>(' + re.escape(e) + r'\uFE0F?)</span>')
        tmpl = pat.sub(lambda mm: f'{mm.group(1)}><Icon name="{name}" :size="16"/></span>', tmpl)
    # 模式 B：剩余裸 emoji 文本 → 图标（前后留空格）
    for e, name in MAP.items():
        # 跳过已被处理的（A 已把 span 内换掉）；处理文本内联
        tmpl = tmpl.replace(e + '\uFE0F', e)
        tmpl = re.sub(re.escape(e), lambda mm: f'<Icon name="{name}" :size="14"/>', tmpl)
    if tmpl != orig:
        t = t[:m.start(1)] + tmpl + t[m.end(1):]
        if 'import Icon' not in t and '<Icon ' in t:
            t = t.replace('<script setup>', "<script setup>\nimport Icon from './Icon.vue'", 1)
        io.open(path, 'w', encoding='utf-8', newline='').write(t)
        changed.append(path)
        print('OK', path)

print('changed', len(changed))
