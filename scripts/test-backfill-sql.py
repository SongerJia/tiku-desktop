# 交叉验证 db.js 的 backfillClientIds() SQL 逻辑（沙箱装不了 better-sqlite3，用标准库 sqlite3 跑同款语句）。
# 验证：历史数据缺失的 client_id / *_cid 能被正确补齐，且外键 cid 能解析到正确的 client_id。
import sqlite3, uuid, json

db = sqlite3.connect(':memory:')
c = db.cursor()
c.executescript('''
CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, parent_id INTEGER, client_id TEXT, parent_cid TEXT, deleted INTEGER DEFAULT 0);
CREATE TABLE questions (id INTEGER PRIMARY KEY, category_id INTEGER, stem TEXT, client_id TEXT, category_cid TEXT, deleted INTEGER DEFAULT 0);
CREATE TABLE answer_records (id INTEGER PRIMARY KEY, question_id INTEGER, client_id TEXT, question_cid TEXT, deleted INTEGER DEFAULT 0);
CREATE TABLE wrong_books (id INTEGER PRIMARY KEY, question_id INTEGER, client_id TEXT, question_cid TEXT, deleted INTEGER DEFAULT 0);
CREATE TABLE favorites (id INTEGER PRIMARY KEY, question_id INTEGER, client_id TEXT, question_cid TEXT, deleted INTEGER DEFAULT 0);
CREATE TABLE notes (id INTEGER PRIMARY KEY, question_id INTEGER, client_id TEXT, question_cid TEXT, deleted INTEGER DEFAULT 0);
''')

# 插入"老库"数据：没有任何 client_id / *_cid（模拟升级前）
c.execute("INSERT INTO categories (id,name,parent_id) VALUES (1,'科目',NULL)")
c.execute("INSERT INTO categories (id,name,parent_id) VALUES (2,'章节',1)")
c.execute("INSERT INTO questions (id,category_id,stem) VALUES (10,2,'题1')")
c.execute("INSERT INTO answer_records (id,question_id) VALUES (100,10)")
c.execute("INSERT INTO wrong_books (id,question_id) VALUES (200,10)")
c.execute("INSERT INTO favorites (id,question_id) VALUES (300,10)")
c.execute("INSERT INTO notes (id,question_id) VALUES (400,10)")
db.commit()

# ---- 复刻 db.js backfillClientIds 的语句 ----
def setCid(table):
    rows = c.execute(f"SELECT id FROM {table} WHERE client_id IS NULL OR client_id=''").fetchall()
    for (rid,) in rows:
        c.execute(f"UPDATE {table} SET client_id=? WHERE id=?", (str(uuid.uuid4()), rid))

for t in ['categories','questions','answer_records','wrong_books','favorites','notes']:
    setCid(t)

def fix(table, fkCol, refTable, refCol):
    c.execute(f"""UPDATE {table} SET {fkCol}=(SELECT client_id FROM {refTable} r WHERE r.id={table}.{refCol})
                  WHERE {fkCol} IS NULL AND {refCol} IS NOT NULL""")

fix('questions','category_cid','categories','category_id')
fix('answer_records','question_cid','questions','question_id')
fix('wrong_books','question_cid','questions','question_id')
fix('favorites','question_cid','questions','question_id')
fix('notes','question_cid','questions','question_id')
fix('categories','parent_cid','categories','parent_id')
db.commit()

# ---- 断言 ----
errs = []
def check(cond, msg):
    if not cond: errs.append(msg)

# 1) 所有表 client_id 非空
for t in ['categories','questions','answer_records','wrong_books','favorites','notes']:
    n_null = c.execute(f"SELECT COUNT(*) FROM {t} WHERE client_id IS NULL OR client_id=''").fetchone()[0]
    check(n_null == 0, f"{t} 仍有空 client_id: {n_null}")

# 2) questions.category_cid == 题目所属章节(cat id=2)的 client_id（category_id 指向章节）
cat2_cid = c.execute("SELECT client_id FROM categories WHERE id=2").fetchone()[0]
q_cat_cid = c.execute("SELECT category_cid FROM questions WHERE id=10").fetchone()[0]
check(q_cat_cid == cat2_cid, f"questions.category_cid 应={cat2_cid}, 实={q_cat_cid}")

# 3) 依赖表 question_cid == 题(id=10)的 client_id
q10_cid = c.execute("SELECT client_id FROM questions WHERE id=10").fetchone()[0]
for t in ['answer_records','wrong_books','favorites','notes']:
    got = c.execute(f"SELECT question_cid FROM {t} WHERE id=?", ({"answer_records":100,"wrong_books":200,"favorites":300,"notes":400}[t],)).fetchone()[0]
    check(got == q10_cid, f"{t}.question_cid 应={q10_cid}, 实={got}")

# 4) categories.parent_cid == 父(cat id=1)的 client_id
cat1_cid = c.execute("SELECT client_id FROM categories WHERE id=1").fetchone()[0]
cat2_parent = c.execute("SELECT parent_cid FROM categories WHERE id=2").fetchone()[0]
check(cat2_parent == cat1_cid, f"categories.parent_cid 应={cat1_cid}, 实={cat2_parent}")

if errs:
    print("FAIL:")
    for e in errs: print("  -", e)
    raise SystemExit(1)
print("全部通过：backfillClientIds SQL 逻辑（6 表 client_id + 外键 cid 解析）正确")
