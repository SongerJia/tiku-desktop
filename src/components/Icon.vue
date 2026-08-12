<script setup>
// 统一线性图标系统（Linear 风格）：stroke currentColor，随父元素颜色
// 用法：<Icon name="home" :size="16" />
const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 16 }
})

const PATHS = {
  home: '<path d="M3 10.5 L12 3 L21 10.5 V21 H15.5 V14.5 H8.5 V21 H3 Z"/>',
  book: '<path d="M4 5 A2 2 0 0 1 6 3 H20 V21 H6 A2 2 0 0 1 4 19 Z"/><path d="M4 5 V19"/>',
  folder: '<path d="M3 6 A2 2 0 0 1 5 4 H9.5 L11.5 6 H19 A2 2 0 0 1 21 8 V18 A2 2 0 0 1 19 20 H5 A2 2 0 0 1 3 18 Z"/>',
  chart: '<path d="M4 20 V11"/><path d="M10 20 V4"/><path d="M16 20 V13"/><path d="M3 20 H21"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21 C4 16.5 7.6 14 12 14 C16.4 14 20 16.5 20 21"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21 L16.5 16.5"/>',
  star: '<path d="M12 3 L14.5 8.5 L20.5 9.3 L16 13.6 L17 19.5 L12 16.8 L7 19.5 L8 13.6 L3.5 9.3 L9.5 8.5 Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5 V5.5 M12 18.5 V21.5 M2.5 12 H5.5 M18.5 12 H21.5 M5.2 5.2 L7.3 7.3 M16.7 16.7 L18.8 18.8 M18.8 5.2 L16.7 7.3 M7.3 16.7 L5.2 18.8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7 V12 L15.5 14"/>',
  check: '<path d="M4 12.5 L9.5 18 L20 6"/>',
  x: '<path d="M6 6 L18 18 M18 6 L6 18"/>',
  'chevron-down': '<path d="M6 9 L12 15 L18 9"/>',
  'chevron-left': '<path d="M15 6 L9 12 L15 18"/>',
  'chevron-right': '<path d="M9 6 L15 12 L9 18"/>',
  'arrow-right': '<path d="M4 12 H20"/><path d="M14 6 L20 12 L14 18"/>',
  plus: '<path d="M12 5 V19 M5 12 H19"/>',
  trash: '<path d="M4 7 H20"/><path d="M9 7 V4.5 H15 V7"/><path d="M6.5 7 L7.5 20 H16.5 L17.5 7"/>',
  note: '<path d="M5 19.5 L6 14.5 L16.5 4 A2.8 2.8 0 0 1 20 4 A2.8 2.8 0 0 1 20 7.5 L9.5 18 Z"/><path d="M14.5 6 L18 9.5"/>',
  fire: '<path d="M12 3.5 C13.5 7 17 7.6 17 11.5 A5 5 0 0 1 7 11.5 C7 8.4 10 7 12 3.5 Z"/><path d="M7 14.5 C7 17 9 19 12 19 C15 19 17 17 17 14.5"/>',
  link: '<path d="M10 13.5 A4 4 0 0 1 10 8 L12.5 5.5 A4 4 0 0 1 18 11 L16.5 12.5"/><path d="M14 10.5 A4 4 0 0 1 14 16 L11.5 18.5 A4 4 0 0 1 6 13 L7.5 11.5"/>',
  doc: '<path d="M14 3 H7 A2 2 0 0 0 5 5 V19 A2 2 0 0 0 7 21 H17 A2 2 0 0 0 19 19 V7 Z"/><path d="M14 3 V7 H19"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  tag: '<path d="M20.6 13.4 L13.4 20.6 A2 2 0 0 1 12 21.2 H4 A1 1 0 0 1 3 20.2 V12.2 A2 2 0 0 1 3.6 10.8 L10.8 3.6 A2 2 0 0 1 13.2 3.6 L20.6 11 A2 2 0 0 1 20.6 13.4 Z"/><circle cx="7.5" cy="15.5" r="1.5"/>',
  cloud: '<path d="M17.5 19 H7 A5 5 0 0 1 7.5 9 C8.5 5.5 12 4.5 15 6.5 C17.5 7.5 19 10 19 12.5 A4 4 0 0 1 17.5 19 Z"/>',
  trophy: '<path d="M7 4 H17 V8 A5 5 0 0 1 7 8 Z"/><path d="M7 6 H4 A2 2 0 0 0 4 10 H7"/><path d="M17 6 H20 A2 2 0 0 1 20 10 H17"/><path d="M12 13 V17"/><path d="M8.5 21 H15.5"/><path d="M9.5 17 H14.5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  refresh: '<path d="M20 12 A8 8 0 1 1 17.7 6.3"/><path d="M20 4 V9 H15"/>',
  bulb: '<path d="M9 18.5 H15"/><path d="M10.5 21.5 H13.5"/><path d="M12 3 A6 6 0 0 0 8.5 13 C8.8 14.2 10 14.5 10 15.5 V17 H14 V15.5 C14 14.5 15.2 14.2 15.5 13 A6 6 0 0 0 12 3 Z"/>',
  paper: '<path d="M7 3 H17 A2 2 0 0 1 19 5 V19 A2 2 0 0 1 17 21 H7 A2 2 0 0 1 5 19 V5 A2 2 0 0 1 7 3 Z"/><path d="M9 8 H15 M9 12 H15 M9 16 H12"/>',
  pulse: '<path d="M3 12 H6.5 L9 5.5 L13 18.5 L15.5 12 H21"/>',
  download: '<path d="M12 4 V16"/><path d="M6 10 L12 16 L18 10"/><path d="M4 20 H20"/>',
  calendar: '<path d="M5 4 H19 A2 2 0 0 1 21 6 V20 A2 2 0 0 1 19 22 H5 A2 2 0 0 1 3 20 V6 A2 2 0 0 1 5 4 Z"/><path d="M3 9 H21"/><path d="M8 2.5 V5.5 M16 2.5 V5.5"/>',
  eye: '<path d="M2 12 C5 6.5 19 6.5 22 12 C19 17.5 5 17.5 2 12 Z"/><circle cx="12" cy="12" r="3"/>',
  menu: '<path d="M4 7 H20 M4 12 H20 M4 17 H20"/>',
  sync: '<path d="M17.5 19 H7 A5 5 0 0 1 7.5 9 C8.5 5.5 12 4.5 15 6.5 C17.5 7.5 19 10 19 12.5"/><path d="M16 12.5 H19.5 V16"/>',
  flag: '<path d="M5 21 V4"/><path d="M5 4 C8 2.5 11 2.5 14 4 C17 5.5 19 5 21 4 V13 C18 14 15 14 12 12.5 C9 11 6.5 11.5 5 12.5"/>',
  play: '<path d="M7 4.5 L20 12 L7 19.5 Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11 V17 M12 7.5 V8.5"/>',
  bookmark: '<path d="M6 4 V21 L12 17 L18 21 V4 A2 2 0 0 0 16 2 H8 A2 2 0 0 0 6 4 Z"/>',
  layers: '<path d="M12 3 L21 8 L12 13 L3 8 Z"/><path d="M3 12 L12 17 L21 12"/><path d="M3 16 L12 21 L21 16"/>'
}
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="icon"
    v-html="PATHS[name] || ''"
  ></svg>
</template>
