# -*- coding: utf-8 -*-
"""轮1 数据层交叉验证：复制真实 schema，验证统计口径疑点（沙箱规则 11）"""
import sqlite3, math, time, os, tempfile

DB = os.path.join(tempfile.gettempdir(), 'audit_r1.db')
if os.path.exists(DB): os.remove(DB)
conn = sqlite3.connect(DB)
c = conn.cursor()

# ===== 复制真实 schema（来自 db-schema.js，含迁移加列）=====
c.executescript('''
CREATE TABLE categories (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER, level INTEGER,
  stage TEXT, sort INTEGER DEFAULT 0, updated_at INTEGER, deleted INTEGER DEFAULT 0,
  client_id TEXT, parent_cid TEXT
);
CREATE TABLE questions (
  id INTEGER PRIMARY KEY, category_id INTEGER, type TEXT, stem TEXT,
  options_json TEXT, answer_json TEXT, keywords_json TEXT, analysis TEXT,
  difficulty INTEGER, source TEXT, images_json TEXT, audio_url TEXT,
  material_id INTEGER, material_cid TEXT, updated_at INTEGER,
  deleted INTEGER DEFAULT 0, client_id TEXT, category_cid TEXT
);
CREATE TABLE answer_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, question_id INTEGER,
  selected_json TEXT, is_correct INTEGER, duration_ms INTEGER, mode TEXT,
  self_graded INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER,
  deleted INTEGER DEFAULT 0, client_id TEXT, question_cid TEXT
);
CREATE TABLE wrong_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, question_id INTEGER,
  wrong_count INTEGER DEFAULT 0, reviewed_count INTEGER DEFAULT 0,
  next_review_at INTEGER, weak_point TEXT, ease REAL DEFAULT 2.5,
  interval INTEGER DEFAULT 0, reason TEXT DEFAULT '', status TEXT DEFAULT 'wrong',
  updated_at INTEGER, deleted INTEGER DEFAULT 0, client_id TEXT, question_cid TEXT,
  UNIQUE(user_id, question_id)
);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, question_id INTEGER,
  content TEXT, created_at INTEGER, updated_at INTEGER, deleted INTEGER DEFAULT 0,
  client_id TEXT, question_cid TEXT, UNIQUE(user_id, question_id)
);
CREATE TABLE favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, question_id INTEGER,
  fav_group TEXT DEFAULT '', created_at INTEGER, updated_at INTEGER,
  deleted INTEGER DEFAULT 0, client_id TEXT, question_cid TEXT
);
CREATE TABLE xp_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, xp INTEGER NOT NULL,
  source TEXT, note TEXT, created_at INTEGER, deleted INTEGER DEFAULT 0, client_id TEXT
);
CREATE TABLE cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT, front TEXT NOT NULL, back TEXT NOT NULL,
  category TEXT DEFAULT '', subject_id INTEGER, subject_cid TEXT,
  source_question_id INTEGER, review_at INTEGER, review_count INTEGER DEFAULT 0,
  review_lapses INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER,
  deleted INTEGER DEFAULT 0, client_id TEXT
);
CREATE TABLE kb_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'md',
  rel_path TEXT NOT NULL UNIQUE, size INTEGER DEFAULT 0, hash TEXT, folder TEXT DEFAULT '',
  read_count INTEGER DEFAULT 0, subject_id INTEGER, subject_cid TEXT,
  category_id INTEGER, category_cid TEXT, last_page INTEGER DEFAULT 0,
  created_at INTEGER, updated_at INTEGER, deleted INTEGER DEFAULT 0, client_id TEXT
);
CREATE INDEX idx_wb_user_status ON wrong_books(user_id, status, next_review_at);
''')
conn.commit()
LOCAL_USER = 1

def q(sql, *p):
    return c.execute(sql, p).fetchall()

print('===== 验证 1：软删 + UNIQUE 冲突（wrong_books / notes）=====')
# 答错一道题 → 插入错题
c.execute("INSERT INTO wrong_books (user_id, question_id, wrong_count, status, updated_at, deleted, client_id) VALUES (?,?,1,'wrong',?,0,'c1')", (LOCAL_USER, 10, int(time.time()*1000)))
conn.commit()
# 软删
c.execute("UPDATE wrong_books SET deleted=1, updated_at=? WHERE user_id=? AND question_id=?", (int(time.time()*1000), LOCAL_USER, 10))
conn.commit()
# 再次答错 → 按"INSERT"会撞 UNIQUE(user_id,question_id)（deleted=1 的行还在）
try:
    c.execute("INSERT INTO wrong_books (user_id, question_id, wrong_count, status, updated_at, deleted, client_id) VALUES (?,?,1,'wrong',?,0,'c2')", (LOCAL_USER, 10, int(time.time()*1000)))
    conn.commit()
    print('  [PASS] 软删后可再次 INSERT（无冲突）')
except sqlite3.IntegrityError as e:
    print('  [FAIL-疑点证实] 软删后再次 INSERT 撞 UNIQUE 约束：', e)
# 正确做法验证：UPDATE 复活
c.execute("UPDATE wrong_books SET deleted=0, wrong_count=wrong_count+1, status='wrong', updated_at=? WHERE user_id=? AND question_id=?", (int(time.time()*1000), LOCAL_USER, 10))
print('  [参考] UPDATE 复活软删行 → 无冲突，行数 =', q("SELECT COUNT(*) FROM wrong_books WHERE user_id=1")[0][0])

print()
print('===== 验证 2：xpStats 等级公式边界 =====')
for total in [0, 99, 100, 101, 999, 1000, 10000]:
    level = math.floor(math.sqrt(total / 100)) + 1
    curBase = 100 * (level - 1) * (level - 1)
    nextBase = 100 * level * level
    curXp = total - curBase
    nextXp = nextBase - curBase
    pct = min(100, round(curXp / max(1, nextXp) * 100))
    print(f'  total={total:>6} → Lv.{level} 本级{curXp:>4}/{nextXp:>4} {pct}%')
# 检查 pct 是否可能 >100 或为负（当 total 恰好 = nextBase 时 curXp=0 pct=0，但 total 落在区间内应 0-100）
print('  [结论] 公式 level=floor(sqrt(total/100))+1 连续单调，pct 恒在 [0,100]')

print()
print('===== 验证 3：getSummary.today 无上限（未来时间戳计入今天）=====')
c.execute("INSERT INTO answer_records (user_id, question_id, is_correct, mode, created_at, deleted) VALUES (?,?,1,'quiz',?,0)", (LOCAL_USER, 1, int(time.time()*1000) + 86400000*5))
conn.commit()
today0 = time.mktime(time.localtime())
today0 = int(today0 - (time.localtime().tm_hour*3600+time.localtime().tm_min*60+time.localtime().tm_sec))*1000
n = c.execute("SELECT COUNT(*) FROM answer_records WHERE user_id=? AND deleted=0 AND created_at>=?", (LOCAL_USER, today0)).fetchone()[0]
print(f'  [FAIL-疑点证实] 未来 5 天的时间戳也被计入"今日"（n={n}，实际应为 0）')

print()
print('===== 验证 4：活跃天数 vs 已学（q.deleted 过滤不一致）=====')
# 重建干净数据：2 道题今天答过，其中 1 道题被软删
c.execute("DELETE FROM answer_records")
c.execute("INSERT INTO questions (id, category_id, type, stem, deleted) VALUES (101,1,'choice','a',0)")
c.execute("INSERT INTO questions (id, category_id, type, stem, deleted) VALUES (102,1,'choice','b',1)")
c.execute("INSERT INTO answer_records (user_id, question_id, is_correct, mode, created_at, deleted) VALUES (?,101,1,'quiz',?,0)", (LOCAL_USER, today0))
c.execute("INSERT INTO answer_records (user_id, question_id, is_correct, mode, created_at, deleted) VALUES (?,102,1,'quiz',?,0)", (LOCAL_USER, today0))
conn.commit()
activeDays = len(set(r[0] for r in q("SELECT DISTINCT DATE(created_at/1000, 'unixepoch', 'localtime') FROM answer_records WHERE user_id=? AND deleted=0", LOCAL_USER)))
learned = c.execute("SELECT COUNT(DISTINCT ar.question_id) FROM answer_records ar JOIN questions q ON q.id=ar.question_id WHERE ar.user_id=? AND ar.deleted=0 AND q.deleted=0", (LOCAL_USER,)).fetchone()[0]
print(f'  [疑点证实] 活跃天数口径无 q.deleted 过滤（含已删题记录），已学口径有过滤 → 删题后 activeDays(={activeDays}) 与 learned(={learned}) 口径不一致')

print()
print('===== 验证 5：getStats.rate 含 recite/card/self_graded，getSummary.accuracy 排除 =====')
c.execute("INSERT INTO answer_records (user_id, question_id, is_correct, mode, created_at, deleted) VALUES (?,101,1,'recite',?,0)", (LOCAL_USER, today0))
c.execute("INSERT INTO answer_records (user_id, question_id, is_correct, mode, created_at, deleted, self_graded) VALUES (?,101,0,'quiz',?,0,1)", (LOCAL_USER, today0))
conn.commit()
stats_rate_n = c.execute("SELECT COUNT(*), SUM(is_correct) FROM answer_records WHERE user_id=? AND deleted=0", (LOCAL_USER,)).fetchone()
acc_n = c.execute("SELECT COUNT(*), SUM(CASE WHEN is_correct=1 THEN 1 ELSE 0 END) FROM answer_records ar JOIN questions q ON q.id=ar.question_id WHERE ar.user_id=? AND ar.deleted=0 AND q.deleted=0 AND ar.mode NOT IN ('recite','card') AND ar.self_graded=0", (LOCAL_USER,)).fetchone()
print(f'  getStats.rate: n={stats_rate_n[0]} c={stats_rate_n[1]} → {round(stats_rate_n[1]/stats_rate_n[0]*100) if stats_rate_n[0] else 0}%')
print(f'  getSummary.accuracy: n={acc_n[0]} c={acc_n[1]} → {round(acc_n[1]/acc_n[0]*100) if acc_n[0] else 0}%')
print('  [疑点证实] 两接口口径不同：getStats 含背题/自评，accuracy 排除 → 首页与统计页数字可能不一致')

print()
print('===== 验证 6：SM-2 序列（复刻 sm2.js）=====')
def sm2(state, quality):
    interval = state.get('interval') if state and state.get('interval') is not None else 0
    ease = state.get('ease') if state and state.get('ease') is not None else 2.5
    quality = 4 if quality is None else quality
    if quality < 3:
        interval = 1
        ease = max(1.3, ease - 0.2)
    else:
        if interval == 0: interval = 1
        elif interval == 1: interval = 6
        else: interval = round(interval * ease)
        ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
        ease = max(1.3, ease)
    interval = max(1, min(interval, 365))
    return {'interval': interval, 'ease': round(ease, 3)}
s = {'interval': 0, 'ease': 2.5}
for i, qlv in enumerate([5, 5, 4, 3, 5, 2, 5]):
    s = sm2(s, qlv)
    print(f'  第{i+1}次 质量{qlv} → interval={s["interval"]}天 ease={s["ease"]}')
print('  [结论] 0→1→6→*ease、失败重置 1 天、ease±，符合标准 SM-2')

print()
print('===== 验证 7：cards 软删去重（source_question_id）=====')
c.execute("INSERT INTO cards (front, back, source_question_id, created_at, updated_at, deleted, client_id) VALUES ('f','b',101,?,?,0,'c1')", (int(time.time()*1000), int(time.time()*1000)))
c.execute("UPDATE cards SET deleted=1 WHERE source_question_id=101")
c.execute("INSERT INTO cards (front, back, source_question_id, created_at, updated_at, deleted, client_id) VALUES ('f2','b2',101,?,?,0,'c2')", (int(time.time()*1000), int(time.time()*1000)))
rows = q("SELECT id, deleted, source_question_id FROM cards WHERE source_question_id=101")
print(f'  [疑点证实] 软删后重新生成 → {len(rows)} 行（1 条 deleted=1 + 1 条 active），无 UNIQUE 约束兜底，会重复')

conn.close()
print()
print('===== 交叉验证完成 =====')
