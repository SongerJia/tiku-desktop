// 整库导出（db.exportData）的列清单常量。
// 从 db.js 抽出，减少主文件体积并统一维护；拆分流程的渐进一步。
// 注意：部分表（kb_blocks/kb_tags/kb_links）没有 deleted 列，dump 时动态检测过滤条件。
module.exports = {
  EXPORT_COLS: {
    categories: ['id', 'name', 'parent_id', 'level', 'stage', 'sort', 'client_id', 'parent_cid', 'updated_at', 'deleted'],
    questions: ['id', 'category_id', 'type', 'stem', 'options_json', 'answer_json', 'keywords_json', 'analysis', 'difficulty', 'source', 'images_json', 'audio_url', 'material_id', 'material_cid', 'client_id', 'category_cid', 'subject_id', 'updated_at', 'deleted'],
    answerRecords: ['id', 'user_id', 'question_id', 'selected_json', 'is_correct', 'duration_ms', 'mode', 'self_graded', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'],
    wrongBooks: ['id', 'user_id', 'question_id', 'wrong_count', 'reviewed_count', 'ease', 'interval', 'next_review_at', 'weak_point', 'reason', 'status', 'client_id', 'question_cid', 'updated_at', 'deleted'],
    favorites: ['id', 'user_id', 'question_id', 'fav_group', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'],
    notes: ['id', 'user_id', 'question_id', 'content', 'created_at', 'client_id', 'question_cid', 'updated_at', 'deleted'],
    papers: ['id', 'user_id', 'title', 'subject_id', 'duration_minutes', 'total_score', 'rules_json', 'created_at', 'client_id', 'updated_at', 'deleted'],
    paperQuestions: ['id', 'paper_id', 'seq', 'question_id', 'score', 'client_id', 'question_cid', 'deleted'],
    kbDocs: ['id', 'title', 'type', 'rel_path', 'size', 'hash', 'folder', 'read_count', 'subject_id', 'subject_cid', 'category_id', 'category_cid', 'last_page', 'created_at', 'updated_at', 'deleted', 'client_id'],
    kbBlocks: ['id', 'doc_id', 'seq', 'heading', 'content', 'char_start', 'char_end', 'review_at', 'review_count', 'review_lapses'],
    kbTags: ['doc_id', 'tag'],
    kbLinks: ['id', 'doc_id', 'block_id', 'question_id', 'note', 'created_at'],
    cards: ['id', 'front', 'back', 'category', 'subject_id', 'subject_cid', 'category_id', 'source_question_id', 'review_at', 'review_count', 'review_lapses', 'created_at', 'updated_at', 'deleted', 'client_id'],
    materials: ['id', 'title', 'content', 'subject_id', 'subject_cid', 'created_at', 'updated_at', 'deleted', 'client_id'],
    reviewLogs: ['id', 'item_type', 'item_id', 'result', 'created_at', 'client_id']
  }
}
