# 交叉验证 db-stats.js getAchievements 新增 5 条 SQL（建表复制真实 schema，含迁移加的列）
import sqlite3, os, tempfile

db = sqlite3.connect(':memory:')
c = db.cursor()

# ---- 复制真实 schema（来自 db-schema.js + 迁移加的列）----
c.execute('''CREATE TABLE favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, question_id INTEGER NOT NULL,
  fav_group TEXT, created_at INTEGER, client_id TEXT, question_cid TEXT, updated_at INTEGER, deleted INTEGER DEFAULT 0
)''')
c.execute('''CREATE TABLE cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT, front TEXT NOT NULL, back TEXT NOT NULL, category TEXT DEFAULT '',
  subject_id INTEGER, source_question_id INTEGER, review_at INTEGER, review_count INTEGER DEFAULT 0,
  review_lapses INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER, deleted INTEGER DEFAULT 0, client_id TEXT
)''')
c.execute('''CREATE TABLE review_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_type TEXT NOT NULL, item_id INTEGER NOT NULL,
  result INTEGER DEFAULT 1, created_at INTEGER, client_id TEXT
)''')
c.execute('''CREATE TABLE focus_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, minutes INTEGER NOT NULL, started_at INTEGER,
  created_at INTEGER, deleted INTEGER DEFAULT 0, client_id TEXT
)''')
c.execute('''CREATE TABLE habit_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, habit_id INTEGER NOT NULL, check_date TEXT NOT NULL,
  created_at INTEGER, client_id TEXT, UNIQUE (habit_id, check_date)
)''')

# ---- 样例数据 ----
# favorites：user 1 有 4 条（3 个非空分组 + 1 个空分组），user 2 有 1 条
c.executemany('INSERT INTO favorites (user_id, question_id, fav_group, deleted) VALUES (?,?,?,?)',
  [(1, 101, '高频错题', 0), (1, 102, '冲刺必背', 0), (1, 103, '高频错题', 0), (1, 104, '', 0), (1, 105, '易混', 0), (2, 201, '收藏夹', 1)])
# cards：3 张有效 + 1 张软删
c.executemany('INSERT INTO cards (front, back, deleted) VALUES (?,?,?)',
  [('a','b',0), ('c','d',0), ('e','f',0), ('g','h',1)])
# review_logs：4 条
c.executemany('INSERT INTO review_logs (item_type, item_id, result, created_at) VALUES (?,?,?,?)',
  [('card',1,1,1000), ('card',2,0,2000), ('block',3,1,3000), ('card',4,1,4000)])
# focus_sessions：50+30 有效 + 20 软删
c.executemany('INSERT INTO focus_sessions (minutes, deleted) VALUES (?,?)',
  [(50,0), (30,0), (20,1)])
# habit_checks：7 条
c.executemany('INSERT INTO habit_checks (habit_id, check_date) VALUES (?,?)',
  [(1,'2026-08-01'), (1,'2026-08-02'), (2,'2026-08-01'), (2,'2026-08-02'), (2,'2026-08-03'), (3,'2026-08-01'), (3,'2026-08-02')])

LOCAL_USER = 1

# ---- 镜像 db-stats.js 的 5 条 SQL ----
favGroups = c.execute("SELECT COUNT(DISTINCT fav_group) AS n FROM favorites WHERE user_id=? AND deleted=0 AND TRIM(IFNULL(fav_group,''))<>''", (LOCAL_USER,)).fetchone()[0]
cardsCount = c.execute('SELECT COUNT(*) AS n FROM cards WHERE deleted=0').fetchone()[0]
reviewCount = c.execute('SELECT COUNT(*) AS n FROM review_logs').fetchone()[0]
focusMin = c.execute('SELECT COALESCE(SUM(minutes),0) AS n FROM focus_sessions WHERE deleted=0').fetchone()[0]
habitChecks = c.execute('SELECT COUNT(*) AS n FROM habit_checks').fetchone()[0]

# ---- 断言 ----
assert favGroups == 3, f'favGroups 期望 3 实际 {favGroups}'
assert cardsCount == 3, f'cardsCount 期望 3 实际 {cardsCount}'
assert reviewCount == 4, f'reviewCount 期望 4 实际 {reviewCount}'
assert focusMin == 80, f'focusMin 期望 80 实际 {focusMin}'
assert habitChecks == 7, f'habitChecks 期望 7 实际 {habitChecks}'

print('PASS: favGroups=3 cardsCount=3 reviewCount=4 focusMin=80 habitChecks=7')
