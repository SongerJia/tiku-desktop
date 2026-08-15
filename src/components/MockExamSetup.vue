<script setup>
import Icon from './Icon.vue'
import { useBodyLock } from '../composables/useBodyLock.js'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import EmptyState from './EmptyState.vue'
import { ref, onMounted, watch } from 'vue'
import { tiku } from '../api/tiku.js'
import { printHtml } from '../utils/print.js'
import { showConfirm } from '../utils/confirm.js'
import { useEsc } from '../utils/useEsc.js'

const props = defineProps({
  show: Boolean,
  wide: Boolean,
  subject: { type: Object, default: () => ({ id: null, name: '' }) }
})
useBodyLock(() => props.show)
useFocusTrap(() => props.show, '.me-panel')
const emit = defineEmits(['confirm', 'cancel'])

const tab = ref('compose') // compose=新建组卷 / mine=我的试卷
const subjects = ref([])
const subjectId = ref(props.subject && props.subject.id ? props.subject.id : '')
const chapters = ref([])
const selectedChapters = ref([])
const rules = ref([
  { type: 'single', count: 10, difficulty: '', score: '' },
  { type: 'multiple', count: 5, difficulty: '', score: '' },
  { type: 'judge', count: 10, difficulty: '', score: '' },
  { type: 'essay', count: 2, difficulty: '', score: '' }
])
const duration = ref(90)
const title = ref('')
const error = ref('')
const working = ref(false)
const papers = ref([])

const TYPE_OPTIONS = [
  { v: 'single', l: '单选' },
  { v: 'multiple', l: '多选' },
  { v: 'judge', l: '判断' },
  { v: 'essay', l: '问答' }
]
const typeLabel = (v) => (TYPE_OPTIONS.find(t => t.v === v) || {}).l || v
const totalCount = () => rules.value.reduce((s, r) => s + (Number(r.count) || 0), 0)
const totalScore = () => {
  const n = totalCount()
  if (!n) return 0
  const manual = rules.value.reduce((s, r) => s + (r.score && Number(r.score) > 0 ? Number(r.score) * (Number(r.count) || 0) : 0), 0)
  // 与 db-paper 组卷一致：手动分值优先，未设分值的自动题均摊剩余分值 (100 - 手动总分)
  const auto = rules.value.reduce((s, r) => s + (r.score && Number(r.score) > 0 ? 0 : (Number(r.count) || 0)), 0)
  const autoScore = auto > 0 ? Math.max(0, 100 - manual) / auto : 0
  return Math.round((manual + auto * autoScore) * 10) / 10
}

async function loadSubjects() {
  subjects.value = await tiku.getSubjects()
  if (!subjectId.value && subjects.value.length) subjectId.value = subjects.value[0].id
  await loadChapters()
}

async function loadChapters() {
  selectedChapters.value = []
  if (!subjectId.value) { chapters.value = []; return }
  const tree = await tiku.getCategories()
  const sub = tree.find(s => String(s.id) === String(subjectId.value))
  chapters.value = sub ? (sub.children || []) : []
}

async function loadPapers() {
  papers.value = await tiku.listPapers()
}

onMounted(async () => {
  await loadSubjects()
  await loadPapers()
})

watch(subjectId, () => loadChapters())
useEsc(() => emit('cancel'))

function addRule() {
  rules.value.push({ type: 'single', count: 1, difficulty: '', score: '' })
}
function removeRule(i) {
  rules.value.splice(i, 1)
}

async function generate() {
  error.value = ''
  if (!totalCount()) { error.value = '请至少设置一道题'; return }
  working.value = true
  try {
    const res = await tiku.generatePaper({
      title: title.value.trim() || `模拟卷 ${new Date().toLocaleString('zh-CN')}`,
      subjectId: subjectId.value ? Number(subjectId.value) : null,
      chapterIds: selectedChapters.value.map(Number),
      rules: rules.value
        .map(r => ({
          type: r.type,
          count: Number(r.count) || 0,
          difficulty: r.difficulty ? Number(r.difficulty) : null,
          score: r.score ? Number(r.score) : null
        }))
        .filter(r => r.count > 0),
      durationMinutes: Number(duration.value) || 90
    })
    emit('confirm', { paperId: res.paperId, durationMin: Number(duration.value) || 90 })
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    working.value = false
  }
}

function reexam(p) {
  emit('confirm', { paperId: p.id, durationMin: p.duration_minutes || 90 })
}
async function delPaper(p) {
  const ok = await showConfirm(`确定删除「${p.title}」？删除后无法恢复。`, { title: '删除试卷', danger: true })
  if (!ok) return
  await tiku.deletePaper(p.id)
  await loadPapers()
}

function fmtDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 导出模拟卷为 PDF（打印）：上半部分为答题卷（无答案），下半部分为参考答案与解析
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
async function exportPaperPdf(p) {
  const paper = await tiku.getPaper(p.id)
  if (!paper || !paper.questions.length) return
  const optText = (o) => (o && o.length ? o.map(x => `${x.key}. ${x.text}`).join('；') : '')
  // 题干图转 base64，打印离线可见
  const imgCache = {}
  for (const q of paper.questions) {
    if (q.images && q.images.length) {
      const urls = await Promise.all(q.images.map(n => tiku.getImage(n)))
      imgCache[q.seq] = urls.filter(Boolean)
    }
  }
  let body = `<h1>${escapeHtml(paper.title)}</h1>`
  body += `<p class="doc-sub">${escapeHtml(paper.subject_name || '全部科目')} · 共 ${paper.questions.length} 题 · 总分 ${paper.totalScore} 分 · ${paper.durationMinutes} 分钟</p>`
  body += `<div class="section-title">试卷（答题区）</div>`
  paper.questions.forEach((q, i) => {
    body += `<div class="q"><span class="q-no">${i + 1}.</span><span class="q-type">[${typeLabel(q.type)} ${q.score}分]</span> <span class="q-stem">${escapeHtml(q.stem)}</span>`
    if (imgCache[q.seq] && imgCache[q.seq].length) body += imgCache[q.seq].map(u => `<img class="q-img" src="${u}"/>`).join('')
    if (q.options && q.options.length) body += '<ul class="opts">' + q.options.map(o => `<li>${escapeHtml(o.key)}. ${escapeHtml(o.text)}</li>`).join('') + '</ul>'
    body += `</div>`
  })
  body += `<div class="section-title">参考答案与解析</div>`
  paper.questions.forEach((q, i) => {
    body += `<div class="q"><span class="q-no">${i + 1}.</span> <span class="ans-key">答案：${escapeHtml(q.answer.join('、'))}</span>`
    if (q.analysis) body += `<div class="analysis">解析：${escapeHtml(q.analysis)}</div>`
    body += `</div>`
  })
  printHtml(paper.title + ' · 模拟卷', body)
}
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="me-mask" :class="{ 'is-wide': wide }" @click.self="emit('cancel')">
      <div class="me-panel" :class="{ 'is-wide': wide }">
        <div class="header">
          <span class="close" @click="emit('cancel')">×</span>
          <span class="title">模拟卷</span>
          <span class="scope">{{ tab === 'compose' ? '组卷' : '我的试卷' }}</span>
        </div>

        <!-- 切换：组卷 / 我的试卷 -->
        <div class="tabs">
          <button class="tab" :class="{ active: tab === 'compose' }" @click="tab = 'compose'">新建组卷</button>
          <button class="tab" :class="{ active: tab === 'mine' }" @click="tab = 'mine'">我的试卷（{{ papers.length }}）</button>
        </div>

        <div class="body">
          <!-- ===== 新建组卷 ===== -->
          <div v-if="tab === 'compose'" class="compose">
            <div class="field">
              <label>科目</label>
              <select v-model="subjectId" class="input">
                <option value="">全部科目</option>
                <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </div>

            <div v-if="chapters.length" class="field">
              <label>章节（不选=该科目全部章节）</label>
              <div class="chapters">
                <label v-for="c in chapters" :key="c.id" class="chk">
                  <input type="checkbox" :value="c.id" v-model="selectedChapters" />
                  <span>{{ c.name }}</span>
                </label>
              </div>
            </div>

            <div class="field">
              <div class="label-row">
                <label>出题规则（题型 / 数量 / 难度 / 每题分值）</label>
                <button class="btn-outline sm" @click="addRule">+ 规则</button>
              </div>
              <div class="rules">
                <div v-for="(r, i) in rules" :key="i" class="rule-row">
                  <select v-model="r.type" class="input r-type">
                    <option v-for="t in TYPE_OPTIONS" :key="t.v" :value="t.v">{{ t.l }}</option>
                  </select>
                  <input type="number" min="0" v-model="r.count" class="input r-count" placeholder="数量" />
                  <select v-model="r.difficulty" class="input r-diff">
                    <option value="">难度不限</option>
                    <option v-for="d in [1,2,3,4,5]" :key="d" :value="d">{{ d }}星</option>
                  </select>
                  <input type="number" min="0" v-model="r.score" class="input r-score" placeholder="分值(空=等分)" />
                  <button v-if="rules.length > 1" class="del" @click="removeRule(i)">×</button>
                </div>
              </div>
              <div class="rule-sum">共 <b>{{ totalCount() }}</b> 题 · 预计总分 <b>{{ totalScore() }}</b> 分</div>
            </div>

            <div class="field">
              <label>试卷标题（选填）</label>
              <input v-model="title" class="input" placeholder="留空自动命名" />
            </div>

            <div class="field">
              <label>考试时长（分钟）</label>
              <input type="number" min="1" v-model="duration" class="input" />
            </div>

            <div v-if="error" class="err">{{ error }}</div>

            <div class="footer">
              <button class="btn-outline" @click="emit('cancel')">取消</button>
              <button class="btn-primary" :disabled="working" @click="generate">
                {{ working ? '生成中…' : '生成并开始' }}
              </button>
            </div>
          </div>

          <!-- ===== 我的试卷 ===== -->
          <div v-else class="mine">
            <EmptyState v-if="!papers.length" icon="doc" text="还没有模拟卷" sub="在「新建组卷」按题型/难度抽题，生成后可反复重考" />
            <div v-else class="paper-list">
              <div v-for="p in papers" :key="p.id" class="paper-card">
                <div class="pc-top">
                  <span class="pc-title">{{ p.title }}</span>
                  <span class="pc-sub">{{ p.subject_name || '全部科目' }}</span>
                </div>
                <div class="pc-meta">
                  <span>{{ p.qCount }} 题</span>
                  <span>总分 {{ p.total_score }} 分</span>
                  <span>{{ p.duration_minutes }} 分钟</span>
                  <span class="pc-date">{{ fmtDate(p.created_at) }}</span>
                </div>
                <div class="pc-actions">
                  <button class="btn-primary sm" @click="reexam(p)">重考</button>
                  <button class="btn-outline sm" @click="exportPaperPdf(p)">导出PDF</button>
                  <button class="btn-outline sm danger" @click="delPaper(p)">删除</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.me-mask {
  position: fixed; inset: 0; z-index: 330;
  background: var(--modal-mask); backdrop-filter: blur(var(--modal-blur, 4px));
  display: flex; align-items: flex-end; justify-content: center;
}
.me-mask.is-wide { align-items: center; padding: 24px; }
.me-panel {
  width: 100%; max-width: 560px; margin: 0 auto; max-height: 90%;
  background: var(--card-solid, #0b1020); border: 1px solid var(--line, #1d2740);
  border-radius: 20px 20px 0 0; display: flex; flex-direction: column; overflow: hidden;
  box-shadow: var(--shadow, 0 20px 60px rgba(0,0,0,.5)), var(--glow-soft, 0 0 20px color-mix(in srgb, var(--brand) 20%, transparent));
}
.me-mask.is-wide .me-panel { width: 520px; max-width: 92vw; height: auto; border-radius: 16px; }

.header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--line); }
.header .close { font-size: 24px; color: var(--muted); cursor: pointer; width: 32px; }
.header .title { font-size: 17px; font-weight: 700; color: var(--text); }
.header .scope { font-size: 12px; color: var(--brand); background: var(--brand-light, color-mix(in srgb, var(--brand) 12%, transparent)); border: 1px solid var(--line); border-radius: 20px; padding: 3px 10px; }

.tabs { display: flex; gap: 8px; padding: 12px 18px 0; }
.tab {
  flex: 1; padding: 8px; border-radius: 10px 10px 0 0; font-size: 13px; cursor: pointer;
  border: 1px solid var(--line); border-bottom: none; background: var(--bg-soft, rgba(255,255,255,.02));
  color: var(--muted); transition: all .18s;
}
.tab.active { background: var(--brand-light, color-mix(in srgb, var(--brand) 8%, transparent)); color: var(--brand); border-color: var(--brand); }

.body { padding: 14px 18px 20px; overflow-y: auto; border-top: 1px solid var(--line); }
.field { margin-bottom: 14px; display: flex; flex-direction: column; gap: 6px; }
.field > label, .label-row > label { font-size: 12px; color: var(--muted); }
.label-row { display: flex; align-items: center; justify-content: space-between; }
.input {
  width: 100%; box-sizing: border-box; background: var(--input-solid-bg, rgba(5,8,15,.8));
  border: 1px solid var(--line); border-radius: 8px; color: var(--text);
  padding: 9px 10px; font-size: 13px; outline: none; font-family: inherit;
}
.input:focus { border-color: var(--brand); box-shadow: var(--glow-soft); }

.chapters { display: flex; flex-wrap: wrap; gap: 8px; }
.chk { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 5px 9px; cursor: pointer; }
.chk input { accent-color: var(--brand); }

.rules { display: flex; flex-direction: column; gap: 8px; }
.rule-row { display: flex; gap: 6px; align-items: center; }
.r-type { flex: 1.1; min-width: 70px; }
.r-count { width: 64px; }
.r-diff { flex: 1; min-width: 70px; }
.r-score { width: 96px; }
.del { flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--line); background: none; color: var(--muted); cursor: pointer; font-size: 15px; line-height: 1; }
.del:hover { color: var(--bad); border-color: var(--bad); }
.rule-sum { margin-top: 8px; font-size: 12px; color: var(--muted); }
.rule-sum b { color: var(--brand); }

.err { font-size: 12px; color: var(--bad-soft); border: 1px solid rgba(255,77,109,.4); background: rgba(255,77,109,.08); border-radius: 8px; padding: 8px 10px; margin-bottom: 12px; }

.footer { display: flex; gap: 12px; margin-top: 6px; }
.btn-outline, .btn-primary {
  flex: 1; padding: 11px; border-radius: 24px; font-size: 14px; font-weight: 600; cursor: pointer; border: 1px solid transparent;
}
.btn-outline { background: transparent; border-color: var(--line); color: var(--text); }
.btn-outline:hover { border-color: var(--brand); color: var(--brand); }
.btn-outline.danger:hover { border-color: var(--bad); color: var(--bad); }
.btn-primary { background: var(--brand); color: #fff; border: none; box-shadow: var(--glow, 0 0 16px color-mix(in srgb, var(--brand) 50%, transparent)); }
.btn-primary:hover { box-shadow: 0 0 22px color-mix(in srgb, var(--brand) 70%, transparent); }
.btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.btn-outline.sm, .btn-primary.sm { flex: 0 0 auto; padding: 6px 16px; font-size: 12px; }

.empty { text-align: center; color: var(--muted); font-size: 13px; padding: 36px 0; line-height: 2; }
.empty-icon { font-size: 30px; opacity: .6; }
.empty-sub { font-size: 12px; opacity: .75; }

.paper-list { display: flex; flex-direction: column; gap: 10px; }
.paper-card { border: 1px solid var(--line); border-radius: 10px; padding: 12px; background: color-mix(in srgb, var(--brand) 3%, transparent); }
.pc-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
.pc-title { font-size: 14px; color: var(--text); font-weight: 600; }
.pc-sub { font-size: 11px; color: var(--muted); }
.pc-meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px; color: var(--muted); margin-bottom: 10px; }
.pc-date { margin-left: auto; }
.pc-actions { display: flex; gap: 8px; }

.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
