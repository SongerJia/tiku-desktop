<script setup>
// 成就解锁全屏爆光（2026-08-14）：粒子爆发 + 光环扩散 + 勋章 3D 飞入 + 成就名渐显
// 由 celebrate.js 在解锁新成就时调用 window.__achBurst({ name, desc, icon })
import { ref, onMounted, onBeforeUnmount } from 'vue'

const show = ref(false)
const payload = ref({ name: '', desc: '' })
let timer = null

// 粒子样式：径向随机分布（每粒随机角度/距离/色/尺寸/时长）
const PART_COLORS = ['#5b7cfa', '#8b5cf6', '#ffd76a', '#4fd1a5', '#fb7185']
function partStyle(i) {
  const ang = (i / 28) * Math.PI * 2 + Math.random() * 0.5
  const dist = 90 + Math.random() * 110
  const size = 3 + Math.random() * 4
  return {
    '--pa': ang.toFixed(3) + 'rad',
    '--pd': dist.toFixed(0) + 'px',
    '--pc': PART_COLORS[i % PART_COLORS.length],
    '--ps': size.toFixed(1) + 'px',
    '--pdur': (0.7 + Math.random() * 0.6).toFixed(2) + 's'
  }
}

function burst(data) {
  payload.value = { name: data.name || '成就解锁', desc: data.desc || '' }
  show.value = true
  clearTimeout(timer)
  timer = setTimeout(() => { show.value = false }, 2000)
}

onMounted(() => { window.__achBurst = burst })
onBeforeUnmount(() => { if (window.__achBurst === burst) delete window.__achBurst; clearTimeout(timer) })
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="ab-burst" aria-hidden="true">
      <!-- 光柱：两束斜向扫过 -->
      <div class="ab-beam b1"></div>
      <div class="ab-beam b2"></div>
      <!-- 光环扩散 -->
      <div class="ab-ring"></div>
      <!-- 粒子爆发：28 粒径向飞散 -->
      <span v-for="i in 28" :key="i" class="ab-part" :style="partStyle(i)"></span>
      <!-- 中央内容：勋章 + 成就名 -->
      <div class="ab-core">
        <div class="ab-badge">
          <svg viewBox="0 0 48 48" class="ab-svg">
            <defs>
              <linearGradient id="abBook" x1="10" y1="13" x2="38" y2="34" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#8faeff" /><stop offset="1" stop-color="#5b7cfa" />
              </linearGradient>
              <linearGradient id="abBook2" x1="38" y1="13" x2="24" y2="34" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#c4b5fd" /><stop offset="1" stop-color="#8b5cf6" />
              </linearGradient>
              <linearGradient id="abStar" x1="17" y1="2.8" x2="31" y2="14.4" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#ffe9a8" /><stop offset="1" stop-color="#ffb84d" />
              </linearGradient>
            </defs>
            <g transform="translate(0,5)">
              <path d="M24 2.8 L26.2 7.4 L31 8.4 L26.2 9.4 L24 14 L21.8 9.4 L17 8.4 L21.8 7.4 Z" fill="url(#abStar)" />
              <path d="M24 15 C20 12.8 12.8 12.8 10 15.6 L10 33.4 C12.8 35.8 20.5 35.4 24 33.6 Z" fill="url(#abBook)" />
              <path d="M24 15 C28 12.8 35.2 12.8 38 15.6 L38 33.4 C35.2 35.8 27.5 35.4 24 33.6 Z" fill="url(#abBook2)" />
              <path d="M24 15 L24 33.6" stroke="rgba(255,255,255,0.6)" stroke-width="1.5" />
            </g>
          </svg>
        </div>
        <div class="ab-title">成就解锁</div>
        <div class="ab-name">{{ payload.name }}</div>
        <div class="ab-desc">{{ payload.desc }}</div>
        <div class="ab-xp">+20 XP</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ab-burst {
  position: fixed; inset: 0; z-index: 9998; pointer-events: none;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
/* 光柱：斜向扫过 */
.ab-beam {
  position: absolute; top: -20%; bottom: -20%; width: 90px;
  background: linear-gradient(180deg, transparent, rgba(91, 124, 250, 0.16), transparent);
  transform: rotate(18deg);
  animation: abBeam 1.1s ease-out forwards;
}
.ab-beam.b1 { left: 8%; }
.ab-beam.b2 { left: 78%; animation-delay: .12s; }
@keyframes abBeam { 0% { transform: translateX(-40vw) rotate(18deg); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateX(70vw) rotate(18deg); opacity: 0; } }
/* 光环扩散 */
.ab-ring {
  position: absolute; width: 120px; height: 120px; border-radius: 50%;
  border: 2px solid rgba(91, 124, 250, 0.7);
  animation: abRing .9s cubic-bezier(.2, .7, .3, 1) forwards;
}
@keyframes abRing { 0% { transform: scale(.3); opacity: .9; } 100% { transform: scale(9); opacity: 0; } }
/* 粒子 */
.ab-part {
  position: absolute; left: 50%; top: 50%;
  width: var(--ps); height: var(--ps); border-radius: 50%;
  background: var(--pc);
  box-shadow: 0 0 6px var(--pc);
  animation: abPart var(--pdur) cubic-bezier(.16, .7, .3, 1) forwards;
}
@keyframes abPart {
  0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  100% { transform: translate(calc(-50% + cos(var(--pa)) * var(--pd)), calc(-50% + sin(var(--pa)) * var(--pd))) scale(.2); opacity: 0; }
}
/* 中央内容 */
.ab-core { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.ab-badge {
  width: 74px; height: 74px; border-radius: 20px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, rgba(91, 124, 250, 0.22), rgba(122, 92, 255, 0.18));
  border: 1px solid rgba(91, 124, 250, 0.5);
  box-shadow: 0 0 34px rgba(91, 124, 250, 0.5);
  animation: abBadgeIn .5s cubic-bezier(.2, .9, .3, 1.4) both;
}
.ab-svg { width: 44px; height: 44px; }
.ab-title { font-size: 12px; letter-spacing: 3px; color: var(--brand); animation: abUp .5s .08s both; }
.ab-name { font-size: 22px; font-weight: 700; color: var(--text); text-shadow: 0 0 18px rgba(91, 124, 250, 0.5); animation: abUp .5s .16s both; }
.ab-desc { font-size: 12px; color: var(--muted); animation: abUp .5s .24s both; }
.ab-xp { font-size: 12px; font-weight: 600; color: #ffd76a; animation: abUp .5s .32s both; }
@keyframes abBadgeIn { 0% { transform: scale(0) rotate(-14deg); opacity: 0; } 100% { transform: scale(1) rotate(0); opacity: 1; } }
@keyframes abUp { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
