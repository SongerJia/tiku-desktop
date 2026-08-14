# 账户云同步方案（GitHub 仓库，零后端）

> **一句话**：你给一个 GitHub Token（只需 `repo` 权限），App 把整份学习数据（题库 + 答题 + 错题 + 收藏 + 笔记 + XP + 复习 + 知识库文档原件 + 题目图片）存进你的**私有 GitHub 仓库**。换设备同账号粘贴同一 Token 点同步，数据就拉回来了。**没有后端、没有服务器、没有数据库要部署。**
>
> **为什么是这个方案**：原设计是自建 Spring Boot + MySQL + Redis 后端同步（太重，已砍）、再改 GitHub Gist（单文件 1MB 硬上限 + 图片要分块，也废弃）、WebDAV/坚果云（体验不稳定，也废弃）。最终定 **GitHub 仓库单后端**——免费私有仓库 1GB、无流量限制，数据快照 + 大文件（kb 文档 / 题目图片）都能塞下。客户端收敛模型（§2）与冲突算法（§3）独立于此，将来换存储后端只改一个文件。

---

## 1. 架构（无后端）

```
┌──────────────────────────────┐         HTTPS + Bearer PAT          ┌──────────────────────────┐
│       tiku-desktop (Electron) │                                     │    GitHub 私有仓库       │
│                               │                                     │   (你的远程"云盘")       │
│  ┌──────────┐  ┌───────────┐  │  ┌────────────────────────────┐    │  data.json.gz  ← 快照    │
│  │ SQLite   │  │ main.js   │──┼─►│ sync-github-repo.js        │───►│  kb/*           ← 文档  │
│  │ tiku.db  │  │ 编排同步  │◄─┼──│  (contents API + raw 下载)  │◄───│  images/*       ← 题图  │
│  └──────────┘  └───────────┘  │  └────────────────────────────┘    │  tiku-manifest.json     │
│         ▲ 本地 upsert/merge    │     sync-merge.js (纯函数合并)       │  (文件 sha256 清单)     │
│         │ (client_id 幂等)     │                                     └──────────────────────────┘
└─────────┴─────────────────────┘
```

- **没有中间服务器**：桌面端直接调 GitHub REST API（`api.github.com`）+ raw 下载。
- **存储模型**：
  - `data.json.gz`：全量数据快照（gzip 压缩，避免 base64 膨胀超限）
  - `kb/<rel_path>`：知识库文档原件（md/pdf，逐段 encodeURIComponent）
  - `images/<safeName>`：题目图片（hash 去重双向增量）
  - `tiku-manifest.json`：文件 sha256 清单（`{ kbFiles: {rel:hash}, images: {name:hash}, updatedAt }`）
- **账号体系 = 你的 GitHub 账号**：PAT 就是"登录凭证"，天然跨设备。

---

## 2. 同步模型：收敛（不是覆盖！）

最容易踩的坑是"整文件覆盖"——A 设备推完，B 设备再推会把 A 的改动**整个冲掉**。所以采用**先拉后推的收敛模型**：

```
 syncNow() 时序
 ┌─────────┐         ┌──────────────┐         ┌──────────────┐
 │ 桌面端   │         │ GitHub 仓库   │         │ 另一台设备    │
 └────┬────┘         └──────┬───────┘         └──────┬───────┘
      │ 1. 拉远端 data.json.gz │                    │
      │──────────────────────►│                    │
      │ 2. mergeRemote 合并进  │                    │
      │    本地(LWW 裁决)       │                    │
      │◄───────────────────────│                    │
      │ 3. exportSync 导本地全量 │                    │
      │ 4. gzip 后 PUT data.json.gz                │
      │──────────────────────►│                    │
      │ 5. kb/ 与 images/ 双向增量（比对 sha256）    │
      │ 6. 写 tiku-manifest.json                    │
      │                         │   (B 同步时同理:   │
      │                         │    先拉到 A 的改动) │
      │                         │◄──────────────────│
```

伪代码（实际落在 `electron/sync-runner.js`）：

```js
async function sync(ghCfg) {
  // ① 数据快照：拉远端合并 → 推本地全量（收敛模型）
  const remote = await ghRepo.downloadData(ghCfg)   // data.json.gz → JSON
  if (remote) db.mergeRemote(remote)                // 先合并进本地（绝不跳过！）
  const full = db.exportSync(0)                     // 导本地全量快照（含软删行）
  await ghRepo.uploadData(ghCfg, JSON.stringify(full))

  // ② 大文件：kb 文档 + 题目图片双向增量（hash 比对）
  await syncAssets(ghCfg)
}
```

> **小张一句到位**：永远"先拉别人的、再推自己的"，两边最终收敛到并集，谁也不会被谁覆盖。

---

## 3. 身份与冲突：client_id + last-write-wins

本地 SQLite 的 `id` 是自增整数，两台设备各自建题 id 可能都是 1，**不能拿它当跨设备主键**。所以每行带一个全局唯一 `client_id`（UUIDv4，创建时生成、终身不变）。

### 3.1 同步字段

| 表 | 新增列 | 说明 |
|---|---|---|
| `categories` | `client_id`, `parent_cid` | 分类树用 `parent_cid` 指父 |
| `questions` | `client_id`, `category_cid` | 题目用 `category_cid` 指分类 |
| `answer_records` | `client_id`, `question_cid` | 用 `question_cid` 指题目 |
| `wrong_books` | `client_id`, `question_cid` | 同上 |
| `favorites` | `client_id`, `question_cid` | 同上 |
| `notes` | `client_id`, `question_cid` | 同上 |
| `cards` / `materials` | `client_id`, `subject_cid` | 科目归属按 cid 重映射 |
| `kb_docs` | `client_id`, `subject_cid`, `category_cid` | 文档归属 |
| `xp_logs` / `focus_sessions` / `review_logs` / `kb_highlights` | `client_id` | 反馈层事件行 |
| `settings` | (无 client_id) | KV，用 `key` 做幂等键 |

> 平时本地业务逻辑（判分、统计）**完全不感知** `client_id`，只在同步边界做 `client_id ↔ 本地 id` 翻译，侵入最小。

### 3.2 冲突裁决（LWW + 删除优先）

`updated_at` 用毫秒 epoch。两端都改了同一题笔记，后改的覆盖先改的；**任一端删了，删除胜出**（删除是终态，防止被旧快照"复活"）：

```js
// electron/sync-merge.js —— 纯函数，可单测
function pickWinner(localRow, remoteRow) {
  if (!localRow) return remoteRow
  if (!remoteRow) return localRow
  const lDel = Number(localRow.deleted) === 1
  const rDel = Number(remoteRow.deleted) === 1
  if (lDel !== rDel) return lDel ? localRow : remoteRow   // 删除优先
  return (Number(remoteRow.updated_at) || 0) >= (Number(localRow.updated_at) || 0)
    ? remoteRow : localRow                                 // LWW；相等取远端（确定性）
}
```

- **软删除也要同步**：`deleted=1` 是条有效同步记录（保留行只标记删），用来跨端传播"删除"动作。否则一端删了，另一端又拉回来"复活"。
- **有损但可预期**：同题两端都改，后改覆盖先改。个人单用户基本单设备在线，风险极低；要无损得上 CRDT，本期不做。

---

## 4. 外键解析（cid → 本地 id）

同步时外键带的是 `client_id`，落地时要翻成本地整数 `id`（因为两台设备的 id 不一样）：

```js
// electron/db-sync.js mergeRemote —— 合并顺序很关键：
// 先 categories → 再 questions → 最后依赖表，保证引用已存在，不会"悬空"
const catCidToId = new Map(catMerged.map(r => [r.client_id, catUpsert(r)]))
const qCidToId  = new Map(qMerged.map(r => [r.client_id, qUpsert(r)]))
applyFk(wrongMerged, 'question_cid', 'question_id', qCidToId)  // 引用列翻成本地 id
```

> 跨端科目归属同理：`subject_cid` → `subject_id`（cards/materials/kb_docs 都有 subject_cid 列）。

---

## 5. 安全：PAT + 本机加密

- **Token 权限最小化**：GitHub PAT 勾 `repo` 权限（需能读写私有仓库），读不到你其他仓库的代码。
- **加密存储**：PAT 用 Electron `safeStorage` 加密后存 `userData/gh-token.enc`，**不进 settings 表、不回传给渲染层（Vue 拿不到明文 token）**。`safeStorage` 不可用（如部分 Linux 无桌面密钥环）时降级明文仅本机。
- **owner/repo/lastSync** 才放 `settings` 表（`gh_owner` / `gh_repo` / `gh_last_sync`）。
- **传输**：HTTPS + Bearer Token；下载走 raw.githubusercontent.com，失败自动重试 3 次（退避），再降级 api.github.com contents 备用源。
- **路径防御**：远端清单的 rel_path 下载前校验（拒绝 `..` / 绝对路径 / 盘符），防止恶意清单越界写盘。

---

## 6. 代码落点（改了哪些文件）

| 文件 | 职责 |
|---|---|
| `electron/sync-github-repo.js` | GitHub REST 封装：`uploadFile` / `downloadFile`（raw 重试 + contents 备用源）/ `deleteFile` / `putManifest` / `uploadData`（gzip） |
| `electron/sync-runner.js` | 编排：`syncData`（快照收敛）+ `syncAssets`（kb/图片双向增量 + 软删文件远端删除）+ manifest 只写成功态 |
| `electron/sync-merge.js` | **纯函数** `lwwMerge` / `pickWinner` / `applyFk`，无 DB 依赖，供单测 |
| `electron/db-sync.js` | `exportData`（备份全量）/ `exportSync`（同步快照，含软删）/ `mergeRemote`（按 client_id upsert + LWW + 外键解析）/ `importData`（整机恢复）/ `importPreview` |
| `electron/db-cols.js` | 导出列清单（EXPORT_COLS，含 review_logs） |
| `electron/db-assets.js` | 题图/音频文件存取 + 缓存 |
| `electron/db-kb.js` | kb 文件清单递归扫描（`listKbFiles`）+ 还原（`restoreKbFiles` 防穿越） |
| `electron/main.js` | `ghGetConfig` / `ghSaveConfig` / `ghTest` / `ghSync` 编排 + token safeStorage |
| `electron/preload.js` + `src/api/tiku.js` | 暴露 sync 方法（三层同名） |
| `src/components/Profile.vue` | 「云同步（GitHub 仓库）」卡片：Token/owner/repo 配置、连接测试、立即同步、上次同步时间 |

---

## 7. 真机验收步骤（你这边怎么用）

```bash
# 1) 建空私有仓库：github.com → New repository → 命名如 tiku-assets → 勾 Private → 不勾 README
# 2) 生成 Token：github.com → Settings → Developer settings → Personal access tokens
#    Generate new token (classic)，勾 repo，复制那串 ghp_...

cd tiku-desktop
npm install && npm run dev
# 3) 我的 → 云同步(GitHub) → 填 owner/repo + Token → 「连接并同步」
#    （首次会自动建 data.json.gz + tiku-manifest.json；状态显示「上次同步：刚刚」）
# 4) 另一台设备同账号，粘贴同一 Token → 「立即同步」→ 数据拉回
```

---

## 8. 边界、坑、与真实踩过的雷

1. **contents API 单文件上限 100MB**（base64 后约 75MB）：data.json.gz 正常远小于此（几千题 + 答题记录压缩后几百 KB~几 MB）；真到超大库需分片（本期不做，量级到不了）。
2. **raw.githubusercontent.com 国内网络不稳（常 502/超时）**：下载自动重试 3 次（800ms×2ⁿ 退避）→ 备用源 api.github.com contents（base64）→ >1MB 用 download_url 直链。这是真实踩过的坑（见 `downloadFile` 注释）。
3. **绝不能"本地覆盖远端"**：若跳过 `mergeRemote` 直接推，B 设备推完会冲掉 A 的改动。收敛模型（§2）专治这个。
4. **client_id 创建即生成、立即持久化**：绝不能在同步时才生成，否则同一条记录每次推送都变成"新行"→ 重复堆积。
5. **软删要传播 + 文件删除闭环**：`deleted=1` 必须随同步走；软删文档的 kb 文件也会从远端清单剔除并删除远端文件本体（`deleteFile`），否则一端删了另一端拉回"复活"。
6. **manifest 只写成功态**：上传失败的排除在清单外 → 下次同步自动重试（不会因一次失败永久丢失）。
7. **时钟漂移**：`updated_at` 依赖本机时钟。用户手改过系统时间会出现"假的新"。可接受风险。
8. **速率限制**：GitHub API 未认证 60 次/时、PAT 5000 次/时。个人同步频率远碰不到，但别写死轮询。

---

## 9. 举一反三：其他免后端方案（都复用同一套 client_id/LWW）

| 方案 | 存储位置 | 自动化 | 适合 |
|---|---|---|---|
| **GitHub 仓库（当前）** | 私有仓库文件 | 半自动（点按钮） | 已有 GitHub、数据量中（含文档/图片） |
| GitHub Gist（已废弃） | 私有 Gist 文件 | 半自动 | 单文件 1MB 硬上限，图片要分块，已弃 |
| WebDAV（坚果云/Nextcloud，已废弃） | WebDAV 服务器 | 全自动 | 体验不稳定，已弃 |
| 对象存储 OSS/COS/S3 | 厂商 bucket | 全自动 | 数据量大、要合规留存 |

> 四者只是"把快照存哪"不同，收敛模型（§2）和冲突算法（§3）完全一样。**将来想全自动，把 `sync-github-repo.js` 换成对应存储的封装即可，`db-sync.js` 一行不用动。**

---

## 10. 隐私提醒

私有仓库只有你和你的 PAT 能读写，但 **GitHub 服务端仍可见明文**（员工/合规场景要当心）。敏感数据别明文存；要更强的自主管控就走自建 WebDAV/MinIO。

---

**小张一句到位**：同步的本质就是"给每条数据一个跨设备不变的名字（client_id）+ 一个修改时间（updated_at），先拉后推、谁新听谁的"——GitHub 私有仓库只是替你白嫖了个带版本历史的云盘（还能装文档和图片），仅此而已。
