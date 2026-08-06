<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({ value: { type: Number, default: 0 }, duration: { type: Number, default: 700 } })
const display = ref(0)
let raf = null

function animate(to) {
  if (raf) cancelAnimationFrame(raf)
  const from = display.value
  const t0 = performance.now()
  const step = (t) => {
    const p = Math.min(1, (t - t0) / props.duration)
    display.value = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)))
    if (p < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}

watch(() => props.value, v => animate(Number(v) || 0), { immediate: true })
onMounted(() => animate(Number(props.value) || 0))
onBeforeUnmount(() => { if (raf) cancelAnimationFrame(raf) })
</script>

<template>
  <span>{{ display }}</span>
</template>
