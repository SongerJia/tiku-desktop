<script setup>
import { ref, computed, watch } from 'vue'
import { useBodyLock } from '../composables/useBodyLock.js'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import EmptyState from './EmptyState.vue'
import { tiku } from '../api/tiku.js'
import { showToast } from '../utils/toast.js'
import { showConfirm } from '../utils/confirm.js'
import { useEsc } from '../utils/useEsc.js'
import Icon from './Icon.vue'
import { speakText, detectSubjectLang } from '../utils/speech.js'

const props = defineProps({ show: Boolean, subject: { type: Object, default: () => ({ id: null, name: '' }) } })
useBodyLock(() => props.show)
useFocusTrap(() => props.show, '.mask > .panel')
const emit = defineEmits(['close', 'updated', 'manage'])

// 发音：按科目名识别语言（英语→en-US，日语→ja-JP，其他科目不显示发音）
const subjLang = computed(() => detectSubjectLang(props.subject && props.subject.name))
// 复习时翻到正面自动发音（会话内记忆到 localStorage）
const autoSpeak = ref(localStorage.getItem('card_autospeak') !== '0')
function toggleAutoSpeak() { localStorage.setItem('card_autospeak', autoSpeak.value ? '1' : '0') }
function speak(text) { if (subjLang.value && text) speakText(text, 1, subjLang.value) }

const cards = ref([])
const stats = ref({ total: 0, due: 0 })
const loading = ref(true)
// 记忆卡范围：默认跟随顶部科目，点角标切「全部科目」（未分类卡只在全部视图出现）
const scope = ref('current')
const filterSubjectId = computed(() => scope.value === 'all' ? undefined : props.subject.id || undefined)
const isAll = computed(() => scope.value === 'all' || !props.subject.id)

// 管理模式：列表 / 复习
const mode = ref('list')
const reviewItems = ref([])
const rIdx = ref(0)
const flipped = ref(false)
const rDone = ref(0)

// 添加/编辑表单（subjectId 供编辑保留原科目，新建默认当前科目）
const form = ref({ id: null, front: '', back: '', category: '', subjectId: null })

const dueCount = computed(() => stats.value.due)

// 记忆状态徽标（E-1）：按复习次数/遗忘次数分级
function cardBadge(c) {
  if (c.lapses >= 2 && (c.review_count || 0) < 5) return { cls: 'warn', text: `易忘 · 忘过 ${c.lapses} 次` }
  if ((c.review_count || 0) >= 5) return { cls: 'ok', text: `稳定 · 记过 ${c.review_count} 次` }
  if ((c.review_count || 0) >= 1) return { cls: 'mid', text: `复习中 · ${c.review_count} 次` }
  return { cls: 'new', text: '新卡' }
}

async function load() {
  loading.value = true
  try {
    const [list, s] = await Promise.all([tiku.listCards({ subjectId: filterSubjectId.value }), tiku.cardsStats({ subjectId: filterSubjectId.value })])
    cards.value = list
    stats.value = s
  } catch (e) { /* 加载失败不转圈 */ }
  loading.value = false
}

function startAdd() { form.value = { id: null, front: '', back: '', category: '', subjectId: null } }

function editCard(c) {
  form.value = { id: c.id, front: c.front, back: c.back, category: c.category || '', subjectId: c.subject_id ?? null }
}
function cancelEdit() { form.value = { id: null, front: '', back: '', category: '', subjectId: null } }

async function saveCard() {
  const f = form.value.front.trim()
  const b = form.value.back.trim()
  if (!f || !b) { showToast('正面和背面都不能为空'); return }
  if (!form.value.id) return // 首页只做编辑，新建走管理弹窗
  // 编辑保留原科目归属
  const sid = form.value.subjectId ?? props.subject.id
  await tiku.updateCard(form.value.id, f, b, form.value.category.trim(), sid)
  cancelEdit()
  await load()
  emit('updated') // 增改卡后通知首页刷新「记忆卡到期」角标
}

async function removeCard(c) {
  const ok = await showConfirm(`删除卡片「${c.front}」？复习记录一并清除。`)
  if (!ok) return
  await tiku.deleteCard(c.id)
  await load()
  emit('updated') // 删卡后同样通知（此前只在复习完成时发）
}

// ---- 复习模式 ----
async function startReview() {
  try {
    reviewItems.value = await tiku.getCardReview(10, filterSubjectId.value)
  } catch (e) { reviewItems.value = [] }
  if (!reviewItems.value.length) { showToast('还没有卡片，先添加几张吧'); return }
  rIdx.value = 0
  rDone.value = 0
  flipped.value = false
  mode.value = 'review'
  // 翻到正面自动发音（仅语言类科目；首卡立即读）
  if (autoSpeak.value && subjLang.value && cur.value) speak(cur.value.front)
}

// 翻面：翻回正面时若开启自动发音则朗读正面
function flipCard() {
  flipped.value = !flipped.value
  if (!flipped.value && autoSpeak.value && subjLang.value && cur.value) speak(cur.value.front)
}

const cur = computed(() => reviewItems.value[rIdx.value] || null)
let marking = false // 防双击：await rateCard 窗口内重复评级跳卡

async function mark(felt) {
  if (!cur.value || marking) return
  marking = true
  try {
    await tiku.rateCard(cur.value.id, felt ? 1 : 0)
  } finally {
    marking = false
  }
  rDone.value++
  flipped.value = false
  if (rIdx.value + 1 >= reviewItems.value.length) {
    await finishReview()
  } else {
    rIdx.value++
    // 下一张卡自动朗读正面（仅语言类科目 + 开启自动发音）
    if (autoSpeak.value && subjLang.value && cur.value) speak(cur.value.front)
  }
}

async function finishReview() {
  mode.value = 'list'
  await load()
  emit('updated') // 通知首页刷新「记忆卡到期」角标（此前只刷面板内部，首页 stale）
  showToast(`本轮复习完成，共 ${reviewItems.value.length} 张`, 'ok')
}

useEsc(() => emit('close'))
watch(() => props.show, (v) => {
  if (v) {
    mode.value = 'list' // 重开面板回到列表，清掉残留复习态
    startAdd()
    load()
  }
})
watch(() => props.subject.id, () => { if (props.show && scope.value === 'current') load() })
watch(scope, () => { if (props.show) load() })
</script>

<template>
  <div v-if="show" class="mask" @click.self="emit('close')">
    <div class="panel">
      <!-- 头部 -->
      <div class="head">
        <span class="title">记忆卡</span>
        <span
          class="card-scope"
          :class="{ all: isAll }"
          @click="scope = scope === 'all' ? 'current' : 'all'"
          :title="isAll ? '点击切回当前科目' : '点击查看全部科目卡片'"
        >{{ isAll ? '全部科目' : (props.subject.name || '当前科目') }}<template v-if="mode === 'list'"> · {{ stats.total }} 张</template></span>
        <span class="stats" v-if="mode === 'list'">今日到期 {{ dueCount }}</span>
        <div class="spacer"></div>
        <button v-if="mode === 'list' && stats.total" class="btn btn-primary review-btn" @click="startReview">
          <Icon name="refresh" :size="13" /> 开始复习<template v-if="dueCount">（{{ dueCount }}）</template>
        </button>
        <button class="btn close-btn" @click="emit('close')">关闭</button>
      </div>

      <!-- 列表模式 -->
      <div v-if="mode === 'list'" class="body">
        <!-- 添加/导入已移到「我的 → 记忆卡管理」，此处只做复习与浏览 -->
        <div class="manage-hint" @click="emit('manage')">
          <Icon name="bookmark" :size="13" /> 添加 / 批量导入请到「我的 → 记忆卡管理」
        </div>

        <EmptyState v-if="!cards.length" icon="bookmark" text="还没有卡片" sub="到「我的 → 记忆卡管理」添加或批量导入；也可从错题/题目一键生成；复习按遗忘曲线自动安排（记住 3 天再见 / 忘记明天再来）" />

        <div v-else class="card-list">
          <div v-for="c in cards" :key="c.id" class="card-item">
            <div class="card-main">
              <div class="card-front">{{ c.front }}</div>
              <div class="card-back">{{ c.back }}</div>
            </div>
            <div class="card-meta">
              <span class="mem-badge" :class="cardBadge(c).cls">{{ cardBadge(c).text }}</span>
              <span v-if="!c.subject_id && isAll" class="cat-badge uncat">未分类</span>
              <span v-if="c.source_question_id" class="cat-badge src">来自题目</span>
              <span v-if="c.category_name" class="cat-badge">{{ c.category_name }}</span>
              <span v-else-if="c.category" class="cat-badge">{{ c.category }}</span>
              <span class="state" :class="{ due: c.due }">
                {{ c.due ? '待复习' : (c.review_count ? '已安排' : '新卡') }}{{ c.review_count ? ' · 记过 ' + c.review_count + ' 次' : '' }}{{ c.lapses ? ' · 忘过 ' + c.lapses + ' 次' : '' }}
              </span>
            </div>
            <div class="card-actions">
              <button class="act" @click="editCard(c)">编辑</button>
              <button class="act del" @click="removeCard(c)">删除</button>
            </div>
            <!-- 行内编辑表单 -->
            <div v-if="form.id === c.id" class="inline-form" @click.stop>
              <input v-model="form.front" class="input" placeholder="正面（问题 / 考点）" @keyup.enter="saveCard" />
              <input v-model="form.back" class="input" placeholder="背面（答案 / 解析）" @keyup.enter="saveCard" />
              <input v-model="form.category" class="input cat-input" placeholder="分类（如：施工许可）" @keyup.enter="saveCard" />
              <div class="inline-actions">
                <button class="btn btn-primary sm" @click="saveCard">保存</button>
                <button class="btn sm" @click="cancelEdit">取消</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 复习模式 -->
      <div v-else class="body review-body">
        <div class="rv-progress">第 {{ rIdx + 1 }} / {{ reviewItems.length }} 张 · 已完成 {{ rDone }} 张</div>
        <div class="card" :class="{ flipped }" @click="flipCard">
          <div class="face front">
            <span class="face-label">正面</span>
            <span class="face-text">{{ cur.front }}</span>
            <span class="face-hint">点击卡片翻面</span>
            <button v-if="subjLang" class="speak-btn" title="朗读正面" @click.stop="speak(cur.front)"><Icon name="volume" :size="14" /></button>
          </div>
          <div class="face back">
            <span class="face-label">背面</span>
            <span class="face-text">{{ cur.back }}</span>
            <span class="face-hint">还记得吗？</span>
            <button v-if="subjLang" class="speak-btn" title="朗读背面" @click.stop="speak(cur.back)"><Icon name="volume" :size="14" /></button>
          </div>
        </div>
        <label v-if="subjLang" class="autospeak" title="翻到正面时自动朗读">
          <input type="checkbox" v-model="autoSpeak" @change="toggleAutoSpeak" /> 自动朗读正面
        </label>
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
  flex-wrap: wrap;
}
.card-item:hover { border-color: color-mix(in srgb, var(--brand) 35%, transparent); }
.card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.card-front { font-size: 14px; font-weight: 600; color: var(--text); }
.card-back { font-size: 13px; color: var(--muted); }
.card-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
/* 记忆状态徽标（E-1） */
.mem-badge { font-size: 10px; padding: 1px 8px; border-radius: 999px; white-space: nowrap; }
.mem-badge.ok { background: rgba(47, 191, 143, 0.12); border: 1px solid rgba(47, 191, 143, 0.45); color: var(--ok-soft); }
.mem-badge.mid { background: color-mix(in srgb, var(--brand) 15%, transparent); border: 1px solid color-mix(in srgb, var(--brand) 50%, transparent); color: var(--brand-soft); }
.mem-badge.warn { background: rgba(217, 154, 61, 0.12); border: 1px solid rgba(217, 154, 61, 0.45); color: var(--warn-soft); }
.mem-badge.new { background: rgba(148, 163, 184, 0.12); border: 1px solid rgba(148, 163, 184, 0.35); color: var(--muted); }
.cat-badge { font-size: 10px; color: var(--brand); border: 1px solid color-mix(in srgb, var(--brand) 35%, transparent); border-radius: 5px; padding: 0 6px; font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif; }
.cat-badge.uncat { color: var(--muted); border-color: var(--line); }
/* 管理入口提示（添加/导入已移到我的页） */
.manage-hint {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--brand);
  border: 1px dashed color-mix(in srgb, var(--brand) 45%, transparent);
  border-radius: 8px; padding: 8px 12px; cursor: pointer; user-select: none;
  background: color-mix(in srgb, var(--brand) 4%, transparent);
  transition: all .15s;
}
.manage-hint:hover { background: color-mix(in srgb, var(--brand) 10%, transparent); }
/* 行内编辑表单 */
.inline-form {
  display: flex; flex-direction: column; gap: 6px;
  margin-top: 8px; padding-top: 8px;
  border-top: 1px dashed var(--line);
  width: 100%;
}
.inline-form .input { padding: 6px 10px; font-size: 12px; }
.inline-actions { display: flex; gap: 8px; }
/* 记忆卡范围角标（点击切换全部/当前科目） */
.card-scope {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; color: var(--brand); border: 1px dashed color-mix(in srgb, var(--brand) 40%, transparent);
  border-radius: 999px; padding: 2px 10px; cursor: pointer; user-select: none; transition: all .15s;
}
.card-scope:hover { background: color-mix(in srgb, var(--brand) 8%, transparent); }
.card-scope.all { color: var(--muted); border-color: var(--line); }
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
.card:hover { border-color: color-mix(in srgb, var(--brand) 40%, transparent); transform: translateY(-2px); }
.face { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 28px 20px; text-align: center; position: relative; }
.face-label { font-size: 11px; color: var(--muted); letter-spacing: 2px; }
.face-text { font-size: 22px; font-weight: 700; color: var(--text); word-break: break-word; }
.face-hint { font-size: 11px; color: var(--muted); opacity: .7; }
/* 翻转：默认显示正面，flipped 时切背面（隐藏另一面避免两按钮重叠） */
.card.flipped .face.front { display: none; }
.card:not(.flipped) .face.back { display: none; }
.mark-row { display: flex; gap: 12px; width: 100%; max-width: 480px; }
.mark-btn {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 11px; border-radius: 10px; border: 1px solid var(--line);
  background: transparent; color: var(--text); font-size: 13px; cursor: pointer; transition: all .15s;
}
.mark-btn.no:hover { border-color: var(--bad); color: var(--bad); background: rgba(229, 83, 95, 0.08); }
.mark-btn.yes:hover { border-color: var(--ok); color: var(--ok); background: rgba(47, 191, 143, 0.08); }
.mark-hint { font-size: 12px; color: var(--muted); }
.autospeak { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); cursor: pointer; user-select: none; margin-top: 4px; }
.autospeak input { accent-color: var(--brand); }
.speak-btn {
  position: absolute; top: 12px; right: 12px;
  background: none; border: 1px solid var(--line); border-radius: 999px;
  color: var(--muted); width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all .15s;
}
.speak-btn:hover { color: var(--brand); border-color: var(--brand); background: color-mix(in srgb, var(--brand) 8%, transparent); }
.empty { text-align: center; color: var(--muted); font-size: 13px; line-height: 1.8; padding: 20px 0; }

/* 次级组件铺开（2026-08-12）：卡片行 hover 渐变底 */
.card-item { transition: background .15s ease, border-color .15s ease, box-shadow .15s ease; }
.card-item:hover { background: linear-gradient(135deg, color-mix(in srgb, var(--brand) 6%, transparent), color-mix(in srgb, var(--brand2) 3%, transparent)); box-shadow: var(--glow-soft); }

</style>