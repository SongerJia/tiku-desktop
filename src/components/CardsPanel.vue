<script setup>
import { ref, computed, onMounted } from 'vue'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { showConfirm } from '../utils/confirm.js'
import { useEsc } from '../utils/useEsc.js'
import Icon from './Icon.vue'

const props = defineProps({ show: Boolean })
const emit = defineEmits(['close'])

const cards = ref([])
const stats = ref({ total: 0, due: 0 })
const loading = ref(true)

// 管理模式：列表 / 复习
const mode = ref('list')
const reviewItems = ref([])
const rIdx = ref(0)
const flipped = ref(false)
const rDone = ref(0)

// 添加/编辑表单
const form = ref({ id: null, front: '', back: '', category: '' })

const dueCount = computed(() => stats.value.due)

async function load() {
  loading.value = true
  const [list, s] = await Promise.all([tiku.listCards(), tiku.cardsStats()])
  cards.value = list
  stats.value = s
  loading.value = false
}

function startAdd() { form.value = { id: null, front: '', back: '', category: '' } }

function editCard(c) {
  form.value = { id: c.id, front: c.front, back: c.back, category: c.category || '' }
  window.scrollTo && window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function saveCard() {
  const f = form.value.front.trim()
  const b = form.value.back.trim()
  if (!f || !b) { showToast('正面和背面都不能为空'); return }
  if (form.value.id) await tiku.updateCard(form.value.id, f, b, form.value.category.trim())
  else await tiku.addCard(f, b, form.value.category.trim())
  startAdd()
  await load()
}

async function removeCard(c) {
  const ok = await showConfirm(`删除卡片「${c.front}」？复习记录一并清除。`)
  if (!ok) return
  await tiku.deleteCard(c.id)
  await load()
}

// ---- CSV 批量导入（每行 front,back[,category]，支持引号包裹）----
const csvInput = ref(null)
function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(c => String(c).trim())) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some(c => String(c).trim())) rows.push(row)
  return rows
}
async function onPickCsv(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  const rows = parseCsv(await file.text())
  let n = 0, skipped = 0
  for (const r of rows) {
    if (r.length < 2 || !String(r[0]).trim() || !String(r[1]).trim()) { skipped++; continue }
    await tiku.addCard(String(r[0]).trim(), String(r[1]).trim(), String(r[2] || '').trim())
    n++
  }
  showToast(n ? `CSV 导入完成：新增 ${n} 张卡片${skipped ? '，跳过 ' + skipped + ' 行' : ''}` : '未导入任何卡片，请检查 CSV 格式（front,back,category）', n ? 'ok' : 'err')
  await load()
}

// ---- 复习模式 ----
async function startReview() {
  reviewItems.value = await tiku.getCardReview(10)
  if (!reviewItems.value.length) { showToast('还没有卡片，先添加几张吧'); return }
  rIdx.value = 0
  rDone.value = 0
  flipped.value = false
  mode.value = 'review'
}

const cur = computed(() => reviewItems.value[rIdx.value] || null)

async function mark(felt) {
  if (!cur.value) return
  await tiku.logReview('card', cur.value.id, felt ? 1 : 0)
  rDone.value++
  flipped.value = false
  if (rIdx.value + 1 >= reviewItems.value.length) {
    await finishReview()
  } else {
    rIdx.value++
  }
}

async function finishReview() {
  mode.value = 'list'
  await load()
  showToast(`本轮复习完成，共 ${reviewItems.value.length} 张`, 'ok')
}

useEsc(() => emit('close'))
onMounted(load)
</script>

<template>
  <div v-if="show" class="mask" @click.self="emit('close')">
    <div class="panel">
      <!-- 头部 -->
      <div class="head">
        <span class="title">单词卡</span>
        <span class="stats" v-if="mode === 'list'">共 {{ stats.total }} 张 · 今日到期 {{ dueCount }}</span>
        <div class="spacer"></div>
        <button v-if="mode === 'list' && stats.total" class="btn btn-primary review-btn" @click="startReview">
          <Icon name="refresh" :size="13" /> 开始复习<template v-if="dueCount">（{{ dueCount }}）</template>
        </button>
        <button class="btn close-btn" @click="emit('close')">关闭</button>
      </div>

      <!-- 列表模式 -->
      <div v-if="mode === 'list'" class="body">
        <!-- 添加/编辑表单 -->
        <div class="add-form">
          <input v-model="form.front" class="input" placeholder="正面（单词 / 问题）" @keyup.enter="saveCard" />
          <input v-model="form.back" class="input" placeholder="背面（释义 / 答案）" @keyup.enter="saveCard" />
          <input v-model="form.category" class="input cat-input" placeholder="分类（如：雅思核心）" @keyup.enter="saveCard" />
          <button class="btn btn-primary" @click="saveCard">{{ form.id ? '保存修改' : '添加卡片' }}</button>
          <button v-if="form.id" class="btn" @click="startAdd">取消编辑</button>
          <button class="btn" @click="csvInput && csvInput.click()">导入 CSV</button>
          <input ref="csvInput" type="file" accept=".csv,.txt" style="display:none" @change="onPickCsv" />
        </div>

        <div v-if="!cards.length" class="empty">
          <p>还没有卡片。背单词从第一张开始：<br />在上面输入「单词 + 释义」即可，复习会按遗忘曲线自动安排（记住 3 天再见 / 忘记明天再来）。</p>
        </div>

        <div v-else class="card-list">
          <div v-for="c in cards" :key="c.id" class="card-item">
            <div class="card-main">
              <div class="card-front">{{ c.front }}</div>
              <div class="card-back">{{ c.back }}</div>
            </div>
            <div class="card-meta">
              <span v-if="c.category" class="cat-badge">{{ c.category }}</span>
              <span class="state" :class="{ due: c.due }">
                {{ c.due ? '待复习' : (c.review_count ? '已安排' : '新卡') }}{{ c.review_count ? ' · 记过 ' + c.review_count + ' 次' : '' }}{{ c.lapses ? ' · 忘过 ' + c.lapses + ' 次' : '' }}
              </span>
            </div>
            <div class="card-actions">
              <button class="act" @click="editCard(c)">编辑</button>
              <button class="act del" @click="removeCard(c)">删除</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 复习模式 -->
      <div v-else class="body review-body">
        <div class="rv-progress">第 {{ rIdx + 1 }} / {{ reviewItems.length }} 张 · 已完成 {{ rDone }} 张</div>
        <div class="card" :class="{ flipped }" @click="flipped = !flipped">
          <div class="face front">
            <span class="face-label">正面</span>
            <span class="face-text">{{ cur.front }}</span>
            <span class="face-hint">点击卡片翻面</span>
          </div>
          <div class="face back">
            <span class="face-label">背面</span>
            <span class="face-text">{{ cur.back }}</span>
            <span class="face-hint">还记得吗？</span>
          </div>
        </div>
        <div v-if="flipped" class="mark-row">
          <button class="mark-btn no" @click="mark(false)"><Icon name="x" :size="14" /> 忘记了（明天再见）</button>
          <button class="mark-btn yes" @click="mark(true)"><Icon name="check" :size="14" /> 记住了（3 天后再见）</button>
        </div>
        <div v-else class="mark-hint">先回想答案，再点击卡片翻面核对</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed; inset: 0; z-index: 60;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur));
  -webkit-backdrop-filter: blur(var(--modal-blur));
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.panel {
  width: min(720px, 100%);
  max-height: 86vh;
  display: flex; flex-direction: column;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.head {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 16px; border-bottom: 1px solid var(--line);
}
.title { font-size: 15px; font-weight: 700; color: var(--text); }
.stats { font-size: 12px; color: var(--muted); }
.spacer { flex: 1; }
.review-btn { padding: 6px 14px; display: inline-flex; align-items: center; gap: 5px; }
.close-btn { padding: 6px 12px; }
.body { padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.add-form { display: flex; gap: 8px; flex-wrap: wrap; }
.add-form .input { flex: 1 1 140px; font-size: 13px; }
.add-form .cat-input { flex: 0 1 150px; }
.card-list { display: flex; flex-direction: column; gap: 8px; }
.card-item {
  display: flex; align-items: center; gap: 12px;
  border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px;
  transition: border-color .15s;
}
.card-item:hover { border-color: rgba(91, 124, 250, 0.35); }
.card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.card-front { font-size: 14px; font-weight: 600; color: var(--text); }
.card-back { font-size: 13px; color: var(--muted); }
.card-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
.cat-badge { font-size: 10px; color: var(--brand); border: 1px solid rgba(91, 124, 250, 0.35); border-radius: 5px; padding: 0 6px; }
.state { font-size: 11px; color: var(--muted); }
.state.due { color: var(--warn); }
.card-actions { display: flex; gap: 6px; flex-shrink: 0; }
.act { border: 1px solid var(--line); background: transparent; color: var(--muted); border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; transition: all .15s; }
.act:hover { color: var(--brand); border-color: var(--brand); }
.act.del:hover { color: var(--bad); border-color: var(--bad); }

/* 复习模式 */
.review-body { align-items: center; }
.rv-progress { font-size: 12px; color: var(--muted); }
.card {
  width: 100%; max-width: 480px; min-height: 220px;
  border: 1px solid var(--line); border-radius: 14px;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: transform .2s, border-color .2s;
  position: relative;
}
.card:hover { border-color: rgba(91, 124, 250, 0.4); transform: translateY(-2px); }
.face { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 28px 20px; text-align: center; }
.face-label { font-size: 11px; color: var(--muted); letter-spacing: 2px; }
.face-text { font-size: 22px; font-weight: 700; color: var(--text); word-break: break-word; }
.face-hint { font-size: 11px; color: var(--muted); opacity: .7; }
.mark-row { display: flex; gap: 12px; width: 100%; max-width: 480px; }
.mark-btn {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 11px; border-radius: 10px; border: 1px solid var(--line);
  background: transparent; color: var(--text); font-size: 13px; cursor: pointer; transition: all .15s;
}
.mark-btn.no:hover { border-color: var(--bad); color: var(--bad); background: rgba(229, 83, 95, 0.08); }
.mark-btn.yes:hover { border-color: var(--ok); color: var(--ok); background: rgba(47, 191, 143, 0.08); }
.mark-hint { font-size: 12px; color: var(--muted); }
.empty { text-align: center; color: var(--muted); font-size: 13px; line-height: 1.8; padding: 20px 0; }
</style>
