# -*- coding: utf-8 -*-
# 个人知识库数据层交叉验证（Python 标准库 sqlite3 镜像 electron/db.js 的 SQL 与逻辑）
# 覆盖：4 张新表 schema / addKbDoc 事务 / getKbDocs|getKbDoc / hash 去重 / 标签 / 联动 /
#       searchKb(LIKE+ESCAPE，中英文子串) / snippet / deleteKbDoc 级联删除
import sqlite3

PASS = 0
FAIL = 0

def check(name, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"✅ {name}")
    else:
        FAIL += 1
        print(f"❌ {name}")

SCHEMA = """
CREATE TABLE IF NOT EXISTS kb_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'md',
  rel_path TEXT NOT NULL UNIQUE,
  size INTEGER DEFAULT 0,
  hash TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  deleted INTEGER DEFAULT 0,
  client_id TEXT
);
CREATE TABLE IF NOT EXISTS kb_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  heading TEXT,
  content TEXT NOT NULL,
  char_start INTEGER,
  char_end INTEGER
);
CREATE TABLE IF NOT EXISTS kb_tags (
  doc_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (doc_id, tag)
);
CREATE TABLE IF NOT EXISTS kb_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  block_id INTEGER,
  question_id INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER,
  UNIQUE (doc_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_kb_blocks_doc ON kb_blocks(doc_id);
CREATE INDEX IF NOT EXISTS idx_kb_links_q ON kb_links(question_id);
CREATE INDEX IF NOT EXISTS idx_kb_docs_deleted ON kb_docs(deleted);
-- 题库最小表（只验证 stemPreview 联动查询，非 KB 本身）
CREATE TABLE questions (id INTEGER PRIMARY KEY, stem TEXT, deleted INTEGER DEFAULT 0);
-- 题目标签最小表（L2 推荐「共享标签」路径）
CREATE TABLE question_tags (question_id INTEGER NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (question_id, tag));
"""

def new_conn():
    conn = sqlite3.connect(':memory:')
    conn.executescript(SCHEMA)
    return conn

# ---- 镜像 db.js 方法 ----

def add_kb_doc(c, title, type_, rel_path, size, hash_, blocks):
    now = 1000
    cur = c.execute(
        'INSERT INTO kb_docs (title, type, rel_path, size, hash, created_at, updated_at, deleted, client_id) VALUES (?,?,?,?,?,?,?,0,?)',
        (title, type_, rel_path, size, hash_, now, now, 'cid-1'))
    doc_id = cur.lastrowid
    for i, b in enumerate(blocks):
        c.execute('INSERT INTO kb_blocks (doc_id, seq, heading, content, char_start, char_end) VALUES (?,?,?,?,?,?)',
                  (doc_id, i, b.get('heading'), b.get('content', ''), b.get('charStart'), b.get('charEnd')))
    return doc_id

def get_kb_docs(c):
    rows = c.execute('SELECT * FROM kb_docs WHERE deleted=0 ORDER BY updated_at DESC').fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d['tags'] = [t[0] for t in c.execute('SELECT tag FROM kb_tags WHERE doc_id=? ORDER BY tag', (d['id'],))]
        d['linkCount'] = c.execute('SELECT COUNT(*) FROM kb_links WHERE doc_id=?', (d['id'],)).fetchone()[0]
        out.append(d)
    return out

def get_kb_doc(c, doc_id):
    row = c.execute('SELECT * FROM kb_docs WHERE id=? AND deleted=0', (doc_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d['tags'] = [t[0] for t in c.execute('SELECT tag FROM kb_tags WHERE doc_id=? ORDER BY tag', (doc_id,))]
    d['blocks'] = [dict(r) for r in c.execute('SELECT id, seq, heading, content FROM kb_blocks WHERE doc_id=? ORDER BY seq', (doc_id,))]
    d['links'] = get_kb_links_for_doc(c, doc_id)
    return d

def find_kb_doc_by_hash(c, hash_):
    if not hash_:
        return None
    row = c.execute('SELECT id, title, type FROM kb_docs WHERE hash=? AND deleted=0 LIMIT 1', (hash_,)).fetchone()
    return dict(row) if row else None

def update_kb_doc(c, doc_id, patch):
    cur = c.execute('SELECT * FROM kb_docs WHERE id=? AND deleted=0', (doc_id,)).fetchone()
    if not cur:
        return None
    title = patch.get('title', cur['title'])
    hash_ = patch.get('hash', cur['hash'])
    size = patch.get('size', cur['size'])
    c.execute('UPDATE kb_docs SET title=?, hash=?, size=?, updated_at=? WHERE id=?', (title, hash_, size, 2000, doc_id))
    return get_kb_doc(c, doc_id)

def set_kb_tags(c, doc_id, tags):
    c.execute('DELETE FROM kb_tags WHERE doc_id=?', (doc_id,))
    for t in tags:
        t = str(t).strip()
        if t:
            c.execute('INSERT OR IGNORE INTO kb_tags (doc_id, tag) VALUES (?,?)', (doc_id, t))
    return get_kb_doc(c, doc_id)

def list_kb_tags(c):
    return c.execute('SELECT tag, COUNT(*) AS n FROM kb_tags GROUP BY tag ORDER BY tag').fetchall()

def link_kb_doc(c, doc_id, question_id, block_id=None, note=''):
    c.execute('INSERT OR IGNORE INTO kb_links (doc_id, block_id, question_id, note, created_at) VALUES (?,?,?,?,?)',
              (doc_id, block_id, question_id, note, 3000))

def unlink_kb_doc(c, doc_id, question_id):
    c.execute('DELETE FROM kb_links WHERE doc_id=? AND question_id=?', (doc_id, question_id))

def get_kb_links_for_question(c, question_id):
    return c.execute(
        'SELECT l.id, l.doc_id, l.block_id, l.note, l.created_at, d.title, d.type, d.rel_path '
        'FROM kb_links l JOIN kb_docs d ON d.id=l.doc_id '
        'WHERE l.question_id=? AND d.deleted=0 ORDER BY l.created_at DESC', (question_id,)).fetchall()

def get_kb_links_for_doc(c, doc_id):
    rows = c.execute('SELECT id, question_id, block_id, note, created_at FROM kb_links WHERE doc_id=? ORDER BY created_at DESC', (doc_id,)).fetchall()
    out = []
    for r in rows:
        q = c.execute('SELECT stem FROM questions WHERE id=? AND deleted=0', (r['question_id'],)).fetchone()
        out.append(dict(r, stemPreview=(q['stem'][:60] if q else '')))
    return out

def snippet(text, kw, length=80):
    t = str(text or '')
    i = t.lower().find(kw.lower())
    if i < 0:
        return t[:length]
    start = max(0, i - 40)
    return ('…' if start > 0 else '') + t[start:start + length] + ('…' if start + length < len(t) else '')

def search_kb(c, query, limit=20):
    kw = str(query or '').strip()
    if not kw:
        return []
    escaped = kw.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    like = '%' + escaped + '%'
    docs = c.execute(
        "SELECT id, title, type, rel_path, updated_at FROM kb_docs "
        "WHERE deleted=0 AND (title LIKE ? ESCAPE '\\' OR id IN "
        "(SELECT doc_id FROM kb_blocks WHERE content LIKE ? ESCAPE '\\')) "
        "ORDER BY updated_at DESC LIMIT ?", (like, like, limit)).fetchall()
    out = []
    for d in docs:
        blocks = c.execute(
            "SELECT id, seq, heading, content FROM kb_blocks WHERE doc_id=? AND content LIKE ? ESCAPE '\\' ORDER BY seq LIMIT 3",
            (d['id'], like)).fetchall()
        out.append(dict(d, matchedBlocks=[
            {'blockId': b['id'], 'heading': b['heading'], 'snippet': snippet(b['content'], kw, 80)} for b in blocks]))
    return out

def delete_kb_doc(c, doc_id):
    row = c.execute('SELECT * FROM kb_docs WHERE id=?', (doc_id,)).fetchone()
    if not row:
        return False
    c.execute('DELETE FROM kb_links WHERE doc_id=?', (doc_id,))
    c.execute('DELETE FROM kb_tags WHERE doc_id=?', (doc_id,))
    c.execute('DELETE FROM kb_blocks WHERE doc_id=?', (doc_id,))
    c.execute('DELETE FROM kb_docs WHERE id=?', (doc_id,))
    return True

# ---- L2 推荐镜像（electron/db.js extractKeywords / getSuggestedDocs*）----
import re

STOP = set(['下列', '关于', '正确', '错误', '说法', '描述', '属于', '不是', '什么', '为什么', '如何',
            '以下', '哪个', '哪些', '情况', '中的', '一种', '可以', '需要', '应该', '必须', '可能',
            '进行', '表示', '包括', '具有', '以及', '对于', '一个', '没有', '说明', '判断', '选择',
            '的是', '是的', '时候', '过程', '方式', '方法', '特点', '主要'])

def extract_keywords(text, max_=6):
    t = str(text or '')
    tokens = re.findall(r'[\u4e00-\u9fa5]{2,}', t) + re.findall(r'[A-Za-z]{3,}', t)
    seen, out = set(), []
    for tok in tokens:
        if tok in STOP or len(tok) < 2:
            continue
        k = tok.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(k)
    return out[:max_]

def suggest_docs_for_question(c, question_id, limit=5):
    q = c.execute('SELECT stem FROM questions WHERE id=? AND deleted=0', (question_id,)).fetchone()
    if not q:
        return []
    out, seen = [], set()

    def push(r, reason):
        if r['id'] in seen:
            return
        seen.add(r['id'])
        out.append({'id': r['id'], 'title': r['title'], 'type': r['type'], 'reason': reason})

    by_tag = c.execute(
        'SELECT DISTINCT d.id, d.title, d.type FROM kb_docs d '
        'JOIN kb_tags kt ON kt.doc_id=d.id JOIN question_tags qt ON qt.tag=kt.tag '
        'WHERE qt.question_id=? AND d.deleted=0 '
        'AND d.id NOT IN (SELECT doc_id FROM kb_links WHERE question_id=?)',
        (question_id, question_id)).fetchall()
    for r in by_tag:
        push(dict(r), '标签匹配')
    if len(out) < limit:
        kws = extract_keywords(q['stem'], 6)
        hit = {}
        for kw in kws:
            if len(out) + len(hit) >= limit:
                break
            like = '%' + kw.replace('%', '\\%').replace('_', '\\_') + '%'
            rows = c.execute(
                "SELECT d.id, d.title, d.type FROM kb_blocks b JOIN kb_docs d ON d.id=b.doc_id "
                "WHERE d.deleted=0 AND d.id NOT IN (SELECT doc_id FROM kb_links WHERE question_id=?) "
                "AND b.content LIKE ? ESCAPE '\\'", (question_id, like)).fetchall()
            for r in rows:
                hit.setdefault(r['id'], r)
        for r in hit.values():
            push(dict(r), '关键词命中')
    return out[:limit]

def suggest_questions_for_doc(c, doc_id, limit=5):
    doc = c.execute('SELECT id FROM kb_docs WHERE id=? AND deleted=0', (doc_id,)).fetchone()
    if not doc:
        return []
    out, seen = [], set()

    def push(r, reason):
        if r['id'] in seen:
            return
        seen.add(r['id'])
        out.append({'id': r['id'], 'stem': r['stem'], 'reason': reason})

    by_tag = c.execute(
        'SELECT DISTINCT q.id, q.stem FROM questions q '
        'JOIN question_tags qt ON qt.question_id=q.id JOIN kb_tags kt ON kt.tag=qt.tag '
        'WHERE kt.doc_id=? AND q.deleted=0 '
        'AND q.id NOT IN (SELECT question_id FROM kb_links WHERE doc_id=?)',
        (doc_id, doc_id)).fetchall()
    for r in by_tag:
        push(dict(r), '标签匹配')
    if len(out) < limit:
        blocks = c.execute('SELECT content FROM kb_blocks WHERE doc_id=? ORDER BY seq LIMIT 30', (doc_id,)).fetchall()
        seen_kw, kws = set(), []
        for b in blocks:
            for k in extract_keywords(b['content'], 8):
                if k not in seen_kw:
                    seen_kw.add(k)
                    kws.append(k)
        hit = {}
        for kw in kws[:10]:
            if len(hit) >= limit:
                break
            like = '%' + kw.replace('%', '\\%').replace('_', '\\_') + '%'
            rows = c.execute(
                "SELECT id, stem FROM questions WHERE deleted=0 "
                "AND id NOT IN (SELECT question_id FROM kb_links WHERE doc_id=?) "
                "AND stem LIKE ? ESCAPE '\\'", (doc_id, like)).fetchall()
            for r in rows:
                hit.setdefault(r['id'], r)
        for r in hit.values():
            push(dict(r), '关键词命中')
    return out[:limit]

def main():
    conn = new_conn()
    c = conn.cursor()
    c.row_factory = sqlite3.Row

    # 1. schema：4 张表存在
    tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    check('schema: kb_docs/kb_blocks/kb_tags/kb_links 四表', {'kb_docs', 'kb_blocks', 'kb_tags', 'kb_links'} <= tables)

    # 2. addKbDoc 事务插元数据+块（中文文档，3 个标题块）
    blocks1 = [
        {'heading': 'TCP 三次握手', 'content': 'tcp 三次握手的过程：SYN、SYN-ACK、ACK，客户端与服务端各一次确认。'},
        {'heading': '为什么不能两次', 'content': '两次握手无法防止历史连接复用，必须三次握手。'},
        {'heading': '挥手四次', 'content': 'tcp 断开连接时服务端与客户端各发一次 FIN 和 ACK。'},
    ]
    d1 = add_kb_doc(c, 'TCP 协议详解', 'md', 'tcp.md', 300, 'hash-tcp', blocks1)
    check('addKbDoc 返回 docId', isinstance(d1, int) and d1 > 0)
    check('addKbDoc 块数=3', c.execute('SELECT COUNT(*) FROM kb_blocks WHERE doc_id=?', (d1,)).fetchone()[0] == 3)

    # 3. 第二篇无标题文档（零格式门槛：整篇一块）
    d2 = add_kb_doc(c, '雅思写作范文', 'md', 'ielts.md', 120, 'hash-ielts', [{'heading': None, 'content': 'Some people think that international tourism creates tension rather than understanding.'}])
    check('无标题文档整篇一块', c.execute('SELECT COUNT(*) FROM kb_blocks WHERE doc_id=?', (d2,)).fetchone()[0] == 1)

    # 4. getKbDocs / getKbDoc
    docs = get_kb_docs(c)
    check('getKbDocs 返回 2 篇且带 tags', len(docs) == 2 and docs[0]['tags'] == [])
    g1 = get_kb_doc(c, d1)
    check('getKbDoc 块序与标题正确', [b['heading'] for b in g1['blocks']][:2] == ['TCP 三次握手', '为什么不能两次'])
    check('getKbDoc 不存在返回 None', get_kb_doc(c, 999) is None)

    # 5. hash 去重（导入主流程用 findKbDocByHash 判重）
    dup = find_kb_doc_by_hash(c, 'hash-tcp')
    check('findKbDocByHash 命中', dup and dup['id'] == d1)
    check('findKbDocByHash 未命中/空', find_kb_doc_by_hash(c, 'nope') is None and find_kb_doc_by_hash(c, None) is None)

    # 6. updateKbDoc 改名
    upd = update_kb_doc(c, d1, {'title': 'TCP 协议详解（新版）'})
    check('updateKbDoc 改名生效', upd['title'] == 'TCP 协议详解（新版）')

    # 7. 标签 + listKbTags
    set_kb_tags(c, d1, ['网络', '高频', '', '  '])
    set_kb_tags(c, d2, ['雅思', '写作'])
    check('setKbTags 去空去重', get_kb_doc(c, d1)['tags'] == ['网络', '高频'])
    tags = list_kb_tags(c)
    check('listKbTags 聚合 4 个标签', len(tags) == 4 and dict((t['tag'], t['n']) for t in tags)['网络'] == 1)

    # 8. 联动：文档↔题目
    c.execute('INSERT INTO questions (id, stem) VALUES (?,?)', (11, 'TCP 三次握手发生在哪两层？这是一道超长的题目用来测试截断'))
    c.execute('INSERT INTO questions (id, stem) VALUES (?,?)', (12, '国际旅游相关观点题'))
    link_kb_doc(c, d1, 11, block_id=None, note='核心考点')
    link_kb_doc(c, d1, 12)
    q_links = get_kb_links_for_question(c, 11)
    check('getKbLinksForQuestion 返回文档标题', len(q_links) == 1 and q_links[0]['title'] == 'TCP 协议详解（新版）')
    d_links = get_kb_links_for_doc(c, d1)
    check('getKbLinksForDoc 2 条且带题干摘要', len(d_links) == 2 and d_links[0]['stemPreview'].startswith('TCP'))
    check('UNIQUE(doc_id,question_id) 防重复', link_kb_doc(c, d1, 11) is None and len(get_kb_links_for_question(c, 11)) == 1)

    # 9. searchKb：中文子串 / 英文大小写 / 空串
    r_cn = search_kb(c, '三次握手')
    check('搜索中文命中文档', len(r_cn) == 1 and r_cn[0]['id'] == d1)
    check('搜索返回块摘要含关键词', r_cn[0]['matchedBlocks'][0]['snippet'].find('三次握手') >= 0)
    r_en = search_kb(c, 'TCP')
    check('搜索英文大小写不敏感命中', len(r_en) == 1 and len(r_en[0]['matchedBlocks']) == 2)
    check('搜索空串返回空', search_kb(c, '   ') == [])
    check('搜索标题命中', len(search_kb(c, '写作范文')) == 1 and search_kb(c, '写作范文')[0]['id'] == d2)

    # 10. LIKE 转义：% 与 _ 是字面量，不匹配所有
    r_pct = search_kb(c, '%')
    check('LIKE 转义: % 不匹配全部', r_pct == [])

    # 11. snippet 居中截断
    long_t = 'x' * 200 + '三次握手' + 'y' * 200
    sn = snippet(long_t, '三次握手', 80)
    check('snippet 命中且首尾省略号', sn.startswith('…') and sn.endswith('…') and sn.find('三次握手') >= 0)

    # 12. L2 关键词提取（零 ML 分词 + 停用词 + 去重）
    # 注：无标点长中文会被贪婪并成一个 token（零 ML 方案的固有边界，靠标签路径兜底），
    # 因此用例用带分隔的文本验证分词、停用词与去重逻辑本身。
    kws = extract_keywords('TCP 三次握手 需要 四次挥手', 8)
    check('extractKeywords 中文词提取', '三次握手' in kws and '四次挥手' in kws)
    check('extractKeywords 英文词提取', 'tcp' in extract_keywords('TCP 连接建立', 6))
    check('extractKeywords 停用词过滤', '为什么' not in kws and '需要' not in kws)
    check('extractKeywords 去重', len(kws) == len(set(kws)))

    # 13. L2 推荐：题目→文档（共享标签 + 关键词路径，排除已关联）
    c.execute('INSERT INTO question_tags (question_id, tag) VALUES (?,?)', (12, '写作'))
    c.execute('INSERT INTO question_tags (question_id, tag) VALUES (?,?)', (12, '雅思'))
    c.execute('INSERT INTO questions (id, stem) VALUES (?,?)', (13, 'TCP 连接建立的过程是什么？'))
    c.execute('INSERT INTO question_tags (question_id, tag) VALUES (?,?)', (13, '网络'))
    c.execute('INSERT INTO questions (id, stem) VALUES (?,?)', (15, 'TCP 三次握手：为什么需要四次挥手？'))
    sd13 = suggest_docs_for_question(c, 13)
    check('题目→文档: 共享标签命中(网络)', any(x['id'] == 1 and x['reason'] == '标签匹配' for x in sd13))
    sd12 = suggest_docs_for_question(c, 12)
    check('题目→文档: 共享标签命中(写作/雅思)', any(x['id'] == 2 and x['reason'] == '标签匹配' for x in sd12))
    sd15 = suggest_docs_for_question(c, 15)
    check('题目→文档: 无标签靠关键词命中', any(x['id'] == 1 and x['reason'] == '关键词命中' for x in sd15))

    # 14. L2 推荐：文档→题目（反向）
    sq2 = suggest_questions_for_doc(c, 2)
    check('文档→题目: 共享标签命中(写作/雅思)', any(x['id'] == 12 and x['reason'] == '标签匹配' for x in sq2))
    sq1 = suggest_questions_for_doc(c, 1)
    check('文档→题目: 共享标签命中(网络)', any(x['id'] == 13 and x['reason'] == '标签匹配' for x in sq1))
    check('文档→题目: 关键词路径命中', any(x['id'] == 15 and x['reason'] == '关键词命中' for x in sq1))
    check('文档→题目: 上限 5 条', len(sq1) <= 5)

    # 15. 已关联排除：q13 关联 d1 后不再被推荐
    link_kb_doc(c, 1, 13)
    check('已关联排除: 关联后不再推荐', not any(x['id'] == 1 for x in suggest_docs_for_question(c, 13)))

    # 16. deleteKbDoc 级联删除
    ok = delete_kb_doc(c, d1)
    check('deleteKbDoc 返回 ok', ok)
    check('级联: 文档删除', c.execute('SELECT COUNT(*) FROM kb_docs WHERE id=?', (d1,)).fetchone()[0] == 0)
    check('级联: 块删除', c.execute('SELECT COUNT(*) FROM kb_blocks WHERE doc_id=?', (d1,)).fetchone()[0] == 0)
    check('级联: 标签删除', c.execute('SELECT COUNT(*) FROM kb_tags WHERE doc_id=?', (d1,)).fetchone()[0] == 0)
    check('级联: 链接删除', c.execute('SELECT COUNT(*) FROM kb_links WHERE doc_id=?', (d1,)).fetchone()[0] == 0)

    conn.close()
    print(f"\n=== kb 数据层交叉验证：{PASS} 通过 / {FAIL} 失败 ===")
    sys_exit(1 if FAIL else 0)

def sys_exit(code):
    import sys
    sys.exit(code)

if __name__ == '__main__':
    main()
