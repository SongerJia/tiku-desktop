# 代码审计 · 轮 5：全局架构与工程（横切）

> 审计时间：2026-08-14 · 范围：`main.js / preload.js(接线已核) / sync-runner.js / sync-merge.js / sync-github-repo.js / package.json / logger.js` + 跨轮汇总

## 一、安全与工程（验证通过项）

| 项 | 结果 |
|---|---|
| 渲染层隔离 | `contextIsolation + nodeIntegration:false + sandbox:true`（main.js L168-173）✓ 纵深防御 |
| gh_token 存储 | safeStorage 加密落盘 `gh-token.enc` + 旧明文迁移清理（L21-49）✓ |
| openPath 白名单 | 仅允许 userData/exports 目录（L444-458）✓ |
| openExternal 协议白名单 | 仅 http/https（L468-473）✓ |
| 单实例锁 / 窗口 bounds 记忆 / 防白屏 | ✓ |
| 自动更新 | 仅打包版 + 10s 首检 + 6h 定时 + 进度节流通知 ✓ |
| 同步链路 | raw 重试 3 次退避 + 备用源 contents API + gzip 快照 + 删除传播闭环 + manifest 只含成功态 ✓ |
| sync-merge | 删除优先 + LWW + cid 身份 + applyFk 重映射 ✓ 设计正确 |
| **P1-3 关闭** | `restoreBackup` 成功后 `app.relaunch()`（main.js L461）→ 子模块 sqlite 闭包失效问题**不存在**（新进程重新 init） |

## 二、发现清单

### 🟠 P2
| # | 位置 | 问题 |
|---|---|---|
| P2-23 | main.js L490-492 | **kbExport 不递归**：只复制顶层文件，`kb/notes/` 子目录文档导出缺失（对比 listKbFiles 递归） |
| P2-24 | main.js L508 | kbOpen 拼路径无 rel_path 穿越校验（并入轮 3 P2-14，共 4 处） |

### 🟡 P3
| # | 位置 | 问题 |
|---|---|---|
| P3-27 | sync-runner.js L44-55 | syncData 每次全量推快照（收敛模型，数据大时全量上传；设计取舍可接受） |
| P3-28 | package.json | mac 无 notarization 配置（Gatekeeper 拦截风险；当前主要 Windows 发布） |
| P3-29 | main.js L466/276/277/321/405/401 | 6 个死接口在 main 的注册（与 preload 一致，前端零调用）→ 待清理 |

## 三、5 轮汇总

| 轮 | 维度 | P1 | P2 | P3 | 要点 |
|---|---|---|---|---|---|
| 1 | 数据层/统计口径 | 3→修正 | 7 | 6 | 同步缺表、软删复活、统计口径、SM-2/等级验证通过 |
| 2 | 核心学习链路 | 1(承) | 6 | 9 | IPC 128/128 对齐、6 死接口、upsert 复活缺失 |
| 3 | 题库/知识库/搜索 | 0 | 6 | 6 | rel_path 穿越、嵌套事务源码级排除 |
| 4 | 首页/统计/我的 | 0 | 3 | 5 | 成就 focusMin 覆盖、wrongClear metric 错、questCheck 死成就 |
| 5 | 全局架构 | 0 | 2 | 3 | P1-3 关闭、kbExport 不递归、安全体系验证通过 |

**最终计数：P1 × 2（P1-1 修正为 review_logs；P1-2 错题复活；P1-3 已排除）· P2 × 24 · P3 × 29**
