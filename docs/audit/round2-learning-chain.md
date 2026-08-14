# 代码审计 · 轮 2：核心学习链路（功能维度）

> 审计时间：2026-08-14 · 范围：`db-quiz.js / db-weak.js / db-paper.js / db-misc.js / db-habits.js / db-meta.js` + `Quiz.vue` 关键链路 + **IPC 三层接线核对**（main ↔ preload ↔ 前端 tiku.*）

## 一、三层接线核对结果（规则 7 专项）

| 核对项 | 结果 |
|---|---|
| preload 暴露 vs main 注册 | **128 / 128 完全一致**（差集为空） |
| 前端 tiku.* 调用 vs preload 白名单 | 122 个调用全部在白名单内（无 undefined 风险） |
| 死接口 | **6 个**：getChapterProgress / getMonthlyCalendar / getWeakChapters / getWeeklyTrend / kbMove / kbStats（前端零引用；kbStats 为后端内部互调被误暴露） |

## 二、发现清单

### 🔴 P1
- **P1-2'（承轮 1）wrong_books 复活缺失的完整路径清单**：`db-quiz.js` L112-119（recite UPSERT）、L143-151（答错 UPSERT）、L158（答对毕业 UPDATE）、L274（markMastered UPDATE）、L296/307（rateReview UPDATE）——全部未置 `deleted=0`；L153/L271/L292 的 SELECT 无 `deleted=0` 过滤。删除错题后再次答题/复习，数据写入不可见行。

### 🟠 P2

| # | 位置 | 问题 | 影响 | 建议 |
|---|---|---|---|---|
| P2-8 | db-quiz.js L177-201 | getWrongBook/getFavorites JOIN questions **无 q.deleted=0** | 题目删除后仍显示在错题本/收藏，点击打开报"题目不存在" | JOIN 补 q.deleted=0 |
| P2-9 | db-weak.js L57-61 | getWeakQuestions 每题 3 个子查询（wc/cor/tot）全量计算 | 弱点模式进入练习全库扫描，题库上千题变慢 | 改为 LEFT JOIN 聚合一次 |
| P2-10 | db-weak.js L58-60 | cor/tot 子查询含 recite/card/self_graded 记录 | 背题"不会"污染弱点权重（抽题偏向背过题） | 排除非正式答题模式 |
| P2-11 | db-misc.js L55/56/81 | getWeeklyReport 用**滚动 7 天**（now-7d），周报标题语义 vs 其他周统计（周一起）不一致；无 subject 分支无 q.deleted=0 | 周报口径漂移、删题污染 | 统一周起点 + 补过滤 |
| P2-12 | db-paper.js L150-161 / db-weak.js L8-27 | 章节进度/薄弱章节按 `category_id=?` **精确匹配** | 3 级分类（科目>章>节）下挂子节的题漏统计 | 章节统计用子孙展开 |
| P2-13 | db-weak.js L19 / db-paper.js L160 | 章节 wrong 计数子查询无 q.deleted=0 | 已删题错题计入章节 | 补过滤 |

### 🟡 P3

| # | 位置 | 问题 |
|---|---|---|
| P3-7 | db-quiz.js L94 | submitAnswer 查题无 deleted=0（API 层不防御已删题） |
| P3-8 | Quiz.vue L284 | essay 提交 selected 传字符串，靠 isEssay 短路才不炸（脆弱） |
| P3-9 | db-paper.js L98-101 | getPaper JOIN 无 q.deleted=0，旧卷含已删题 |
| P3-10 | db-habits.js L1 | habits/habit_checks 为**已砍功能残留表**（schema 仍建、成就 habitChecks 恒 0）→ 死表，且轮 1 P1-1 修正为「**仅 review_logs 需补同步**」 |
| P3-11 | db-meta.js L90 | 断点续做 questions（含答案）存 settings 随同步走（数据纯净性） |
| P3-12 | db-meta.js L79-92 | clearUserData 未清 papers / kb_highlights / kb_doc_links |
| P3-13 | db-misc.js L108 | `totalAnswered: s.learned \|\| s.totalAnswered` 死代码（learned 恒优先） |
| P3-14 | preload/main | 6 个死接口（见上表）可清理 |
| P3-15 | db-quiz.js L102 | 多选判分 `[...selected].sort()` 字符串比较——答案含 HTML 富文本时排序比较脆弱（当前数据 OK） |

### ✅ 验证通过
- 四步写事务（答题记录+用户计数+XP+错题本）原子性 ✓
- recite 模式不污染统计/XP（仅错题本）✓；每日一题"答对连击/答错不清"逻辑 ✓
- 模拟卷组卷 Fisher-Yates 洗牌 + 计分误差抹平 + manualTotal>100 校验 ✓
- 标签 setQuestionTags bump updated_at 使删除可传播 ✓
- clearUserData 覆盖 XP 根源（此前漏清已修注释在案）✓
- 断点续做退出拦截 + 完成后清除 ✓

## 三、轮 1 P1-1 修正说明

`db-habits.js` L1 注释证实「习惯打卡已砍」——habits/habit_checks 是残留表，**不需要也不应该同步**。轮 1 P1-1 修正为：**仅 `review_logs`（复习次数，驱动周报/成就）需补入同步导出**；habits 表列入死代码清理（P3-10）。

## 四、汇总（累计 2 轮）

- 轮 1：P1×3（其中 P1-1 修正后=review_logs 同步缺）· P2×7 · P3×6
- 轮 2：P2×6 · P3×9 · 三层接线 128/128 全对齐（+6 死接口）
- 核心事务/算法质量高；问题集中在**软删复活、统计口径、同步覆盖、死代码**
