# 验证标签筛选 SQL（AND 语义）：题目须带全部所选标签。
# 镜像 db.js getQuestions / listQuestions 中的标签子查询逻辑。
import sqlite3, json, sys

con = sqlite3.connect(':memory:')
c = con.cursor()
c.executescript('''
CREATE TABLE questions (id INTEGER PRIMARY KEY, deleted INTEGER DEFAULT 0, stem TEXT);
CREATE TABLE question_tags (question_id INTEGER, tag TEXT);
''')
items = [
  (1, '高频+易错'), (2, '高频'), (3, '易错'), (4, '无标签'), (5, '易错+必背')
]
c.executemany('INSERT INTO questions (id, stem) VALUES (?,?)', items)
tagmap = {1: ['高频','易错'], 2: ['高频'], 3: ['易错'], 4: [], 5: ['易错','必背']}
for qid, tags in tagmap.items():
    for t in tags:
        c.execute('INSERT INTO question_tags (question_id, tag) VALUES (?,?)', (qid, t))

def filter_by_tags(tags):
    sql = 'SELECT id FROM questions WHERE deleted=0'
    params = []
    for t in tags:
        sql += ' AND id IN (SELECT question_id FROM question_tags WHERE tag=?)'
        params.append(t)
    return sorted(r[0] for r in c.execute(sql, params).fetchall())

def check(name, got, exp):
    ok = got == exp
    print(f"{'✅' if ok else '❌'} {name}: got={got} exp={exp}")
    return ok

r = True
r &= check('filter[高频,易错] -> 仅1', filter_by_tags(['高频','易错']), [1])
r &= check('filter[高频] -> 1,2', filter_by_tags(['高频']), [1, 2])
r &= check('filter[易错] -> 1,3,5', filter_by_tags(['易错']), [1, 3, 5])
r &= check('filter[必背] -> 5', filter_by_tags(['必背']), [5])
r &= check('filter[不存在] -> 空', filter_by_tags(['zzz']), [])
r &= check('filter[] -> 全部', filter_by_tags([]), [1, 2, 3, 4, 5])

print('标签筛选 SQL 全部通过' if r else '标签筛选 SQL 存在失败')
sys.exit(0 if r else 1)
