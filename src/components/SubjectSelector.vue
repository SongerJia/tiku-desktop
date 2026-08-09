<script setup>
import Icon from './Icon.vue'
import { ref, onMounted, watch } from 'vue'
import { tiku } from '../api/tiku.js'
import { useEsc } from '../utils/useEsc.js'

const props = defineProps({ show: Boolean, currentId: [Number, String], wide: Boolean })
const emit = defineEmits(['update:show', 'select', 'close'])

const tree = ref([])
const selectedId = ref(props.currentId)
const expanded = ref(new Set())

onMounted(load)
watch(() => props.show, (v) => { if (v) { load(); selectedId.value = props.currentId } })

async function load() {
  tree.value = await tiku.getCategories()
}

// 左侧箭头：仅控制展开/收起，不触发选中
function toggle(node) {
  if (!node.children || !node.children.length) return
  if (expanded.value.has(node.id)) expanded.value.delete(node.id)
  else expanded.value.add(node.id)
  expanded.value = new Set(expanded.value)
}

// 点击行：选中任意节点（科目 / 章节 / 子章节均可）
function select(node) {
  selectedId.value = node.id
}

function confirm() {
  if (!selectedId.value) return
  const node = findNode(tree.value, selectedId.value)
  if (node) emit('select', { id: node.id, name: node.name })
  emit('update:show', false)
}

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.children) {
      const found = findNode(n.children, id)
      if (found) return found
    }
  }
  return null
}

function isExpanded(node) {
  return expanded.value.has(node.id)
}
useEsc(() => emit('close'))
</script>

<template>
  <transition name="fade">
    <div v-if="show" class="selector-mask" :class="{ 'is-wide': wide }" @click.self="$emit('update:show', false)">
      <div class="selector-panel" :class="{ 'is-wide': wide }">
        <div class="selector-header">
          <span class="close" @click="$emit('update:show', false)">×</span>
          <span class="title">选择科目</span>
          <span class="placeholder"></span>
        </div>

        <div class="selector-tip">点击科目或章节即可选中，左侧 ▸ 可展开下级</div>

        <div class="selector-body">
          <div v-if="!tree.length" class="empty">暂无科目</div>
          <ul class="tree">
            <li v-for="node in tree" :key="node.id">
              <div
                class="tree-row"
                :class="{ selected: selectedId === node.id }"
                @click="select(node)"
              >
                <span class="toggle" @click.stop="toggle(node)">{{ node.children && node.children.length ? (isExpanded(node) ? '−' : '+') : '' }}</span>
                <span class="name">{{ node.name }}</span>
                <span v-if="selectedId === node.id" class="check"><Icon name="check" :size="16"/></span>
              </div>
              <ul v-if="node.children && node.children.length && isExpanded(node)" class="sub-tree">
                <li v-for="sub in node.children" :key="sub.id">
                  <div
                    class="tree-row sub"
                    :class="{ selected: selectedId === sub.id }"
                    @click="select(sub)"
                  >
                    <span class="toggle" @click.stop="toggle(sub)">{{ sub.children && sub.children.length ? (isExpanded(sub) ? '−' : '+') : '' }}</span>
                    <span class="name">{{ sub.name }}</span>
                    <span v-if="selectedId === sub.id" class="check"><Icon name="check" :size="16"/></span>
                  </div>
                  <ul v-if="sub.children && sub.children.length && isExpanded(sub)" class="sub-tree">
                    <li v-for="leaf in sub.children" :key="leaf.id">
                      <div
                        class="tree-row leaf-row"
                        :class="{ selected: selectedId === leaf.id }"
                        @click="select(leaf)"
                      >
                        <span class="name leaf-name">{{ leaf.name }}</span>
                        <span v-if="selectedId === leaf.id" class="check"><Icon name="check" :size="16"/></span>
                      </div>
                    </li>
                  </ul>
                </li>
              </ul>
            </li>
          </ul>
        </div>

        <div class="selector-footer">
          <button
            class="btn btn-block"
            :class="selectedId ? 'btn-primary' : 'btn-disabled'"
            :disabled="!selectedId"
            @click="confirm"
          >确认选择</button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.selector-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 200;
  display: flex;
  align-items: flex-end;
}
.selector-panel {
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
  height: 80%;
  background: var(--card-solid);
  border: 1px solid var(--line);
  border-radius: 20px 20px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow);
}
/* PC 端：底部抽屉改为居中模态框 */
.selector-mask.is-wide {
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.selector-panel.is-wide {
  width: 460px;
  max-width: 92vw;
  height: auto;
  max-height: 84vh;
  margin: 0;
  border-radius: 16px;
}
.selector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}
.selector-header .close { font-size: 24px; color: var(--muted); cursor: pointer; width: 32px; }
.selector-header .title { font-size: 17px; font-weight: 600; }
.selector-header .placeholder { width: 32px; }

.selector-tip {
  padding: 8px 16px 0;
  font-size: 12px;
  color: var(--muted);
}

.selector-body { flex: 1; overflow-y: auto; padding: 6px 16px 10px; }
.tree, .sub-tree { list-style: none; margin: 0; padding: 0; }
.sub-tree { padding-left: 18px; }
.tree-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 15px;
  transition: background .15s;
}
.tree-row:hover { background: rgba(255, 255, 255, 0.05); }
.tree-row.selected {
  background: var(--brand-light);
  color: var(--brand);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px var(--brand);
}
.tree-row.leaf-row { padding-left: 28px; }
.tree-row .toggle {
  width: 20px;
  text-align: center;
  color: var(--muted);
  font-size: 16px;
  flex-shrink: 0;
}
.tree-row .toggle:empty { cursor: default; }
.tree-row .name { flex: 1; }
.tree-row .name.leaf-name { font-size: 14px; }
.tree-row .check { font-weight: 700; color: var(--brand); text-shadow: var(--glow-soft); }

.selector-footer {
  padding: 12px 16px 28px;
  border-top: 1px solid var(--line);
}
.btn-disabled {
  background: rgba(255, 255, 255, 0.08);
  color: var(--muted);
  cursor: not-allowed;
  border: 1px solid var(--line);
}

.fade-enter-active, .fade-leave-active { transition: opacity .25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
