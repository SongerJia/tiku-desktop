# 账户云同步方案（GitHub Gist，零后端）

> **一句话**：你给一个 GitHub Token（只需 `gist` 权限），App 自动建一个**私有 Gist** 当"云端数据库"，把整份学习数据（题库 + 答题 + 错题 + 收藏 + 笔记）存成 `tiku-backup.json`。换设备同账号粘贴同一 Token 点同步，数据就拉回来了。**没有后端、没有服务器、没有数据库要部署。**
>
> **为什么是这个方案**：原设计是自建 Spring Boot + MySQL + Redis 后端同步，但部署 / 运维 / JDK 版本成本对个人项目太高，**已明确放弃该路线**。改用"借 GitHub 当存储"——零后端、零部署。客户端收敛模型（§2）与冲突算法（§3）独立于此，将来真要做服务端合并也只是换存储后端。

---

## 1. 架构（无后端）

```
┌──────────────────────────────┐         HTTPS + Bearer PAT          ┌──────────────────────┐
│       tiku-desktop (Electron) │                                     │      GitHub Gist      │
│                               │                                     │   (你的私有远程"库")  │
│  ┌──────────┐  ┌───────────┐  │  ┌────────────────────────────┐    │                      │
│  │ SQLite   │  │ main.js   │──┼─►│ sync-github.js (Node fetch) │───►│ tiku-backup.json     │
│  │ tiku.db  │  │ 编排同步  │◄─┼──│  createGist / updateGist   │◄───│ { 七张表的快照 }     │
│  └──────────┘  └───────────┘  │  └────────────────────────────┘    │                      │
│         ▲ 本地 upsert/merge    │     sync-merge.js (纯函数合并)       │  仅你 + 你的 PAT 可读 │
│         │ (client_id 幂等)     │                                     └──────────────────────┘
└─────────┴─────────────────────┘
```

- **没有中间服务器**：桌面端直接调 GitHub REST API（`api.github.com`）。
- **存储即一个文件**：私有 Gist 里的 `tiku-backup.json`，本质就是一个 JSON 快照。
- **账号体系 = 你的 GitHub 账号**：PAT 就是"登录凭证"，天然跨设备。

---

## 2. 同步模型：收敛（不是覆盖！）

最容易踩的坑是"整文件覆盖"——A 设备推完，B 设备再推会把 A 的改动**整个冲掉**。所以采用**先拉后推的收敛模型**：

```
 syncNow() 时序
 ┌─────────┐         ┌─────────────┐         ┌──────────────┐
 │ 桌面端   │         │ GitHub Gist │         │ 另一台设备    │
 └────┬────┘         └──────┬──────┘         └──────┬───────┘
      │ 1. 拉远端快照           │                    │
      │──────────────────────►│                    │
      │ 2. mergeRemote 合并进   │                    │
      │    本地(LWW 裁决)        │                    │
      │◄───────────────────────│                    │
      │ 3. exportSync 导本地全量 │                    │
      │ 4. 无 gistId→建 / 有→PATCH 推上去            │
      │──────────────────────►│                    │
      │ 5. 存 lastSync          │                    │
      │                         │   (B 同步时同理:   │
      │                         │    先拉到 A 的改动) │
      │                         │◄──────────────────│
```

伪代码（实际落在 `electron/main.js` 的 `syncNow` 句柄）：

```js
async function syncNow() {
  const cfg = db.getConfig()          // { gistId, lastSync, login }
  let remote = null
  if (cfg.gistId) remote = await github.getGist(cfg.gistId)   // 拉远端
  if (remote) mergeRemote(remote)     // 先合并进本地（绝不跳过这步！）
  const local = db.exportSync()       // 导本地全量快照（含软删行）
  if (!cfg.gistId) {
    const g = await github.createGist(local)   // 首次：建私有 Gist
    db.setSetting('sync_gist_id', g.id)
  } else {
    await github.updateGist(cfg.gistId, local)  // 之后：PATCH 更新
  }
  db.setSetting('sync_last_sync', Date.now())
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
| `settings` | (无 client_id) | KV，用 `key` 做幂等键 |

> 平时本地业务逻辑（判分、统计）**完全不感知** `client_id`，只在同步边界做 `client_id ↔ 本地 id` 翻译，侵入最小。

### 3.2 冲突裁决（LWW）

`updated_at` 用毫秒 epoch。两端都改了同一题笔记，后改的覆盖先改的：

```js
// electron/sync-merge.js —— 纯函数，可单测
function lwwMerge(localRows, remoteRows) {
  const byCid = new Map()
  for (const r of localRows) byCid.set(r.client_id, r)
  for (const r of remoteRows) {
    const cur = byCid.get(r.client_id)
    if (!cur) { byCid.set(r.client_id, r); continue }          // 远端新行 → 收下
    if (r.updated_at > cur.updated_at) byCid.set(r.client_id, r)  // 远端更新 → 覆盖
    else if (r.updated_at === cur.updated_at) byCid.set(r.client_id, r) // 相等 → 取远端（确定性）
  }
  return [...byCid.values()]
}
```

- **软删除也要同步**：`deleted=1` 是条有效同步记录（保留行只标记删），用来跨端传播"删除"动作。否则一端删了，另一端又拉回来"复活"。
- **有损但可预期**：同题两端都改，后改覆盖先改。个人单用户基本单设备在线，风险极低；要无损得上 CRDT，本期不做。

---

## 4. 外键解析（cid → 本地 id）

同步时外键带的是 `client_id`，落地时要翻成本地整数 `id`（因为两台设备的 id 不一样）：

```js
// 1) 先合并 categories / questions，建 cid→id 映射
const catMap = new Map(merged.categories.map(r => [r.client_id, r.id]))
const qMap   = new Map(merged.questions.map(r => [r.client_id, r.id]))

// 2) 合并依赖表时，把 *_cid 翻译成本地 *_id
for (const ar of merged.answer_records) {
  ar.question_id = qMap.get(ar.question_cid) ?? ar.question_id
}
for (const nb of merged.notes) {
  nb.question_id = qMap.get(nb.question_cid) ?? nb.question_id
}
// wrong_books / favorites 同理
```

> 合并顺序很关键：**先 categories → 再 questions → 最后三张依赖表**，保证外键引用的行已经存在，不会"悬空"。

---

## 5. 安全：PAT + 本机加密

- **Token 权限最小化**：GitHub PAT 只需勾 `gist` scope，读不到你的代码/私有仓库。
- **加密存储**：PAT 用 Electron `safeStorage` 加密后存 `userData/sync-token.enc`，**不进 settings 表、不回传给渲染层（Vue 拿不到明文 token）**。`safeStorage` 不可用（如部分 Linux 无桌面密钥环）时降级明文并弹提示。
- **gistId / 登录名 / lastSync** 才放 `settings` 表（`sync_gist_id` / `sync_login` / `sync_last_sync`）。
- **传输**：走 HTTPS 到 `api.github.com`，Bearer Token 在 Header。

---

## 6. 代码落点（改了哪些文件）

| 文件 | 职责 |
|---|---|
| `electron/sync-github.js` | GitHub REST 封装：`validateToken` / `createGist` / `updateGist` / `getGist`（Node 全局 `fetch`，统一错误） |
| `electron/sync-merge.js` | **纯函数** `lwwMerge` / `applyFk` / `mergeTables`，无 DB 依赖，供单测 |
| `electron/db.js` | `exportSync()`（全量快照含软删）、`mergeRemote(json)`（按 client_id upsert + LWW + 外键解析）、`backfillClientIds()`（老库补齐 client_id/*_cid）、`getSetting/setSetting` |
| `electron/main.js` | `syncGetConfig` / `syncConnect` / `syncDisconnect` / `syncNow` 编排 + token 安全存储 |
| `electron/preload.js` + `src/api/tiku.js` | 暴露上述四个 sync 方法（三层同名） |
| `src/components/Profile.vue` | 「云同步（GitHub）」卡片：输入 Token、连接、立即同步、断开 |

---

## 7. 真机验收步骤（你这边怎么用）

```bash
# 1) 生成 Token：github.com → Settings → Developer settings → Personal access tokens
#    Generate new token (classic)，只勾 gist，复制那串 gh...

cd tiku-desktop
npm install && npm run dev
# 2) 我的 → 云同步(GitHub) → 粘贴 Token → 「连接并同步」
#    （首次会自动建一个私有 Gist；状态显示「上次同步：刚刚」）
# 3) 另一台设备同账号，粘贴同一 PAT → 「立即同步」→ 数据拉回
```

---

## 8. 边界、坑、与真实踩过的雷

1. **Gist 单文件 1MB 硬上限**：GitHub Gist 每个文件最大约 1MB。个人考证数据（几千题 + 答题记录）通常没问题，但 `answer_records` 会暴增——若超 1MB，要么只同步最近 N 条、要么做压缩。**这是个真实卡点，真机同步前先估一下快照大小**。
2. **绝不能"本地覆盖远端"**：若 `syncNow` 跳过 `mergeRemote` 直接 PATCH，B 设备推完会冲掉 A 的改动。收敛模型（§2）专治这个。
3. **client_id 创建即生成、立即持久化**：绝不能在同步时才生成，否则同一条记录每次推送都变成"新行"→ 重复堆积。
4. **软删要传播**：`deleted=1` 必须随同步走，否则一端删了另一端拉回"复活"。
5. **外键翻译失败**：pull 时若 `question_cid` 在本地找不到对应行，靠"先 categories → 再 questions → 最后依赖表"的顺序保证引用已存在；极端情况（断点续传）需建占位行，本期不处理。
6. **时钟漂移**：`updated_at` 依赖本机时钟。用户手改过系统时间会出现"假的新"。可接受风险；必要时用 GitHub 返回的 `Date` 头校准。
7. **速率限制**：GitHub API 未认证 60 次/时、PAT 5000 次/时。个人同步频率远碰不到，但别写死轮询。

## 9. 举一反三：其他免后端方案（都复用同一套 client_id/LWW）

| 方案 | 存储位置 | 自动化 | 适合 |
|---|---|---|---|
| **GitHub Gist（当前）** | 私有 Gist 文件 | 半自动（点按钮） | 已有 GitHub、数据量小 |
| 云盘同步目录 | OneDrive/坚果云/Dropbox 本地文件夹 | 半自动 | 不想暴露给 GitHub、零 API |
| WebDAV（坚果云/Nextcloud） | WebDAV 服务器 | 全自动 | 想全自动、不愿依赖 GitHub |
| 对象存储 OSS/COS/S3 | 厂商 bucket | 全自动 | 数据量大、要合规留存 |

> 四者只是"把 JSON 快照存哪"不同，收敛模型（§2）和冲突算法（§3）完全一样。**将来想全自动，把 `sync-github.js` 换成 `sync-webdav.js` 即可，db.js 一行不用动。**

## 10. 隐私提醒

私有 Gist 只有你和你的 PAT 能读，但 **GitHub 服务端仍可见明文**（员工/合规场景要当心）。敏感数据别明文存；要更强的自主管控就走"云盘同步目录"或自建 WebDAV/MinIO。

---

**小张一句到位**：同步的本质就是"给每条数据一个跨设备不变的名字（client_id）+ 一个修改时间（updated_at），先拉后推、谁新听谁的"——GitHub Gist 只是替你白嫖了个带版本历史的云盘，仅此而已。
