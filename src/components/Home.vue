<script setup>
import { ref, onMounted, watch } from 'vue'
import { tiku } from '../api/tiku.js'

const props = defineProps({ subject: Object })
const emit = defineEmits(['start'])

const summary = ref({ total: 0, learned: 0, mastered: 0, today: 0, wrongCount: 0 })
const loading = ref(true)

onMounted(load)
watch(() => props.subject.id, load)

async function load() {
  loading.value = true
  summary.value = await tiku.getSummary()
  loading.value = false
}
</script>

<template>
  <div class="home">
    <!-- 欢迎卡片 -->
    <div class="card welcome">
      <div class="welcome-text">
        <div class="subtitle">基于艾宾浩斯记忆曲线，科学记忆，高效备考</div>
        <h1>欢迎来到<br>知识记忆小助手</h1>
        <button class="btn btn-primary" @click="$emit('start', { mode: 'practice' })">立即开始</button>
      </div>
      <div class="welcome-illustration">
        <svg viewBox="0 0 120 100" width="110" height="92">
          <rect x="10" y="40" width="70" height="50" rx="8" fill="#0a1a26" stroke="#1c6f7d" stroke-width="1.5" />
          <rect x="25" y="25" width="70" height="50" rx="8" fill="#150f33" stroke="#7b46c4" stroke-width="1.5" />
          <rect x="40" y="10" width="70" height="50" rx="8" fill="#0c2230" stroke="#2af5ff" stroke-width="2" />
          <circle cx="95" cy="25" r="14" fill="none" stroke="#2af5ff" stroke-width="1.5" opacity="0.7" />
          <path d="M95 11 L98 21 L108 21 L100 27 L103 37 L95 31 L87 37 L90 27 L82 21 L92 21 Z" fill="#2af5ff" />
        </svg>
      </div>
    </div>

    <!-- 总数卡片 -->
    <div class="card stat-card">
      <div class="stat-title">知识卡片总数</div>
      <div class="stat-number">
        <span class="num">{{ summary.total }}</span>
        <span class="unit">张</span>
      </div>
    </div>

    <!-- 快捷入口 -->
    <div class="card shortcuts">
      <div class="card-title">知识卡片预览</div>
      <div class="shortcut-grid">
        <div class="shortcut" @click="$emit('start', { mode: 'wrong' })">
          <div class="s-icon wrong">✗</div>
          <div class="s-label">错题本</div>
          <div class="s-count">{{ summary.wrongCount }} 题</div>
        </div>
        <div class="shortcut" @click="$emit('start', { mode: 'favorite' })">
          <div class="s-icon fav">★</div>
          <div class="s-label">我的收藏</div>
          <div class="s-count">去复习</div>
        </div>
        <div class="shortcut" @click="$emit('start', { mode: 'practice' })">
          <div class="s-icon all">📚</div>
          <div class="s-label">全部刷题</div>
          <div class="s-count">{{ summary.total }} 题</div>
        </div>
        <div class="shortcut no-click">
          <div class="s-icon today">📅</div>
          <div class="s-label">今日已刷</div>
          <div class="s-count">{{ summary.today }} 题</div>
        </div>
      </div>
    </div>

    <div v-if="loading" class="empty">加载中…</div>
  </div>
</template>

<style scoped>
.welcome {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background:
    radial-gradient(circle at 90% 15%, rgba(176, 107, 255, 0.20), transparent 60%),
    linear-gradient(135deg, rgba(42, 245, 255, 0.10), rgba(176, 107, 255, 0.06));
  border-color: rgba(42, 245, 255, 0.30);
  box-shadow: var(--glow-soft), var(--shadow);
}
.welcome-text { flex: 1; }
.welcome-text h1 { font-size: 22px; line-height: 1.3; margin: 8px 0 14px 0; color: var(--text); text-shadow: var(--glow-soft); }
.welcome-text .subtitle { font-size: 12px; color: var(--muted); }
.welcome-illustration { flex-shrink: 0; filter: drop-shadow(0 0 8px rgba(42, 245, 255, 0.35)); }

.stat-card { display: flex; flex-direction: column; gap: 8px; }
.stat-title { font-size: 15px; font-weight: 600; color: var(--text); }
.stat-number { display: flex; align-items: baseline; gap: 6px; }
.stat-number .num { font-size: 40px; font-weight: 700; color: var(--brand); line-height: 1; text-shadow: var(--glow); }
.stat-number .unit { font-size: 14px; color: var(--muted); }

.shortcuts .shortcut-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.shortcut {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 4px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: all .2s;
}
.shortcut:hover { background: var(--brand-light); border-color: var(--brand); box-shadow: var(--glow-soft); }
.s-icon {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: #021018;
}
.s-icon.wrong { background: var(--bad); box-shadow: 0 0 10px rgba(255, 77, 109, 0.55); }
.s-icon.fav { background: var(--warn); box-shadow: 0 0 10px rgba(255, 180, 84, 0.55); }
.s-icon.all { background: var(--brand); box-shadow: var(--glow); }
.s-icon.today { background: var(--ok); box-shadow: 0 0 10px rgba(44, 229, 168, 0.55); }
.s-label { font-size: 12px; color: var(--text); }
.s-count { font-size: 11px; color: var(--muted); }
.shortcut.no-click { cursor: default; }
.shortcut.no-click:hover { background: rgba(255, 255, 255, 0.02); border-color: var(--line); box-shadow: none; }
</style>
