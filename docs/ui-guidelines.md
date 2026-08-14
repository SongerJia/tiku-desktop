# UI 设计规范（Design System）

> 本文档从现有实现提取，是**新增/修改任何页面、弹窗、浮层、提示、展示元素时必须遵守的规则**。
> 违反 = 返工。新增展示元素前先读本文档。

## 0. 三主题适配（最高优先级）

| 主题 | 说明 | 品牌色 --brand |
|---|---|---|
| `dark`（默认） | 深蓝灰（:root 默认值） | `#5b7cfa` 主靛蓝 + `--brand2 #7a5cff` 副紫蓝 |
| `light` | 浅色 | `#3d5bd9` / `--brand2 #7c3aed` |
| `eye` | 护眼绿 | 绿系 |

**硬性规则**：
1. **颜色一律走语义变量**（`--bg/--card/--text/--muted/--line/--brand/--ok/--bad/--warn/--tip-*` 等 37 个），禁止硬编码 hex/rgba。
2. **例外（允许硬编码）**：白字 on 品牌按钮（`color:#fff`）、状态色本身（SVG 图形/图表色阶）、图片上遮罩（深底白字）、PDF 白画布。
3. **新增颜色** → 先在 style.css **三主题各配定义**再引用；有 `[data-theme="light"]` 覆盖必须**同步补 eye**（7 组件 21 处 eye 缺失的坑）。
4. **var 引用必须有定义**：跑 `python scripts/check-css-vars.py`，无 fallback 且未定义 = bug（`--good`/`--bg-soft` 两次踩坑）。白名单仅 JS 动态注入（tiltRx/tiltRy/--ang/--kb-md-fs）。
5. **品牌色光晕/边框/背景**：用 `color-mix(in srgb, var(--brand) X%, transparent)`——dark 下零变化，light/eye 自动跟随。禁止写死 `rgba(91,124,250,...)`（5cec433 漏青色/ok 绿两族的教训）。
6. 渐变文字用 `--num-grad`（三主题已配）。

## 1. 页面规范

- **布局**：`.app > .sidebar`（PC 侧栏）｜`.main-col > .topbar + .page-content`；窄屏 `.bottom-tab`。
- **滚动容器**：`.page-content`（`overflow-y:auto`）是唯一滚动区（html/body 不滚）。锁背景滚动用 `useBodyLock`。
- **卡片**：`.card` 统一（`--card` 背景 / `--radius` 14px / `--shadow` rest / `--shadow-hover` 抬起）。卡片间距 14px，padding 16px。
- **Tab 切换**：App.vue `tabs` + `Transition fade`；切回首页刷新用 `homeRefresh` 计数。
- **加载态**：列表加载用 `SkeletonCards` 骨架屏；任何异步操作必须有 loading/disabled 反馈。
- **空态**：`EmptyState` 组件 + 引导话术（告知去哪操作）。
- **数字**：统计数字 `tabular-nums`（全局已开），滚动用 `CountUp`。

## 2. 弹窗规范

- **结构**：`{前缀}-mask`（全屏遮罩，`@click.self` 关闭）＞ `{前缀}-panel`（居中面板）＞ `{前缀}-header` + `{前缀}-body` + 关闭按钮。
- **前缀表**：bm=题库管理、km=文档管理、qe=题目编辑、iw=导入向导、me=模拟卷、nl=笔记、cat=科目管理、ep=编辑资料、cf=确认、pp=输入、ab=关于、bk=备份、setup=练习设置、selector=科目选择、us=搜索、sq=简单题、qd=题目详情、kb=文档信息、wf=错题本、gf=收藏、ac=答题卡。
- **三关闭**：× 按钮 + 遮罩点击 + `useEsc`（键盘可达性）。
- **背景锁定**：弹窗打开必须 `useBodyLock(() => show)`（计数器式，多层叠加全关才解锁）。
- **Teleport**：弹层必须 `<Teleport to="body">`，与内容树解耦（规则 13）。
- **超高内容**：`.body { flex:1; min-height:0; overflow-y:auto }`（规则 14）。
- **z-index 分层**：弹窗 200–400（嵌套逐层加）、confirm 900、prompt 910、toast 999。
- **危险操作**：删除/清空/恢复必须 `showConfirm(..., { danger: true })`。

## 3. 浮层规范

- **一律 Teleport + floating-ui**（`computePosition` + `flip` + `shift`）（规则 17）。禁止手写坐标/方向翻转。
- 浮层背景/文字用 `--tip-bg/--tip-text/--tip-muted`（三主题已配）。
- hover 类简单提示可 CSS 浮层（`.side-cmd-tip` 模式），但位置固定场景才允许。

## 4. 提示规范

- **toast**：全局 `showToast(msg, 'info'|'ok'|'err')`——禁止组件内自建 toast（4 套收敛为 1 套的坑）。
- **confirm**：`showConfirm(msg, { title, danger })`——危险操作必须用。
- **prompt**：`showPrompt({ title, msg, value })`——禁止 `window.prompt`（Electron 里系统级输入框割裂）。
- 错误提示用 `'err'` 类型（`--bad-soft` 语义色，浅色主题可读）。

## 5. 展示/样式规范

- **按钮层级**：`btn-primary`（品牌实心，主操作）/ `btn-outline`（描边，次操作）/ `ghost`（透明）/ `danger`（危险红）/ `sm`（小号）。同一操作区必须有主次（P3-9 返回首页改次按钮的教训）。
- **特效动画**：合成属性 `opacity/transform` + 缓动规范如下（两次"僵硬/突然"反馈的教训）：
  - **入场动画**（riseIn/numPop/panelIn 等）：统一 `cubic-bezier(.2, .7, .3, 1)`（出弹曲线，全站标准）。
  - **呼吸/循环动画**（呼吸圈/扫光/光斑）：必须 `ease-in-out` 对称缓动 + 只动 opacity/transform；**禁止 box-shadow spread 动画和先快后慢的不对称 bezier**。
- **动效时长**：微交互 .15–.3s；入场 .3–.5s；呼吸/循环 2.2–5.5s（快慢错开不抢戏）。
- **状态色**：`--ok` 成功 / `--bad` 错误 / `--warn` 警告；浅色主题用软色变量 `--ok-soft/--bad-soft/--warn-soft/--brand-soft`（深色调保对比度）。
- **滚动条**：全局 8px 蓝灰细条（style.css 统一），勿重复定义。
- **prefers-reduced-motion**：style.css L513 已支持，勿破坏。

## 6. 新增/修改展示元素的检查清单

1. 颜色都是语义变量？三主题各配？light 覆盖同步 eye？`check-css-vars.py` 过？
2. 弹窗：mask/panel/header/body/close？Teleport？Esc？`useBodyLock`？
3. 浮层：floating-ui？tip 变量？
4. 提示：走全局三件套？
5. 特效：合成属性 + ease-in-out？
6. 按钮：层级语义（主/次/危险）正确？
7. 弹窗 z-index 在规范区间？

## 附：常用语义变量速查

| 变量 | 用途 | | 变量 | 用途 |
|---|---|---|---|---|
| --brand / --brand2 | 品牌主/副色 | | --ok / --bad / --warn | 成功/错误/警告 |
| --bg / --card / --card-solid | 页面/卡片背景 | | --ok-soft / --bad-soft / --warn-soft / --brand-soft | 浅色主题软色 |
| --text / --muted | 主/次文字 | | --line | 边框细线 |
| --hover-bg / --hover-bg-strong | 行 hover | | --bg-soft | 弱背景（胶囊/输入框） |
| --tip-bg / --tip-text / --tip-muted | 浮层 | | --modal-mask / --modal-blur | 弹窗遮罩 |
| --toast-bg | toast | | --glow / --glow-soft | 品牌光晕/柔和阴影 |
| --shadow / --shadow-hover | 卡片阴影 | | --radius / --radius-sm | 圆角 14/10 |
| --num-grad | 渐变数字 | | --side-active-bg / --sidebar-bg | 侧栏 |
