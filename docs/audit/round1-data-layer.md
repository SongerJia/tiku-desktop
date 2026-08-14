# 代码审计 · 轮 1：数据层与统计口径（功能维度）

> 审计时间：2026-08-14 · 范围：`electron/db-schema.js / db-cols.js / db-stats.js / db-gamify.js / sm2.js / db-cards.js / db.js / db-export.js / db-sync.js(exportData) / db-quiz.js(插入路径)`
> 方法：逐文件通读 + Python 复刻真实 schema 交叉验证（沙箱验证约定）

## 一、范围与方法

| 文件 | 行数 | 角色 |
|---|---|---|
| db-schema.js | 346 | 建表 + 轻量迁移（只加列） |
| db-cols.js | 21 | 导出列清单（EXPORT_COLS） |
| db-stats.js | 332 | 统计 / 趋势 / 成就指标 |
| db-gamify.js | 104 | XP / 等级 / 每日任务 / 复习到期 |
| sm2.js | 24 | SM-2 自适应复习算法 |
| db-cards.js | 137 | 卡片记忆 + 材料题 |
| db.js | 256 | 入口 / 连接 / 备份 / 恢复 |
| db-export.js | 83 | Markdown 导出 + 孤儿图清理 |
| db-sync.js | 588 | 导出 / 合并（exportData 部分） |
| db-quiz.js | — | 答题 / 错题 / 笔记写入路径（交叉核对） |

交叉验证脚本：`scripts/verify-round1.js.py`（复制真实 schema 含迁移列，7 组用例全跑通）。

## 二、交叉验证结果

| 用例 | 结果 | 说明 |
|---|---|---|
| 软删 + UNIQUE 冲突 | ⚠️ 冲突可复现 | 但使用方 UPSERT 兜底，未崩（见 P3-15） |
| 等级公式边界（0/99/100/999/1000/10000） | ✅ | `floor(sqrt(total/100))+1` 连续单调，pct 恒 [0,100] |
| getSummary.today 未来时间戳 | ⚠️ 计入"今日" | n=1（应为 0），P3 |
| 活跃天数 vs 已学 | ⚠️ 口径不一致 | 活跃天无 q.deleted 过滤，P2 |
| getStats.rate vs accuracy | ⚠️ 75% vs 100% | 一个含背题/自评一个排除，P2 |
| SM-2 序列（0→1→6→×ease，失败重置） | ✅ | 质量分/ease± 与标准一致 |
| cards 软删重复生成 | ⚠️ 2 行共存 | source_question_id 无 UNIQUE，P2 |

## 三、发现清单（按严重度）

### 🔴 P1（高，建议尽快修复）

**P1-1 习惯 / 复习日志不进云同步与备份导出**
- 位置：`db-sync.js` L18-64（exportData）· `db-cols.js` EXPORT_COLS · `db-schema.js` L171 注释
- 问题：exportData 覆盖 22 类数据，但 **habits、habit_checks、review_logs、question_tags 完全缺失**；schema 注释明确写"反馈层…全部带 client_id 走 LWW 同步"，设计与实现不符
- 影响：换机 / 恢复备份后，习惯打卡（habitChecks 成就）、复习次数（reviewCount 成就、getMonthStats.reviewed、周报）**清零**，成就与周报失真；题目标签（question_tags）丢失
- 修复：EXPORT_COLS 增补 4 表列；db-sync import 侧增补对应 dump/合并（sync-merge 增加 habits/review_logs 表）；tags 已走题目 cid 关联，需补 export 侧

**P1-2 wrong_books 软删后"复活"缺失（错题链路错乱）**
- 位置：`db-quiz.js` L112-119（recite UPSERT）、L143-151（答错 UPSERT）、L271-279（markMastered）、L292-308（rateReview）
- 问题：wrong_books 所有 `ON CONFLICT DO UPDATE` 与相关 `UPDATE` 都**未置 `deleted=0`**；查询（L271/L292 `SELECT … WHERE user_id=? AND question_id=?`）也无 `deleted=0` 过滤。对照：notes 的 UPSERT（L240-243）**有** `deleted=0`
- 影响：用户删除某错题后，该题再次答错 / 复习 / 标记掌握 → 数据写入被软删行（不可见），错题本、复习到期、掌握统计全部错乱
- 修复：所有 wrong_books UPSERT 的 DO UPDATE 加 `deleted=0`；相关 UPDATE 语句补 `deleted=0` 条件或同时置位；L271/L292 查询加 `deleted=0`

**P1-3 restoreBackup 后子模块 sqlite 闭包失效**
- 位置：`db.js` L127-140（Object.assign 传 ctx.sqlite 值拷贝）vs L191-219（restoreBackup close → _tryOpen 重新赋值）
- 问题：子模块闭包持有的 sqlite 是**最初实例**，restoreBackup 后全局 sqlite 指向新库，子模块仍指已 close 的旧实例 → 恢复后所有查询抛 "connection not open"
- 待确认：main.js 调用 restoreBackup 后是否 `app.relaunch()`（若重启则无碍）——见轮 5 主进程审计；若不重启，需改为 api 持有可变引用或恢复后重建子模块
- 影响：备份恢复功能可能直接失效（取决于主进程重启策略）

### 🟠 P2（中，安排修复）

| # | 位置 | 问题 | 影响 | 建议 |
|---|---|---|---|---|
| P2-1 | db-stats.js L14 vs L151-156 | getStats.rate 含 recite/card/self_graded，getSummary.accuracy 排除 | 首页与统计页正确率不一致 | 统一口径（getStats 同步排除） |
| P2-2 | db-stats.js L136 | 活跃天数/streak 无 q.deleted 过滤 | 删题后 activeDays 虚高、连击口径漂移 | 加 JOIN questions 过滤 |
| P2-3 | db-cards.js L32 | source_question_id 无 UNIQUE，删卡后重新生成双卡 | 卡片去重失效 | 去重查询含软删行或重建时复活 |
| P2-4 | db-gamify.js L77-91 | quest 领奖 XP 按 note 字符串去重（`刷20题`） | 当日改目标后同任务可重复领 XP | note 结构化（key+目标值分离） |
| P2-5 | db-gamify.js L27 | weeks 周排行 `%Y-%W` 与 JS 周起点跨年错位 | 跨年周统计错位 | 统一 ISO 周或 JS 周 key |
| P2-6 | db-cards.js L84 | rateCard 不更新 updated_at | LWW 同步可能回滚复习进度 | UPDATE 补 updated_at |
| P2-7 | db-cols.js L14 vs db-sync.js L43-47 | kbDocs 缺 category_cid 列，由 exportData 特判 LEFT JOIN 补 | 维护隐患（列清单失真） | EXPORT_COLS 补列 |

### 🟡 P3（低，顺手修）

| # | 位置 | 问题 |
|---|---|---|
| P3-1 | db-stats.js L132 | today 无未来时间上限（`created_at>=todayStart`） |
| P3-2 | db-stats.js L296 | reason 未归一化（大小写/空格变体分桶） |
| P3-3 | db-cards.js L118-128 | upsertMaterial 无 UNIQUE(subject_id,content)，同步可能重复 |
| P3-4 | db.js L43-55 | descendantCategoryIds 每次全表扫 categories（量级小，仅微优化） |
| P3-5 | db-cards.js L41 | categories 查询无 deleted=0 过滤（取名字，语义无碍） |
| P3-6 | db-schema.js L59-73 / L84-95 | wrong_books/notes 软删 + UNIQUE 靠 UPSERT 兜底（已确认 notes 复活正确） |

### ✅ 验证通过（无需处理）

- SM-2 算法正确（序列 0→1→6→×ease、失败重置 1 天、ease± 与标准一致，间隔 clamp 365）
- 等级公式单调连续；init 顺序（建表→迁移→用户→种子→cid 回填）正确
- PRAGMA（WAL / busy_timeout / foreign_keys / cache）健壮性好
- 自动备份按天去重 + 损坏自动恢复链路完整；migrateSchema 只加列的安全规则 ✓
- 索引覆盖主要查询路径（wb_user_status / ar_user_created / notes_user_q 等）
- answer_records 四步写事务包裹（db-quiz L125）✓ 防半状态

## 四、汇总

- **P1 × 3**（同步缺表 / 错题复活缺失 / 恢复后闭包失效）
- **P2 × 7**（统计口径 ×2 / 卡片去重 / quest 去重 / 周排行 / 同步时间戳 / 列清单）
- **P3 × 6**
- 核心算法（SM-2、等级、UPSERT 兜底）质量良好，问题集中在**同步覆盖不全**与**软删复活**两类模式

> 建议：P1-2（错题复活）与 P1-1（同步缺表）随轮 5 同步链路审计一并修复；P1-3 待 main.js 确认后定案。统计口径（P2-1/P2-2）建议本轮优先统一，避免用户看到"首页 100%、统计页 75%"的困惑。
