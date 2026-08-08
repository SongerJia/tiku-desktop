// 纯函数：本地快照与远端快照的合并逻辑，不依赖任何数据库，便于在 Node 中直接单测。
//
// 设计要点（也是多端同步不出错的关键）：
//   1. 身份用 client_id（每条记录创建时生成的 uuid），不用自增 id——自增 id 在不同机器上一定错位。
//   2. 冲突用 last-write-wins：updated_at 大者胜；相等取远端（保证 pull 一定并入）。
//   3. 外键（category_id / question_id / parent_id）在合并时按 client_id→本地id 重新解析，
//      因为对端传来的 id 是它自己机器的 id，落到本机必须换成"本机这条 client_id 对应的 id"。
//
// 输入/输出结构统一为：
//   { categories, questions, answerRecords, wrongBooks, favorites, notes }
// 每个元素为行对象，含 client_id 与引用用的 *_cid 列。

// 按 client_id 把行收进 Map；client_id 缺失的行直接丢弃（正常写入都会带）。
function indexByCid(rows) {
  const m = new Map()
  for (const r of rows || []) {
    if (r && r.client_id != null && r.client_id !== '') m.set(r.client_id, r)
  }
  return m
}

// 取较新一方；updated_at 相同取远端（保证 pull 一定并入）。
function pickWinner(localRow, remoteRow) {
  if (!localRow) return remoteRow
  if (!remoteRow) return localRow
  const lu = Number(localRow.updated_at) || 0
  const ru = Number(remoteRow.updated_at) || 0
  return ru >= lu ? remoteRow : localRow
}

// 合并单表：以 client_id 为身份做 LWW，返回胜出行数组（保留 client_id）。
function lwwMerge(localRows, remoteRows) {
  const localMap = indexByCid(localRows)
  const remoteMap = indexByCid(remoteRows)
  const out = new Map()
  for (const [cid, r] of localMap) out.set(cid, pickWinner(r, remoteMap.get(cid)))
  for (const [cid, r] of remoteMap) if (!out.has(cid)) out.set(cid, r)
  return Array.from(out.values())
}

// 按 cid→id 映射，把引用列(refCol)解析成外键列(fkCol)的本地 id。
// rows 会被原地修改。cidToId 为 Map<client_id, 本地id>。
function applyFk(rows, refCol, fkCol, cidToId) {
  if (!cidToId) return rows
  for (const r of rows || []) {
    if (r && r[refCol] != null && cidToId.has(r[refCol])) {
      r[fkCol] = cidToId.get(r[refCol])
    }
  }
  return rows
}

// 一次性合并六张表（依赖顺序：先 categories/questions，再依赖它们的三张表）。
// local / remote 结构同上；返回 merged（已解析外键到"merged 集合内的 id"）。
// 注意：纯函数里"merged 集合内的 id"是胜出行自带的 id；真实落库时 db.js 会再用
// client_id→本机id 重新映射一次，避免对端 id 落本机造成错位。单测用受控 id 验证算法即可。
function mergeTables(local, remote) {
  const categories = lwwMerge(local.categories, remote.categories)
  const questions = lwwMerge(local.questions, remote.questions)

  // 即便纯函数里也先解析一次外键（供单测断言），db.js 落库时会再解析成本机 id。
  const catCidToId = new Map()
  categories.forEach(c => { if (c.client_id != null) catCidToId.set(c.client_id, c.id) })
  const quesCidToId = new Map()
  questions.forEach(q => { if (q.client_id != null) quesCidToId.set(q.client_id, q.id) })

  applyFk(categories, 'parent_cid', 'parent_id', catCidToId)
  applyFk(questions, 'category_cid', 'category_id', quesCidToId)

  const answerRecords = applyFk(lwwMerge(local.answerRecords, remote.answerRecords), 'question_cid', 'question_id', quesCidToId)
  const wrongBooks = applyFk(lwwMerge(local.wrongBooks, remote.wrongBooks), 'question_cid', 'question_id', quesCidToId)
  const favorites = applyFk(lwwMerge(local.favorites, remote.favorites), 'question_cid', 'question_id', quesCidToId)
  const notes = applyFk(lwwMerge(local.notes, remote.notes), 'question_cid', 'question_id', quesCidToId)

  return { categories, questions, answerRecords, wrongBooks, favorites, notes }
}

// 快照级合并：把「本地增量快照」并入「现有 gist 完整快照」，产出新的完整快照。
// 用于推送时保持 gist 始终是包含多端数据的完整收敛态（pull 端 mergeRemote 依旧照常工作）。
// 规则与 mergeRemote/db.js 完全一致：client_id 身份 + updated_at 大者胜（相等取 incoming）。
//
// 快照结构（见 db.js exportSync）：
//   - ARRAY_TABLES：含 client_id 的行数组，逐行 LWW
//   - DOC_SCOPED：{ [docCid]: 行数组 }，按所属文档的 LWW 胜者整体取用（文档级重建）
//   - SET_KEYS：无 client_id、按业务键去重的数组（incoming 覆盖 existing）
const SNAP_ARRAY_TABLES = [
  'categories', 'questions', 'answerRecords', 'wrongBooks', 'favorites', 'notes',
  'papers', 'paperQuestions', 'xpLogs', 'habits', 'habitChecks', 'reviewLogs',
  'focusSessions', 'cards', 'materials', 'kbDocs', 'kbHighlights', 'kbDocLinks'
]
const SNAP_DOC_SCOPED = ['kbBlocksByCid', 'kbTagsByCid', 'kbLinksByCid']
const SNAP_SET_KEYS = [
  { key: 'questionTags', idOf: (r) => r.tag + '|' + r.question_cid },
  { key: 'kbFiles', idOf: (r) => r.relPath }
]

function mergeByKey(existingArr, incomingArr, idOf) {
  const map = new Map()
  for (const r of existingArr || []) if (r) map.set(idOf(r), r)
  for (const r of incomingArr || []) if (r) map.set(idOf(r), r) // incoming 覆盖
  return Array.from(map.values())
}

function mergeSnapshots(existing, incoming) {
  existing = existing || {}
  incoming = incoming || {}
  const out = { ...existing } // 先以 existing 为基底，下面逐键覆盖

  // 1) 行数组表：逐 client_id LWW
  for (const key of SNAP_ARRAY_TABLES) {
    out[key] = lwwMerge(existing[key] || [], incoming[key] || [])
  }

  // 2) 文档作用域子表：按所属文档 LWW 胜者整体取用
  const eDocs = indexByCid(existing.kbDocs)
  const iDocs = indexByCid(incoming.kbDocs)
  for (const key of SNAP_DOC_SCOPED) {
    const eMap = existing[key] || {}
    const iMap = incoming[key] || {}
    const merged = {}
    const cids = new Set([...Object.keys(eMap), ...Object.keys(iMap)])
    for (const cid of cids) {
      const winnerDoc = pickWinner(eDocs.get(cid), iDocs.get(cid))
      const src = winnerDoc === iDocs.get(cid) ? iMap[cid] : eMap[cid]
      if (Array.isArray(src) && src.length) merged[cid] = src
    }
    out[key] = merged
  }

  // 3) 按业务键去重（incoming 覆盖）
  for (const { key, idOf } of SNAP_SET_KEYS) {
    out[key] = mergeByKey(existing[key], incoming[key], idOf)
  }

  // 4) 元信息取较新一方；保留 existing/incoming 中其它未知键
  out.version = incoming.version || existing.version
  out.kind = incoming.kind || existing.kind
  out.exportedAt = incoming.exportedAt || existing.exportedAt
  for (const k of Object.keys(existing)) if (!(k in out)) out[k] = existing[k]
  for (const k of Object.keys(incoming)) if (!(k in out)) out[k] = incoming[k]
  return out
}

module.exports = { indexByCid, pickWinner, lwwMerge, applyFk, mergeTables, mergeSnapshots }
