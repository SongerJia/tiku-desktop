// 建表 + 迁移模块：initSchema（全部 CREATE TABLE/INDEX）、migrateSchema（老库 ALTER 加列）。
// 从 db.js 拆出（拆分渐进一步）：ctx 注入 sqlite，纯 SQL 无 this 依赖。
module.exports = function schemaModule(ctx) {
  const { sqlite } = ctx

  return {
  initSchema() {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT,
        total_answered INTEGER DEFAULT 0,
        correct_count INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER,
        client_id TEXT
      );
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id INTEGER,
        level INTEGER,
        stage TEXT,
        sort INTEGER DEFAULT 0,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT,
        parent_cid TEXT
      );
      CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY,
        category_id INTEGER,
        type TEXT,
        stem TEXT,
        options_json TEXT,
        answer_json TEXT,
        analysis TEXT,
        difficulty INTEGER,
        source TEXT,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT,
        category_cid TEXT,
        subject_id INTEGER
      );
      CREATE TABLE IF NOT EXISTS answer_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        question_id INTEGER,
        selected_json TEXT,
        is_correct INTEGER,
        duration_ms INTEGER,
        mode TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT,
        question_cid TEXT
      );
      CREATE TABLE IF NOT EXISTS wrong_books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        question_id INTEGER,
        wrong_count INTEGER DEFAULT 0,
        reviewed_count INTEGER DEFAULT 0,
        next_review_at INTEGER,
        weak_point TEXT,
        status TEXT DEFAULT 'wrong',
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT,
        question_cid TEXT,
        UNIQUE(user_id, question_id)
      );
      CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        question_id INTEGER,
        created_at INTEGER,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT,
        question_cid TEXT
      );
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        question_id INTEGER,
        content TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT,
        question_cid TEXT,
        UNIQUE(user_id, question_id)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS papers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT,
        subject_id INTEGER,
        duration_minutes INTEGER,
        total_score REAL,
        rules_json TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT
      );
      CREATE TABLE IF NOT EXISTS paper_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        paper_id INTEGER,
        seq INTEGER,
        question_id INTEGER,
        score REAL,
        deleted INTEGER DEFAULT 0,
        client_id TEXT,
        question_cid TEXT
      );
      CREATE TABLE IF NOT EXISTS question_tags (
        question_id INTEGER NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (question_id, tag)
      );
      CREATE TABLE IF NOT EXISTS kb_docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'md',
        rel_path TEXT NOT NULL UNIQUE,
        size INTEGER DEFAULT 0,
        hash TEXT,
        folder TEXT DEFAULT '',
        read_count INTEGER DEFAULT 0,
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
        char_end INTEGER,
        review_at INTEGER,
        review_count INTEGER DEFAULT 0,
        review_lapses INTEGER DEFAULT 0
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
      -- 反馈层：XP / 习惯 / 每日回顾 / 专注 / 高亮 / 文档双链（全部带 client_id 走 LWW 同步）
      CREATE TABLE IF NOT EXISTS xp_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        xp INTEGER NOT NULL,
        source TEXT,
        note TEXT,
        created_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT
      );
      CREATE TABLE IF NOT EXISTS habits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        icon TEXT DEFAULT '✅',
        sort INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT
      );
      CREATE TABLE IF NOT EXISTS habit_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        habit_id INTEGER NOT NULL,
        check_date TEXT NOT NULL,
        created_at INTEGER,
        client_id TEXT,
        UNIQUE (habit_id, check_date)
      );
      CREATE TABLE IF NOT EXISTS review_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_type TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        result INTEGER DEFAULT 1,
        created_at INTEGER,
        client_id TEXT
      );
      CREATE TABLE IF NOT EXISTS focus_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        minutes INTEGER NOT NULL,
        started_at INTEGER,
        created_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT
      );
      CREATE TABLE IF NOT EXISTS cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        front TEXT NOT NULL,
        back TEXT NOT NULL,
        category TEXT DEFAULT '',
        review_at INTEGER,
        review_count INTEGER DEFAULT 0,
        review_lapses INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT
      );
      CREATE TABLE IF NOT EXISTS materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT DEFAULT '',
        content TEXT NOT NULL,
        subject_id INTEGER,
        created_at INTEGER,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT
      );
      CREATE TABLE IF NOT EXISTS kb_highlights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER NOT NULL,
        block_id INTEGER,
        text TEXT,
        note TEXT,
        color TEXT DEFAULT 'yellow',
        created_at INTEGER,
        updated_at INTEGER,
        deleted INTEGER DEFAULT 0,
        client_id TEXT
      );
      CREATE TABLE IF NOT EXISTS kb_doc_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_doc_id INTEGER NOT NULL,
        to_doc_id INTEGER NOT NULL,
        note TEXT,
        created_at INTEGER,
        client_id TEXT,
        UNIQUE (from_doc_id, to_doc_id)
      );
      CREATE INDEX IF NOT EXISTS idx_xp_created ON xp_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_habit_checks_date ON habit_checks(check_date);
      CREATE INDEX IF NOT EXISTS idx_review_created ON review_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_focus_created ON focus_sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_kb_highlights_doc ON kb_highlights(doc_id);
      CREATE INDEX IF NOT EXISTS idx_kb_doc_links_from ON kb_doc_links(from_doc_id);
      -- 核心题库/练习查询索引：getQuestions 每请求都按 category_id+deleted 过滤，
      -- wrong/favorite/review 模式按 user_id+status 取 ID，统计按 user_id+question_id 聚合。
      CREATE INDEX IF NOT EXISTS idx_q_cat_deleted ON questions(category_id, deleted);
      CREATE INDEX IF NOT EXISTS idx_q_stem ON questions(stem); -- 前缀/排序加速（子串 %kw% 仍需全扫，量级小无碍）
      CREATE INDEX IF NOT EXISTS idx_cat_parent ON categories(parent_id);
      CREATE INDEX IF NOT EXISTS idx_wb_user_status ON wrong_books(user_id, status, next_review_at);
      CREATE INDEX IF NOT EXISTS idx_fav_user ON favorites(user_id, question_id);
      CREATE INDEX IF NOT EXISTS idx_ar_user_q ON answer_records(user_id, question_id);
      CREATE INDEX IF NOT EXISTS idx_ar_user_created ON answer_records(user_id, created_at); -- 按日/月统计、最近记录（answer_records 增长最快，缺时间索引会全扫）
      CREATE INDEX IF NOT EXISTS idx_notes_user_q ON notes(user_id, question_id); -- 笔记高频查询（答题页每切一题 getNote）
      CREATE INDEX IF NOT EXISTS idx_qt_tag ON question_tags(tag);
      CREATE INDEX IF NOT EXISTS idx_mat_subject ON materials(subject_id);
    `)
  },

  // 轻量迁移：老版本装过的库没有新列，这里按需 ALTER，保证升级后不丢数据也不报错。
  // 规则：只做「加列」这种绝对安全的操作，绝不改列类型 / 删列。
  migrateSchema() {
    const addColumn = (table, column, ddl) => {
      const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
      if (!cols.includes(column)) {
        sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
        return true
      }
      return false
    }
    // 问答题的「得分关键词」
    addColumn('questions', 'keywords_json', 'keywords_json TEXT')
    // 问答题自评标记
    addColumn('answer_records', 'self_graded', 'self_graded INTEGER DEFAULT 0')
    // 云同步身份列 + 外键 cid
    addColumn('users', 'client_id', 'client_id TEXT')
    addColumn('categories', 'client_id', 'client_id TEXT')
    addColumn('categories', 'parent_cid', 'parent_cid TEXT')
    addColumn('questions', 'client_id', 'client_id TEXT')
    addColumn('questions', 'category_cid', 'category_cid TEXT')
    addColumn('questions', 'images_json', 'images_json TEXT')
    addColumn('questions', 'audio_url', 'audio_url TEXT')
    // 材料题：questions 挂材料（materials 表），material_cid 用于跨设备引用解析
    addColumn('questions', 'material_id', 'material_id INTEGER')
    addColumn('questions', 'material_cid', 'material_cid TEXT')
    // 科目归属：错题/收藏/笔记页按科目过滤依赖（category 树推导回填，见 backfillClientIds）
    addColumn('questions', 'subject_id', 'subject_id INTEGER')
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_q_material ON questions(material_id)') // 依赖上面加列，必须在 migrate 阶段建
    addColumn('answer_records', 'client_id', 'client_id TEXT')
    addColumn('answer_records', 'question_cid', 'question_cid TEXT')
    addColumn('wrong_books', 'client_id', 'client_id TEXT')
    addColumn('wrong_books', 'question_cid', 'question_cid TEXT')
    // 自适应复习：ease（难度因子，SM-2）、interval（当前间隔天数）
    addColumn('wrong_books', 'ease', 'ease REAL DEFAULT 2.5')
    addColumn('wrong_books', 'interval', 'interval INTEGER DEFAULT 0')
    addColumn('favorites', 'client_id', 'client_id TEXT')
    addColumn('favorites', 'question_cid', 'question_cid TEXT')
    addColumn('notes', 'client_id', 'client_id TEXT')
    addColumn('notes', 'question_cid', 'question_cid TEXT')
    // 知识库：文件夹分类 + 阅读次数统计
    addColumn('kb_docs', 'folder', 'folder TEXT DEFAULT \'\'')
    addColumn('kb_docs', 'read_count', 'read_count INTEGER DEFAULT 0')
    // 知识块间隔复习（每日回顾调度：记住→3天，忘记→1天）
    addColumn('kb_blocks', 'review_at', 'review_at INTEGER')
    addColumn('kb_blocks', 'review_count', 'review_count INTEGER DEFAULT 0')
    addColumn('kb_blocks', 'review_lapses', 'review_lapses INTEGER DEFAULT 0')
    addColumn('kb_docs', 'last_page', 'last_page INTEGER DEFAULT 0') // PDF 阅读位置记忆
    // 错题原因标签（粗心/知识点不懂/时间不够…）
    addColumn('wrong_books', 'reason', 'reason TEXT DEFAULT \'\'')
    // 卡片来源题目（方向 10：错题/题目一键生成记忆卡，用于去重与来源标记）
    addColumn('cards', 'source_question_id', 'source_question_id INTEGER')
    // 记忆卡科目归属（内容闭环跟科目走：切科目只看该科目卡；错题生成卡自动继承题目科目）
    addColumn('cards', 'subject_id', 'subject_id INTEGER')
    // 收藏分组（方向 9：收藏面板按组浏览/标记；fav_group 避开 SQL 关键字 group）
    addColumn('favorites', 'fav_group', "fav_group TEXT DEFAULT ''")
    // 知识库科目关联（第二批：知识库按科目归类，切换科目维度时文档跟随）
    addColumn('kb_docs', 'subject_id', 'subject_id INTEGER')
    // 知识库章节归属：文档可选归属到科目下的具体章节（顶部选择器选章节时按 category_id 过滤）
    addColumn('kb_docs', 'category_id', 'category_id INTEGER')
    addColumn('kb_docs', 'category_cid', 'category_cid TEXT') // 跨端章节归属：merge 时按 cid 重映射
    // 跨端科目归属：cards/materials/kb_docs 的 subject_id 是本地自增 id，远端同步会挂错科目 → 加 subject_cid 列，merge 按 cid 重映射
    addColumn('cards', 'subject_cid', 'subject_cid TEXT')
    addColumn('materials', 'subject_cid', 'subject_cid TEXT')
    addColumn('kb_docs', 'subject_cid', 'subject_cid TEXT')
  },
  }
}
