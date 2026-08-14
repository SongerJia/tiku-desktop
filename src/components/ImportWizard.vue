<script setup>
import Icon from './Icon.vue'
import { ref, computed } from 'vue'
import { tiku } from '../api/tiku.js'
import { useEsc } from '../utils/useEsc.js'
import {
  parseCsv, parseMatrix, parseJsonBank,
  buildTemplateCsv, TEMPLATE_HEADER, TYPE_LABEL
} from '../utils/bankParser.js'

const props = defineProps({
  show: Boolean,
  wide: Boolean,
  subjects: { type: Array, default: () => [] }
})
const emit = defineEmits(['close', 'imported'])

const step = ref(1)              // 1 选文件 / 2 预览校验 / 3 结果
const fileName = ref('')
const parsing = ref(false)
const fatal = ref('')
const results = ref([])
const summary = ref({ total: 0, ok: 0, failed: 0, warned: 0 })
const hasSubjectColumn = ref(false)
const dragOver = ref(false)

const targetSubjectId = ref('')
const newSubjectName = ref('')
const duplicateMode = ref('skip') // skip 跳过重复 | update 更新已有 | all 全部新增
const importResult = ref(null)
const importing = ref(false)
const showAllErrors = ref(false)

const okRows = computed(() => results.value.filter(r => r.ok))
const badRows = computed(() => results.value.filter(r => !r.ok))
const warnRows = computed(() => results.value.filter(r => r.ok && r.warnings.length))
const visibleBad = computed(() => showAllErrors.value ? badRows.value : badRows.value.slice(0, 8))

// 没有「科目」列时，必须显式指定目标科目，否则不知道题该放哪
const needTarget = computed(() => !hasSubjectColumn.value)
const targetReady = computed(() =>
  !needTarget.value || !!targetSubjectId.value || !!newSubjectName.value.trim()
)
const canImport = computed(() => okRows.value.length > 0 && targetReady.value && !importing.value)

function reset() {
  step.value = 1
  fileName.value = ''
  fatal.value = ''
  results.value = []
  summary.value = { total: 0, ok: 0, failed: 0, warned: 0 }
  hasSubjectColumn.value = false
  targetSubjectId.value = ''
  newSubjectName.value = ''
  importResult.value = null
  showAllErrors.value = false
}

function close() {
  reset() // 先同步清空状态，再关闭：避免 setTimeout 延迟窗口内快速重开残留上轮状态
  emit('close')
}
useEsc(() => close())

/**
 * Excel 在中文 Windows 上「另存为 CSV」默认是 GBK 而不是 UTF-8，
 * 直接按 UTF-8 解会整片乱码。这里先严格试 UTF-8，失败再回落 GBK。
 */
function decodeText(buffer) {
  const bytes = new Uint8Array(buffer)
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(bytes)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (e) {
    try {
      return new TextDecoder('gbk').decode(bytes)
    } catch (e2) {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
}

function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = () => reject(new Error('文件读取失败'))
    fr.readAsArrayBuffer(file)
  })
}

async function handleFile(file) {
  if (!file) return
  reset()
  fileName.value = file.name
  parsing.value = true
  try {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    const buf = await readAsArrayBuffer(file)
    let parsed

    if (ext === 'xlsx' || ext === 'xls') {
      // Excel 交给主进程解析（Node 侧零依赖 xlsx-lite），渲染层只负责传字节
      const matrix = await tiku.parseSheet(new Uint8Array(buf))
      parsed = parseMatrix(matrix)
    } else if (ext === 'json') {
      parsed = parseJsonBank(decodeText(buf))
      hasSubjectColumn.value = parsed.results.some(r => r.data.subject)
    } else {
      parsed = parseMatrix(parseCsv(decodeText(buf)))
    }

    if (ext !== 'json') {
      hasSubjectColumn.value = !!(parsed.headerMap && parsed.headerMap.subject != null)
    }

    fatal.value = parsed.fatal || ''
    results.value = parsed.results
    summary.value = parsed.summary
    if (!fatal.value) step.value = 2
  } catch (err) {
    fatal.value = err.message || String(err)
  } finally {
    parsing.value = false
  }
}

function onPick(e) {
  handleFile(e.target.files[0])
  e.target.value = ''
}

function onDrop(e) {
  dragOver.value = false
  handleFile(e.dataTransfer.files && e.dataTransfer.files[0])
}

function downloadTemplate() {
  // 注意：buildTemplateCsv() 内部已带 UTF-8 BOM，这里不要再加，否则双 BOM 会让首列表头变成 "\uFEFF科目" 匹配不上
  const blob = new Blob([buildTemplateCsv()], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = '题库导入模板.csv'
  a.click()
  URL.revokeObjectURL(url)
}

async function downloadTemplateXlsx() {
  try {
    const base64 = await tiku.exportExcelTemplate()
    if (!base64) throw new Error('模板生成失败')
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '题库导入模板.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    fatal.value = 'Excel 模板生成失败：' + (err.message || String(err))
  }
}

async function doImport() {
  importing.value = true
  try {
    let subjectId = targetSubjectId.value ? Number(targetSubjectId.value) : null
    if (needTarget.value && !subjectId && newSubjectName.value.trim()) {
      const r = await tiku.addCategory({ name: newSubjectName.value.trim(), parentId: null })
      subjectId = r.id
    }
    const rows = okRows.value.map(r => r.data)
    const res = await tiku.importQuestionBank(rows, {
      defaultSubjectId: subjectId,
      duplicateMode: duplicateMode.value
    })
    importResult.value = res
    step.value = 3
    emit('imported', res)
  } catch (err) {
    fatal.value = '写入失败：' + (err.message || String(err))
  } finally {
    importing.value = false
  }
}

function previewText(r) {
  const d = r.data
  const isEssay = d.type === 'essay'
  const opts = isEssay ? '' : d.options.map(o => `${o.key}.${o.text}`).join('  ')
  const answer = isEssay
    ? (d.keywords && d.keywords.length ? `采分点：${d.keywords.join('；')}` : '问答题（自评）')
    : d.answer.join('')
  return { type: TYPE_LABEL[d.type] || d.type || '?', stem: d.stem, opts, answer, isEssay }
}
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="iw-mask" :class="{ 'is-wide': wide }" @click.self="close">
      <div class="iw-panel" :class="{ 'is-wide': wide }">
        <div class="iw-header">
          <span class="close" @click="close">×</span>
          <span class="title">导入题目</span>
          <span class="stepper">{{ step }}/3</span>
        </div>

        <!-- ============ 步骤 1：选文件 ============ -->
        <div v-if="step === 1" class="iw-body">
          <div
            class="dropzone"
            :class="{ over: dragOver }"
            @dragover.prevent="dragOver = true"
            @dragleave.prevent="dragOver = false"
            @drop.prevent="onDrop"
          >
            <div class="dz-icon">⬆</div>
            <div class="dz-title">把文件拖到这里，或点击选择</div>
            <div class="dz-sub">支持 .xlsx / .xls / .csv / .json</div>
            <label class="btn btn-primary dz-btn">
              选择文件
              <input type="file" accept=".xlsx,.xls,.csv,.json,.txt" hidden @change="onPick" />
            </label>
          </div>

          <div v-if="parsing" class="hint">正在解析 {{ fileName }} …</div>
          <div v-if="fatal" class="alert bad">{{ fatal }}</div>

          <div class="guide">
            <div class="guide-head">
              <span class="sec-title">表格格式</span>
              <div class="guide-actions">
                <button class="btn btn-outline sm" @click="downloadTemplate">下载 CSV 模板</button>
                <button class="btn btn-outline sm" @click="downloadTemplateXlsx">下载 Excel 模板</button>
              </div>
            </div>
            <div class="cols">
              <span v-for="h in TEMPLATE_HEADER" :key="h" class="col-chip">{{ h }}</span>
            </div>
            <ul class="tips">
              <li><b>必填</b>：题干、答案。其余能空则空。</li>
              <li><b>题型</b>：单选 / 多选 / 判断 / 问答（简答、论述、填空、名词解释等主观题都填「问答」；不写也行，会按答案自动推断）。</li>
              <li><b>答案</b>：单选填 <code>A</code>；多选填 <code>ABD</code> 或 <code>A,B,D</code>；判断填 <code>对</code> / <code>错</code>；问答填<b>参考答案全文</b>。</li>
              <li><b>得分关键词</b>（仅问答）：用 <code>；</code>、逗号或换行分隔采分点，作答时会高亮命中情况，辅助你自评对错。</li>
              <li><b>科目/章节</b>：填名称即可，不存在会自动创建；留空则用下一步指定的科目。</li>
              <li>Excel 另存 CSV 的 GBK 编码会自动识别，不用手动转 UTF-8。也可直接导入 .xlsx / .xls。</li>
            </ul>
          </div>
        </div>

        <!-- ============ 步骤 2：预览与校验 ============ -->
        <div v-else-if="step === 2" class="iw-body">
          <div class="file-line">
            <span class="fname">{{ fileName }}</span>
            <button class="btn btn-outline sm" @click="step = 1">换个文件</button>
          </div>

          <div class="stat-row">
            <div class="stat"><b>{{ summary.total }}</b><span>总行数</span></div>
            <div class="stat ok"><b>{{ summary.ok }}</b><span>可导入</span></div>
            <div class="stat warn"><b>{{ summary.warned }}</b><span>有提醒</span></div>
            <div class="stat bad"><b>{{ summary.failed }}</b><span>有错误</span></div>
          </div>

          <div v-if="badRows.length" class="alert bad">
            <div class="alert-title">{{ badRows.length }} 行有问题，将被跳过：</div>
            <div v-for="r in visibleBad" :key="'e' + r.rowNo" class="err-line">
              <span class="rowno">第 {{ r.rowNo }} 行</span>{{ r.errors.join('；') }}
            </div>
            <button
              v-if="badRows.length > 8"
              class="link"
              @click="showAllErrors = !showAllErrors"
            >{{ showAllErrors ? '收起' : `展开全部 ${badRows.length} 条` }}</button>
          </div>

          <div v-if="warnRows.length" class="alert warn">
            <div class="alert-title">{{ warnRows.length }} 行有提醒（仍会导入）：</div>
            <div v-for="r in warnRows.slice(0, 5)" :key="'w' + r.rowNo" class="err-line">
              <span class="rowno">第 {{ r.rowNo }} 行</span>{{ r.warnings.join('；') }}
            </div>
          </div>

          <div v-if="needTarget" class="target-box">
            <div class="sec-title">目标科目<span class="req">必选</span></div>
            <div class="target-desc">文件里没有「科目」列，请指定这批题放到哪个科目下。</div>
            <div class="target-row">
              <select v-model="targetSubjectId" class="input">
                <option value="">选择已有科目…</option>
                <option v-for="s in subjects" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
              <span class="or">或</span>
              <input v-model="newSubjectName" class="input" placeholder="新建科目名称" />
            </div>
          </div>

          <div class="dedupe-line">
            <span class="dd-label">重复处理</span>
            <div class="seg">
              <button :class="{ on: duplicateMode === 'skip' }" @click="duplicateMode = 'skip'">跳过</button>
              <button :class="{ on: duplicateMode === 'update' }" @click="duplicateMode = 'update'">更新</button>
              <button :class="{ on: duplicateMode === 'all' }" @click="duplicateMode = 'all'">全部新增</button>
            </div>
            <span class="dd-hint">{{ { skip: '同章节同题干自动跳过', update: '同题干覆盖更新内容', all: '不去重，全部插入' }[duplicateMode] }}</span>
          </div>

          <div v-if="okRows.length" class="preview">
            <div class="sec-title">预览（前 5 题）</div>
            <div v-for="r in okRows.slice(0, 5)" :key="'p' + r.rowNo" class="pv-item">
              <div class="pv-head">
                <span class="pv-type">{{ previewText(r).type }}</span>
                <span class="pv-stem">{{ previewText(r).stem }}</span>
              </div>
              <div v-if="previewText(r).opts" class="pv-opts">{{ previewText(r).opts }}</div>
              <div class="pv-ans" :class="{ kw: previewText(r).isEssay }">答案：{{ previewText(r).answer }}</div>
            </div>
          </div>

          <div v-if="fatal" class="alert bad">{{ fatal }}</div>

          <div class="iw-footer">
            <button class="btn btn-outline" @click="step = 1">上一步</button>
            <button class="btn btn-primary" :disabled="!canImport" @click="doImport">
              {{ importing ? '导入中…' : `导入 ${okRows.length} 题` }}
            </button>
          </div>
          <div v-if="!targetReady" class="hint">请先指定目标科目</div>
        </div>

        <!-- ============ 步骤 3：结果 ============ -->
        <div v-else class="iw-body result-body">
          <div class="done-icon"><Icon name="check" :size="14"/></div>
          <div class="done-title">导入完成</div>
          <div class="done-stats">
            <div><b>{{ importResult ? importResult.inserted : 0 }}</b> 题已入库</div>
            <div v-if="importResult && importResult.duplicated">
              <b>{{ importResult.duplicated }}</b> 题重复已跳过
            </div>
            <div v-if="importResult && importResult.updated">
              <b>{{ importResult.updated }}</b> 题已更新
            </div>
            <div v-if="summary.failed"><b>{{ summary.failed }}</b> 行有错误未导入</div>
          </div>
          <div class="iw-footer center">
            <button class="btn btn-outline" @click="step = 1">继续导入</button>
            <button class="btn btn-primary" @click="close">完成</button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.iw-mask {
  position: fixed;
  inset: 0;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur));
  z-index: 200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.iw-mask.is-wide { align-items: center; }

.iw-panel {
  width: 100%;
  max-height: 88vh;
  overflow-y: auto;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: var(--radius) var(--radius) 0 0;
  box-shadow: var(--shadow), var(--glow-soft);
}
.iw-panel.is-wide {
  width: 720px;
  max-width: 92vw;
  border-radius: var(--radius);
  max-height: 84vh;
}

.iw-header {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--card-solid);
  z-index: 2;
}
.iw-header .title { flex: 1; font-size: 16px; font-weight: 700; color: var(--text); }
.iw-header .close { font-size: 22px; color: var(--muted); cursor: pointer; line-height: 1; }
.iw-header .close:hover { color: var(--brand); }
.iw-header .stepper { font-size: 12px; color: var(--brand); }

.iw-body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }

/* 拖拽区 */
.dropzone {
  border: 1px dashed var(--line);
  border-radius: var(--radius);
  padding: 26px 16px;
  text-align: center;
  background: color-mix(in srgb, var(--brand) 4%, transparent);
  transition: all 0.18s;
}
.dropzone.over { border-color: var(--brand); box-shadow: var(--glow-soft); background: var(--brand-light); }
.dz-icon { font-size: 26px; color: var(--brand); }
.dz-title { margin-top: 8px; font-size: 14px; color: var(--text); }
.dz-sub { margin-top: 4px; font-size: 12px; color: var(--muted); }
.dz-btn { display: inline-block; margin-top: 12px; cursor: pointer; }

/* 说明 */
.guide { border-top: 1px solid var(--line); padding-top: 12px; }
.guide-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 10px; }
.guide-actions { display: flex; gap: 8px; flex-shrink: 0; }
.sec-title { font-size: 13px; font-weight: 600; color: var(--text); }
.cols { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.col-chip {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 20px;
  border: 1px solid var(--line);
  color: var(--muted);
  background: color-mix(in srgb, var(--brand) 5%, transparent);
}
.tips { margin: 0; padding-left: 18px; color: var(--muted); font-size: 12px; line-height: 1.9; }
.tips code {
  background: color-mix(in srgb, var(--brand) 10%, transparent);
  color: var(--brand);
  padding: 1px 5px;
  border-radius: 4px;
}
.tips b { color: var(--text); }

/* 校验统计 */
.file-line { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.fname { font-size: 13px; color: var(--brand); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.stat {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 10px 6px;
  text-align: center;
  background: color-mix(in srgb, var(--brand) 4%, transparent);
}
.stat b { display: block; font-size: 18px; color: var(--text); }
.stat span { font-size: 11px; color: var(--muted); }
.stat.ok b { color: var(--ok); }
.stat.warn b { color: var(--warn); }
.stat.bad b { color: var(--bad); }

.alert { border-radius: var(--radius-sm); padding: 10px 12px; font-size: 12px; line-height: 1.8; }
.alert.bad { border: 1px solid rgba(255, 77, 109, 0.4); background: rgba(255, 77, 109, 0.08); color: var(--bad-soft); }
.alert.warn { border: 1px solid rgba(255, 180, 84, 0.4); background: rgba(255, 180, 84, 0.08); color: var(--warn-soft); }
.alert-title { font-weight: 600; margin-bottom: 4px; }
.err-line { display: flex; gap: 8px; }
.rowno { flex-shrink: 0; opacity: 0.75; }
.link { background: none; border: none; color: var(--brand); font-size: 12px; cursor: pointer; padding: 4px 0; }

/* 目标科目 */
.target-box { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px; }
.req { color: var(--bad); font-size: 11px; margin-left: 6px; }
.target-desc { font-size: 12px; color: var(--muted); margin: 6px 0 10px; }
.target-row { display: flex; align-items: center; gap: 8px; }
.or { font-size: 12px; color: var(--muted); flex-shrink: 0; }
.input {
  flex: 1;
  min-width: 0;
  background: var(--input-solid-bg);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  color: var(--text);
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
}
.input:focus { border-color: var(--brand); box-shadow: var(--glow-soft); }

.check-line { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); cursor: pointer; }
.check-line input { accent-color: var(--brand); }
.dedupe-line { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
.dd-label { font-weight: 600; color: var(--text); }
.dedupe-line .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.dedupe-line .seg button { border: none; background: transparent; color: var(--muted); padding: 5px 14px; font-size: 12px; cursor: pointer; transition: all .15s; }
.dedupe-line .seg button.on { background: var(--brand); color: #ffffff; font-weight: 600; }
.dd-hint { font-size: 11px; opacity: .85; }

/* 预览 */
.preview { display: flex; flex-direction: column; gap: 8px; }
.pv-item {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 10px;
  background: color-mix(in srgb, var(--brand) 3%, transparent);
}
.pv-head { display: flex; gap: 8px; align-items: baseline; }
.pv-type {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--brand);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 5px;
}
.pv-stem { font-size: 13px; color: var(--text); line-height: 1.6; }
.pv-opts { font-size: 12px; color: var(--muted); margin-top: 6px; line-height: 1.7; }
.pv-ans { font-size: 12px; color: var(--ok); margin-top: 4px; }

.iw-footer { display: flex; gap: 10px; padding-top: 6px; }
.iw-footer.center { justify-content: center; }
.iw-footer .btn { flex: 1; }
.iw-footer.center .btn { flex: 0 0 auto; padding-left: 24px; padding-right: 24px; }
.btn.sm { padding: 5px 12px; font-size: 12px; }
.btn[disabled] { opacity: 0.45; cursor: not-allowed; }
.hint { font-size: 12px; color: var(--muted); text-align: center; }

/* 结果页 */
.result-body { align-items: center; text-align: center; padding: 34px 16px; }
.done-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 1px solid var(--ok);
  color: var(--ok);
  font-size: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 18px color-mix(in srgb, var(--ok) 35%, transparent);
}
.done-title { font-size: 17px; font-weight: 700; color: var(--text); }
.done-stats { font-size: 13px; color: var(--muted); line-height: 2; }
.done-stats b { color: var(--brand); font-size: 15px; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.18s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
