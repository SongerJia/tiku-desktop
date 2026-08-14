# 代码审计 · 轮 3：题库 / 知识库 / 搜索（页面维度）

> 审计时间：2026-08-14 · 范围：`db-bank.js / db-kb.js` + 前端 `BankManager / KbLibrary / KbReader / UnifiedSearch / ImportWizard` 关键模式抽查
> 专项：better-sqlite3 嵌套事务行为核实（node_modules 源码级）、v-html 面、定时器清理配对

## 一、专项核实

| 项 | 结果 |
|---|---|
| batchUpdateQuestions 事务内调 setQuestionTags（内层再开事务） | ✅ **安全**——better-sqlite3 `db.inTransaction` 时自动降级 SAVEPOINT（transaction.js L54-62），非嵌套 BEGIN |
| v-html / innerHTML 面（6 处） | ✅ 内容源均为内部枚举（Icon name / 底部 tab 图标）或本地用户内容 MD 渲染（Vditor 默认净化）；风险=本地内容互信模型，多用户共享题库时需净化 |
| 定时器清理（5 组件） | ⚠️ BankManager 3 个 / ImportWizard 1 个 setTimeout 未在卸载清理（Vue3 卸载后 ref 更新无害，P3） |

## 二、发现清单

### 🟠 P2

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| P2-14 | db-kb.js L16 / L141 / L382 | **rel_path 路径穿越校验缺失**：readKbFile / deleteKbDoc(unlink) / kbSaveMd(write) 直接 `path.join(kbDir, rel_path)`——restoreKbFiles（L436）有防穿越，但这三处没有；同步导入含 `../` 的 rel_path 可越界读写 | 抽统一 `safeRelPath()` 校验（拒绝 `..` / 绝对路径 / 盘符），三处共用 |
| P2-15 | db-bank.js L210-216 | getBankStats.bySubject 只统计 `parent_id=s.id` 直接子级 → 3 级分类（科目>章>节）漏节内题目 | 与轮 2 P2-12 同族：章节统计统一用子孙展开 |
| P2-16 | db-bank.js L77 | listQuestions 搜索 `options_json LIKE`——选项 JSON 含 HTML 标签，关键字误命中标签属性 | 搜索域改为 stem/analysis/keywords 文本列，或剥 HTML 后匹配 |
| P2-17 | db-kb.js L367-372 | bumpKbRead 每次打开阅读页 +5 XP 且 read_count+1 **无防刷**——反复开关文档可刷"阅读"每日任务与 XP | 同文档同日去重（settings 记当日已读集合）或限频 |
| P2-18 | db-bank.js L161-166 | getQuestionInfo 分类路径 `while (pid)` **无循环 guard**（_rootSubjectOf L18 有 guard<10，此处无）；同步合并若引入环会死循环 | 补 guard（同 _rootSubjectOf） |
| P2-19 | db-kb.js L71/L96/L200 | getKbGraph 每节点查 tags、getKbDocs 每文档 2 查询、getKbLinksForDoc 每链接查 stem——N+1（当前量级小，文档数百时可见） | 批量 IN 查询 |

### 🟡 P3

| # | 位置 | 问题 |
|---|---|---|
| P3-16 | db-kb.js L155 | addCardFromHighlight 按 front 文本判重——不同高亮同文本会判重 |
| P3-17 | db-kb.js L247 | extractKeywords 停用词表 '的是' 重复项 |
| P3-18 | BankManager.vue L46/104/127 · ImportWizard.vue L60 | toast/noteHint/防抖 setTimeout 未存句柄、卸载未清理（Vue3 无害，仅规范） |
| P3-19 | db-bank.js L23-58 | importQuestionBank 单事务处理全量 rows（千行 OK，万行占内存） |
| P3-20 | db-kb.js L105 | getKbDoc 返回全部 blocks（超大文档一次拉全） |
| P3-21 | db-bank.js L119-128 | addQuestion 无服务端必填校验（type/stem），靠前端 |

### ✅ 验证通过
- deleteKbDoc 级联清理完整（kb_links/kb_tags/kb_blocks 物理删 + 高亮软删 + 双链双向删 + 文件删除）
- restoreKbFiles 防穿越 + 远端为准覆盖写（修复回滚循环的注释在案）
- searchKb LIKE 转义（%_\\）✓；deleteQuestion 顺带清 question_tags ✓
- 嵌套事务 SAVEPOINT 机制 ✓；upsertCategoryByName 同父同名去重 ✓

## 三、汇总（累计 3 轮）

- 轮 3：P2×6 · P3×6；嵌套事务疑点源码级排除（验证通过）
- 累计：P1×3（P1-1 修正为 review_logs 同步）· P2×19 · P3×21
- 主题律：问题集中在**同步覆盖、软删复活、统计口径、路径防御、死代码**五类模式
