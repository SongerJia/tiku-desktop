// 同步合并纯函数单测（不依赖 Electron / better-sqlite3，直接在 Node 跑）。
// 验证：lwwMerge 冲突裁决、applyFk 外键按 cid→id 解析、mergeTables 六表整体合并。
const assert = require('assert')
const { lwwMerge, applyFk, mergeTables } = require('../electron/sync-merge.js')

let pass = 0
function ok(name, cond) {
  assert.ok(cond, 'FAIL: ' + name)
  pass++
  console.log('  ✓', name)
}

// ---- lwwMerge：身份用 client_id，updated_at 大者胜，相等取远端 ----
;(function () {
  const local = [
    { client_id: 'A', updated_at: 100, v: 1 },
    { client_id: 'B', updated_at: 50, v: 2 }
  ]
  const remote = [
    { client_id: 'A', updated_at: 200, v: 9 }, // A 远端更新 → 胜
    { client_id: 'C', updated_at: 10, v: 3 }   // C 仅远端有 → 并入
  ]
  const m = lwwMerge(local, remote)
  const byCid = Object.fromEntries(m.map(r => [r.client_id, r]))
  ok('lwwMerge 远端更新胜出(A)', byCid.A.v === 9)
  ok('lwwMerge 本地保留(B)', byCid.B.v === 2)
  ok('lwwMerge 远端新行并入(C)', byCid.C && byCid.C.v === 3)

  // 相等取远端
  const m2 = lwwMerge([{ client_id: 'X', updated_at: 100, v: 1 }], [{ client_id: 'X', updated_at: 100, v: 7 }])
  ok('lwwMerge 时间戳相等取远端', m2[0].v === 7)
})()

// ---- applyFk：按 cid→id 把引用列解析成外键 id ----
;(function () {
  const cidToId = new Map([['q1', 11], ['q2', 22]])
  const rows = [
    { question_cid: 'q1', question_id: 999 },
    { question_cid: 'q2', question_id: 888 },
    { question_cid: 'unknown', question_id: 777 } // 无映射 → 不动
  ]
  applyFk(rows, 'question_cid', 'question_id', cidToId)
  ok('applyFk 解析 q1→11', rows[0].question_id === 11)
  ok('applyFk 解析 q2→22', rows[1].question_id === 22)
  ok('applyFk 无映射保留原值', rows[2].question_id === 777)
})()

// ---- mergeTables：六表整体合并 + 外键按 cid 解析 ----
;(function () {
  const local = {
    categories: [{ id: 1, client_id: 'cA', name: '本地A', parent_cid: null, parent_id: null }],
    questions: [{ id: 10, client_id: 'qA', category_cid: 'cA', category_id: 1, stem: '本地题' }],
    answerRecords: [], wrongBooks: [], favorites: [], notes: []
  }
  const remote = {
    categories: [{ id: 99, client_id: 'cA', name: '远端A(改过名)', parent_cid: null, parent_id: null, updated_at: 500 }],
    questions: [{ id: 88, client_id: 'qA', category_cid: 'cA', category_id: 99, stem: '远端题', updated_at: 500 }],
    answerRecords: [{ id: 5, client_id: 'a1', question_cid: 'qA', question_id: 88, updated_at: 500 }],
    wrongBooks: [], favorites: [], notes: []
  }
  local.categories[0].updated_at = 100
  local.questions[0].updated_at = 100

  const merged = mergeTables(local, remote)
  // 远端更新胜出
  ok('mergeTables 分类采用远端名', merged.categories[0].name === '远端A(改过名)')
  ok('mergeTables 题目采用远端 stem', merged.questions[0].stem === '远端题')
  // 外键按 cid→id 解析：category_id 应指向"合并后 cA 对应的 id"
  const catId = merged.categories[0].id
  ok('mergeTables 题目 category_id 指向合并后分类 id', merged.questions[0].category_id === catId)
  // answerRecords 的 question_id 应指向合并后 qA 对应的 id
  const qId = merged.questions[0].id
  ok('mergeTables 答题记录 question_id 指向合并后题目 id', merged.answerRecords[0].question_id === qId)
})()

console.log(`\n全部通过：${pass} 项断言`)
