# 知识记忆小助手（刷题题库）— Electron 本地版

一个**本地安装、离线可用**的刷题题库桌面软件。数据全存在你电脑上的一个 SQLite 文件里，不需要服务器、不需要联网、不需要备案。支持分类刷题、选择题自动判分、问答题自评、错题本、收藏、学习统计、模拟卷组卷、题目图片与笔记，以及 CSV / Excel / JSON 导入导出。内置**个人知识库**（md / pdf 知识文档，与题库题目双向联动），升级为"刷题 + 资料库"all-in-one 学习工具。

> 当前版本：**v0.6.3（Phase 1 本地 + Phase 2 全量云同步 + 科目维度全闭环 + 模拟卷/图片 + 个人知识库全闭环 + 学习反馈层 + 赛季系统 + 全局打磨 + 阅读器体验升级 + 自动更新）**。已实现本地刷题全闭环、**GitHub 仓库全量云同步**（学习数据 + 题库 + 知识库文档原件 + 题目图片，跨 Windows/macOS/安卓）、**科目维度全闭环**（题库/错题/收藏/复习/每日一题/薄弱点/知识库/记忆卡全部跟随科目）、模拟卷组卷、题目图片与音频、标签系统、弱点强化、错题深度分析、PDF 导出、游戏化成就与**赛季挑战**、批量操作、浅色主题，**个人知识库**（md/pdf 导入、全文搜索、阅读、MD 在线编辑、文件夹分类、同步、导出、与题目双向联动、统计），**学习反馈层**（XP 等级、每日任务、每日回顾、番茄钟、习惯打卡、错题原因、文档高亮/双链、周排行、学习周报），**记忆卡**（按科目归类 + SM-2 调度复习）、**全局体验打磨**（应用内 Toast/Confirm、骨架屏、计数动画、Tab 过渡、Esc 关闭、键盘可达、自动备份、首启引导、打包图标）与**学习体验打磨**（知识块间隔复习、练习完成总结、顽固错题优先、键盘快捷键、成就/升级即时庆祝）与**阅读器体验升级**（知识库全屏三栏阅读页、右侧栏整列收起、MD 打开即 Vditor 即时渲染编辑、PDF 懒渲染 + 缩放缓存 + Ctrl+滚轮 + 右下角缩放浮层）与**发布体系**（GitHub Releases 应用内自动更新、安装包瘦身、一键安装向导）；Phase 3 用 Capacitor 出 Android APK。

---

## 1. 技术架构与版本

| 层级 | 技术/库 | 版本 | 说明 |
|---|---|---|---|
| 桌面壳 | Electron | ^31.0.0 | 把 Chromium + Node.js 打包成独立 exe/dmg |
| 界面框架 | Vue | ^3.4.0 | Composition API + `<script setup>` |
| 构建工具 | Vite | ^5.4.0 | 开发热更新 + 生产打包 |
| Electron 插件 | vite-plugin-electron | ^0.28.0 | 把 electron/main.js 纳入 Vite 构建 |
| 本地数据库 | better-sqlite3 | ^11.3.0 | 单个 `tiku.db` SQLite 文件，存在系统用户目录 |
| Excel 读写 | 自研 `electron/xlsx-lite.js` | — | 零依赖，Node 内置 `zlib` + 手写 zip/CRC32，不装 `xlsx` npm 包 |
| CSV 解析 | 自研 `src/utils/bankParser.js` | — | RFC4180 + GBK 自动回落 + 题型/答案归一化 |
| MD 编辑/渲染 | Vditor | ^3.11.2 | 即时渲染（IR）模式：整篇渲染预览、光标行显示源码（点击行即编辑）；离线资源本地化在 `public/vditor/`（cdn 指向相对路径） |
| PDF 抽取/渲染 | pdfjs-dist | ^6.2.108 | 纯 JS：主进程抽文本（`extractPdf`）、渲染进程 canvas 渲染；**懒渲染**（只渲染可见页 + 滚动按需补渲 + 缩放缓存，大 PDF 秒开）+ Ctrl+滚轮缩放 |

### 核心约定
- **主进程**：`electron/main.js`（CommonJS），负责窗口、IPC、SQLite、better-sqlite3、xlsx-lite。
- **渲染层**：`src/`（ESM），Vue 组件通过 `window.electronAPI` 调用 IPC；不直接访问 Node API，保持 `contextIsolation: true`。
- **IPC 命名**：与 `db.js` 函数同名（`getCategories`、`submitAnswer`、`importQuestionBank`…），新增接口先在 `electron/preload.js` 白名单、再在 `src/api/tiku.js` 封装、最后在组件里使用。
- **安全**：`nodeIntegration: false`、`contextIsolation: true`；preload 只暴露白名单函数。

---

## 2. 已实现功能与当前进度

| 模块 | 功能点 | 状态 | 备注 |
|---|---|---|---|
| **首页** | 欢迎卡片、今日已刷、错题/收藏/全部刷题快捷入口 | ✅ 完成 | |
| **科目/章节** | 顶部科目选择器、两级分类树、章节筛选 | ✅ 完成 | 点顶部按钮弹出抽屉 |
| **题库数据** | SQLite 建表、样例数据、分类 CRUD、题目 CRUD | ✅ 完成 | 核心七张表，已含 `client_id` + `updated_at`/`deleted`（云同步身份与软删） |
| **刷题答题** | 单选 / 多选 / 判断自动判分、问答题自评 | ✅ 完成 | 问答有「得分关键词」高亮辅助自评 |
| **练习模式** | 顺序/随机、错题重练、收藏复习、全部刷题 | ✅ 完成 | |
| **考试模式** | 倒计时、到点自动交卷 | ✅ 完成 | 问答题到点未自评算未掌握 |
| **错题本** | 答错自动入册、答对标记 mastered、复习状态 | ✅ 完成 | |
| **收藏** | 题目收藏/取消 | ✅ 完成 | |
| **学习统计** | 掌握进度、周趋势、学习日历、连续天数、章节进度 | ✅ 完成 | |
| **题库导入** | CSV / Excel / JSON 批量导入、预览校验、自动去重 | ✅ 完成 | 支持 `.xlsx`（零依赖）和 `.csv`（GBK 兼容） |
| **题库导出** | CSV / Excel 导出当前题库 | ✅ 完成 | 列序与导入模板严格一致，可导回 |
| **整库备份** | JSON 导出/导入整库（含答题记录、错题、收藏） | ✅ 完成 | 用于换机迁移 |
| **界面风格** | 科幻风暗色主题、响应式布局（窗口自适应） | ✅ 完成 | 支持宽屏/窄屏 |
| **窗口菜单** | 隐藏系统默认 File/Edit/View/Window/Help 菜单 | ✅ 完成 | 更像独立 App |
| **题库搜索** | 题库管理页关键词搜索（300ms 防抖）+ 科目筛选 + 分页 | ✅ 完成 | 走 `listQuestions` 的 `keyword` 参数 |
| **数据同步** | 多端云同步（GitHub 仓库，单后端全量） | ✅ 完成 | `tiku-assets` 私有仓库存 data.json.gz（学习数据+题库）+ kb/（知识库文档原件）+ images/（题目图片）+ tiku-manifest.json；「拉远端 mergeRemote 合并→exportSync 全量推回」收敛；client_id + LWW 冲突；kb/图片 hash 双向增量；token safeStorage 加密存储 |
| **模拟卷组卷** | 按题型/难度/章节抽题组卷、存卷、限时考试、重考 | ✅ 完成 | `papers`/`paper_questions` 两表；`generatePaper` 按规则随机抽题+等分/手动计分；「我的试卷」可重考 |
| **题目图片** | 题干配图（多图），录入/答题渲染，随题库备份 | ✅ 完成 | `questions.images_json` + `userData/images` 本地图床；`saveImage`/`getImage` |
| **题目笔记** | 每题个人批注，答题页/题库页内联编辑，Profile「我的笔记」汇总 | ✅ 完成 | `notes` 表 + `getNote`/`saveNote`/`listNotes`/`getNotedQuestionIds` |
| **背题模式** | 直接看答案不判分，可叠加任意范围（如背错题） | ✅ 完成 | 与题库范围正交的开关，与考试互斥 |
| **智能复习** | SM-2 间隔重复算法：按每次作答质量（0–5）动态计算 `ease`/`interval`，连对毕业；复习间隔不再固定写死 | ✅ 完成 | `wrong_books.next_review_at` 新增 `ease`/`interval` 列；`scheduleNextReview(state, quality)` 按质量分复利增长，「复习」范围可用 |
| **标签系统** | 题目打标签（高频/易错/必背…），题库按标签筛选、练习按标签范围 | ✅ 完成 | `question_tags` 表 + `setQuestionTags`/`listTags`/`getQuestionTags`；标签随同步传播 |
| **弱点强化** | 按正确率/错题数加权自动抽取最薄弱的题练习 | ✅ 完成 | `getWeakQuestions`；练习设置新增「弱点强化」范围 |
| **错题深度分析** | 薄弱章节自动识别（正确率升序）+ 相似题推荐 + 交卷逐题解析页 | ✅ 完成 | `getWeakChapters`/`getSimilarQuestions`；Quiz 交卷后可看「你的答案 vs 正确答案 + 解析」 |
| **模拟卷/错题 导出 PDF** | 打印/导出为 PDF（答题卷 + 答案键 / 错题解析） | ✅ 完成 | `src/utils/print.js` 独立窗口调起系统打印；题干图内联 base64 |
| **游戏化成就** | 成就墙（10 项）+ 每日目标进度 + 首页今日进度卡 | ✅ 完成 | `getAchievements`；成就阈值在前端派生；目标存 `settings.daily_goal` |
| **题目批量操作** | 多选题目批量移动章节/打标签/改难度/删除 | ✅ 完成 | `batchUpdateQuestions`/`batchDeleteQuestions`；软删兼容同步 |
| **浅色主题 + 字号** | 护眼浅色主题、字号 80%–140% 全局缩放 | ✅ 完成 | `data-theme="light"` 覆盖 CSS 变量 + `documentElement.zoom`；存 `settings.theme/font_scale` |
| **图片跨设备同步** | 题图独立存储跨设备（原仅传文件名会裂图，也不再把 base64 塞进 JSON 快照） | ✅ 完成 | 图片独立存仓库 `images/` 目录（hash 去重双向增量）；`exportImageFiles`/`restoreImages`；manifest 按 sha256 跳过重传 |
| **个人知识库** | 知识文档（md/pdf）入库、MD 按标题切块 / PDF 逐页抽文本、全文检索、知识库 Tab（列表/搜索/标签/**全屏三栏阅读**：Vditor IR 编辑 + pdfjs 懒渲染）、**题目↔文档双向联动**（解析页「相关文档」+ 文档页「相关题目」+ L2 自动推荐） | ✅ 完成 | `kb_docs`/`kb_blocks`/`kb_tags`/`kb_links` 四表 + `electron/kbExtract.js` + LIKE 检索 + `getSuggestedDocsForQuestion`/`getSuggestedQuestionsForDoc`（共享标签 + 题干/块关键词，零 ML） |
| **统一搜索** | 顶部搜索按钮一处搜题目 + 知识文档（双组结果，题目速览 / 文档阅读直达） | ✅ 完成 | `UnifiedSearch.vue` + `SimpleQuestion.vue`；并行 `listQuestions(keyword)` + `kbSearch` |
| **知识库跨设备同步** | 知识库**文档原件**随仓库同步：kb/ 目录双向增量（md/pdf 文件 hash 比对，缺失/变更才传），元数据走快照合并 | ✅ 完成 | `syncAssets` 递归扫描 kb 目录；`mergeRemote` LWW + rel_path 冲突换名兜底 + 路径穿越防护 |
| **整库备份含知识库** | JSON 备份/恢复含 kb 四表 + 全部原件文件（md/pdf base64 内嵌） | ✅ 完成 | `exportData` 加 kb 表与 `listKbFiles`；`importData` 还原 `restoreKbFiles`；老备份无 kb 字段自动跳过 |
| **知识库文件夹** | 文档按文件夹分组展示（未分类置顶）、编辑弹层设置/移动文件夹 | ✅ 完成 | `kb_docs.folder` 列（ALTER 兜底）+ `getKbFolders`/`moveKbDoc` |
| **知识库统计** | 「我的」新增知识库概览（文档/文本块/题目联动/阅读次数/标签/文件夹）+ 阅读埋点 | ✅ 完成 | `kb_docs.read_count` + `bumpKbRead`；`kbStats` 扩展 |
| **MD 在线编辑** | 知识库阅读页 MD 文档直接编辑保存，自动重新切块并更新检索索引 | ✅ 完成 | `kbSaveMd` 写回副本 + `extractMd` 重建块 + 更新 hash/size |
| **全屏三栏阅读页** | 知识库阅读从弹窗改为全屏三栏：左 MD 目录 / 中正文 / 右相关题目+批注；窄屏 <960px 回退单栏 | ✅ 完成 | `kb-page` + flex 三栏；MD 目录常驻左栏 |
| **右侧栏整列收起** | 顶栏「收起侧栏/展开侧栏」一键沉浸阅读（0.25s flex 动画），与各卡片独立收起共存 | ✅ 完成 | `sidePanelOpen` + `.collapsed` 修饰符；窄屏隐藏按钮 |
| **MD 打开即 Vditor 编辑** | MD 文档打开直接进 Vditor 即时渲染编辑器——整篇预览、点击行即编辑，无「编辑」按钮；输入停 800ms 自动保存 + Ctrl+S + 返回落盘 | ✅ 完成 | `initMdVditor`（mode:'ir'）+ `saveMdDoc`；目录从 Vditor DOM 收集 |
| **PDF 懒渲染 + 缩放缓存** | 大 PDF 打开只渲染可见页、滚动按需补渲（串行单页 getPage，严禁全量/并发）、缩放回旧比例复用缓存 | ✅ 完成 | `rebuildPdfAtZoom`/`pumpRenderQueue`/`pdfCache`（LRU 40） |
| **MD/PDF 统一缩放** | 右下角缩放浮层（滑条 + −/＋ + 百分比 + 复位）+ Ctrl+滚轮 + 2.2s 自动隐藏，MD 字号倍数 / PDF canvas scale | ✅ 完成 | `changeZoom`/`onZoomSlider` 按文档类型分发；`attachZoomWheel` |
| **系统通知提醒** | 每日定时学习提醒（今日已刷/错题待复习），主进程 Notification + 每分钟检查，当天只提醒一次 | ✅ 完成 | settings `remind_enabled/remind_time/last_remind_date`；「我的」偏好设置开关 + 时间选择 |
| **知识库导出** | 一键导出知识库到指定目录（全部原件副本 + manifest.json 元数据/标签/联动摘要） | ✅ 完成 | `kbExport` 选目录复制 + 写 manifest |
| **XP 经验值 + 等级** | 刷题/复习/阅读/专注/任务得 XP，等级进度条 + 今日/本周统计 | ✅ 完成 | `xp_logs` 事件表（带 client_id 随同步）+ `xpStats`；答对+10 答错+2 |
| **每日任务 Quest** | 每日 3 任务（刷 20 题/复习 5 条/阅读 1 篇），达标自动发 XP（当天一次） | ✅ 完成 | `checkQuests` 实时判定当天指标，零新表 |
| **每日回顾** | 到期错题 + 知识库随机块 → 卡片翻面主动回忆，记结果 + XP | ✅ 完成 | `review_logs` + `getDailyReview`；`ReviewPanel.vue` |
| **专注番茄钟** | 25 分钟专注计时，完成记入统计 + XP | ✅ 完成 | `focus_sessions`；首页卡片计时器 |
| **习惯打卡** | 多目标习惯（雅思/健身…）每日打卡、连续天数、首页快速打卡 | ✅ 完成 | `habits` + `habit_checks`（UNIQUE 每日一次，随同步） |
| **错题原因标签** | 错题标记错因（粗心/知识点不懂/时间不够/审题不清/其他），随同步传播 | ✅ 完成 | `wrong_books.reason` 列 + 错题本下拉 |
| **文档高亮批注** | 阅读时选中文字高亮 + 批注列表 | ✅ 完成 | `kb_highlights`（带 client_id 随同步） |
| **文档双链** | 文档↔文档双向关联，阅读页搜索关联 + 跳转 | ✅ 完成 | `kb_doc_links`（UNIQUE，cid 引用解析随同步） |
| **本地周排行** | 近 6 周 XP 对比（自己 vs 历史周），无社交 | ✅ 完成 | `xpStats.weeks` |
| **学习周报** | 近 7 天刷题/正确率/XP/专注/回顾/习惯聚合 → 打印导出 PDF | ✅ 完成 | `getWeeklyReport` + `print.js`；学习统计页按钮 |
| **知识块间隔复习** | 每日回顾的知识块按遗忘曲线调度（记住→3 天再见 / 忘记→1 天重来，含记错次数），不再是随机抽取 | ✅ 完成 | `kb_blocks.review_at/review_count/review_lapses` + `logReview` 调度 + 到期优先/新块兜底；随仓库同步 |
| **练习完成总结** | 练习做完弹总结：正确率/用时/错题列表 + 「重做这 N 道错题」一键重刷 | ✅ 完成 | Quiz done 面板 + `redoWrongs`；错题自动进错题本 |
| **顽固错题标记** | 同题错 ≥3 次标「顽固」，错题本高亮 + 每日回顾永远优先 | ✅ 完成 | `wrong_count>=3` 排序优先 + WrongBook badge |
| **键盘快捷键** | 1-9 选答案 / Enter 提交或下一题 / F 收藏 / 空格翻页（背题），输入框聚焦自动禁用 | ✅ 完成 | Quiz `onKey` + window keydown |
| **成就/升级即时庆祝** | 答题/复习/阅读后检测，新成就解锁与等级升级即时 toast 庆祝（首次不打扰老数据） | ✅ 完成 | `utils/achievements.js` 共享定义 + `utils/celebrate.js` 触发器 |
| **记忆卡** | 正反面记忆卡：添加/批量管理/翻卡复习，复用遗忘曲线调度（记住→3 天 / 忘记→1 天），**按科目归类**（错题/题目一键生成自动继承科目、切科目只看该科目卡、可切全部科目），随仓库同步 | ✅ 完成 | `cards` 表 + `CardsPanel.vue`（科目范围角标 + 列表/翻卡复习）；首页入口显示到期数 |
| **听力音频** | 题目可配 `audio_url`（本地路径或 http 链接），答题页自动显示播放器——雅思等听力题的扩展点 | ✅ 完成 | `questions.audio_url` 列 + 录题表单字段 + Quiz `<audio>` 渲染；随同步/备份传播 |
| **习惯增强** | 打卡 +5 XP（当天首次）+ 首页显示近 7 天圆点 + 空态引导；修复打卡勾选图标渲染 bug | ✅ 完成 | `checkHabit` XP 奖励 + `listHabits` 返回 week 位图 |
| **备份补全** | 整库备份/恢复补上反馈层 7 表（XP/习惯/打卡/回顾/专注/高亮/双链）+ 单词卡——之前备份会丢这些数据 | ✅ 完成 | `exportData` + `importData` 全覆盖，老备份自动跳过 |
| **同步安全加固** | 快照 gzip 压缩体积降 70-85%；下载失败自动重试 3 次 + 备用源（API contents 兜底 raw 502）；同步失败收集重试（成功才写 manifest）；token safeStorage 加密 + 路径穿越防护 + 超时/防重入 | ✅ 完成 | `sync-runner.js` + `sync-github-repo.js`；gh_token 加密文件 |
| **手动同步** | 「我的 → 数据管理 → 云盘同步（GitHub 仓库）」一键同步（自动保存配置）；测试连接 + 上次同步时间 + 结果摘要（数据/图片/文档增删 + 冲突数 + 失败清单） | ✅ 完成 | `ghSync` IPC + Profile 同步卡；`sync-runner.sync` 双向 |
| **同步冲突可视** | 合并时统计冲突条数（同记录双端都改过），同步 toast 展示「冲突 N 条（按时间戳覆盖）」 | ✅ 完成 | `makeUpsert` 冲突计数 + Profile toast |
| **导入备份保护** | 导入备份前**差异预览**：新增/覆盖/本地独有统计 + 明确确认，防误导入覆盖新数据 | ✅ 完成 | `db.importPreview` + Profile 导入确认弹层 |
| **导入去重三模式** | 题库导入重复处理升级：跳过重复（默认）/ 覆盖更新同题干 / 全部新增；结果页显示更新数 | ✅ 完成 | `duplicateMode` 参数 + ImportWizard 三选 |
| **导入模板补字段** | CSV/Excel 模板加「听力音频」列，解析器识别 audio 并写入 `audio_url` | ✅ 完成 | `bankParser.js` TEMPLATE_HEADER/别名/数据行 |
| **全局体验打磨** | 应用内 Toast（替代原生 alert）/ Confirm 弹层（替代原生 confirm）/ 骨架屏加载 / 计数动画 / Tab 切换过渡 / Esc 统一关闭 / 键盘 focus 可达 / 卡片 hover 反馈 | ✅ 完成 | `utils/toast.js` + `AppToast.vue`、`utils/confirm.js` + `AppConfirm.vue`、`SkeletonCards.vue`、`CountUp.vue`、`useEsc.js`；原生弹窗清零 |
| **数据安全** | 每次启动自动备份 `tiku.db`（按天去重，保留 5 份）+ 主进程全局错误日志 | ✅ 完成 | `db.autoBackup()` → `userData/backups/`；`error.log` |
| **首启欢迎引导** | 首次启动 3 步引导（导入题库/知识库/设目标），看过后不再显示 | ✅ 完成 | `WelcomeGuide.vue` + `settings.seen_welcome` |
| **打包发布** | electron-builder 配置（productName/appId/NSIS）+ 1024×1024 精致图标 + 安装包瘦身 + **GitHub Releases 应用内自动更新** | ✅ 完成 | `npm run dist` → `release/`；`npm run release` 发布（防呆查重 + 自动上传）；依赖瘦身（渲染层依赖移 devDependencies，asar 226MB→约 90MB） |
| **科目维度全闭环** | 题库/错题/收藏/复习/每日一题/薄弱点/知识库/记忆卡**全部跟随科目**（切顶部科目即切换范围），激励（XP/连击/成就/习惯）全局 | ✅ 完成 | 各模块传 `subjectId` 过滤；知识库按科目、记忆卡按科目（错题生成卡自动继承题目科目） |
| **赛季系统** | 每月一赛季：6 项挑战（刷题/复习/专注/打卡/记忆卡/全勤）目标逐季递增 + 赛季成就存档 | ✅ 完成 | `achievements.js` currentSeason/evaluateSeason/syncSeasonArchive + Profile 赛季区块 |
| **安装版数据隔离** | 打包版用独立 userData 目录（`知识记忆小助手-正式版`），安装版首次打开干净空库，不带开发机测试数据 | ✅ 完成 | main.js `app.isPackaged` 时 setPath 独立目录 |
| **发布流程** | `npm run bump patch/minor/major`（升版本号+同步 README+提交）→ `npm run release`（防呆查重+打包+上传 GitHub Releases）→ 已装用户自动更新 | ✅ 完成 | `scripts/bump-version.mjs` + `scripts/check-release-version.mjs` + electron-updater 全链路通知 |
| **Android APK** | Capacitor 打包移动端 | ⏳ 未开始 | Phase 3 |

> 「我的笔记」入口已从占位升级为真实功能（展示/删除全部笔记）；原「默写记录」「我的反馈」两个纯占位入口已移除。

### 当前阶段一句话
v0.6.0 全功能落地：题库闭环、模拟卷、标签、错题、笔记、知识库全链路、反馈层（XP/任务/回顾/番茄/习惯/高亮/双链/周报）、**科目维度全闭环**（题库/错题/收藏/复习/每日一题/薄弱点/知识库/记忆卡全跟科目）、**赛季系统**、全局打磨与数据安全（备份/引导/图标/打包配置）均已完成；**云同步升级为 GitHub 仓库单后端**（学习数据 + 题库 + 知识库文档原件 + 题目图片全量），**发布体系就绪**（bump 升版 + release 发布 + 应用内自动更新）。代码可直接 `npm install && npm run dev` 跑起来，`npm run dist` 可打包安装包，`npm run release` 发布后已装用户自动更新；下一步可选：**Phase 3 安卓 APK** 或 **扫描版 PDF OCR**。

---

## 3. 开发规范（给后续 AI / 协作者）

### 3.1 目录与文件约定
```
tiku-desktop/
├─ electron/
│  ├─ main.js          # 主进程入口：窗口、IPC、菜单隐藏、知识库导入编排
│  ├─ preload.js       # 渲染层白名单 API（contextIsolation 安全）
│  ├─ db.js            # SQLite 数据层：建表/判分/统计/导入导出/迁移/kb_* 四表与联动
│  ├─ kbExtract.js     # 知识库抽取：MD 按标题切块、PDF pdfjs 逐页抽文本、文件名去重
│  ├─ xlsx-lite.js     # 零依赖 Excel 读写器
│  └─ sampleData.js    # 首启样例数据（二级建造师）
├─ src/
│  ├─ App.vue          # 5 Tab 导航 + 顶部科目选择器/统一搜索按钮 + 答题覆盖层
│  ├─ main.js          # Vue 入口
│  ├─ style.css        # 全局 CSS 变量 + 基础样式（精致现代暗色主题 + 浅色主题；字体 Inter + Noto Sans SC 本地打包）
│  ├─ api/tiku.js      # 渲染层 IPC 调用封装（Proxy 自动转发 window.electronAPI + 统一错误日志）
│  ├─ utils/bankParser.js   # CSV/Excel/JSON 题库解析与校验
│  ├─ utils/print.js        # 独立窗口打印/导出 PDF
│  ├─ utils/appearance.js   # 主题/字号应用
│  └─ components/      # 页面与业务组件（KbLibrary/KbReader/UnifiedSearch/SimpleQuestion 为知识库新增）
├─ public/vditor/      # Vditor 离线资源（dist 全套 + content-theme 深浅主题；cdn 指向 './vditor' 本地化，生产 file:// 可用）
├─ scripts/            # 独立测试脚本（test-kb.py / test-kb-extract.mjs / test-parser.mjs / test-xlsx.mjs / test-mock-paper.js / test-tag-filter.py）
├─ vite.config.js
├─ vite.verify.config.js   # 纯编译校验（不落盘产物）
└─ package.json
```

### 3.2 新增 IPC 的标准两步（tiku.js 已 Proxy 化，无需维护方法列表）
1. `electron/main.js`：`ipcMain.handle('foo', (e, arg) => db.foo(arg))`
2. `electron/preload.js`：`foo: (arg) => ipcRenderer.invoke('foo', arg)`
> `src/api/tiku.js` 是 Proxy 自动转发 `window.electronAPI` 全部方法并统一捕获错误日志——**preload 加新方法后组件直接 `tiku.foo()` 即可，无需改 api 层**。

### 3.3 新增题型的标准链路
题库系统里有四种题型：`single`（单选）、`multiple`（多选）、`judge`（判断）、`essay`（问答）。如果要加第五种题型：
1. `electron/db.js`：`submitAnswer` 判分逻辑、`getQuestions` 返回值里加字段。
2. `src/utils/bankParser.js`：题型别名映射、校验规则、`bankToMatrix` 导出列。
3. `src/components/QuestionEditor.vue`：录入界面。
4. `src/components/Quiz.vue`：作答与结果展示。
5. `src/components/ImportWizard.vue`、`BankManager.vue`：导入/导出预览。
6. `electron/main.js`：如导出列需要调整，同步更新 `EXPORT_HEADER`/`bankToMatrix`。

### 3.4 样式规范
- 全部颜色用 CSS 变量（见 `style.css`）：`var(--brand)`、`var(--ok)`、`var(--bad)`、`var(--warn)`、`var(--muted)`、`var(--text)`、`var(--bg)`、`var(--card-solid)`、`var(--line)`。
- 圆角变量：`--radius`、`--radius-sm`；阴影/发光：`--shadow`、`--glow-soft`。
- 响应式：默认移动端窄屏布局，`.wide` / `@media (min-width: 900px)` 覆盖宽屏。
- 组件 scoped style，全局原子类放 `style.css`。

### 3.5 数据库迁移
- `db.js` 的 `init()` 里用 `PRAGMA table_info` 检查列是否存在，缺列则 `ALTER TABLE ADD COLUMN`。
- 不要直接改已发布表的列类型；新版加列、旧版兼容。

### 3.6 测试规范
- 解析层测试：`npm run test:parser`（覆盖 CSV 转义、GBK、题型推断、答案归一化、问答/关键词、脏数据）。
- Excel 测试：`npm run test:xlsx`（覆盖 xlsx-lite 读写往返、题库→Excel→重导回端到端）。
- 知识库测试：`npm run test:kb`（`test-kb.py` 用 Python sqlite3 镜像 db.js 的 kb 四表/CRUD/搜索/L2 推荐 SQL，`test-kb-extract.mjs` 真实跑 pdfjs 抽 `fixture.pdf` 文本）。
- 编译校验：`npm run verify`（排查 SFC 语法错误，不落盘产物）。
- 主进程语法：`node --check electron/main.js && node --check electron/preload.js`。

---

## 4. 快速开始

```bash
# 1. 安装依赖（better-sqlite3 是原生模块，首次安装会本地编译，需有构建环境：
#    Windows 装了 VS Build Tools / Python；Mac 装了 Xcode Command Line Tools）
npm install

# 2. 开发模式：自动起 Vite + 打开桌面窗口
npm run dev

# 3. 自测（全部绿色再提交）：
npm run verify      # 渲染层编译校验（不落盘）
npm run test:kb     # 知识库数据层（Python 镜像）+ 抽取模块
npm run test:sync   # 同步合并逻辑（LWW/去重/UNIQUE 语义）
npm run test:parser && npm run test:xlsx   # 解析层 + Excel

# 4. 打包成 Windows 安装包（输出在 release/ 目录，含自定义图标）
npm run dist

# 5. 发布新版本（详见下方「发版流程」小节）
npm run bump minor   # 升版本号（自动同步 README 版本行）
npm run release      # 防呆查重 → 打包 → 上传 GitHub Releases → 已装用户自动更新
```

### 发版流程（版本号由 bump 命令统一管理）

**`npm run bump <patch|minor|major>`** —— 升版本号并同步各处：

| 参数 | 版本变化 | 什么时候用 |
|---|---|---|
| `patch` | 0.6.0 → 0.6.1 | 修 bug、小调整 |
| `minor` | 0.6.0 → 0.7.0 | 加了新功能 |
| `major` | 0.6.0 → 1.0.0 | 功能稳定、正式发布 |

跑完自动做三件事：
1. **改 `package.json` 的 version**（软件内「关于我们」、安装包、GitHub Release tag 全部跟随它）
2. **同步 README 第 5 行「当前版本：vX.Y.Z」**（只换版本号，不碰描述文字）
3. 提示你提交（`git add -A && git commit`）

**完整发版流程：**

```bash
npm run bump minor            # ① 升版本（自动改 package.json + README）
git add -A && git commit -m "release: v0.7.0"   # ② 提交版本号
git push                      # ③ 推送代码（可选但建议）
npm run release               # ④ 打包 + 上传 GitHub Releases（内置防呆：同版本已发布会中止）
```

发布后：
- **已装用户**：启动 10 秒后 / 每 6 小时自动检测，发现新版自动下载，退出应用即自动安装——无需重新下载安装包
- **新用户**：从 GitHub Releases 下载安装包（一键安装向导）
- 版本号在 **README / 软件内「关于我们」/ 安装包 / GitHub Release** 四处保持一致

> 发布需要 GitHub Token（`repo` 权限）：已写入 Windows 用户环境变量 `GH_TOKEN`，或发布前 `export GH_TOKEN=ghp_xxx`。

> 沙箱环境里没有 VS Build Tools，我没法在这里 `npm run dev` 实景跑起来；但工程是规范的，拉回去 `npm install && npm run dev` 即可。

---

## 5. 界面结构

5 个底部 Tab：
- **首页**：欢迎卡 + 知识卡片总数（计数动画）+ 快捷入口 + 今日目标进度 + **每日任务 Quest** + **习惯打卡** + **每日回顾/番茄钟** + 空题库引导。
- **题库**（原「知识库」）：搜索框 + 章节筛选 chips + 知识点卡片列表，点卡片即进入答题。题库管理的入口在「我的」。
- **知识库**（个人文档）：md / pdf 知识文档的导入、全文搜索、标签筛选、**全屏三栏阅读**（左目录/中正文/右相关题目+批注，右侧栏可一键收起）；MD 文档**打开即 Vditor 即时渲染编辑器**（整篇预览、点击行即编辑、自动保存），PDF 懒渲染 + Ctrl+滚轮/右下角浮层缩放；阅读页含「相关题目」+「批注与关联」（高亮 + 文档双链）。
- **学习统计**：环形掌握进度 + 数字卡 + 学习趋势（周柱状）+ 学习习惯 + 当月学习日历 + 学习周报导出。
- **我的**：用户卡（右侧紧凑 XP 等级）+ 按类别折叠分组（学习成长：XP/知识库概览/成就墙；偏好设置；习惯管理；云同步与数据；错题与收藏含笔记）+ 底部菜单（**章节进度**弹层：按科目逐章展示 已学/正确率/掌握/错题；**关于我们**弹层：版本/技术栈/GitHub 链接）。

顶部为**科目选择器**（点击弹出底部抽屉）与**统一搜索按钮**（🔍，一处搜题目 + 知识文档）。答题页（`Quiz.vue`）覆盖在 Tab 之上；考试模式支持「提前交卷」（确认后收卷）。

---

## 6. 数据模型

题库侧七张核心表，均已含 `client_id` + `updated_at` / `deleted`（云同步身份与软删）：

| 表 | 作用 |
|---|---|
| `users` | 本地用户（Phase 1 固定 id=1；Phase 2 扩账号） |
| `categories` | 科目 → 章节 两级分类树 |
| `questions` | 题目（题干/选项/答案/解析/难度/类型/得分关键词） |
| `answer_records` | 每次答题流水 |
| `wrong_books` | 错题本 |
| `favorites` | 收藏 |
| `settings` | 键值配置（如当前科目 `current_subject`） |

> 此外 `papers` / `paper_questions` 两表已建（模拟卷组卷），`questions.images_json` 已加（题目图片），`question_tags` 表已建（标签系统），均经 `migrateSchema` 的 `ALTER` 兜底老库升级。题图二进制**不**内嵌进同步 JSON 快照，独立存于仓库 `images/` 目录（hash 去重），拉取时落盘 `userData/images`。

### 学习反馈层（v0.6.0 新增，全部带 client_id 随同步）
| 表 | 作用 |
|---|---|
| `xp_logs` | XP 事件流水（刷题/复习/阅读/专注/任务），**事件行按 client_id 去重，多端总量正确** |
| `habits` / `habit_checks` | 多目标习惯 + 每日打卡（`UNIQUE(habit_id, check_date)`，跨设备同日合并不冲突） |
| `review_logs` | 每日回顾记录（题目/知识块，答对/没想起） |
| `focus_sessions` | 番茄钟专注 session |
| `kb_highlights` | 文档高亮批注（doc 引用按 cid 解析） |
| `kb_doc_links` | 文档↔文档双链（`UNIQUE(from, to)` + OR IGNORE） |
| `wrong_books.reason` | 错题原因标签（migrate 加列） |

### 个人知识库（kb_*）四表
| 表 | 作用 |
|---|---|
| `kb_docs` | 文档元数据（标题/类型/相对路径/大小/hash 去重/时间戳） |
| `kb_blocks` | 文档文本块：MD 按 `#` 标题切块、PDF 按页切块，供全文检索与块级联动 |
| `kb_tags` | 文档标签（与题目标签 `question_tags` 同构，联动推荐时取交集） |
| `kb_links` | **题目 ↔ 文档 双向关联**（`UNIQUE(doc_id, question_id)`），联动层核心 |

> 文件原件复制进 `userData/kb/`（不改动用户原文件）；检索用 `LIKE` 中英文子串匹配（SQLite FTS5 的 unicode61 分词器不做中文分词，LIKE 对个人库量级足够且对中文正确）。扫描版 PDF（无文本层）抽取返回空块 + 错误标记，靠文件名/标签兜底。

### 知识库能力与使用
入口：底部 **知识库** Tab（原「知识库」Tab 已改名「题库」，语义归位为章节浏览）。

| 能力 | 说明 |
|---|---|
| **导入** | 「导入文档」多选或下次拖拽；仅收 `md` / `pdf`。原件**复制**进 `userData/kb/`（绝不改动原文件），同 hash 自动去重跳过，同名文件自动加后缀。**零格式门槛**：任意排版直接可用，MD 的 `#` 标题、PDF 的文本层只是「切块更精细」的加分项 |
| **搜索** | 列表页搜索框 300ms 防抖全文检索（标题 + 文本块，`LIKE` 中英文子串，`%`/`_` 已转义）；标签筛选 chips |
| **阅读** | **全屏三栏阅读页**（左 MD 目录 / 中正文 / 右相关题目+批注，右侧栏可整列收起）。MD 用 **Vditor 即时渲染（IR）**——打开即编辑器，整篇渲染预览、点击行即编辑，输入停 800ms 自动保存 / Ctrl+S / 返回落盘；PDF 用 pdfjs-dist canvas **懒渲染**（只渲染可见页、滚动按需补渲、缩放缓存）+ **Ctrl+滚轮 / 右下角浮层**缩放（MD/PDF 交互统一）。**扫描版 PDF 无法内嵌预览** → 提示 + 「系统阅读器打开」兜底（`shell.openPath`） |
| **联动（L1 手动）** | 文档阅读页「相关题目」面板可**搜题手动关联/解除**；Quiz 交卷解析页每题「相关文档」面板显示已关联列表（可解除）。关联存 `kb_links`，双向可见 |
| **联动（L2 推荐）** | 零 ML：共享标签（`question_tags ∩ kb_tags`）+ 题干/块关键词 `LIKE` 命中，按「标签匹配 → 关键词命中」排序，**自动排除已关联**。`getSuggestedDocsForQuestion` / `getSuggestedQuestionsForDoc` |
| **边界** | ① 无标点长中文串被零 ML 分词器贪婪并成一个词，关键词推荐可能 miss——靠标签路径兜底；② 扫描版 PDF 全文搜不到，靠文件名/标签兜底 |
| **跨设备同步** | ✅ 随仓库同步：kb/ 目录文档原件双向增量（md/pdf 文件 hash 比对）；元数据走快照合并；子表（块/标签/联动）跟随「远端胜出」的文档整体重建 |

### 判分逻辑
- 选择/判断：`electron/db.js` 的 `submitAnswer` 对答案排序后比对，多选顺序无关。
- 问答（essay）：`correct` 以用户 `selfGrade` 为准（无标准答案）；系统仅通过 `keywords_json` 给出「采分点命中」提示辅助自评。

---

## 7. 题库导入 / 导出（CSV / Excel / JSON）

入口：**我的 → 题库管理**。功能：批量导入、手动录题、编辑删除、导出 CSV / Excel。

> 📐 **手头有任意格式的题目资料（Word/PDF/网页/OCR 文本）想转成题库？** 把原始内容丢给任意 AI，附上 [`docs/import-guide.md`](docs/import-guide.md)（转换约束规范），即可得到可直接导入的标准 CSV/Excel——规范含 16 列表头、题型/答案枚举、转换铁律与验收清单。

### 7.1 表格格式
支持下载 **CSV 模板** 或 **Excel 模板**（ImportWizard 第一步有按钮），标准表头如下：

| 科目 | 章节 | 题型 | 题干 | 选项A | 选项B | 选项C | 选项D | 选项E | 选项F | 答案 | 得分关键词 | 解析 | 难度 | 来源 | 材料 | 听力音频 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

- **必填**：题干、答案。其余能空则空。
- **题型**：`单选` / `多选` / `判断` / **`问答`**。不写也行——按答案自动推断（答案 `AC` 判多选，`对` 判判断题，长文本且没选项判问答）。写了但不是标准词（如"选择题""简答题"）会猜一个并给出**警告**，不会闷声改数据。
- **答案**：
  - 单选：`A`
  - 多选：`ABD`、`A,B,D`、`A、B、D`、数字 `1,3`（= A、C）都认
  - 判断：`对`/`错`/`正确`/`T`/`√` 都认
  - 问答：填**参考答案全文**
- **得分关键词（仅问答）**：用 `；`、逗号或换行分隔采分点（如 `收集资料；划分施工过程；计算工程量`）。作答时实时高亮命中情况，辅助自评；留空也能导入，只是失去提示。
- **科目/章节**：写名称即可，库里没有会自动创建两级分类树；整列留空则在向导第二步统一指定目标科目。

### 7.2 三种题型作答方式
- **选择 / 判断**：正常选答案，自动判分。
- **问答**：写答案 → 点「提交作答」→ 系统对照「得分关键词」显示命中情况（采分点命中 X/Y）→ 用户自己判断「我会了 / 答错了」，以此计入正确率与错题本。

### 7.3 三个容易踩的坑（都已处理）
1. **Excel 另存 CSV 是 GBK 编码**：导入时先严格试 UTF-8，失败自动回落 GBK，不用手动转码。
2. **题干里带逗号 / 引号 / 换行**：CSV 解析按 RFC4180 处理双引号转义与字段内换行，不会串列。
3. **脏数据静默入库**：所有行先校验再导入，答案越界、选项不足、单选给了多个答案等会被逐行拦下并显示「第 N 行 + 原因」，只导入合格行。

### 7.4 Excel 支持说明
`.xlsx` 导入与导出走**零依赖**的 `electron/xlsx-lite.js`（Node 内置 `zlib` 手写 zip + CRC32）：
- 直接拖 `.xlsx` 即可导入，也支持「导出 Excel」一键生成 `.xlsx`。
- 不再依赖 SheetJS，内网 / 离线环境也不会出现「装不上 Excel 库」的问题。
- **老式 `.xls`（OLE2 格式）不支持**，请在 Excel 里「另存为」→ 选 `.xlsx` 或 `.csv` 再导入。

### 7.5 整库备份 vs 题库导入（别搞混）
- **我的 → 数据管理 → 导出/导入备份**：整库 JSON，含答题记录、错题本、收藏、统计，用于换电脑迁移。
- **我的 → 题库管理 → 批量导入**：只往题库里加题，不动学习记录。
- **我的 → 题库管理 → 导出 CSV / 导出 Excel**：把当前题库（按科目筛选）导出成表格，改完还能再导回来。

---

## 8. 自测命令

```bash
npm run test:parser      # 76 条断言：CSV 转义、GBK、题型推断、问答/关键词、脏数据
npm run test:xlsx        # 43 条断言：xlsx-lite 读写往返、题库→Excel→重导回端到端
npm run test:kb          # kb 数据层交叉验证（Python sqlite3 镜像）+ 抽取模块真实验证（pdfjs 抽 fixture.pdf）
npm run test:sync        # 8 条断言：同步合并（LWW 冲突 / 事件行去重 / UNIQUE OR IGNORE / cid 解析 / 子表重建）
node scripts/test-mock-paper.js   # 模拟卷组卷计分算法（等分=100 / 手动优先 / 无重复 / 超库存拦截）
python scripts/test-tag-filter.py  # 标签筛选 SQL 的 AND 语义
npm run verify           # 编译校验渲染层，不落盘（排查 SFC 语法错误）
node --check electron/main.js && node --check electron/preload.js
```

---

## 9. Phase 2 / Phase 3 规划

### Phase 2：账户云同步 —— 已落地「GitHub 仓库单后端全量同步」
> 已**完成**并可用。选择零后端方案：一个 GitHub 私有仓库承载全部数据（学习数据+题库快照、知识库文档原件、题目图片），详见仓库内 `SYNC.md`。
1. 七张表已加 `client_id` 与 `*_cid` 外键列；`backfillClientIds` 给老数据补齐身份。
2. `exportSync()` 导出全量快照（含软删行，图片二进制不再内嵌），`mergeRemote()` 按 `client_id` upsert + `updated_at` last-write-wins + 外键按 cid 解析；图片由 `exportImageFiles()` 独立导出、`restoreImages()` 落盘。
3. `electron/sync-github-repo.js` 调 GitHub API 把快照存进私有仓库（contents API 上传 + raw 下载）；主进程用 `safeStorage` 加密存 token；Profile 页「云盘同步（GitHub 仓库）」卡片配置/测试/同步。

### 知识库跨设备同步（阶段 E，已完成）
1. **MD 文档**：纯文本，`exportSync` 把 `kb_docs` 四表 + MD 文件 base64 并入快照，随现有同步链路跨设备还原（与题图同机制）。
2. **PDF 原件**：二进制大文件与 kb 目录一起走仓库 `kb/` 增量同步（hash 比对，缺失/变更才传）——文档原件跨设备可完整还原。
3. **合并策略**：`kb_docs` 走 client_id + LWW；子表（`kb_blocks`/`kb_tags`/`kb_links`）无 client_id，按 doc 的 client_id 分组随快照携带，跟随「远端胜出」的文档整体重建；rel_path 冲突自动换名兜底。

### Phase 3：Android APK（复用同一套 Vue 界面）
Electron 只能出桌面端，出 APK 用 **Capacitor**：
1. `npm run build` 产出纯 Web 产物到 `dist/`。
2. 加 Capacitor：`npm i -D @capacitor/core @capacitor/cli @capacitor/android`
   - `npx cap init tiku com.yourcompany.tiku --web-dir=dist`
   - `npx cap add android` → `npx cap sync` → `npx cap open android`
3. **存储替换**：`better-sqlite3` 在 WebView 里跑不了，改用 `@capacitor-community/sqlite`；SQL 建表/查询语句几乎照搬 `db.js`。
4. **IPC 替换**：当前 `src/api/tiku.js` 走 `window.electronAPI`；APK 版改成 Capacitor 插件桥，UI 组件无需改。

---

## 10. 常见错误 / 排错

### better-sqlite3 报 `NODE_MODULE_VERSION` 不匹配
**现象**：启动即崩，`was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 125`。
**原因**：`better-sqlite3` 是原生模块，被系统 Node 编译后 ABI 与 Electron 不一致。
**解决**：
```bash
npx electron-rebuild
# 或删除 node_modules 后重新 npm install（postinstall 已配 electron-rebuild）
```

### 首启没数据 / 想换自己的题
首次启动会自动建库并灌入「二级建造师」样题，库文件在系统用户目录（如 `~/tiku.db`）。
换成自己的题走「我的 → 题库管理 → 批量导入」。

### 知识库常见问题
- **导入 PDF 后搜索不到**：该 PDF 是扫描版（无文本层）。靠文件名 + 手动打标签检索，或「系统阅读器打开」原件；有文字层的 PDF（复制出文字的那种）才能全文检索。
- **换设备后知识库文档没了**：知识库跨设备同步（阶段 E）尚未实现；当前文档只在本机 `userData/kb/`，同步的是题库学习数据。
- **搜索中文词没结果**：确认关键词在文档正文/标题里确实存在；`LIKE` 是子串匹配，个别长句分词边界（见「知识库能力与使用」）可能导致推荐 miss，可给文档打标签后按标签筛选。
