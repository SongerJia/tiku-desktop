<script setup>
import { ref, onMounted } from 'vue'
import { tiku } from '../api/tiku.js'
import WrongBook from './WrongBook.vue'
import Favorites from './Favorites.vue'

const emit = defineEmits(['reset', 'start', 'open-bank'])

function forwardStart(payload) {
  emit('start', payload)
}

const loggedIn = ref(false)
const userName = ref('本地用户')
const toast = ref('')

onMounted(() => {
  // 本地 MVP 默认已登录
  loggedIn.value = true
})

function showToast(msg) {
  toast.value = msg
  setTimeout(() => toast.value = '', 2000)
}

function login() {
  loggedIn.value = true
  showToast('已登录本地账号')
}

async function logout() {
  await tiku.clearUserData()
  loggedIn.value = false
  userName.value = '本地用户'
  showToast('已退出并清空本地学习数据')
  emit('reset')
}

async function exportData() {
  const json = await tiku.exportData()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tiku-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  showToast('备份已导出')
}

function importData(event) {
  const file = event.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const r = await tiku.importData(e.target.result)
      showToast(`导入成功，共 ${r.imported} 题`)
    } catch (err) {
      showToast('导入失败：' + err.message)
    }
  }
  reader.readAsText(file)
  event.target.value = ''
}

const menus = [
  { label: '我的学习', action: () => emit('reset') },
  { label: '章节进度', action: () => showToast('请在「学习统计」页查看') },
  { label: '默写记录', action: () => showToast('功能开发中') },
  { label: '我的反馈', action: () => showToast('功能开发中') },
  { label: '关于我们', action: () => showToast('知识记忆小助手 v0.1.0') },
]
</script>

<template>
  <div class="profile">
    <!-- 用户信息 -->
    <div class="card user-card">
      <div class="avatar">{{ loggedIn ? userName.slice(0, 1) : '?' }}</div>
      <div class="user-info">
        <div class="user-name">{{ loggedIn ? userName : '登录后可查看学习记录' }}</div>
        <div v-if="loggedIn" class="user-sub">本地账号 · 数据离线存储</div>
      </div>
      <button
        class="btn"
        :class="loggedIn ? 'btn-outline' : 'btn-primary'"
        @click="loggedIn ? logout() : login()"
      >{{ loggedIn ? '退出登录' : '立即登录' }}</button>
    </div>

    <!-- 题库管理 -->
    <div class="card">
      <div class="card-title">题库</div>
      <div class="list-item highlight" @click="emit('open-bank')">
        <span class="title">题库管理</span>
        <span class="sub">导入 Excel/CSV · 录题 · 编辑删除</span>
        <span class="arrow">›</span>
      </div>
    </div>

    <!-- 数据导入导出 -->
    <div class="card">
      <div class="card-title">数据管理</div>
      <div class="list-item" @click="exportData">
        <span class="title">导出备份</span>
        <span class="arrow">›</span>
      </div>
      <label class="list-item" style="display:flex;cursor:pointer">
        <span class="title">导入备份</span>
        <span class="arrow">›</span>
        <input type="file" accept=".json" style="display:none" @change="importData" />
      </label>
    </div>

    <!-- 错题本 / 收藏 -->
    <div class="card">
      <div class="card-title">我的错题与收藏</div>
      <WrongBook @start="forwardStart" />
      <Favorites @start="forwardStart" />
    </div>

    <!-- 菜单列表 -->
    <div class="card menu-card">
      <div
        v-for="m in menus"
        :key="m.label"
        class="list-item"
        @click="m.action"
      >
        <span class="title">{{ m.label }}</span>
        <span class="arrow">›</span>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.user-card {
  display: flex;
  align-items: center;
  gap: 14px;
}
.avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--brand-light);
  color: var(--brand);
  font-size: 22px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.user-info { flex: 1; overflow: hidden; }
.user-name { font-size: 16px; font-weight: 600; }
.user-sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
.user-card .btn { padding: 6px 14px; font-size: 13px; flex-shrink: 0; }

.menu-card { padding: 0 16px; }

/* 题库管理入口：比普通菜单项更显眼，这是高频操作 */
.list-item.highlight { cursor: pointer; }
.list-item.highlight .title { color: var(--brand); font-weight: 600; }
.list-item.highlight .sub {
  flex: 1;
  text-align: right;
  margin-right: 8px;
  font-size: 11px;
  color: var(--muted);
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 90px;
  transform: translateX(-50%);
  background: rgba(8, 14, 28, 0.92);
  color: var(--text);
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 13px;
  z-index: 100;
  border: 1px solid var(--line);
  box-shadow: var(--glow-soft);
}
</style>
