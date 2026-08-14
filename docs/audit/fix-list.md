# 代码审计修复清单（5 轮汇总）

> 2026-08-14 · 依据 docs/audit/round1~5 五份审计报告汇总
> 修复原则：按批次提交（每批独立 commit），P1 先行；修完一轮验证一轮（vite build + 交叉验证）

---

## 批次 A · 数据正确性（P1 + 关键 P2，最高优先）

| # | 严重度 | 位置 | 问题 | 修复方案 |
|---|---|---|---|---|
| F-01 | P1 | db-quiz.js L112-119 / L143-151 / L158 / L274 / L296 / L307 | wrong_books 软删后"复活"缺失：UPSERT/UPDATE 未置 deleted=0，SELECT（L153/271/292）无 deleted=0 过滤 | ① 所有 `ON CONFLICT DO UPDATE` 加 `deleted=0`；② L158/274/296/307 UPDATE 补 `deleted=0` 条件；③ L153/271/292 SELECT 加 `AND deleted=0` |
| F-02 | P1 | db-sync.js exportData / db-cols.js / sync-merge.js | review_logs（复习次数）不进同步导出 → 换机后复习成就/周报清零 | ① EXPORT_COLS 加 reviewLogs 列（id/item_type/item_id/result/created_at/client_id）；② exportData 补 dump('review_logs')；③ import 侧补合并（表已有 client_id，走 lwwMerge） |
| F-03 | P2 | db-stats.js L14 vs L151-156 | getStats.rate 含 recite/card/self_graded，与 getSummary.accuracy 口径不一致 | getStats 统计加 `mode NOT IN ('recite','card') AND self_graded=0` 过滤 |
| F-04 | P2 | db-stats.js L136 | 活跃天数/streak 无 q.deleted 过滤（删题后虚高） | 活跃天 SQL 加 JOIN questions q ON q.id=ar.question_id AND q.deleted=0 |
| F-05 | P2 | db-stats.js L132 | getSummary.today 无未来时间上限 | 加 `AND ar.created_at < 明日 0 点` |
| F-06 | P2 | db-quiz.js L177-201 | getWrongBook/getFavorites JOIN questions 无 q.deleted=0（已删题仍显示） | JOIN 补 `AND q.deleted=0` |
| F-07 | P2 | db-weak.js L58-60 | getWeakQuestions 权重 cor/tot 含 recite/card/self_graded | 子查询排除非正式答题模式 |
| F-08 | P2 | db-weak.js L19 / db-paper.js L160 | 章节错题计数子查询无 q.deleted=0 | 子查询 JOIN questions 补过滤 |
| F-09 | P2 | db-misc.js L55/56/81 | getWeeklyReport 滚动 7 天 vs 周一口径；无 subject 分支无 q.deleted=0 | 统一周起点（周一起）+ 全局分支补 JOIN 过滤 |
| F-10 | P2 | achievements.js L42 + db-stats.js getAchievements | wrongClear"错题毕业"复用 mastered（答对数），语义错误 | 后端加 `wrongGraduated` 指标（wrong_books 中 status='mastered' 计数），成就换 metric |
| F-11 | P2 | achievements.js L49 | questCheck 用 habitChecks（习惯已砍，恒 0）→ 死成就 | 删除该成就定义（ACH_DEFS）并同步 ACH_SERIES 计数 |
| F-12 | P2 | celebrate.js L9 | merged focusMin 被 getMonthStats（本月）覆盖 → 成就墙(累计)/庆祝(本月)不一致 | merged 时排除 focusMin 覆盖（保留 getAchievements 的累计值） |
| F-13 | P2 | db-gamify.js L77-91 | quest 领奖 XP 按 note 字符串去重（改目标可重复领） | note 结构化（key: `${type}:${goal}`），has() 按 key 判断 |
| F-14 | P2 | db-gamify.js L27 | weeks 周排行 %Y-%W 跨年错位 | 与 JS 周起点统一（用 strftime('%Y-%m-%d' 计算周一同款或改 JS 聚合） |
| F-15 | P2 | db-cards.js L84 | rateCard 不更新 updated_at（同步回滚复习进度） | UPDATE 补 updated_at |

## 批次 B · 同步与导出（数据完整性）

| # | 严重度 | 位置 | 问题 | 修复方案 |
|---|---|---|---|---|
| F-16 | P2 | db-cols.js L14 + db-sync.js L43-47 | kbDocs 缺 category_cid（exportData 特判补，列清单失真） | EXPORT_COLS.kbDocs 补 category_cid |
| F-17 | P2 | main.js L490-492 | kbExport 不递归，kb/notes/ 子目录漏导出 | 改递归（复用 listKbFiles walk 逻辑） |
| F-18 | P2 | db-cards.js L32 | cards 软删后重新生成双卡（source_question_id 无 UNIQUE） | 去重查询含软删行；或重建时先复活旧卡 |
| F-19 | P3 | db-meta.js L90 | 断点续做 questions（含答案）存 settings 随同步走 | clearResumeSession 同步前清空 / 断点数据不入 settings 同步 |
| F-20 | P3 | db-meta.js L79-92 | clearUserData 未清 papers / kb_highlights / kb_doc_links | 按语义补清（模拟卷属学习数据 → 清；高亮属知识库数据 → 保留需确认） |

## 批次 C · 安全加固

| # | 严重度 | 位置 | 问题 | 修复方案 |
|---|---|---|---|---|
| F-21 | P2 | db-kb.js L16/L141/L382 + main.js L508 | rel_path 路径穿越校验缺失（4 处） | 抽 `safeRelPath()`（拒绝 `..`/绝对路径/盘符），readKbFile/deleteKbDoc/kbSaveMd/kbOpen 统一使用 |
| F-22 | P2 | db-bank.js L161-166 | getQuestionInfo 分类路径 while 无循环 guard | 补 guard（同 _rootSubjectOf） |
| F-23 | P2 | db-kb.js L367-372 | bumpKbRead 每次 +5 XP 无防刷 | 同日同文档去重（settings 记当日已读集合） |
| F-24 | P3 | print.js | title/body 未转义注入打印窗口 | escapeHtml 标题/题干后再拼装 |

## 批次 D · 性能与体验

| # | 严重度 | 位置 | 问题 | 修复方案 |
|---|---|---|---|---|
| F-25 | P2 | db-weak.js L57-61 | getWeakQuestions 每题 3 子查询全量计算 | 改 LEFT JOIN 一次聚合（wc/cor/tot 用 JOIN + GROUP BY）。⚠️ SQL 重写回归风险：若改后行为有疑，先加 `idx_wb_uid_qid`/`idx_ar_uid_qid` 复合索引兜底，分两步走 |
| F-26 | P2 | db-bank.js L77 | listQuestions 搜索 options_json LIKE 误命中 HTML | 搜索域去掉 options_json，或剥 HTML 后匹配 |
| F-27 | P2 | db-bank.js L210-216 / db-paper.js L150-161 / db-weak.js L8-27 | 章节统计按精确 category_id（3 级分类漏子孙） | 章节统计用 descendantCategoryIds 展开 |
| F-28 | P3 | db-kb.js L71/L96/L200 | N+1 查询（tags/links/stem） | 批量 IN 查询 |
| F-29 | P3 | achievements.js L70 | fmtText 显示当前档阈值（已达标仍显示 /1000） | 改为显示下一档阈值 |

## 批次 E · 清理（死代码 / 残留 / 规范）

| # | 严重度 | 位置 | 问题 | 修复方案 |
|---|---|---|---|---|
| F-30 | P3 | preload.js L20/21/22 + main.js L276/277/321/466 | 6 个死接口（getWeeklyTrend/getMonthlyCalendar/getChapterProgress/getWeakChapters/kbMove/kbStats） | 三层同步删除（main handle + preload 暴露；kbStats 后端内部互调保留在 api 但不暴露 IPC） |
| F-31 | P3 | db-schema.js L182-199 + db-meta.js | habits/habit_checks 已砍功能残留表 + 成就引用 | schema 保留（兼容老库），成就定义移除引用；表留待大版本清理 |
| F-32 | P3 | tilt.js + Home.vue L143-159 | vTilt 重复定义 | Home 改用 utils/tilt.js 统一；指令卸载时清理监听 |
| F-33 | P3 | confirm.js L15-24 | resolver 单例（连续 showConfirm 前一个永不 resolve） | 多实例队列或拒绝重入 |
| F-34 | P3 | db-kb.js L247 | 停用词表 '的是' 重复 | 去重 |
| F-35 | P3 | db-misc.js L108 | `s.learned || s.totalAnswered` 死代码 | 清理 |
| F-36 | P3 | 多组件 | toast/noteHint 类 setTimeout 卸载未清理 | onUnmounted 统一 clear（规范） |

## 复核补充（2026-08-14 二次审查）

| # | 严重度 | 位置 | 问题 | 修复方案 |
|---|---|---|---|---|
| F-37 | P2 | SYNC.md 全文 + db-sync.js L125 注释 | **SYNC.md 严重过时**：仍描述已废弃的「GitHub Gist」方案（createGist/updateGist、tiku-backup.json、tiku-img.0 分块、gist 权限）；实际实现是 **GitHub 仓库**（data.json.gz + kb/ + images/ + tiku-manifest.json，见 README L50）——用户/新贡献者读 SYNC.md 会得到错误方案 | 重写 SYNC.md 为仓库方案（结构复用 README L50/L63/L66 描述），或文件头标注「已废弃，见 README」；db-sync.js L125 注释残留 "Gist 文件" 字样一并修正 |
| F-38 | P3 | src/composables/useResponsive.js | 模块级 resize 监听永不移除（App 生命周期常驻，无实际泄漏；可接受） | 可选：不修（记录确认） |

## 复核结论（二次审查）

- **5 份报告发现全部复核属实**：抽查 F-01（db-quiz.js 7 处无 deleted=0）、F-02（exportData 无 review_logs）、F-12（celebrate focusMin 覆盖）、F-21（rel_path 4 处）行号与描述一致；已排除项（P1-3 relaunch、嵌套事务 SAVEPOINT、IPC 128/128、sandbox 隔离）复核成立
- **无重大误报**；修复方案总体可行；F-25 增加回归风险备注（先索引兜底分步走）
- 新增 F-37（SYNC.md 文档过时，P2）——5 轮未覆盖文档层，本次补审发现

---

## 汇总

- **P1 × 2**（F-01 错题复活 / F-02 review_logs 同步）—— 修复后需交叉验证：Python 复刻 schema 跑复活用例 + 导出 JSON 断言含 review_logs
- **P2 × 16**（F-03~F-18、F-21~F-27）
- **P3 × 14**（F-19~F-20、F-24、F-28~F-36）
- 修复顺序建议：**A → B → C → D → E**，每批独立 commit；全部完成后跑 `npm test` + `vite build --config vite.verify.config.js` + IPC 三层接线核对脚本
