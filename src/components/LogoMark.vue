<script setup>
// 记忆书卷 Logo（2026-08-14）：打开的书 + 金色记忆星
// - 完整版（size>=34）：渐变底座 + 双色高光书页 + 星芒 + 动效（星旋转/光晕呼吸/流光扫过/光环扩散）
// - 简约版（size<34）：去底座/射线/文字线，双色书页 + 星保留慢速旋转（小尺寸辨识度）
const props = defineProps({
  size: { type: Number, default: 36 },
  spin: { type: Boolean, default: true } // 动效开关（侧边栏常驻，About/Welcome 也可关）
})
const full = () => props.size >= 34
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 48 48" class="logo-mark" :class="{ spin: spin }" role="img" aria-label="知识记忆小助手">
    <defs>
      <linearGradient id="lgBase" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#4a6cf7" />
        <stop offset="1" stop-color="#6d3fd6" />
      </linearGradient>
      <linearGradient id="lgBookL" x1="10" y1="13" x2="24" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#8faeff" />
        <stop offset="1" stop-color="#5b7cfa" />
      </linearGradient>
      <linearGradient id="lgBookR" x1="38" y1="13" x2="24" y2="34" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#c4b5fd" />
        <stop offset="1" stop-color="#8b5cf6" />
      </linearGradient>
      <linearGradient id="lgStar" x1="17" y1="2.8" x2="31" y2="14.4" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#ffe9a8" />
        <stop offset="1" stop-color="#ffb84d" />
      </linearGradient>
    </defs>

    <!-- 完整版：渐变底座（深品牌色 + 底部投影感） -->
    <template v-if="full()">
      <rect x="0" y="0" width="48" height="48" rx="12" fill="url(#lgBase)" />
      <rect x="0" y="37" width="48" height="11" rx="5.5" fill="rgba(0, 0, 0, 0.16)" />
      <rect x="5.5" y="5.5" width="37" height="37" rx="9.5" fill="url(#lgBase)" />
      <!-- 底座光环扩散 -->
      <circle cx="24" cy="24" r="22" fill="none" stroke="rgba(255, 255, 255, 0.5)" class="lm-ring" />
    </template>

    <!-- 星：四角星 + 光晕圆（呼吸）+ 双侧小星 -->
    <circle cx="24" cy="8.4" r="7.5" fill="#ffd76a" class="lm-star-halo" />
    <g class="lm-star-pulse">
      <path d="M24 2.8 L26.2 7.4 L31 8.4 L26.2 9.4 L24 14 L21.8 9.4 L17 8.4 L21.8 7.4 Z" fill="url(#lgStar)" />
      <path v-if="full()" d="M14.5 4.5 L15.5 6.5 L17.5 7 L15.5 7.5 L14.5 9.5 L13.5 7.5 L11.5 7 L13.5 6.5 Z" fill="#ffe9a8" opacity=".75" />
      <path v-if="full()" d="M33 3.5 L34 5.5 L36 6 L34 6.5 L33 8.5 L32 6.5 L30 6 L32 5.5 Z" fill="#ffe9a8" opacity=".55" />
    </g>
    <!-- 星芒旋转（细射线，绕星中心） -->
    <g v-if="full()" class="lm-spin" opacity=".5">
      <path d="M24 0.5 L24.8 3.6 L27.8 4.2 L24.8 4.8 L24 7.9 L23.2 4.8 L20.2 4.2 L23.2 3.6 Z" fill="#ffd76a" />
      <path d="M24 9.2 L24.5 11 L26.2 11.4 L24.5 11.8 L24 13.6 L23.5 11.8 L21.8 11.4 L23.5 11 Z" fill="#ffe9a8" opacity=".8" />
    </g>

    <!-- 书本：双页（左靛蓝 / 右紫）+ 书脊 + 文字线 + 流光 -->
    <g class="lm-book">
      <path d="M24 15 C20 12.8 12.8 12.8 10 15.6 L10 33.4 C12.8 35.8 20.5 35.4 24 33.6 Z" fill="url(#lgBookL)" />
      <path d="M24 15 C28 12.8 35.2 12.8 38 15.6 L38 33.4 C35.2 35.8 27.5 35.4 24 33.6 Z" fill="url(#lgBookR)" />
      <path d="M24 15 L24 33.6" stroke="rgba(255, 255, 255, 0.6)" stroke-width="1.5" />
      <g v-if="full()">
        <path d="M13.4 21 L20.6 19.6 M13.4 24.6 L20.6 23.2 M13.4 28.2 L20.6 26.8" stroke="rgba(255, 255, 255, 0.5)" stroke-width="1.4" stroke-linecap="round" />
        <path d="M27.4 19.6 L34.6 21 M27.4 23.2 L34.6 24.6 M27.4 26.8 L34.6 28.2" stroke="rgba(255, 255, 255, 0.5)" stroke-width="1.4" stroke-linecap="round" />
      </g>
      <!-- 书页底部投影（厚度感） -->
      <path v-if="full()" d="M10 33.4 C12.8 35.8 20.5 35.4 24 33.6" stroke="rgba(0, 0, 0, 0.16)" stroke-width="1.8" fill="none" transform="translate(0, 1.4)" />
      <path v-if="full()" d="M24 33.6 C27.5 35.4 35.2 35.8 38 33.4" stroke="rgba(0, 0, 0, 0.16)" stroke-width="1.8" fill="none" transform="translate(0, 1.4)" />
      <!-- 流光扫过 -->
      <rect v-if="full()" x="10" y="15" width="14" height="6" rx="3" fill="#fff" opacity=".35" class="lm-shine" />
    </g>
  </svg>
</template>

<style scoped>
.logo-mark { display: block; flex-shrink: 0; }
/* 星芒慢速旋转 */
.lm-spin { transform-box: fill-box; transform-origin: center; animation: lmSpin 3.2s linear infinite; }
@keyframes lmSpin { to { transform: rotate(360deg); } }
/* 星光光晕呼吸（光晕圆 + 星本体错相呼吸，不用 drop-shadow 避免渐变+filter 合成坑） */
.lm-star-halo { transform-box: fill-box; transform-origin: center; animation: lmHalo 2.4s ease-in-out infinite; }
@keyframes lmHalo { 0%, 100% { opacity: .22; } 50% { opacity: .6; } }
.lm-star-pulse { animation: lmPulse 2.4s ease-in-out infinite; }
@keyframes lmPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
/* 书页流光扫过（左页顶部，循环平移） */
.lm-shine { animation: lmShine 3.6s ease-in-out infinite; }
@keyframes lmShine { 0%, 55% { opacity: 0; transform: translateX(-12px); } 75% { opacity: .5; } 100% { opacity: 0; transform: translateX(14px); } }
/* 底座光环扩散 */
.lm-ring { transform-box: fill-box; transform-origin: center; animation: lmRing 2.6s ease-out infinite; }
@keyframes lmRing { 0% { opacity: .4; transform: scale(.97); } 100% { opacity: 0; transform: scale(1.14); } }
</style>
