#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
用 Python 标准库 sqlite3 交叉验证 db.js 里「题目笔记」相关的 SQL。

为什么需要这个：沙箱/CI 里装不上 better-sqlite3（原生模块要编译），
但 SQL 语句本身是纯文本、跟驱动无关。把 db.js 里的建表与增删改查
原样抄过来跑一遍，能在不启动 Electron 的前提下抓出语法错、
UPSERT 冲突目标写错、JOIN 漏条件、软删过滤失效这类问题。

跑法：python scripts/test-notes-sql.py
"""
import sqlite3
import sys
import time

passed = 0
failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  \u2713 {name}")
    else:
        failed += 1
        print(f"  \u2717 {name}  {extra}")


LOCAL_USER = 1
now = lambda: int(time.time() * 1000)

# ---- 与 electron/db.js initSchema 中 notes 表保持一致 ----
SCHEMA = """
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY, name TEXT, parent_id INTEGER, level INTEGER,
  stage TEXT, sort INTEGER DEFAULT 0, updated_at INTEGER, deleted INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY, category_id INTEGER, type TEXT, stem TEXT,
  options_json TEXT, answer_json TEXT, keywords_json TEXT, analysis TEXT,
  difficulty INTEGER, source TEXT, updated_at INTEGER, deleted INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  question_id INTEGER,
  content TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  deleted INTEGER DEFAULT 0,
  UNIQUE(user_id, question_id)
);
"""

SQL_SAVE_UPSERT = """INSERT INTO notes (user_id, question_id, content, created_at, updated_at, deleted)
      VALUES (?,?,?,?,?,0)
      ON CONFLICT(user_id, question_id) DO UPDATE SET
        content=excluded.content,
        deleted=0,
        updated_at=excluded.updated_at"""

SQL_SOFT_DELETE = "UPDATE notes SET content=?, deleted=1, updated_at=? WHERE user_id=? AND question_id=?"

SQL_GET = "SELECT content, updated_at FROM notes WHERE user_id=? AND question_id=? AND deleted=0"

SQL_LIST = """SELECT n.question_id, n.content, n.updated_at,
        q.stem, q.type, c.name AS category
      FROM notes n
      JOIN questions q ON q.id=n.question_id AND q.deleted=0
      LEFT JOIN categories c ON c.id=q.category_id
      WHERE n.user_id=? AND n.deleted=0 AND TRIM(IFNULL(n.content,''))<>''
      ORDER BY n.updated_at DESC"""

SQL_NOTED_IDS = "SELECT question_id FROM notes WHERE user_id=? AND deleted=0 AND TRIM(IFNULL(content,''))<>''"


def save_note(db, question_id, content):
    """等价于 db.js 的 api.saveNote"""
    text = (content or "").strip()
    t = now()
    if not text:
        db.execute(SQL_SOFT_DELETE, ("", t, LOCAL_USER, question_id))
        return {"content": "", "deleted": True}
    db.execute(SQL_SAVE_UPSERT, (LOCAL_USER, question_id, text, t, t))
    return {"content": text, "deleted": False}


def get_note(db, question_id):
    r = db.execute(SQL_GET, (LOCAL_USER, question_id)).fetchone()
    return {"content": r[0] or "", "updatedAt": r[1]} if r else {"content": "", "updatedAt": None}


def main():
    db = sqlite3.connect(":memory:")
    db.executescript(SCHEMA)

    # 造点题库数据
    db.execute("INSERT INTO categories (id,name,parent_id,level,deleted) VALUES (1,'二级建造师',NULL,1,0)")
    db.execute("INSERT INTO categories (id,name,parent_id,level,deleted) VALUES (2,'施工管理',1,2,0)")
    for qid, stem, qtype in [(10, '施工进度计划编制步骤', 'essay'),
                             (11, '下列属于强制性条文的是', 'single'),
                             (12, '已被删除的题', 'single')]:
        db.execute("INSERT INTO questions (id,category_id,type,stem,deleted) VALUES (?,?,?,?,?)",
                   (qid, 2, qtype, stem, 1 if qid == 12 else 0))

    print("\n[1] 建表与基础读写")
    check("空笔记读取返回空串而非报错", get_note(db, 10)["content"] == "")
    save_note(db, 10, "  关键在于先排关键线路  ")
    check("保存后能读回", get_note(db, 10)["content"] == "关键在于先排关键线路")
    check("保存时首尾空白被 trim", not get_note(db, 10)["content"].startswith(" "))

    print("\n[2] UPSERT：同题第二次保存应覆盖而不是插入新行")
    save_note(db, 10, "改写后的笔记")
    cnt = db.execute("SELECT COUNT(*) FROM notes WHERE user_id=? AND question_id=?", (LOCAL_USER, 10)).fetchone()[0]
    check("同题只存在一行（UNIQUE 冲突走 UPDATE）", cnt == 1, f"实际 {cnt} 行")
    check("内容已被覆盖", get_note(db, 10)["content"] == "改写后的笔记")

    print("\n[3] 清空内容 = 软删除")
    save_note(db, 10, "   ")
    check("清空后读取为空", get_note(db, 10)["content"] == "")
    row = db.execute("SELECT deleted FROM notes WHERE user_id=? AND question_id=?", (LOCAL_USER, 10)).fetchone()
    check("行仍在（软删，保留同步痕迹）", row is not None)
    check("deleted 标记为 1", row[0] == 1)

    print("\n[4] 软删后重新写入应复活同一行")
    save_note(db, 10, "复活的笔记")
    cnt = db.execute("SELECT COUNT(*) FROM notes WHERE user_id=? AND question_id=?", (LOCAL_USER, 10)).fetchone()[0]
    check("仍只有一行（未产生重复）", cnt == 1, f"实际 {cnt} 行")
    check("deleted 被重置为 0", get_note(db, 10)["content"] == "复活的笔记")

    print("\n[5] listNotes：JOIN 题干与分类、过滤空内容与已删题")
    save_note(db, 11, "记住：强条不可违反")
    save_note(db, 12, "这题已被删除，不该出现在列表里")
    rows = db.execute(SQL_LIST, (LOCAL_USER,)).fetchall()
    ids = [r[0] for r in rows]
    check("只返回未删除题目的笔记", 12 not in ids, f"实际 {ids}")
    check("两条有效笔记都在", set(ids) == {10, 11}, f"实际 {ids}")
    stems = {r[0]: r[3] for r in rows}
    check("JOIN 出了题干", stems.get(11) == '下列属于强制性条文的是')
    cats = {r[0]: r[5] for r in rows}
    check("LEFT JOIN 出了章节名", cats.get(11) == '施工管理')

    print("\n[6] listNotes 排序：按最近修改倒序")
    time.sleep(0.01)
    save_note(db, 10, "刚刚才改的")
    rows = db.execute(SQL_LIST, (LOCAL_USER,)).fetchall()
    check("最近修改的排最前", rows[0][0] == 10, f"实际首位 {rows[0][0]}")

    print("\n[7] getNotedQuestionIds：题库页标记用")
    save_note(db, 11, "")          # 清掉 11
    noted = [r[0] for r in db.execute(SQL_NOTED_IDS, (LOCAL_USER,)).fetchall()]
    check("已清空的题不再计入", 11 not in noted, f"实际 {noted}")
    check("有笔记的题仍在", 10 in noted, f"实际 {noted}")

    print("\n[8] 多用户隔离")
    db.execute(SQL_SAVE_UPSERT, (999, 10, '另一个用户的笔记', now(), now()))
    check("本用户读到的仍是自己的", get_note(db, 10)["content"] == "刚刚才改的")
    other = db.execute(SQL_GET, (999, 10)).fetchone()
    check("另一用户独立成行", other is not None and other[0] == '另一个用户的笔记')

    print("\n[9] clearUserData 只清本用户")
    db.execute("DELETE FROM notes WHERE user_id=?", (LOCAL_USER,))
    check("本用户笔记已清空", get_note(db, 10)["content"] == "")
    left = db.execute("SELECT COUNT(*) FROM notes WHERE user_id=999").fetchone()[0]
    check("其他用户不受影响", left == 1)

    print(f"\n结果：{passed} 通过 / {failed} 失败\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
