<script setup>
// 粒子星尘背景（2026-08-14）：canvas fixed 全屏，粒子缓慢漂移 + 鼠标排斥交互
// 透明度极低（≤0.15）不干扰阅读；数量随屏幕自适应；卸载清理 rAF
import { ref, onMounted, onBeforeUnmount } from 'vue'

const canvasEl = ref(null)
let canvas, ctx, raf = 0
let W = 0, H = 0, pts = []
const mouse = { x: -9999, y: -9999 }
let reduced = false // prefers-reduced-motion 用户关掉粒子

function resize() {
  const r = canvas.parentElement.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  W = canvas.width = r.width * dpr
  H = canvas.height = r.height * dpr
  canvas.style.width = r.width + 'px'
  canvas.style.height = r.height + 'px'
  // 数量自适应：~每 20000 px² 一颗，上限 80
  const n = Math.min(80, Math.max(24, Math.round((r.width * r.height) / 20000)))
  pts = []
  for (let i = 0; i < n; i++) {
    pts.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      r: (Math.random() * 1.4 + 0.5) * dpr,
      ph: Math.random() * Math.PI * 2
    })
  }
}

function tick() {
  ctx.clearRect(0, 0, W, H)
  const t = Date.now() / 1000
  for (const p of pts) {
    p.x += p.vx
    p.y += p.vy
    // 鼠标排斥：80px 内粒子被推开
    const dx = p.x - mouse.x
    const dy = p.y - mouse.y
    const d2 = dx * dx + dy * dy
    if (d2 < 80 * 80) {
      const d = Math.sqrt(d2) || 1
      const f = (1 - d / 80) * 1.1
      p.x += (dx / d) * f
      p.y += (dy / d) * f
    }
    if (p.x < -8) p.x = W + 8
    if (p.x > W + 8) p.x = -8
    if (p.y < -8) p.y = H + 8
    if (p.y > H + 8) p.y = -8
    // 呼吸闪烁（透明度 0.06~0.15）
    const a = 0.06 + 0.09 * (0.5 + 0.5 * Math.sin(t * 1.2 + p.ph))
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(140, 160, 255, ${a.toFixed(3)})`
    ctx.fill()
  }
  raf = requestAnimationFrame(tick)
}

function onMove(e) {
  const r = canvas.getBoundingClientRect()
  mouse.x = (e.clientX - r.left) * (W / (r.width || 1))
  mouse.y = (e.clientY - r.top) * (H / (r.height || 1))
}

onMounted(() => {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { reduced = true; return }
  canvas = canvasEl.value
  if (!canvas) return
  ctx = canvas.getContext('2d')
  resize()
  window.addEventListener('resize', resize)
  window.addEventListener('mousemove', onMove, { passive: true })
  raf = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  window.removeEventListener('resize', resize)
  window.removeEventListener('mousemove', onMove)
})
</script>

<template>
  <canvas ref="canvasEl" v-if="!reduced" class="starfield" aria-hidden="true"></canvas>
</template>

<style scoped>
.starfield {
  position: fixed; inset: 0;
  width: 100%; height: 100%;
  z-index: 0; pointer-events: none;
}
</style>
