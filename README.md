# 知识记忆小助手（刷题题库）— Electron 本地版

一个**本地安装、离线可用**的刷题题库桌面软件。数据全存在你电脑上的一个 SQLite 文件里，不需要服务器、不需要联网、不需要备案。支持分类刷题、选择题自动判分、问答题自评、错题本、收藏、学习统计，以及 CSV / Excel / JSON 导入导出。

> 当前版本：**v0.3.0（Phase 1 本地 + Phase 2 轻量云同步 + 模拟卷/图片）**。已实现本地刷题全闭环、GitHub Gist 零后端多端同步、模拟卷组卷与题目图片；Phase 3 用 Capacitor 出 Android APK。

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
| **题库数据** | SQLite 建表、样例数据、分类 CRUD、题目 CRUD | ✅ 完成 | 七张表，已含 `client_id` + `updated_at`/`deleted`（云同步身份与软删） |
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
| **数据同步** | 多端云同步（GitHub Gist，零后端） | ✅ 完成 | 用私有 Gist 存全量快照，「pull 合并→push 全量」收敛；client_id + LWW 冲突 |
| **模拟卷组卷** | 按题型/难度/章节抽题组卷、存卷、限时考试、重考 | ✅ 完成 | `papers`/`paper_questions` 两表；`generatePaper` 按规则随机抽题+等分/手动计分；「我的试卷」可重考 |
| **题目图片** | 题干配图（多图），录入/答题渲染，随题库备份 | ✅ 完成 | `questions.images_json` + `userData/images` 本地图床；`saveImage`/`getImage` |
| **题目笔记** | 每题个人批注，答题页/题库页内联编辑，Profile「我的笔记」汇总 | ✅ 完成 | `notes` 表 + `getNote`/`saveNote`/`listNotes`/`getNotedQuestionIds` |
| **背题模式** | 直接看答案不判分，可叠加任意范围（如背错题） | ✅ 完成 | 与题库范围正交的开关，与考试互斥 |
| **智能复习** | 艾宾浩斯曲线安排错题重现（间隔 1/2/4/7/15/30/60 天，连对 3 次毕业） | ✅ 完成 | `wrong_books.next_review_at` 已实现，「复习」范围可用 |
| **Android APK** | Capacitor 打包移动端 | ⏳ 未开始 | Phase 3 |

> 「我的笔记」入口已从占位升级为真实功能（展示/删除全部笔记）；原「默写记录」「我的反馈」两个纯占位入口已移除。

### 当前阶段一句话
Phase 1 本地 MVP、Phase 2 轻量云同步（GitHub Gist）、模拟卷组卷与题目图片均已完成。代码可直接 `npm install && npm run dev` 跑起来；下一步可选 **Phase 3 安卓 APK**。

---

## 3. 开发规范（给后续 AI / 协作者）

### 3.1 目录与文件约定
```
tiku-desktop/
├─ electron/
│  ├─ main.js          # 主进程入口：窗口、IPC、菜单隐藏
│  ├─ preload.js       # 渲染层白名单 API（contextIsolation 安全）
│  ├─ db.js            # SQLite 数据层：建表/判分/统计/导入导出/迁移
│  ├─ xlsx-lite.js     # 零依赖 Excel 读写器
│  └─ sampleData.js    # 首启样例数据（二级建造师）
├─ src/
│  ├─ App.vue          # 4 Tab 导航 + 顶部科目选择器 + 答题覆盖层
│  ├─ main.js          # Vue 入口
│  ├─ style.css        # 全局 CSS 变量 + 基础样式（科幻风暗色主题）
│  ├─ api/tiku.js      # 渲染层 IPC 调用封装
│  ├─ utils/bankParser.js   # CSV/Excel/JSON 题库解析与校验
│  └─ components/      # 页面与业务组件
├─ scripts/            # 独立测试脚本（不依赖 Electron）
├─ vite.config.js
├─ vite.verify.config.js   # 纯编译校验（不落盘产物）
└─ package.json
```

### 3.2 新增 IPC 的标准三步
1. `electron/main.js`：`ipcMain.handle('foo', (e, arg) => db.foo(arg))`
2. `electron/preload.js`：`foo: (arg) => ipcRenderer.invoke('foo', arg)`
3. `src/api/tiku.js`：`foo: (arg) => window.electronAPI.foo(arg)`

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

# 3. 打包成安装包（输出在 dist-electron / release 目录）
npm run build
```

> 沙箱环境里没有 VS Build Tools，我没法在这里 `npm run dev` 实景跑起来；但工程是规范的，拉回去 `npm install && npm run dev` 即可。

---

## 5. 界面结构

4 个底部 Tab：
- **首页**：欢迎卡 + 知识卡片总数 + 快捷入口（错题本 / 收藏 / 全部刷题 / 今日已刷）。
- **知识库**：搜索框 + 章节筛选 chips + 知识点卡片列表，点卡片即进入答题。
- **学习统计**：环形掌握进度 + 数字卡 + 学习趋势（周柱状）+ 学习习惯 + 当月学习日历。
- **我的**：本地账号、数据管理（整库 JSON 导出/导入）、题库管理、章节进度、关于。

顶部为**科目选择器**（点击弹出底部抽屉）。答题页（`Quiz.vue`）覆盖在 Tab 之上。

---

## 6. 数据模型

七张表，均已含 `client_id` + `updated_at` / `deleted`（云同步身份与软删）：

| 表 | 作用 |
|---|---|
| `users` | 本地用户（Phase 1 固定 id=1；Phase 2 扩账号） |
| `categories` | 科目 → 章节 两级分类树 |
| `questions` | 题目（题干/选项/答案/解析/难度/类型/得分关键词） |
| `answer_records` | 每次答题流水 |
| `wrong_books` | 错题本 |
| `favorites` | 收藏 |
| `settings` | 键值配置（如当前科目 `current_subject`） |

> 此外 `papers` / `paper_questions` 两表已建（模拟卷组卷），`questions.images_json` 已加（题目图片），均经 `migrateSchema` 的 `ALTER` 兜底老库升级。

### 判分逻辑
- 选择/判断：`electron/db.js` 的 `submitAnswer` 对答案排序后比对，多选顺序无关。
- 问答（essay）：`correct` 以用户 `selfGrade` 为准（无标准答案）；系统仅通过 `keywords_json` 给出「采分点命中」提示辅助自评。

---

## 7. 题库导入 / 导出（CSV / Excel / JSON）

入口：**我的 → 题库管理**。功能：批量导入、手动录题、编辑删除、导出 CSV / Excel。

### 7.1 表格格式
支持下载 **CSV 模板** 或 **Excel 模板**（ImportWizard 第一步有按钮），标准表头如下：

| 科目 | 章节 | 题型 | 题干 | 选项A | 选项B | 选项C | 选项D | 选项E | 选项F | 答案 | 得分关键词 | 解析 | 难度 | 来源 |
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
npm run verify           # 编译校验渲染层，不落盘（排查 SFC 语法错误）
node --check electron/main.js && node --check electron/preload.js
```

---

## 9. Phase 2 / Phase 3 规划

### Phase 2：账户云同步 —— 已落地「轻量 GitHub Gist 方案」
> 已**完成**并可用。选择零后端方案（不用部署 Spring Boot），详见仓库内 `SYNC.md`（GitHub Gist 同步方案）。
1. 七张表已加 `client_id` 与 `*_cid` 外键列；`backfillClientIds` 给老数据补齐身份。
2. `exportSync()` 导出全量快照（含软删行），`mergeRemote()` 按 `client_id` upsert + `updated_at` last-write-wins + 外键按 cid 解析。
3. `electron/sync-github.js` 调 GitHub API 把快照存进私有 Gist；主进程用 `safeStorage` 加密存 token；Profile 页「云同步（GitHub）」卡片连接/同步/断开。

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
