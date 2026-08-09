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
// 删除优先：任一方 deleted=1 且对方非删除时，删除胜出（删除是终态，防止被旧快照"复活"）。
function pickWinner(localRow, remoteRow) {
  if (!localRow) return remoteRow
  if (!remoteRow) return localRow
  const lDel = Number(localRow.deleted) === 1
  const rDel = Number(remoteRow.deleted) === 1
  if (lDel !== rDel) return lDel ? localRow : remoteRow
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

module.exports = { indexByCid, pickWinner, lwwMerge, applyFk }
