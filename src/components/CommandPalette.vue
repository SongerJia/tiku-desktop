<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({ show: Boolean })
const emit = defineEmits(['close', 'command'])

const query = ref('')
const activeIndex = ref(0)
const inputEl = ref(null)

// 静态命令：导航 + 快捷动作
const baseCommands = [
  { id: 'tab-home', label: '前往 · 首页', icon: 'home', group: '导航', run: () => emit('command', { type: 'tab', key: 'home' }) },
  { id: 'tab-bank', label: '前往 · 题库', icon: 'book', group: '导航', run: () => emit('command', { type: 'tab', key: 'bank' }) },
  { id: 'tab-kb', label: '前往 · 知识库', icon: 'doc', group: '导航', run: () => emit('command', { type: 'tab', key: 'kb' }) },
  { id: 'tab-stats', label: '前往 · 学习统计', icon: 'chart', group: '导航', run: () => emit('command', { type: 'tab', key: 'stats' }) },
  { id: 'tab-profile', label: '前往 · 我的', icon: 'user', group: '导航', run: () => emit('command', { type: 'tab', key: 'profile' }) },
  { id: 'act-practice', label: '开始练习（全部）', icon: 'play', group: '动作', run: () => emit('command', { type: 'start', mode: 'practice' }) },
  { id: 'act-wrong', label: '错题复习', icon: 'target', group: '动作', run: () => emit('command', { type: 'start', mode: 'review-due' }) },
  { id: 'act-fav', label: '收藏题练习', icon: 'star', group: '动作', run: () => emit('command', { type: 'start', mode: 'favorite' }) },
  { id: 'act-import', label: '打开题库管理（导入/录题）', icon: 'book', group: '动作', run: () => emit('command', { type: 'action', name: 'open-bank' }) },
  { id: 'act-sync', label: '前往云同步', icon: 'sync', group: '动作', run: () => emit('command', { type: 'tab', key: 'profile' }) }
]

const commands = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = baseCommands.filter(c => !q || c.label.toLowerCase().includes(q))
  // 输入非空时，追加一个「搜索题目」动态命令
  if (query.value.trim()) {
    list.unshift({
      id: 'search-q',
      label: '在题库中搜索：' + query.value.trim(),
      icon: 'search',
      group: '搜索',
      run: () => emit('command', { type: 'search', text: query.value.trim() })
    })
  }
  return list
})

watch(() => props.show, (v) => {
  if (v) {
    query.value = ''
    activeIndex.value = 0
    nextTick(() => inputEl.value && inputEl.value.focus())
  }
})
watch(commands, () => { activeIndex.value = 0 })

function onInput() { activeIndex.value = 0 }
function move(delta) {
  const n = commands.value.length
  if (!n) return
  activeIndex.value = (activeIndex.value + delta + n) % n
}
function choose(cmd) {
  if (!cmd) return
  cmd.run()
  emit('close')
}
function onKey(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
  else if (e.key === 'Enter') { e.preventDefault(); choose(commands.value[activeIndex.value]) }
  else if (e.key === 'Escape') { e.preventDefault(); emit('close') }
}
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="cp-mask" @click.self="emit('close')">
      <div class="cp-panel" @keydown="onKey">
        <div class="cp-input-row">
          <Icon name="search" :size="16" />
          <input
            ref="inputEl"
            v-model="query"
            class="cp-input"
            placeholder="输入命令或搜索题目…（↑↓ 选择，Enter 执行，Esc 关闭）"
            @input="onInput"
          />
        </div>
        <div class="cp-list">
          <div
            v-for="(c, i) in commands"
            :key="c.id"
            class="cp-item"
            :class="{ active: i === activeIndex }"
            @mouseenter="activeIndex = i"
            @click="choose(c)"
          >
            <Icon :name="c.icon" :size="15" />
            <span class="cp-label">{{ c.label }}</span>
            <span class="cp-group">{{ c.group }}</span>
          </div>
          <div v-if="!commands.length" class="cp-empty">无匹配命令</div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.cp-mask {
  position: fixed; inset: 0; z-index: 320;
  background: var(--modal-mask);
  backdrop-filter: blur(var(--modal-blur));
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 12vh;
}
.cp-panel {
  width: 560px; max-width: 92vw;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow), var(--glow-soft);
  overflow: hidden;
}
.cp-input-row {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
}
.cp-input {
  flex: 1; background: none; border: none; outline: none;
  color: var(--text); font-size: 14px; font-family: inherit;
}
.cp-list { max-height: 50vh; overflow-y: auto; padding: 6px; }
.cp-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: var(--radius-sm);
  color: var(--text); font-size: 13px; cursor: pointer;
}
.cp-item.active { background: var(--brand-light); box-shadow: var(--glow-soft); }
.cp-label { flex: 1; }
.cp-group { font-size: 10px; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 1px 6px; }
.cp-empty { padding: 18px; text-align: center; color: var(--muted); font-size: 13px; }
.fade-enter-active, .fade-leave-active { transition: opacity .16s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
