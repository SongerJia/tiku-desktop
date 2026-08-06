<script setup>
import { ref } from 'vue'
import { tiku } from '../api/tiku.js'

const msg = ref('')

async function doExport() {
  const json = await tiku.exportData()
  const blob = new Blob([json], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'tiku-backup-' + new Date().toISOString().slice(0, 10) + '.json'
  a.click()
  URL.revokeObjectURL(a.href)
  msg.value = '已导出备份文件（含题库 / 答题记录 / 错题本 / 收藏）。'
}

async function onFile(e) {
  const file = e.target.files[0]
  if (!file) return
  const text = await file.text()
  try {
    const r = await tiku.importData(text)
    msg.value = '导入成功，题目数：' + r.imported + '。可回到「题库」查看。'
  } catch (err) {
    msg.value = '导入失败：' + (err && err.message ? err.message : err)
  }
  e.target.value = ''
}
</script>

<template>
  <div>
    <h2>数据导入 / 导出</h2>
    <p class="desc">
      导出会把题库、答题记录、错题本、收藏打包成一个 JSON 文件——可备份，也可拷到别的电脑后「导入」，
      实现你之前说的"题目和学习情况的输入输出"。
    </p>

    <button class="export" @click="doExport">导出备份（JSON）</button>

    <p style="margin-top:16px">
      <label class="filebtn">
        导入备份（JSON）
        <input type="file" accept="application/json" @change="onFile" hidden />
      </label>
    </p>

    <p class="msg" v-if="msg">{{ msg }}</p>
  </div>
</template>

<style scoped>
.desc { color: #374151; line-height: 1.7; max-width: 640px; }
.export { background: var(--brand); color: #fff; border: none; padding: 9px 18px; border-radius: 8px; font-size: 14px; }
.filebtn { display: inline-block; background: #fff; color: var(--brand); border: 1px solid var(--brand); padding: 9px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; }
.msg { color: var(--brand); margin-top: 14px; }
</style>
