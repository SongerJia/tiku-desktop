<script setup>
// 系列徽记组件（2026-08-13 宝石级）：渐变填充 + 深色描边 + 高光 + 装饰，viewBox 48
// 用法：<MedalIcon series="quiz" :got="true" :size="26" />，未解锁时灰影剪影（由父级 class 控制色）
defineProps({
  series: { type: String, required: true },
  got: { type: Boolean, default: true },
  size: { type: Number, default: 26 }
})
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 48 48" class="medal-badge" :class="{ dim: !got }" aria-hidden="true">
    <defs>
      <radialGradient id="mq" cx=".4" cy=".3" r="1"><stop offset="0" stop-color="#a8bcff"/><stop offset=".6" stop-color="#5b7cfa"/><stop offset="1" stop-color="#3a56d6"/></radialGradient>
      <radialGradient id="mf" cx=".5" cy=".25" r="1.2"><stop offset="0" stop-color="#ffd58a"/><stop offset=".55" stop-color="#ff9a3d"/><stop offset="1" stop-color="#d94f1e"/></radialGradient>
      <linearGradient id="mt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset=".5" stop-color="#f5b83d"/><stop offset="1" stop-color="#c98a12"/></linearGradient>
      <linearGradient id="ms" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fe8d2"/><stop offset=".55" stop-color="#35c0a2"/><stop offset="1" stop-color="#1f8f76"/></linearGradient>
      <linearGradient id="mc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e4c2ff"/><stop offset=".5" stop-color="#b77cf2"/><stop offset="1" stop-color="#8a4fd8"/></linearGradient>
      <linearGradient id="mh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd68a"/><stop offset=".6" stop-color="#f59a3a"/><stop offset="1" stop-color="#d96f1e"/></linearGradient>
      <linearGradient id="mb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#93c4ff"/><stop offset=".55" stop-color="#3f8ae8"/><stop offset="1" stop-color="#2462b8"/></linearGradient>
      <linearGradient id="mn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9bcff"/><stop offset=".55" stop-color="#a47af0"/><stop offset="1" stop-color="#7a4fd0"/></linearGradient>
      <radialGradient id="mst" cx=".4" cy=".3" r="1.2"><stop offset="0" stop-color="#fff3c4"/><stop offset=".55" stop-color="#fdd75e"/><stop offset="1" stop-color="#e0a012"/></radialGradient>
    </defs>

    <!-- 刷题达人：双环靶心 + 十字 + 八向箭头 -->
    <g v-if="series === 'quiz'">
      <circle cx="24" cy="24" r="21" fill="none" stroke="#3a56d6" stroke-width="6" opacity=".25"/>
      <circle cx="24" cy="24" r="17" fill="none" stroke="url(#mq)" stroke-width="3.5"/>
      <circle cx="24" cy="24" r="10.5" fill="none" stroke="url(#mq)" stroke-width="2"/>
      <path d="M24 5.5v7.5M24 35v7.5M5.5 24H13M35 24h7.5" stroke="url(#mq)" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M24 19v-5.5m0 0l-2.6 2.6M24 13.5l2.6 2.6M24 34.5V29m0 0l-2.6 2.6M24 29l2.6 2.6M29 24h5.5m0 0l-2.6-2.6M34.5 24l-2.6 2.6M19 24h-5.5m0 0l2.6-2.6M13.5 24l2.6 2.6" stroke="url(#mq)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="24" cy="24" r="4.2" fill="url(#mq)"/>
      <circle cx="24" cy="24" r="1.8" fill="#e8eeff"/>
    </g>

    <!-- 连续打卡：双层焰舌 + 火星 + 底部弧 -->
    <g v-else-if="series === 'streak'">
      <path d="M24 2c2 5.5 6.5 8 6.5 13.5a6.5 6.5 0 0 1-13 0c0-4.2 2.6-6.5 3.9-8.7.5 1.4 1.5 2.3 3 2.7-.7-2.5-.1-5.2-.4-7.5z" fill="url(#mf)" stroke="#d94f1e" stroke-width="1.5"/>
      <path d="M24 15c1.6 2.2 2.9 4 2.9 6.8a2.9 2.9 0 0 1-5.8 0c0-2 1.1-3.1 2.9-6.8z" fill="#ffe9ad"/>
      <path d="M16 19c-.6 1.2-.9 2.4-.9 3.6a4.4 4.4 0 0 0 3.2 4.2" fill="none" stroke="#d94f1e" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>
      <path d="M32 16c.7 1.5 1 3 1 4.4a4.6 4.6 0 0 1-2.8 4.2" fill="none" stroke="#d94f1e" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>
      <circle cx="14.5" cy="27" r="1.6" fill="#ffd58a"/>
      <circle cx="33" cy="25" r="1.2" fill="#ffd58a"/>
      <circle cx="36.5" cy="34" r="1" fill="#ff9a3d"/>
      <path d="M18 38c3.5 2.6 8.5 2.6 12 0" stroke="#d94f1e" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".7"/>
    </g>

    <!-- 掌握之路：奖杯 + 双耳 + 底座 + 杯心星 -->
    <g v-else-if="series === 'master'">
      <path d="M14 4h20v6a10.5 10.5 0 0 1-10.5 10.5A10.5 10.5 0 0 1 14 10z" fill="url(#mt)" stroke="#c98a12" stroke-width="1.6"/>
      <path d="M14 6H7a5.5 5.5 0 0 0 5.5 6.5M34 6h7a5.5 5.5 0 0 1-5.5 6.5" fill="none" stroke="url(#mt)" stroke-width="2.6"/>
      <path d="M19.5 24.5h9M24 22.5v7M17 29.5h14" fill="none" stroke="url(#mt)" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M24 20.5l2.2 4.3 4.8.7-3.5 3.3.8 4.7-4.3-2.2-4.3 2.2.8-4.7-3.5-3.3 4.8-.7z" fill="#fff" opacity=".9"/>
      <circle cx="8.5" cy="33" r="1.4" fill="#f5b83d" opacity=".8"/>
      <circle cx="39.5" cy="20" r="1.2" fill="#f5b83d" opacity=".8"/>
    </g>

    <!-- 错题大师：盾牌 + 内衬 + 对勾 + 顶饰 -->
    <g v-else-if="series === 'wrong'">
      <path d="M24 2l16 5.5V19c0 8-7 13-16 17-9-4-16-9-16-17V7.5z" fill="url(#ms)" stroke="#1f8f76" stroke-width="1.8"/>
      <path d="M24 7.5l11 4V19c0 5.4-4.6 9-11 12-6.4-3-11-6.6-11-12v-7.5z" fill="none" stroke="#d9fff2" stroke-width="1.4" opacity=".6"/>
      <path d="M15.5 19.5l6 6 11-11.5" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M24 2l-3.4 5.4L24 12l3.4-4.6z" fill="#9af0da" stroke="#1f8f76" stroke-width="1.2"/>
      <path d="M8 12c2-1 4-1.5 6-1.6" stroke="#9af0da" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>
      <circle cx="38" cy="12" r="1.3" fill="#35c0a2" opacity=".7"/>
    </g>

    <!-- 记忆卡达人：卡片 + 折角 + 记忆线 + 星 -->
    <g v-else-if="series === 'cards'">
      <rect x="9" y="3" width="30" height="41" rx="4" fill="url(#mc)" stroke="#8a4fd8" stroke-width="1.8"/>
      <path d="M30 3l9 9h-9z" fill="#f2e2ff" stroke="#8a4fd8" stroke-width="1.2"/>
      <path d="M15 15h18M15 22h18M15 29h13" stroke="#f6ecff" stroke-width="2.2" stroke-linecap="round" opacity=".85"/>
      <circle cx="16.5" cy="38.5" r="2" fill="#ffe08a"/>
      <path d="M24 10l1.4 2.8 3.1.45-2.25 2.2.5 3.05-2.75-1.4-2.75 1.4.5-3.05-2.25-2.2 3.1-.45z" fill="#fff" opacity=".9"/>
    </g>

    <!-- 专注达人：沙漏 + 流沙 + 沙粒 -->
    <g v-else-if="series === 'focus'">
      <path d="M12.5 3h23M12.5 45h23" stroke="url(#mh)" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M16.5 3c0 9 4.5 12.5 7.5 15.5-3 3-7.5 6.5-7.5 15.5v8M31.5 3c0 9-4.5 12.5-7.5 15.5 3 3 7.5 6.5 7.5 15.5v8" fill="none" stroke="url(#mh)" stroke-width="3"/>
      <path d="M20.5 25.5c2.3-1.3 4.7-1.3 7 0" stroke="#ffe9c4" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <circle cx="21.5" cy="20.5" r="1.3" fill="#ffe9c4"/>
      <circle cx="26.5" cy="31.5" r="1.3" fill="#ffe9c4"/>
      <circle cx="17" cy="33" r="1" fill="#ffd68a" opacity=".8"/>
      <circle cx="31" cy="18" r="1" fill="#ffd68a" opacity=".8"/>
    </g>

    <!-- 知识库：翻开的书 + 书签 + 文字线 -->
    <g v-else-if="series === 'kb'">
      <path d="M24 8c-4.8-3.8-11.5-3.2-16.5-.6V41c4.8-2.7 11.7-3.2 16.5.6 4.8-3.8 11.7-3.3 16.5-.6V7.4C35.5 4.8 28.8 4.2 24 8z" fill="url(#mb)" stroke="#2462b8" stroke-width="1.8"/>
      <path d="M24 8v33.6" stroke="#e6f1ff" stroke-width="2.4" opacity=".8"/>
      <path d="M10 17h7M10 22.5h7M31 17h7M31 22.5h7M12 29h6M30 29h6" stroke="#e6f1ff" stroke-width="1.6" stroke-linecap="round" opacity=".6"/>
      <path d="M37 29l7-6 3.6 3.6-7 6z" fill="#ffd76a" stroke="#d9a514" stroke-width="1"/>
      <circle cx="20" cy="30" r="1.3" fill="#93c4ff" opacity=".8"/>
    </g>

    <!-- 笔记整理：笔记本 + 环 + 笔 -->
    <g v-else-if="series === 'notes'">
      <rect x="12" y="3" width="28" height="42" rx="3.5" fill="url(#mn)" stroke="#7a4fd0" stroke-width="1.8"/>
      <circle cx="8.5" cy="13" r="3" fill="none" stroke="url(#mn)" stroke-width="3"/>
      <path d="M19 13h15M19 21h15M19 29h15M19 37h10" stroke="#f0e6ff" stroke-width="2.2" stroke-linecap="round" opacity=".8"/>
      <path d="M35 32l9-9 3.6 3.6-9 9z" fill="#ffd76a" stroke="#d9a514" stroke-width="1"/>
      <circle cx="30" cy="7" r="1.2" fill="#ffe08a"/>
    </g>

    <!-- 收藏卷宗：金星 + 内层亮星 + 光点 -->
    <g v-else>
      <path d="M24 2l6.2 12.8 14.3 2-10.3 10 2.4 14-12.6-6.6-12.6 6.6 2.4-14-10.3-10 14.3-2z" fill="url(#mst)" stroke="#c98a12" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M24 10l3.1 6.4 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2 1.2-6.8-5-4.9 6.9-1z" fill="#fff6d6" opacity=".6"/>
      <path d="M24 2l-2.5 5.2L24 13l2.5-5.8z" fill="#fff" opacity=".9"/>
      <path d="M9 9c2-.8 3.6-1 5-1" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".6"/>
      <path d="M30 12c2.5-1.4 5-2 7.5-2.3" stroke="#ffe9ad" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".8"/>
      <circle cx="38" cy="30" r="1.6" fill="#ffd76a"/>
      <circle cx="10" cy="36" r="1.8" fill="#ffd76a"/>
      <circle cx="41" cy="16" r="1.1" fill="#ffd76a"/>
      <circle cx="6" cy="20" r="1" fill="#ffd76a" opacity=".8"/>
    </g>
  </svg>
</template>

<style scoped>
.medal-badge { display: block; }
/* 未解锁：整枚灰影剪影（SVG fill/stroke 固定色，不随父级 color → 用 filter 统一灰化） */
.medal-badge.dim { filter: grayscale(1) opacity(.45); }
</style>
