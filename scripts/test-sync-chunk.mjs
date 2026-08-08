// 增量同步 + 多文件分块 逻辑自动化测试（Node 原生 assert，无依赖）
// 覆盖：快照级 LWW 合并、文档作用域子表重建、按业务键去重、分块编解码往返（含超大负载多分块）。
import { strict as assert } from 'node:assert'
import crypto from 'node:crypto'
import { mergeSnapshots } from '../electron/sync-merge.js'
import { encodeSnapshotChunks, decodeSnapshotChunks, encodeSnapshot, FILE, CHUNK_BASE, encodeImageFiles, decodeImageFiles, IMG_INDEX } from '../electron/sync-github.js'

let pass = 0
async function check(name, fn) {
  try { await fn(); pass++; console.log('✅', name) } catch (e) { console.log('❌', name, '->', e.message); process.exitCode = 1 }
}

const snap = (over = {}) => Object.assign({
  version: 4, kind: 'sync', exportedAt: 1,
  categories: [], questions: [], answerRecords: [], wrongBooks: [], favorites: [],
  notes: [], papers: [], paperQuestions: [], questionTags: [], kbDocs: [],
  kbBlocksByCid: {}, kbTagsByCid: {}, kbLinksByCid: {}, kbFiles: [], xpLogs: [],
  habits: [], habitChecks: [], reviewLogs: [], focusSessions: [], cards: [],
  kbHighlights: [], kbDocLinks: []
}, over)

await check('mergeSnapshots LWW incoming 胜', () => {
  const e = snap({ questions: [{ client_id: 'a', updated_at: 100, stem: '老' }] })
  const i = snap({ questions: [{ client_id: 'a', updated_at: 200, stem: '新' }] })
  const m = mergeSnapshots(e, i)
  assert.equal(m.questions.length, 1)
  assert.equal(m.questions[0].stem, '新')
})

await check('mergeSnapshots 新行并入', () => {
  const e = snap({ questions: [{ client_id: 'a', updated_at: 100 }] })
  const i = snap({ questions: [{ client_id: 'b', updated_at: 200 }] })
  const m = mergeSnapshots(e, i)
  assert.equal(m.questions.length, 2)
})

await check('mergeSnapshots 文档子表按文档胜者重建', () => {
  const e = snap({
    kbDocs: [{ client_id: 'd1', updated_at: 100 }],
    kbBlocksByCid: { d1: [{ seq: 0, content: '旧块' }] }
  })
  const i = snap({
    kbDocs: [{ client_id: 'd1', updated_at: 200 }],
    kbBlocksByCid: { d1: [{ seq: 0, content: '新块' }] }
  })
  const m = mergeSnapshots(e, i)
  assert.equal(m.kbBlocksByCid.d1[0].content, '新块')
})

await check('mergeSnapshots 未变更文档保留 existing 子表', () => {
  const e = snap({
    kbDocs: [{ client_id: 'd1', updated_at: 200 }],
    kbBlocksByCid: { d1: [{ seq: 0, content: '已存在块' }] }
  })
  const i = snap({ kbDocs: [], kbBlocksByCid: {} })
  const m = mergeSnapshots(e, i)
  assert.equal(m.kbBlocksByCid.d1[0].content, '已存在块')
})

await check('mergeSnapshots questionTags 去重', () => {
  const e = snap({ questionTags: [{ tag: 't1', question_cid: 'q1' }] })
  const i = snap({ questionTags: [{ tag: 't1', question_cid: 'q1' }, { tag: 't2', question_cid: 'q1' }] })
  const m = mergeSnapshots(e, i)
  assert.equal(m.questionTags.length, 2)
})

await check('图片编码/解码往返：小图单文件', async () => {
  const buf = crypto.randomBytes(2048)
  const { files, index } = encodeImageFiles([{ name: 'a.png', buffer: buf, hash: 'h1' }])
  const all = { ...files, [IMG_INDEX]: { content: index } }
  const out = await decodeImageFiles(all, null)
  assert.equal(out.length, 1)
  assert.equal(out[0].name, 'a.png')
  assert.ok(buf.equals(out[0].buffer), 'buffer 解码后应完全一致')
})

await check('图片编码/解码往返：大图自动分块', async () => {
  const buf = crypto.randomBytes(800 * 1024) // gzip+base64 后 >900KB，应分块
  const { files, index } = encodeImageFiles([{ name: 'big.png', buffer: buf, hash: 'h2' }])
  const parsed = JSON.parse(index)
  assert.ok(parsed.entries[0].parts > 1, '大图应被切成多块，实际 parts=' + parsed.entries[0].parts)
  const all = { ...files, [IMG_INDEX]: { content: index } }
  const out = await decodeImageFiles(all, null)
  assert.equal(out.length, 1)
  assert.ok(buf.equals(out[0].buffer), '分块解码后应完全一致')
})

await check('图片编码：多图各自独立文件', async () => {
  const a = crypto.randomBytes(1000), b = crypto.randomBytes(1000)
  const { files, index } = encodeImageFiles([{ name: 'x.png', buffer: a, hash: 'h3' }, { name: 'y.png', buffer: b, hash: 'h4' }])
  const parsed = JSON.parse(index)
  assert.equal(parsed.entries.length, 2)
  assert.equal(Object.values(files).length, 2, '应生成 2 个独立图片文件')
})

await check('分块往返：小负载单文件', async () => {
  const obj = { hello: 'world', n: 42 }
  const json = JSON.stringify(obj)
  const { files, count } = encodeSnapshotChunks(json)
  assert.equal(count, 1)
  assert.ok(files[CHUNK_BASE + '0'])
  const back = await decodeSnapshotChunks(files, null)
  assert.deepEqual(JSON.parse(back), obj)
})

await check('分块往返：大负载多分块一致', async () => {
  const rand = () => crypto.randomBytes(160).toString('base64')
  const big = { questions: Array.from({ length: 9000 }, (_, i) => ({ client_id: 'c' + i, updated_at: i, stem: rand(), analysis: rand(), options_json: JSON.stringify([rand(), rand()]) })) }
  const json = JSON.stringify(big)
  assert.ok(json.length > 1024 * 1024, 'payload should exceed 1MB')
  const { files, count } = encodeSnapshotChunks(json)
  assert.ok(count > 1, 'should split into multiple chunks, got ' + count)
  const back = await decodeSnapshotChunks(files, null)
  assert.deepEqual(JSON.parse(back), big)
})

await check('分块兼容旧单文件', async () => {
  const obj = { legacy: true }
  const files = { [FILE]: { content: encodeSnapshot(JSON.stringify(obj)), truncated: false } }
  const back = await decodeSnapshotChunks(files, null)
  assert.deepEqual(JSON.parse(back), obj)
})

console.log(`\n=== 增量同步/分块测试：${pass} 通过 / 0 失败 ===`)
