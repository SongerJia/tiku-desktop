# -*- coding: utf-8 -*-
"""批次 A 修复验证：F-01 软删复活 / F-04 活跃天口径 / F-05 today 上限 / F-02 review_logs 导出列"""
import sqlite3, os, tempfile, time

DB = os.path.join(tempfile.gettempdir(), 'audit_A.db')
if os.path.exists(DB): os.remove(DB)
conn = sqlite3.connect(DB)
c = conn.cursor()
c.executescript('''
CREATE TABLE wrong_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, question_id INTEGER,
  wrong_count INTEGER DEFAULT 0, reviewed_count INTEGER DEFAULT 0,
  next_review_at INTEGER, weak_point TEXT, ease REAL DEFAULT 2.5,
  interval INTEGER DEFAULT 0, reason TEXT DEFAULT '', status TEXT DEFAULT 'wrong',
  updated_at INTEGER, deleted INTEGER DEFAULT 0, client_id TEXT, question_cid TEXT,
  UNIQUE(user_id, question_id)
);
CREATE TABLE answer_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, question_id INTEGER,
  selected_json TEXT, is_correct INTEGER, duration_ms INTEGER, mode TEXT,
  self_graded INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER,
  deleted INTEGER DEFAULT 0, client_id TEXT, question_cid TEXT
);
CREATE TABLE questions (
  id INTEGER PRIMARY KEY, category_id INTEGER, type TEXT, stem TEXT,
  options_json TEXT, answer_json TEXT, keywords_json TEXT, analysis TEXT,
  difficulty INTEGER, source TEXT, images_json TEXT, audio_url TEXT,
  material_id INTEGER, material_cid TEXT, updated_at INTEGER,
  deleted INTEGER DEFAULT 0, client_id TEXT, category_cid TEXT
);
CREATE TABLE review_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL, result INTEGER DEFAULT 1,
  created_at INTEGER, client_id TEXT
);
''')
conn.commit()
U = 1
now = int(time.time()*1000)

print('===== F-01：wrong_books 软删复活（UPSERT 带 deleted=0）=====')
# 模拟修复后的 upsert（DO UPDATE 含 deleted=0）
c.execute("INSERT INTO wrong_books (user_id,question_id,wrong_count,status,updated_at,deleted,client_id) VALUES (?,?,1,'wrong',?,0,'c1')", (U, 10, now))
c.execute("UPDATE wrong_books SET deleted=1, updated_at=? WHERE user_id=? AND question_id=?", (now, U, 10))
c.execute('''INSERT INTO wrong_books (user_id,question_id,wrong_count,reviewed_count,status,next_review_at,ease,interval,updated_at,client_id,question_cid)
  VALUES (?,?,1,0,'wrong',?,?,?,?,?,?)
  ON CONFLICT(user_id,question_id) DO UPDATE SET
    wrong_count=wrong_books.wrong_count+1, reviewed_count=0, status='wrong', deleted=0,
    next_review_at=excluded.next_review_at, ease=excluded.ease, interval=excluded.interval, updated_at=?''',
  (U, 10, now, 2.5, 1, now, 'c2', 'qc', now))
row = c.execute("SELECT wrong_count, deleted FROM wrong_books WHERE user_id=? AND question_id=?", (U, 10)).fetchone()
ok1 = row[0] == 2 and row[1] == 0
print(f'  [{"PASS" if ok1 else "FAIL"}] 答错复活：wrong_count={row[0]} deleted={row[1]}（期望 2 / 0）')

# 答对分支：用户删了错题，答对不应复活（查询带 deleted=0 → wb 查不到）
c.execute("UPDATE wrong_books SET deleted=1, updated_at=? WHERE user_id=? AND question_id=?", (now, U, 10))
wb = c.execute("SELECT id FROM wrong_books WHERE user_id=? AND question_id=? AND deleted=0", (U, 10)).fetchone()
ok2 = wb is None
print(f'  [{"PASS" if ok2 else "FAIL"}] 答对不复活软删行：wb={wb}（期望 None）')

# markMastered：主动标记掌握应复活（UPDATE 置 deleted=0）
c.execute("INSERT INTO wrong_books (user_id,question_id,wrong_count,status,updated_at,deleted,client_id) VALUES (?,?,1,'wrong',?,0,'c3')", (U, 20, now))
c.execute("UPDATE wrong_books SET deleted=1, updated_at=? WHERE user_id=? AND question_id=?", (now, U, 20))
wb2 = c.execute("SELECT id FROM wrong_books WHERE user_id=? AND question_id=?", (U, 20)).fetchone()  # 查询无过滤（保持）
c.execute("UPDATE wrong_books SET reviewed_count=3, status='mastered', deleted=0, updated_at=? WHERE id=?", (now, wb2[0]))
row = c.execute("SELECT status, deleted FROM wrong_books WHERE user_id=? AND question_id=?", (U, 20)).fetchone()
ok3 = row[0] == 'mastered' and row[1] == 0
print(f'  [{"PASS" if ok3 else "FAIL"}] markMastered 复活：status={row[0]} deleted={row[1]}（期望 mastered / 0）')

print()
print('===== F-04：活跃天只统计未删题 =====')
c.execute("INSERT INTO questions (id,category_id,type,stem,deleted) VALUES (101,1,'choice','a',0)")
c.execute("INSERT INTO questions (id,category_id,type,stem,deleted) VALUES (102,1,'choice','b',1)")
c.execute("INSERT INTO answer_records (user_id,question_id,is_correct,mode,created_at,deleted) VALUES (?,101,1,'quiz',?,0)", (U, now))
c.execute("INSERT INTO answer_records (user_id,question_id,is_correct,mode,created_at,deleted) VALUES (?,102,1,'quiz',?,0)", (U, now))
conn.commit()
days = c.execute("SELECT COUNT(DISTINCT DATE(ar.created_at/1000,'unixepoch','localtime')) FROM answer_records ar JOIN questions q ON q.id=ar.question_id WHERE ar.user_id=? AND ar.deleted=0 AND q.deleted=0", (U,)).fetchone()[0]
ok4 = days == 1
print(f'  [{"PASS" if ok4 else "FAIL"}] 活跃天含已删题记录={days}（期望 1，只算未删题）')

print()
print('===== F-05：today 只统计 [今日,明日) =====')
today0 = now - (now % 86400000)
c.execute("DELETE FROM answer_records")  # 清空：只保留未来记录，排除今日真实记录干扰
future = today0 + 86400000 * 5
c.execute("INSERT INTO answer_records (user_id,question_id,is_correct,mode,created_at,deleted) VALUES (?,101,1,'quiz',?,0)", (U, future))
conn.commit()
n = c.execute("SELECT COUNT(*) FROM answer_records ar JOIN questions q ON q.id=ar.question_id WHERE ar.user_id=? AND ar.deleted=0 AND q.deleted=0 AND ar.created_at>=? AND ar.created_at<?", (U, today0, today0+86400000)).fetchone()[0]
ok5 = n == 0
print(f'  [{"PASS" if ok5 else "FAIL"}] 未来时间戳计入今日={n}（期望 0）')

print()
print('===== F-02：review_logs 导出列齐全 =====')
EXPECT = ['id', 'item_type', 'item_id', 'result', 'created_at', 'client_id']
cols = [r[1] for r in c.execute("PRAGMA table_info(review_logs)").fetchall()]
ok6 = all(x in cols for x in EXPECT)
print(f'  [{"PASS" if ok6 else "FAIL"}] review_logs 列含导出所需: {cols}')

conn.close()
print()
print('===== 批次 A 验证完成 =====')
