<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import MarkdownIt from 'markdown-it'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { celebrate } from '../utils/celebrate.js'
import { showConfirm } from '../utils/confirm.js'
import { useEsc } from '../utils/useEsc.js'
import SimpleQuestion from './SimpleQuestion.vue'

const props = defineProps({ show: Boolean, doc: Object })
const emit = defineEmits(['close', 'open-doc'])

const HL_COLORS = {
  yellow: 'rgba(255, 200, 60, 0.25)',
  blue: 'rgba(60, 160, 255, 0.25)',
  green: 'rgba(80, 220, 140, 0.25)',
  pink: 'rgba(255, 110, 160, 0.25)'
}
const hlColor = (c) => HL_COLORS[c] || HL_COLORS.yellow

const md = new MarkdownIt({ linkify: true, breaks: true, html: false })
// MD 目录：给 h1-h4 加锚点 id，收集目录项
let toc = []
const _headingOpen = md.renderer.rules.heading_open || ((tokens, idx) => `<${tokens[idx].tag}>`)
md.renderer.rules.heading_open = (tokens, idx) => {
  const tag = tokens[idx].tag
  const level = Number(tag.slice(1))
  if (level <= 4) {
    const id = 'sec-' + toc.length
    toc.push({ id, level, text: tokens[idx + 1] ? tokens[idx + 1].content : '' })
    return `<${tag} id="${id}" class="kb-h${level}">`
  }
  return `<${tag}>`
}
const tocList = ref([])
function jumpToToc(id) {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
// 阅读字号
const fontSize = ref(14)
// PDF 当前页（滚动估算）
const currentPage = ref(0)
// PDF 缩放百分比（100 = 基准 1.5 scale），全量重渲染实现
const pdfZoom = ref(100)
const PDF_ZOOM_MIN = 50
const PDF_ZOOM_MAX = 250
const PDF_ZOOM_STEP = 15
let pdfZoomTimer = null
function changePdfZoom(delta) {
  pdfZoom.value = Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, pdfZoom.value + delta))
  clearTimeout(pdfZoomTimer)
  pdfZoomTimer = setTimeout(async () => {
    if (!pdfDoc || !pdfContainer.value) return
    pdfContainer.value.innerHTML = ''
    pdfState.value.done = 0
    await renderAllPages() // 全量重渲染（scale 跟随 pdfZoom）
  }, 200)
}
const html = ref('')
const pdfState = ref({ loading: false, error: '', pages: 0, done: 0 })
const pdfContainer = ref(null)
let pdfTask = null
let pdfDoc = null

// 「相关题目」面板：已关联(kb_links) + L2 推荐(kbSuggestQuestions) + 手动搜题关联
const qLinks = ref([])
const qSugg = ref([])
const qPanel = ref(true)
const mKw = ref('')
const mRes = ref([])
const mLoading = ref(false)
const sq = ref({ show: false, q: null })
let mTimer = null

// MD 在线编辑
const editMode = ref(false)
const editText = ref('')
// 右侧面板整列收起/展开（沉浸阅读）
const sidePanelOpen = ref(true)

async function startEdit() {
  const r = await tiku.kbRead(props.doc.id)
  if (!r.ok) { showToast('读取失败：' + r.error, 'err'); return }
  editText.value = new TextDecoder('utf-8').decode(b64ToUint8(r.base64))
  editMode.value = true
}

async function saveEdit() {
  const r = await tiku.kbSaveMd(props.doc.id, editText.value)
  if (!r.ok) { showToast('保存失败：' + r.error, 'err'); return }
  editMode.value = false
  await renderMd()
}

function cancelEdit() {
  editMode.value = false
}

// 关闭拦截：MD 编辑未保存时先确认，防丢数据；PDF 顺带保存阅读位置
async function onClose() {
  if (editMode.value) {
    const ok = await showConfirm('有未保存的编辑内容，确定关闭？编辑内容将丢失。')
    if (!ok) return
  }
  await saveScroll()
  emit('close')
}

// 高亮批注 + 文档双链
const hl = ref([])
const links = ref({ from: [], to: [] })
const hlPanel = ref(true)
const linkKw = ref('')
const linkRes = ref([])
let linkTimer = null

async function loadHlAndLinks() {
  if (!props.doc) return
  const [h, l] = await Promise.all([tiku.getHighlightsForDoc(props.doc.id), tiku.getDocLinks(props.doc.id)])
  hl.value = h
  links.value = l
}

async function addHlFromSelection() {
  const sel = window.getSelection()
  const text = sel ? sel.toString().trim() : ''
  if (!text) { showToast('先在文档正文里选中文字，再点「高亮」'); return }
  await tiku.addHighlight({ docId: props.doc.id, text })
  try { sel.removeAllRanges() } catch (e) { /* 忽略 */ }
  await loadHlAndLinks()
}

async function removeHl(id) {
  await tiku.removeHighlight(id)
  await loadHlAndLinks()
}

function onLinkInput() {
  clearTimeout(linkTimer)
  const kw = linkKw.value.trim()
  if (!kw) { linkRes.value = []; return }
  linkTimer = setTimeout(async () => {
    linkRes.value = (await tiku.kbSearch(kw, 5)).filter(d => d.id !== props.doc.id)
  }, 300)
}

async function linkDoc(d) {
  await tiku.linkDocs(props.doc.id, d.id)
  linkRes.value = linkRes.value.filter(x => x.id !== d.id)
  await loadHlAndLinks()
}

async function unlinkDoc(docId) {
  await tiku.unlinkDocs(props.doc.id, docId)
  await loadHlAndLinks()
}

async function loadQPanel() {
  if (!props.doc) return
  const [links, sugg] = await Promise.all([
    tiku.kbLinksForDoc(props.doc.id),
    tiku.kbSuggestQuestions(props.doc.id, 5)
  ])
  qLinks.value = links
  qSugg.value = sugg
}

watch(() => props.show, async (v) => {
  if (!v || !props.doc) return
  html.value = ''
  pdfState.value = { loading: false, error: '', pages: 0, done: 0 }
  qLinks.value = []
  qSugg.value = []
  mKw.value = ''
  mRes.value = []
  editMode.value = false
  pdfZoom.value = 100 // 换文档重置缩放
  clearTimeout(pdfZoomTimer)
  cleanupPdf()
  if (props.doc.type === 'md') await renderMd()
  else await renderPdf()
  await loadQPanel()
  await loadHlAndLinks()
  await tiku.kbBumpRead(props.doc.id) // 阅读埋点（计入学习统计）
  celebrate()
})

async function linkQ(qid) {
  await tiku.kbLink({ docId: props.doc.id, questionId: qid })
  mRes.value = mRes.value.filter(x => x.id !== qid)
  await loadQPanel()
}

async function unlinkQ(qid) {
  await tiku.kbUnlink(props.doc.id, qid)
  await loadQPanel()
}

function onMInput() {
  clearTimeout(mTimer)
  const kw = mKw.value.trim()
  if (!kw) { mRes.value = []; mLoading.value = false; return }
  mTimer = setTimeout(async () => {
    mLoading.value = true
    mRes.value = await tiku.getQuestions({ keyword: kw, limit: 6 })
    mLoading.value = false
  }, 300)
}

async function openQ(qid, fallbackStem) {
  const full = await tiku.getQuestionById(qid)
  sq.value = { show: true, q: full || { id: qid, stem: fallbackStem, options: [], answer: [], type: 'single' } }
}

function b64ToUint8(b64) {
  const bin = atob(b64)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i += 0x8000) {
    const chunk = Math.min(0x8000, len - i)
    for (let j = 0; j < chunk; j++) bytes[i + j] = bin.charCodeAt(i + j)
  }
  return bytes
}

async function renderMd() {
  const r = await tiku.kbRead(props.doc.id)
  if (!r.ok) { html.value = `<div class="kb-err">读取失败：${r.error}</div>`; return }
  toc = []
  const text = new TextDecoder('utf-8').decode(b64ToUint8(r.base64))
  html.value = md.render(text)
  tocList.value = toc.slice()
}

async function renderPdf() {
  const r = await tiku.kbRead(props.doc.id)
  if (!r.ok) { pdfState.value.error = `读取失败：${r.error}`; return }
  try {
    pdfState.value.loading = true
    // pdfjs 6.x 必须显式设置 workerSrc；用本地 worker 文件避免网络依赖
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href
    }
    const getDocument = pdfjsLib.getDocument
    pdfTask = getDocument({
      data: b64ToUint8(r.base64),
      isEvalSupported: false,
      useSystemFonts: true
    })
    pdfDoc = await pdfTask.promise
    pdfState.value.pages = pdfDoc.numPages
    await renderAllPages()
  } catch (e) {
    pdfState.value.error = String((e && e.message) || e)
  } finally {
    pdfState.value.loading = false
  }
}

async function renderAllPages() {
  if (!pdfDoc || !pdfContainer.value) return
  try {
    const scale = 1.5 * (pdfZoom.value / 100)
    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page = await pdfDoc.getPage(p)
      const vp = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport: vp }).promise
      canvas.classList.add('kb-pdf-page')
      canvas.dataset.page = p
      pdfContainer.value.appendChild(canvas)
      pdfState.value.done = p
    }
    // 恢复阅读位置：缩放后回到当前页（而非第一页）
    const last = currentPage.value || Number(props.doc.last_page) || 0
    if (last > 0 && last <= pdfDoc.numPages) {
      const target = pdfContainer.value.querySelector(`canvas[data-page="${last}"]`)
      if (target) target.scrollIntoView({ block: 'start' })
    }
  } catch (e) {
    if (!pdfState.value.error) pdfState.value.error = String((e && e.message) || e)
  }
}

// 滚动时估算当前页（保存阅读位置用）
function onPdfScroll() {
  const container = pdfContainer.value
  if (!container) return
  const canvases = container.querySelectorAll('canvas.kb-pdf-page')
  const top = container.scrollTop + 40
  let cur = 0
  for (const c of canvases) {
    if (c.offsetTop <= top) cur = Number(c.dataset.page) || 0
    else break
  }
  currentPage.value = cur
}

async function saveScroll() {
  if (!props.doc) return
  if (props.doc.type === 'pdf' && currentPage.value > 0) {
    await tiku.saveKbScroll(props.doc.id, currentPage.value)
  }
}

function cleanupPdf() {
  if (pdfTask && typeof pdfTask.destroy === 'function') {
    try { pdfTask.destroy() } catch (e) { /* 忽略 */ }
  }
  pdfTask = null
  pdfDoc = null
}

onBeforeUnmount(() => {
  cleanupPdf()
  clearTimeout(mTimer)
  clearTimeout(pdfZoomTimer)
})
useEsc(() => emit('close'))
</script>

<template>
  <div v-if="show" class="kb-page">
    <!-- 顶栏：返回 + 标题 + 操作按钮 -->
    <div class="kb-head">
      <button class="btn kb-back" @click="onClose">← 返回</button>
      <span class="badge kb-type" :class="props.doc?.type">{{ props.doc?.type === 'pdf' ? 'PDF' : 'MD' }}</span>
      <span class="kb-title">{{ props.doc?.title }}</span>
      <div class="kb-spacer"></div>
      <span v-if="pdfState.pages" class="kb-pdf-prog">{{ pdfState.done }}/{{ pdfState.pages }}</span>
      <template v-if="props.doc?.type === 'md' && !editMode">
        <button class="btn kb-act" @click="addHlFromSelection">高亮</button>
        <button class="btn kb-act" @click="startEdit">编辑</button>
        <button class="btn kb-act" @click="fontSize = Math.max(11, fontSize - 1)">A-</button>
        <button class="btn kb-act" @click="fontSize = Math.min(20, fontSize + 1)">A+</button>
      </template>
      <template v-else-if="props.doc?.type === 'pdf' && !editMode">
        <button class="btn kb-act" :disabled="pdfZoom <= PDF_ZOOM_MIN" @click="changePdfZoom(-PDF_ZOOM_STEP)">缩小</button>
        <span class="kb-pdf-zoom">{{ pdfZoom }}%</span>
        <button class="btn kb-act" :disabled="pdfZoom >= PDF_ZOOM_MAX" @click="changePdfZoom(PDF_ZOOM_STEP)">放大</button>
        <button class="btn kb-act" v-if="pdfZoom !== 100" @click="changePdfZoom(100 - pdfZoom)">复位 100%</button>
      </template>
      <template v-if="editMode">
        <button class="btn btn-primary" @click="saveEdit">保存</button>
        <button class="btn" @click="cancelEdit">取消</button>
      </template>
      <button class="btn kb-side-toggle" :class="{ off: !sidePanelOpen }" @click="sidePanelOpen = !sidePanelOpen">
        <span class="kb-side-toggle-icon">{{ sidePanelOpen ? '⟩' : '⟨' }}</span>
        {{ sidePanelOpen ? '收起侧栏' : '展开侧栏' }}
      </button>
    </div>
    <!-- 主体：左目录 | 中正文 | 右相关题目+批注 -->
    <div class="kb-body">
      <!-- 左：MD 目录（常驻） -->
      <div v-if="props.doc?.type === 'md' && tocList.length" class="kb-side-toc">
        <div class="kb-side-title">目录</div>
        <div class="kb-toc">
          <div
            v-for="t in tocList"
            :key="t.id"
            class="kb-toc-item"
            :style="{ paddingLeft: (t.level - 1) * 12 + 8 + 'px' }"
            @click="jumpToToc(t.id)"
          >{{ t.text || '（无标题）' }}</div>
        </div>
      </div>
      <!-- 中：正文（md / pdf / 编辑态） -->
      <div class="kb-main" @scroll.passive="onPdfScroll">
        <textarea
          v-if="editMode"
          v-model="editText"
          class="kb-edit-area"
          spellcheck="false"
          placeholder="编辑 Markdown 内容，保存后自动重新切块并更新全文检索索引"
        ></textarea>
        <template v-else>
          <div v-if="pdfState.error" class="kb-err">
            <p>{{ pdfState.error }}</p>
            <p class="kb-hint">扫描版 PDF 没有文本层无法内嵌预览，可用系统阅读器打开原件</p>
            <button class="btn btn-primary" @click="tiku.kbOpen(props.doc.id)">系统阅读器打开</button>
          </div>
          <div v-if="pdfState.loading" class="empty">PDF 加载中…</div>
          <div v-if="props.doc?.type === 'md'" class="kb-md" :style="{ fontSize: fontSize + 'px' }" v-html="html"></div>
          <div v-else ref="pdfContainer" class="kb-pdf"></div>
        </template>
      </div>
      <!-- 右：相关题目 + 批注与关联 -->
      <div class="kb-side-panel">
        <!-- 相关题目面板：已关联 + L2 推荐 + 手动搜题关联 -->
        <div class="kb-links">
          <div class="kb-links-head" @click="qPanel = !qPanel">
            <span>相关题目</span>
            <span v-if="qLinks.length || qSugg.length" class="kb-links-count">{{ qLinks.length + qSugg.length }}</span>
            <span class="kb-links-toggle">{{ qPanel ? '收起' : '展开' }}</span>
          </div>
          <div v-if="qPanel" class="kb-links-body">
            <div v-if="!qLinks.length && !qSugg.length" class="kb-links-empty">暂无关联题目，可在下方搜索手动关联</div>
            <div v-for="l in qLinks" :key="'l' + l.id" class="kb-lq">
              <span class="kb-lq-stem" @click="openQ(l.question_id, l.stemPreview)">{{ l.stemPreview }}</span>
              <button class="kb-lq-act" @click="unlinkQ(l.question_id)">解除</button>
            </div>
            <div v-for="s in qSugg" :key="'s' + s.id" class="kb-lq sug">
              <span class="kb-lq-stem" @click="openQ(s.id, s.stem)">{{ s.stem }}</span>
              <span class="kb-lq-reason">{{ s.reason }}</span>
              <button class="kb-lq-act" @click="linkQ(s.id)">关联</button>
            </div>
            <div class="kb-lq-search">
              <input v-model="mKw" class="input" placeholder="搜题手动关联（如：TCP 三次握手）…" @input="onMInput" />
            </div>
            <div v-if="mLoading" class="kb-links-empty">搜索中…</div>
            <div v-for="q in mRes" :key="'m' + q.id" class="kb-lq">
              <span class="kb-lq-stem" @click="openQ(q.id, q.stem)">{{ q.stem }}</span>
              <button class="kb-lq-act" @click="linkQ(q.id)">关联</button>
            </div>
          </div>
        </div>

        <!-- 批注与关联：高亮 + 文档双链 -->
        <div class="kb-links">
          <div class="kb-links-head" @click="hlPanel = !hlPanel">
            <span>批注与关联</span>
            <span v-if="hl.length || links.from.length || links.to.length" class="kb-links-count">{{ hl.length + links.from.length + links.to.length }}</span>
            <span class="kb-links-toggle">{{ hlPanel ? '收起' : '展开' }}</span>
          </div>
          <div v-if="hlPanel" class="kb-links-body">
            <div v-if="hl.length" class="kb-hl">
              <div v-for="h in hl" :key="h.id" class="kb-lq">
                <span class="kb-hl-text" :style="{ background: hlColor(h.color) }">{{ h.text }}</span>
                <button class="kb-lq-act" @click="removeHl(h.id)">删除</button>
              </div>
            </div>
            <div v-else class="kb-links-empty">阅读时选中文字点「高亮」，重要内容不丢失</div>
            <div v-if="links.from.length || links.to.length" class="kb-dl">
              <div v-for="l in [...links.from, ...links.to]" :key="l.doc_id" class="kb-lq">
                <span class="kb-lq-stem" @click="$emit('open-doc', l.doc_id)">{{ l.title }}</span>
                <button class="kb-lq-act" @click="unlinkDoc(l.doc_id)">解除</button>
              </div>
            </div>
            <div class="kb-lq-search">
              <input v-model="linkKw" class="input" placeholder="搜索其他文档建立关联…" @input="onLinkInput" />
            </div>
            <div v-for="d in linkRes" :key="'d' + d.id" class="kb-lq">
              <span class="kb-lq-stem">{{ d.title }}</span>
              <button class="kb-lq-act" @click="linkDoc(d)">关联</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <SimpleQuestion :show="sq.show" :q="sq.q" @close="sq.show = false" />
  </div>
</template>

<style scoped>
/* 全屏三栏阅读页 */
.kb-page {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}
.kb-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--topbar-bg, var(--bg));
  flex-shrink: 0;
}
.kb-back { padding: 4px 12px; }
.kb-title { font-size: 14.5px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kb-spacer { flex: 1; }
.kb-type { text-transform: uppercase; letter-spacing: 1px; }
.kb-type.pdf { background: rgba(232, 95, 61, 0.15); color: #e85f3d; }
.kb-type.md { background: rgba(91, 124, 250, 0.12); color: var(--brand); }
.kb-pdf-prog { font-size: 12px; color: var(--muted); }
.kb-pdf-zoom { font-size: 12px; color: var(--muted); min-width: 42px; text-align: center; font-variant-numeric: tabular-nums; }
.kb-act { padding: 4px 12px; }

.kb-body {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.kb-side-toc {
  flex: 0 0 200px;
  min-width: 0;
  border-right: 1px solid var(--line);
  overflow-y: auto;
  padding: 14px 10px;
  background: rgba(127, 127, 127, 0.03);
}
.kb-side-title { font-size: 11px; color: var(--muted); letter-spacing: 2px; padding: 0 6px 8px; }
.kb-toc {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kb-toc-item {
  padding: 5px 10px;
  font-size: 12.5px;
  color: var(--muted);
  cursor: pointer;
  border-radius: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background .15s, color .15s;
}
.kb-toc-item:hover { background: var(--brand-light); color: var(--brand); }

.kb-main {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 30px 60px;
  scroll-behavior: smooth;
}
.kb-side-panel {
  flex: 0 0 300px;
  min-width: 0;
  border-left: 1px solid var(--line);
  overflow-y: auto;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(127, 127, 127, 0.03);
  transition: flex-basis .25s ease, padding .25s ease;
}
.kb-side-panel.collapsed {
  flex: 0 0 0;
  padding: 0;
  border-left-color: transparent;
}
.kb-side-panel.collapsed > * { opacity: 0; pointer-events: none; }
.kb-side-toggle { padding: 4px 12px; }
.kb-side-toggle.off { color: var(--brand); border-color: var(--brand); }
.kb-side-toggle-icon { font-family: Consolas, monospace; font-size: 14px; line-height: 1; }
.kb-md h1, .kb-md h2, .kb-md h3, .kb-md h4 { scroll-margin-top: 70px; }
.kb-edit-area {
  width: 100%;
  height: 100%;
  min-height: 60vh;
  background: var(--input-solid-bg);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  font-size: 13px;
  line-height: 1.7;
  font-family: Consolas, 'Courier New', monospace;
  outline: none;
  resize: none;
}
.kb-edit-area:focus { border-color: var(--brand); box-shadow: var(--glow-soft); }
.kb-md { max-width: 760px; margin: 0 auto; }
.kb-md :deep(h1), .kb-md :deep(h2), .kb-md :deep(h3) { color: var(--brand); margin: 18px 0 10px; }
.kb-md :deep(h1) { font-size: 20px; }
.kb-md :deep(h2) { font-size: 17px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
.kb-md :deep(h3) { font-size: 15px; }
.kb-md :deep(p) { line-height: 1.8; color: var(--text); margin: 8px 0; }
.kb-md :deep(ul), .kb-md :deep(ol) { padding-left: 22px; color: var(--text); line-height: 1.8; }
.kb-md :deep(code) { background: rgba(91, 124, 250, 0.1); color: var(--brand); padding: 1px 6px; border-radius: 4px; font-size: 12.5px; }
.kb-md :deep(pre) { background: rgba(255, 255, 255, 0.04); border: 1px solid var(--line); border-radius: 10px; padding: 12px; overflow-x: auto; }
.kb-md :deep(pre code) { background: none; color: var(--text); }
.kb-md :deep(blockquote) { border-left: 3px solid var(--brand); padding-left: 12px; color: var(--muted); margin: 10px 0; }
.kb-md :deep(table) { border-collapse: collapse; margin: 10px 0; }
.kb-md :deep(th), .kb-md :deep(td) { border: 1px solid var(--line); padding: 6px 10px; font-size: 13px; }
.kb-md :deep(img) { max-width: 100%; border-radius: 8px; }
.kb-pdf { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.kb-pdf-page {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.5);
  background: #fff;
}
.kb-err { color: #e85f3d; text-align: center; padding: 40px 0; }
.kb-hint { font-size: 12px; color: var(--muted); margin-top: 8px; }

/* 窄屏：三栏 → 单栏（目录隐藏、右侧板落到底部） */
@media (max-width: 960px) {
  .kb-body { flex-direction: column; }
  .kb-side-toc { display: none; }
  .kb-side-toggle { display: none; }
  .kb-side-panel { flex: 0 0 auto; border-left: none; border-top: 1px solid var(--line); max-height: 40vh; }
  .kb-main { padding: 18px 18px 40px; }
}

.kb-links {
  margin: 22px auto 0;
  max-width: 760px;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
}
.kb-links-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--brand);
  background: rgba(91, 124, 250, 0.05);
  user-select: none;
}
.kb-links-count {
  font-size: 11px;
  color: var(--muted);
  background: rgba(91, 124, 250, 0.1);
  border-radius: 10px;
  padding: 0 8px;
}
.kb-links-toggle { margin-left: auto; font-size: 12px; color: var(--muted); }
.kb-links-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.kb-links-empty { font-size: 12px; color: var(--muted); }
.kb-lq { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.kb-lq.sug { opacity: .9; }
.kb-lq-stem {
  flex: 1;
  color: var(--text);
  line-height: 1.5;
  cursor: pointer;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.kb-lq-stem:hover { color: var(--brand); }
.kb-lq-reason { font-size: 11px; color: var(--muted); flex-shrink: 0; }
.kb-lq-act {
  font-size: 11px;
  color: var(--muted);
  background: none;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
}
.kb-lq-act:hover { color: var(--brand); }
.kb-lq-search { margin-top: 4px; }
.kb-lq-search .input { width: 100%; font-size: 13px; }
.kb-hl, .kb-dl { display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; }
.kb-hl-text {
  flex: 1;
  font-size: 12px;
  color: var(--text);
  line-height: 1.6;
  border-radius: 6px;
  padding: 4px 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
