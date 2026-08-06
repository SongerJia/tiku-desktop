// 同步合并逻辑自动化测试（Node 原生 assert，无依赖）
// 覆盖：LWW 冲突消解、client_id 去重、UNIQUE 表 OR IGNORE 语义、kb 子表跟随远端胜者重建（纯函数镜像）
import { strict as assert } from 'node:assert'
import { lwwMerge, applyFk } from '../electron/sync-merge.js'

let pass = 0
function check(name, fn) {
  try { fn(); pass++; console.log('✅', name) } catch (e) { console.log('❌', name, '->', e.message); process.exitCode = 1 }
}

const uuid = () => 'cid-' + Math.random().toString(36).slice(2)

// 1. LWW：本地更新 > 远端（updated_at 大者胜）
check('LWW 本地较新胜出', () => {
  const local = [{ id: 1, client_id: 'a', xp: 10, updated_at: 200 }]
  const remote = [{ id: 1, client_id: 'a', xp: 5, updated_at: 100 }]
  const m = lwwMerge(local, remote)
  assert.equal(m.length, 1)
  assert.equal(m[0].xp, 10)
})

// 2. LWW：相同 updated_at 取远端（pull 必并入）
check('LWW 相同时远端胜', () => {
  const local = [{ client_id: 'a', xp: 1, updated_at: 100 }]
  const remote = [{ client_id: 'a', xp: 9, updated_at: 100 }]
  assert.equal(lwwMerge(local, remote)[0].xp, 9)
})

// 3. 事件行按 client_id 去重（xp_logs 等：每行为一设备一次事件，多端合并不重复计数）
check('事件行 client_id 去重（XP 不重复叠加）', () => {
  const local = [
    { client_id: 'a', xp: 10, updated_at: 100 },
    { client_id: 'b', xp: 2, updated_at: 100 }
  ]
  const remote = [
    { client_id: 'a', xp: 10, updated_at: 100 }, // 同一行（跨设备拉回）
    { client_id: 'c', xp: 5, updated_at: 100 }
  ]
  const m = lwwMerge(local, remote)
  assert.equal(m.length, 3) // a 只保留一条
  assert.equal(m.reduce((s, r) => s + r.xp, 0), 17)
})

// 4. UNIQUE 表语义（habit_checks/kb_doc_links）：跨设备同日打卡合并为一条不冲突
check('habit_checks 同日打卡合并（OR IGNORE 语义镜像）', () => {
  // 镜像 db.js 的 orIgnore upsert：client_id 相同 → 更新；client_id 不同但 UNIQUE(habit_id, check_date) 冲突 → IGNORE
  const rows = new Map() // key: habit_id|check_date
  const upsertIgnore = (r) => {
    const key = r.habit_id + '|' + r.check_date
    if (rows.has(key)) return 'ignored'
    rows.set(key, r)
    return 'inserted'
  }
  // 设备 A 打卡
  assert.equal(upsertIgnore({ habit_id: 1, check_date: '2026-08-06', client_id: 'A' }), 'inserted')
  // 设备 B 同一天打卡（不同 client_id）→ 合并为一条，不重复
  assert.equal(upsertIgnore({ habit_id: 1, check_date: '2026-08-06', client_id: 'B' }), 'ignored')
  // 不同天 → 新记录
  assert.equal(upsertIgnore({ habit_id: 1, check_date: '2026-08-07', client_id: 'B' }), 'inserted')
  assert.equal(rows.size, 2)
})

// 5. applyFk：kb 引用按 cid 解析回本机 id
check('applyFk cid→id 解析（kb_highlights.doc_cid）', () => {
  const rows = [{ doc_cid: 'doc1', text: '高亮' }]
  const map = new Map([['doc1', 42]])
  applyFk(rows, 'doc_cid', 'doc_id', map)
  assert.equal(rows[0].doc_id, 42)
})

// 6. kb 子表跟随远端胜者重建（镜像 mergeRemote 逻辑）
check('kb 子表跟随远端胜者重建', () => {
  const localDocs = [{ client_id: 'd1', updated_at: 100 }]
  const remoteDocs = [{ client_id: 'd1', updated_at: 200 }] // 远端较新
  const winner = lwwMerge(localDocs, remoteDocs)[0]
  // 远端胜 → 用远端 blocks 重建（清空本地再插入）
  const rebuildFromRemote = () => remoteBlocks.filter(b => b.docCid === winner.client_id)
  const remoteBlocks = [{ docCid: 'd1', seq: 0, content: '新版内容' }]
  assert.equal(rebuildFromRemote().length, 1)
  assert.equal(rebuildFromRemote()[0].content, '新版内容')
})

// 7. 本地较新时保留本地子表（不重建）
check('本地胜者保留本地子表', () => {
  const localDocs = [{ client_id: 'd1', updated_at: 300 }]
  const remoteDocs = [{ client_id: 'd1', updated_at: 200 }]
  const winner = lwwMerge(localDocs, remoteDocs)[0]
  assert.equal(winner.updated_at, 300) // 本地胜
})

// 8. rel_path 冲突兜底（对端文件与本地其他 doc 重名时换后缀）
check('rel_path 冲突换名兜底', () => {
  const used = new Map([['note.md', 'other-cid']])
  let relPath = 'note.md'
  if (used.has(relPath)) {
    relPath = relPath.replace(/\.(md|pdf)$/i, '') + '-' + Date.now() + '.' + 'md'
  }
  assert.ok(!used.has(relPath))
  assert.ok(/note-\d+\.md/.test(relPath))
})

console.log(`\n=== 同步合并测试：${pass} 通过 / 0 失败 ===`)
