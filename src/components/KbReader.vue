<script setup>
import { ref, computed, nextTick, watch, onBeforeUnmount } from 'vue'
import MarkdownIt from 'markdown-it'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { celebrate } from '../utils/celebrate.js'
import { showConfirm } from '../utils/confirm.js'
import { useEsc } from '../utils/useEsc.js'
import SimpleQuestion from './SimpleQuestion.vue'

const props = defineProps({ show: Boolean, doc: Object })
const emit = defineEmits(['close', 'open-doc'])

// 笔记文档（标题以「笔记」结尾）打开时直接进 MD 编辑态，不渲染三栏
const isNoteDoc = computed(() => props.doc?.type === 'md' && String(props.doc.title || '').endsWith('笔记'))

const HL_COLORS = {
  yellow: 'rgba(255, 200, 60, 0.25)',
  blue: 'rgba(60, 160, 255, 0.25)',
  green: 'rgba(80, 220, 140, 0.25)',
  pink: 'rgba(255, 110, 160, 0.25)'
}
const hlColor = (c) => HL_COLORS[c] || HL_COLORS.yellow

// 阅读态 MD 渲染：markdown-it（稳定渲染，5083ea3 验证过正文必显示）；编辑态仍用 Vditor IR
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
const html = ref('') // 阅读态渲染结果（markdown-it → v-html）
const mdErr = ref('') // MD 渲染错误信息
let themeObserver = null // 监听 data-theme 切换，阅读态重渲染跟随主题
let mdRenderSeq = 0 // 渲染序号守卫：防止快速切换文档时旧渲染覆盖新文档
function jumpToToc(id) {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
// 阅读字号（MD 用）
const fontSize = ref(14)
// PDF 缩放百分比（100 = 基准 1.5 scale）
const pdfZoom = ref(100)
const PDF_ZOOM_MIN = 50
const PDF_ZOOM_MAX = 250
const PDF_ZOOM_STEP = 15
let pdfZoomTimer = null
let pdfScrollTimer = null
// 缩放浮层显隐（Ctrl+滚轮 / 滑条 / ±按钮 触发后显示，2.2s 无操作自动隐藏）
const zoomUi = ref(false)
let zoomUiTimer = null
function scheduleZoomHide() {
  clearTimeout(zoomUiTimer)
  zoomUiTimer = setTimeout(() => { zoomUi.value = false }, 2200)
}
function keepZoomUi() {
  clearTimeout(zoomUiTimer)
  zoomUi.value = true
}
function showZoomUi() {
  zoomUi.value = true
  scheduleZoomHide()
}
// 滑条拖动：实时预览 + 松手 200ms 后重建
function onZoomRangeInput(e) {
  const v = Number(e.target.value)
  const ratio = v / pdfZoom.value
  pdfZoom.value = Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, v))
  if (pdfContainer.value) {
    pdfContainer.value.querySelectorAll('canvas.kb-pdf-page').forEach(cv => {
      cv.style.transform = `scale(${ratio})`
      cv.style.transformOrigin = 'top center'
    })
  }
  clearTimeout(pdfZoomTimer)
  pdfZoomTimer = setTimeout(() => {
    if (!pdfDoc || !pdfContainer.value) return
    rebuildPdfAtZoom()
  }, 200)
  showZoomUi()
}
// Ctrl+滚轮缩放（需 passive:false 才能 preventDefault 阻止页面滚动）
let pdfWheelCleanup = null
function attachPdfWheel() {
  const c = pdfContainer.value
  if (!c || pdfWheelCleanup) return
  const onWheel = (e) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    changePdfZoom(e.deltaY < 0 ? PDF_ZOOM_STEP : -PDF_ZOOM_STEP)
  }
  c.addEventListener('wheel', onWheel, { passive: false })
  pdfWheelCleanup = () => c.removeEventListener('wheel', onWheel)
}
function detachPdfWheel() {
  if (pdfWheelCleanup) { pdfWheelCleanup(); pdfWheelCleanup = null }
}
// 懒渲染 + 缓存：pageEls[p] 当前 DOM 元素（placeholder 或 canvas）；pdfCache `${p}|${zoom}` → canvas
let pdfPageObjs = []
let pageEls = []
const pdfCache = new Map()
let renderQueue = []
let renderBusy = false
function changePdfZoom(delta) {
  const oldZoom = pdfZoom.value
  pdfZoom.value = Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, pdfZoom.value + delta))
  // 1) 即时预览：现有画布直接 CSS 拉伸，松手 150ms 后再重建
  const ratio = pdfZoom.value / oldZoom
  if (pdfContainer.value) {
    pdfContainer.value.querySelectorAll('canvas.kb-pdf-page').forEach(cv => {
      cv.style.transform = `scale(${ratio})`
      cv.style.transformOrigin = 'top center'
    })
  }
  clearTimeout(pdfZoomTimer)
  pdfZoomTimer = setTimeout(() => {
    if (!pdfDoc || !pdfContainer.value) return
    rebuildPdfAtZoom()
  }, 150)
  showZoomUi()
}
// 缓存写入（带上限，防大文档内存爆炸）
function cacheSet(key, canvas) {
  pdfCache.set(key, canvas)
  if (pdfCache.size > 40) {
    const oldest = pdfCache.keys().next().value
    pdfCache.delete(oldest)
  }
}
// 视口内可见页（懒渲染依据）：以滚动宿主（.kb-main）的视口矩形判断
function visiblePages() {
  const c = pdfContainer.value
  if (!c || !pdfDoc) return []
  const host = c.parentElement || c
  const rect = host.getBoundingClientRect()
  const top = rect.top
  const bottom = rect.bottom
  const out = []
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const el = pageEls[p]
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (r.bottom >= top && r.top <= bottom) out.push(p)
  }
  return out
}
// 渲染队列泵：串行渲染，避免并发画爆 GPU
async function pumpRenderQueue() {
  if (renderBusy) return
  renderBusy = true
  try {
    while (renderQueue.length) {
      const p = renderQueue.shift()
      await renderPage(p)
    }
  } catch (e) { /* 单页失败不阻塞队列 */ } finally {
    renderBusy = false
  }
}
// 渲染单页（缓存命中直接移动画布，避免重复光栅化）
async function renderPage(p) {
  const placeholder = pageEls[p]
  if (!placeholder || !pdfDoc) return
  const key = `${p}|${pdfZoom.value}`
  const cached = pdfCache.get(key)
  let canvas = null
  if (cached) {
    canvas = cached // 复用同一节点（canvas.cloneNode 不复制像素，必须移动）
  } else {
    try {
      const page = pdfPageObjs[p] || await pdfDoc.getPage(p)
      pdfPageObjs[p] = page
      const scale = 1.5 * (pdfZoom.value / 100)
      const vp = page.getViewport({ scale })
      canvas = document.createElement('canvas')
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      canvas.className = 'kb-pdf-page'
      canvas.dataset.page = p
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
      cacheSet(key, canvas)
    } catch (e) {
      if (!pdfState.value.error) pdfState.value.error = String((e && e.message) || e)
      return
    }
  }
  canvas.classList.add('kb-pdf-page')
  canvas.dataset.page = p
  placeholder.replaceWith(canvas)
  pageEls[p] = canvas
  pdfState.value.done++
}
// 按当前 zoom 重建全部占位并渲染可见页
async function rebuildPdfAtZoom() {
  const c = pdfContainer.value
  if (!c || !pdfDoc) return
  const total = pdfDoc.numPages
  const anchor = currentPage.value || Number(props.doc.last_page) || 1
  c.innerHTML = '' // 清空旧占位/画布（缓存的 canvas 节点仍在 pdfCache 中可复用）
  pageEls = []
  const scale = 1.5 * (pdfZoom.value / 100)
  // 拿 anchor 页 viewport 作为统一占位尺寸（PDF 通常统一页大小）；同时后台并发 getPage 其他页到缓存
  let stdW = 900, stdH = 1200
  try {
    const aPage = await pdfDoc.getPage(anchor)
    pdfPageObjs[anchor] = aPage
    const vp = aPage.getViewport({ scale })
    stdW = Math.floor(vp.width)
    stdH = Math.floor(vp.height)
  } catch (e) { /* 用兜底尺寸 */ }
  // 为所有页建占位（撑滚动条）；不并发预取 getPage——大 PDF（600+页）并发 getPage 会卡死主线程，只在滚动/首屏渲染时按需取
  for (let p = 1; p <= total; p++) {
    const ph = document.createElement('div')
    ph.className = 'kb-pdf-ph'
    ph.dataset.page = p
    ph.style.width = stdW + 'px'
    ph.style.height = stdH + 'px'
    c.appendChild(ph)
    pageEls[p] = ph
  }
  // 滚动到 anchor（默认会找最近的纵滚祖先 .kb-main）
  const anchorEl = pageEls[anchor]
  if (anchorEl) anchorEl.scrollIntoView({ block: 'start' })
  // 先渲染 anchor 前后 ±3 页（共 7 页）作为首屏可见内容；其余页等滚动时 onPdfScroll 按需补
  for (let dp = -3; dp <= 3; dp++) {
    const p = anchor + dp
    if (p >= 1 && p <= total && !renderQueue.includes(p)) renderQueue.push(p)
  }
  await pumpRenderQueue()
}
// PDF 当前页（滚动估算）
const currentPage = ref(0)
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

// 整个右侧面板收起/展开（聚焦文档时的「沉浸模式」）
const sidePanelOpen = ref(true)

// 文档笔记：独立 MD 文档（命名 = 原标题 + '笔记'），底部 Dock + Vditor IR 富编辑，收起/Ctrl+S 自动保存
const note = ref({ id: null, title: '', text: '', loaded: false })
const notePanel = ref(true)
const noteStatus = ref('') // '' | 'saving' | 'saved' | 'err'
const noteModal = ref(false)
let noteTimer = null
const noteVditorEl = ref(null)
let noteVditor = null

async function loadNote() {
  if (!props.doc) return
  const r = await tiku.kbGetNote(props.doc.id)
  if (!r.ok) return
  note.value.id = r.noteId
  note.value.title = r.title
  const rd = await tiku.kbRead(r.noteId)
  if (rd.ok) {
    note.value.text = new TextDecoder('utf-8').decode(b64ToUint8(rd.base64))
    note.value.loaded = true
  }
}

async function openNoteModal() {
  if (!note.value.id) return
  noteModal.value = true
  noteStatus.value = ''
  await nextTick()
  const isDark = document.documentElement.dataset.theme === 'dark'
  noteVditor = new Vditor(noteVditorEl.value, {
    mode: 'ir', // 与主文档编辑同一引擎
    cdn: import.meta.env.DEV ? '/vditor' : './vditor',
    value: note.value.text,
    height: '100%',
    theme: isDark ? 'dark' : 'classic',
    lang: 'zh_CN',
    placeholder: '记录要点、想法、疑问…（Markdown 格式）',
    cache: { enable: false },
    preview: { delay: 150 },
    input: (val) => { note.value.text = val; onNoteInput() },
    after: () => { if (noteVditor) noteVditor.focus() }
  })
}

function onNoteKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault()
    saveNote()
  }
}

function onNoteInput() {
  clearTimeout(noteTimer)
  noteStatus.value = 'saving'
  noteTimer = setTimeout(saveNote, 800)
}

async function saveNote() {
  if (!note.value.id) return
  const content = noteVditor ? noteVditor.getValue() : note.value.text
  note.value.text = content
  const r = await tiku.kbSaveMd(note.value.id, content)
  noteStatus.value = r.ok ? 'saved' : 'err'
  return r.ok
}

async function closeNoteModal() {
  const ok = await saveNote()
  noteModal.value = false
  destroyNoteVditor()
  if (!ok) showToast('笔记保存失败，请重试', 'err')
}

// MD 在线编辑：Vditor 即时渲染模式（IR）——整篇渲染预览，光标所在行显示源码
const editMode = ref(false)
const editText = ref('')
const vditorRef = ref(null)
let vditor = null

function destroyVditor() {
  if (vditor) {
    try { vditor.destroy() } catch (e) { /* 忽略 */ }
    vditor = null
  }
}

// 阅读态点击正文 → 进入编辑（按点击位置比例定位编辑器滚动位置）
// 例外：用户选中了文字（准备高亮）时不进入编辑
async function onMdBodyClick(e) {
  if (editMode.value) return
  const el = e.currentTarget
  if (!el) return
  if (e.target.closest('a, button, img, .vditor-task')) return // 链接/按钮/图片照常交互，不进编辑
  const sel = window.getSelection()
  if (sel && sel.toString().trim()) return // 有选区 = 高亮场景，不进编辑
  const rect = el.getBoundingClientRect()
  const ratio = rect.height > 0 ? Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) : 0
  await startEdit(ratio)
}

async function startEdit(clickRatio = 0) {
  const r = await tiku.kbRead(props.doc.id)
  if (!r.ok) { showToast('读取失败：' + r.error, 'err'); return }
  editText.value = new TextDecoder('utf-8').decode(b64ToUint8(r.base64))
  editMode.value = true
  await nextTick()
  const isDark = document.documentElement.dataset.theme === 'dark'
  vditor = new Vditor(vditorRef.value, {
    mode: 'ir', // 即时渲染：整篇预览，光标行显示源码
    cdn: import.meta.env.DEV ? '/vditor' : './vditor',
    value: editText.value,
    height: '100%',
    theme: isDark ? 'dark' : 'classic',
    lang: 'zh_CN',
    placeholder: '点击正文任意处编辑，光标所在行显示源码，移开即渲染预览',
    cache: { enable: false },
    preview: { delay: 150 },
    input: (val) => { editText.value = val },
    after: () => {
      if (!vditor) return
      vditor.focus()
      // 按点击位置比例定位到编辑器对应区域
      if (clickRatio > 0) {
        const content = vditor.element.querySelector('.vditor-content, .vditor-ir')
        if (content) {
          content.scrollTop = Math.max(0, content.scrollHeight * clickRatio - content.clientHeight / 2)
        }
      }
    }
  })
}

async function saveEdit() {
  const content = vditor ? vditor.getValue() : editText.value
  const r = await tiku.kbSaveMd(props.doc.id, content)
  if (!r.ok) { showToast('保存失败：' + r.error, 'err'); return }
  editMode.value = false
  destroyVditor()
  await renderMd()
}

function cancelEdit() {
  editMode.value = false
  destroyVditor()
}

// 关闭拦截：MD 编辑未保存时先确认，防丢数据；PDF 顺带保存阅读位置；笔记待写内容先落盘
async function onClose() {
  if (note.value.id && noteTimer) { clearTimeout(noteTimer); await saveNote() }
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
  mdErr.value = ''
  tocList.value = []
  pdfState.value = { loading: false, error: '', pages: 0, done: 0 }
  qLinks.value = []
  qSugg.value = []
  mKw.value = ''
  mRes.value = []
  editMode.value = false
  destroyVditor()
  pdfZoom.value = 100 // 换文档重置缩放
  zoomUi.value = false
  clearTimeout(pdfZoomTimer)
  clearTimeout(zoomUiTimer)
  clearTimeout(noteTimer)
  note.value = { id: null, title: '', text: '', loaded: false }
  noteStatus.value = ''
  noteModal.value = false
  destroyNoteVditor()
  detachPdfWheel()
  cleanupPdf()
  if (props.doc.type === 'md') {
    await renderMd()
  } else {
    await renderPdf()
    attachPdfWheel()
  }
  await loadQPanel()
  await loadHlAndLinks()
  if (!isNoteDoc.value) await loadNote() // 笔记文档本身是笔记，不再挂「文档笔记」
  await tiku.kbBumpRead(props.doc.id) // 阅读埋点（计入学习统计）
  celebrate()
  // 监听主题切换：MD 阅读态重渲染跟随深浅主题（Vditor content-theme 需重载）
  if (props.doc.type === 'md' && !themeObserver) {
    themeObserver = new MutationObserver(() => {
      if (props.show && props.doc && props.doc.type === 'md' && !editMode.value) renderMd()
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  }
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
  const seq = ++mdRenderSeq
  const r = await tiku.kbRead(props.doc.id)
  if (!r.ok) { mdErr.value = `读取失败：${r.error}`; return }
  const text = new TextDecoder('utf-8').decode(b64ToUint8(r.base64))
  mdErr.value = ''
  toc = []
  html.value = md.render(text)
  if (seq !== mdRenderSeq) return // 已有更新的渲染请求，丢弃本次结果
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
    pdfState.value.done = 0
    await rebuildPdfAtZoom() // 建占位 + 渲染可见页（懒渲染）
  } catch (e) {
    pdfState.value.error = String((e && e.message) || e)
  } finally {
    pdfState.value.loading = false
  }
}

// 滚动时估算当前页 + 懒渲染新进入视口的页
function onPdfScroll() {
  const container = pdfContainer.value
  if (!container || !pdfDoc) return
  const host = container.parentElement || container
  const top = host.getBoundingClientRect().top + 40
  let cur = 0
  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const el = pageEls[p]
    if (!el) continue
    if (el.getBoundingClientRect().top <= top) cur = p
    else break
  }
  currentPage.value = cur
  // 把可见但未渲染的页加入队列（防抖，避免滚动中疯狂排队）
  clearTimeout(pdfScrollTimer)
  pdfScrollTimer = setTimeout(() => {
    const vis = visiblePages()
    for (const p of vis) {
      if (pdfCache.has(`${p}|${pdfZoom.value}`)) continue
      if (!renderQueue.includes(p)) renderQueue.push(p)
    }
    pumpRenderQueue()
  }, 120)
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
  pdfPageObjs = []
  pageEls = []
  renderQueue = []
  renderBusy = false
  pdfCache.clear()
}

onBeforeUnmount(() => {
  cleanupPdf()
  detachPdfWheel()
  destroyVditor()
  destroyNoteVditor()
  if (themeObserver) { themeObserver.disconnect(); themeObserver = null }
  clearTimeout(mTimer)
  clearTimeout(pdfZoomTimer)
  clearTimeout(pdfScrollTimer)
  clearTimeout(zoomUiTimer)
  clearTimeout(noteTimer)
})
useEsc(() => {
  if (noteModal.value) closeNoteModal()
  else emit('close')
})
</script>

<template>
  <div v-if="show" class="kb-page">
    <!-- 顶部栏 -->
    <div class="kb-head">
      <button class="btn kb-back" @click="onClose">← 返回</button>
      <span class="badge kb-type" :class="props.doc?.type">{{ props.doc?.type === 'pdf' ? 'PDF' : 'MD' }}</span>
      <span class="kb-title">{{ props.doc?.title }}</span>
      <div class="kb-spacer"></div>
      <span v-if="pdfState.pages" class="kb-pdf-prog">{{ currentPage || 1 }}/{{ pdfState.pages }} 页</span>
      <template v-if="props.doc?.type === 'md' && !editMode">
        <button class="btn kb-act" @click="addHlFromSelection">高亮</button>
        <button class="btn kb-act" @click="fontSize = Math.max(11, fontSize - 1)">A-</button>
        <button class="btn kb-act" @click="fontSize = Math.min(20, fontSize + 1)">A+</button>
      </template>
      <template v-if="editMode">
        <button class="btn btn-primary" @click="saveEdit">保存</button>
        <button class="btn" @click="cancelEdit">取消</button>
      </template>
      <button class="btn kb-act kb-side-toggle" :class="{ off: !sidePanelOpen }" :title="sidePanelOpen ? '收起右侧栏（沉浸阅读）' : '展开右侧栏'" @click="sidePanelOpen = !sidePanelOpen">
        <span class="kb-side-toggle-icon">{{ sidePanelOpen ? '⟩' : '⟨' }}</span>
        <span>{{ sidePanelOpen ? '收起侧栏' : '展开侧栏' }}</span>
      </button>
    </div>

    <!-- 主体：左目录 | 中内容 | 右相关题目+批注 -->
    <div class="kb-body" :class="{ 'note-doc': isNoteDoc }">
      <div v-if="!editMode && props.doc?.type === 'md' && tocList.length" class="kb-side-toc">
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

      <div class="kb-main" @scroll.passive="onPdfScroll">
        <div v-if="editMode" class="kb-edit-wrap" ref="vditorRef"></div>
        <template v-else>
          <div v-if="pdfState.error" class="kb-err">
            <p>{{ pdfState.error }}</p>
            <p class="kb-hint">扫描版 PDF 没有文本层无法内嵌预览，可用系统阅读器打开原件</p>
            <button class="btn btn-primary" @click="tiku.kbOpen(props.doc.id)">系统阅读器打开</button>
          </div>
          <div v-if="pdfState.loading" class="empty">PDF 加载中…</div>
          <template v-if="props.doc?.type === 'md'">
            <div v-if="mdErr" class="kb-err">{{ mdErr }}</div>
            <div v-else class="kb-md" :style="{ fontSize: fontSize + 'px' }" v-html="html" @click="onMdBodyClick"></div>
          </template>
          <div v-else ref="pdfContainer" class="kb-pdf"></div>
        </template>
      </div>

      <!-- PDF 缩放浮层：右下角正文上层，Ctrl+滚轮或滑条控制，2.2s 无操作自动隐藏 -->
      <div v-if="props.doc?.type === 'pdf' && !editMode" class="kb-zoom-float" :class="{ hidden: !zoomUi }" @mouseenter="keepZoomUi()" @mouseleave="scheduleZoomHide()">
        <span class="kb-zoom-pct">{{ pdfZoom }}%</span>
        <input
          type="range"
          class="kb-zoom-range"
          :min="PDF_ZOOM_MIN"
          :max="PDF_ZOOM_MAX"
          :step="PDF_ZOOM_STEP"
          :value="pdfZoom"
          @input="onZoomRangeInput"
        />
        <button class="kb-zoom-btn" @click="changePdfZoom(-PDF_ZOOM_STEP)" :disabled="pdfZoom <= PDF_ZOOM_MIN">−</button>
        <button class="kb-zoom-btn" @click="changePdfZoom(PDF_ZOOM_STEP)" :disabled="pdfZoom >= PDF_ZOOM_MAX">＋</button>
        <button class="kb-zoom-btn" v-if="pdfZoom !== 100" @click="changePdfZoom(100 - pdfZoom)">复位</button>
      </div>

      <div class="kb-side-panel" :class="{ collapsed: !sidePanelOpen }">
        <!-- 文档笔记（最常用，放最上面） -->
        <div class="kb-links kb-note-card">
          <div class="kb-links-head" @click="notePanel = !notePanel">
            <span>文档笔记</span>
            <span v-if="noteStatus === 'saving'" class="kb-links-toggle">保存中…</span>
            <span v-else-if="noteStatus === 'saved'" class="kb-links-toggle ok">已保存</span>
            <span v-else-if="noteStatus === 'err'" class="kb-links-toggle err">保存失败</span>
            <span class="kb-links-toggle">{{ notePanel ? '收起' : '展开' }}</span>
          </div>
          <div v-if="notePanel" class="kb-links-body">
            <div class="kb-note-meta">{{ note.title || '文档笔记' }} · Markdown</div>
            <button class="btn btn-primary kb-note-open" @click="openNoteModal">
              <span>打开笔记</span>
            </button>
          </div>
        </div>

        <!-- 相关题目面板 -->
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

        <!-- 批注与关联 -->
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

    <!-- 文档笔记底部 Dock：固定占正文下方区域，Vditor IR 富编辑（与主文档编辑同引擎） -->
    <div v-if="noteModal" class="kb-note-dock">
      <div class="kb-note-dock-head">
        <span class="kb-note-dock-title">{{ note.title }}</span>
        <div class="kb-spacer"></div>
        <span v-if="noteStatus === 'saving'" class="kb-links-toggle">保存中…</span>
        <span v-else-if="noteStatus === 'saved'" class="kb-links-toggle ok">已保存</span>
        <span v-else-if="noteStatus === 'err'" class="kb-links-toggle err">保存失败</span>
        <span class="kb-note-dock-hint">Ctrl+S 保存 · 收起自动保存</span>
        <button class="btn kb-note-min" title="收起（自动保存）" @click="closeNoteModal">收起</button>
      </div>
      <div class="kb-note-dock-body" ref="noteVditorEl"></div>
    </div>
  </div>
</template>

<style scoped>
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
  background: var(--topbar-bg);
  backdrop-filter: blur(10px);
  flex-shrink: 0;
}
.kb-back { padding: 4px 12px; color: var(--muted); }
.kb-back:hover { color: var(--brand); border-color: var(--brand); }
.kb-title { font-size: 15px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kb-spacer { flex: 1; }
.kb-act { padding: 4px 12px; }
.kb-type { text-transform: uppercase; letter-spacing: 1px; }
.kb-type.pdf { background: rgba(232, 95, 61, 0.15); color: #e85f3d; }
.kb-type.md { background: rgba(91, 124, 250, 0.12); color: var(--brand); }
.kb-pdf-prog { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
/* PDF 缩放浮层：右下角正文上层，滑条 + ± 按钮 */
.kb-zoom-float {
  position: fixed;
  right: 28px;
  bottom: 24px;
  z-index: 320;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--card-solid, var(--topbar-bg));
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  opacity: 1;
  transform: translateY(0);
  transition: opacity .22s ease, transform .22s ease;
  pointer-events: auto;
}
.kb-zoom-float.hidden {
  opacity: 0;
  transform: translateY(10px);
  pointer-events: none;
}
.kb-zoom-pct {
  font-size: 12px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  min-width: 44px;
  text-align: center;
  font-weight: 600;
}
.kb-zoom-range {
  width: 140px;
  accent-color: var(--brand);
  cursor: pointer;
}
.kb-zoom-btn {
  font-size: 13px;
  padding: 2px 10px;
  color: var(--text);
  background: var(--input-solid-bg);
  border: 1px solid var(--line);
  border-radius: 8px;
  cursor: pointer;
  line-height: 1.6;
}
.kb-zoom-btn:hover:not(:disabled) { color: var(--brand); border-color: var(--brand); }
.kb-zoom-btn:disabled { opacity: .4; cursor: default; }
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
  overflow: auto;
  padding: 24px 30px 60px;
  scroll-behavior: smooth;
}
.kb-side-panel {
  flex: 0 0 320px;
  min-width: 0;
  border-left: 1px solid var(--line);
  overflow: hidden;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(127, 127, 127, 0.03);
  transition: flex-basis .25s ease, padding .25s ease, border-color .25s ease;
}
.kb-side-panel.collapsed {
  flex: 0 0 0;
  padding: 0;
  border-left-color: transparent;
}
.kb-side-panel.collapsed > * { opacity: 0; pointer-events: none; }
.kb-side-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.kb-side-toggle.off { color: var(--brand); border-color: var(--brand); }
.kb-side-toggle-icon { font-family: Consolas, monospace; font-size: 14px; line-height: 1; }
/* Vditor 即时渲染编辑器：填满内容区，主题色对齐 */
.kb-edit-wrap { height: 100%; min-height: 400px; }
.kb-edit-wrap :deep(.vditor) {
  border-radius: 10px;
  border-color: var(--line);
}
.kb-edit-wrap :deep(.vditor-toolbar) {
  border-radius: 10px 10px 0 0;
  background: var(--card-solid, var(--bg));
  border-bottom-color: var(--line);
}
.kb-edit-wrap :deep(.vditor-toolbar__item button) {
  color: var(--text);
}
.kb-edit-wrap :deep(.vditor-toolbar__item button:hover) {
  background: var(--brand-light);
  color: var(--brand);
}
.kb-edit-wrap :deep(.vditor-content) {
  background: var(--card-solid, var(--bg));
}
.kb-edit-wrap :deep(.vditor-ir) {
  background: var(--card-solid, var(--bg));
  color: var(--text);
}
.kb-edit-wrap :deep(.vditor-ir pre) {
  background: var(--input-solid-bg);
}
.kb-edit-wrap :deep(.vditor-reset) {
  color: var(--text);
}
/* 窄屏：三栏 → 单栏（目录隐藏、右侧板落到底部） */
@media (max-width: 960px) {
  .kb-body { flex-direction: column; }
  .kb-side-toc { display: none; }
  .kb-side-panel { flex: 0 0 auto; border-left: none; border-top: 1px solid var(--line); max-height: 40vh; }
  .kb-side-toggle { display: none; }
  .kb-main { padding: 18px 18px 40px; }
}

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
.kb-pdf { display: flex; flex-direction: column; align-items: center; gap: 12px; overflow-x: auto; padding: 0 6px; }
.kb-pdf-page {
  height: auto;
  border-radius: 4px;
  box-shadow: 0 2px 14px rgba(0, 0, 0, 0.5);
  background: #fff;
  flex-shrink: 0;
}
.kb-pdf-ph {
  border-radius: 4px;
  background:
    linear-gradient(90deg, rgba(127, 127, 127, 0.05) 25%, rgba(127, 127, 127, 0.09) 50%, rgba(127, 127, 127, 0.05) 75%);
  background-size: 300% 100%;
  animation: kb-ph-sweep 1.6s linear infinite;
  flex-shrink: 0;
}
@keyframes kb-ph-sweep {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
.kb-err { color: #e85f3d; text-align: center; padding: 40px 0; }
.kb-hint { font-size: 12px; color: var(--muted); margin-top: 8px; }

.kb-links {
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  background: var(--card);
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
.kb-note-card .kb-links-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.kb-note-meta { font-size: 11px; color: var(--muted); }
.kb-note-open { width: 100%; justify-content: center; }
/* 笔记底部 Dock：固定占正文下方 40% 区域，全宽，实底（Vditor IR 富编辑） */
.kb-note-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 400;
  height: 40vh;
  min-height: 220px;
  background: var(--card-solid, var(--bg));
  border-top: 1px solid var(--line);
  box-shadow: 0 -16px 40px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.kb-note-dock-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
  background: rgba(127, 127, 127, 0.04);
}
.kb-note-dock-title { font-size: 13px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kb-note-dock-hint { font-size: 11px; color: var(--muted); }
.kb-note-min { padding: 4px 14px; color: var(--muted); }
.kb-note-min:hover { color: var(--brand); border-color: var(--brand); }
.kb-note-dock-body { flex: 1; min-height: 0; }
.kb-note-dock-body :deep(.vditor) { border: none; border-radius: 0; }
.kb-note-dock-body :deep(.vditor-toolbar) { border-radius: 0; background: var(--card-solid, var(--bg)); border-bottom-color: var(--line); }
.kb-note-dock-body :deep(.vditor-toolbar__item button) { color: var(--text); }
.kb-note-dock-body :deep(.vditor-toolbar__item button:hover) { background: var(--brand-light); color: var(--brand); }
.kb-note-dock-body :deep(.vditor-content) { background: var(--card-solid, var(--bg)); }
.kb-note-dock-body :deep(.vditor-ir) { background: var(--card-solid, var(--bg)); color: var(--text); }
.kb-note-dock-body :deep(.vditor-reset) { color: var(--text); }
.kb-links-toggle.ok { color: #2ecc71; }
.kb-links-toggle.err { color: #e85f3d; }
/* 笔记文档（标题以「笔记」结尾）：保持正常阅读布局，只隐藏「文档笔记」自指卡片 */
.kb-body.note-doc .kb-note-card { display: none; }
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
