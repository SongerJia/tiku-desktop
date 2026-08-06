<script setup>
import { ref, onMounted } from 'vue'
import { tiku } from '../api/tiku.js'
import WrongBook from './WrongBook.vue'
import Favorites from './Favorites.vue'
import NotesList from './NotesList.vue'

const emit = defineEmits(['reset', 'start', 'open-bank'])

function forwardStart(payload) {
  emit('start', payload)
}

const userName = ref('本地用户')
const toast = ref('')
const showNotes = ref(false)

// ---- 云同步（GitHub Gist）状态 ----
const syncConnected = ref(false)
const syncLogin = ref('')
const syncLast = ref(0)
const syncToken = ref('')
const syncing = ref(false)

const menus = [
  { label: '我的学习', action: () => emit('reset') },
  { label: '我的笔记', action: () => showNotes.value = true },
  { label: '章节进度', action: () => showToast('请在「学习统计」页查看') },
  { label: '关于我们', action: () => showToast('知识记忆小助手 v0.1.0') }
]

onMounted(async () => {
  try {
    const cfg = await tiku.syncGetConfig()
    syncConnected.value = cfg.connected
    syncLogin.value = cfg.login
    syncLast.value = cfg.lastSync
  } catch (e) { /* 同步配置读取失败不阻塞页面 */ }
})

function showToast(msg) {
  toast.value = msg
  setTimeout(() => toast.value = '', 2400)
}

async function connect() {
  const t = syncToken.value.trim()
  if (!t) { showToast('请输入 GitHub Token'); return }
  try {
    const r = await tiku.syncConnect(t)
    syncConnected.value = true
    syncLogin.value = r.login
    syncToken.value = ''
    showToast('已连接 GitHub：' + r.login)
  } catch (e) {
    showToast('连接失败：' + (e.message || '请检查 Token 与网络'))
  }
}

async function doSync() {
  if (syncing.value) return
  syncing.value = true
  try {
    const r = await tiku.syncNow()
    syncLast.value = r.lastSync
    showToast('同步成功 · ' + new Date(r.lastSync).toLocaleString())
  } catch (e) {
    showToast('同步失败：' + (e.message || '网络异常'))
  } finally {
    syncing.value = false
  }
}

async function disconnect() {
  try { await tiku.syncDisconnect() } catch (e) {}
  syncConnected.value = false
  syncLogin.value = ''
  syncLast.value = 0
  showToast('已断开云同步（本地数据保留）')
}

async function clearLocal() {
  await tiku.clearUserData()
  showToast('已清空本地学习数据')
  emit('reset')
}

function fmtTime(ts) {
  if (!ts) return '从未同步'
  const d = new Date(Number(ts))
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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
</script>

<template>
  <div class="profile">
    <!-- 用户信息 -->
    <div class="card user-card">
      <div class="avatar">{{ userName.slice(0, 1) }}</div>
      <div class="user-info">
        <div class="user-name">{{ userName }}</div>
        <div class="user-sub">本地账号 · 数据离线存储</div>
      </div>
    </div>

    <!-- 云同步（GitHub Gist，零后端） -->
    <div class="card">
      <div class="card-title">云同步（GitHub）</div>

      <div v-if="!syncConnected" class="sync-connect">
        <p class="sync-tip">
          用 GitHub 私有 Gist 同步多设备学习数据，零后端、零部署。<br />
          需一个带 <code>gist</code> 权限的 Personal Access Token。
        </p>
        <input
          v-model="syncToken"
          class="sync-input"
          type="password"
          placeholder="粘贴 GitHub Token（ghp_...）"
          @keyup.enter="connect"
        />
        <button class="btn btn-primary sync-btn" @click="connect">连接并同步</button>
        <a class="sync-link" href="https://github.com/settings/tokens" target="_blank" rel="noopener">
          如何创建 Token？
        </a>
      </div>

      <div v-else class="sync-connected">
        <div class="sync-row">
          <span class="sync-dot"></span>
          <span>已连接：<b>{{ syncLogin }}</b></span>
        </div>
        <div class="sync-row sub">上次同步：{{ fmtTime(syncLast) }}</div>
        <div class="sync-actions">
          <button class="btn btn-primary" :disabled="syncing" @click="doSync">
            {{ syncing ? '同步中…' : '立即同步' }}
          </button>
          <button class="btn btn-outline" @click="disconnect">断开连接</button>
        </div>
      </div>
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
      <div class="list-item" @click="clearLocal">
        <span class="title danger">清空本地学习数据</span>
        <span class="arrow">›</span>
      </div>
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

    <NotesList :show="showNotes" @close="showNotes = false" />
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
.list-item.danger .title { color: #ff6b6b; }

/* 云同步卡片 */
.sync-connect { display: flex; flex-direction: column; gap: 10px; }
.sync-tip { font-size: 12px; color: var(--muted); line-height: 1.6; }
.sync-tip code {
  background: var(--line);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
}
.sync-input {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px 12px;
  color: var(--text);
  font-size: 13px;
  outline: none;
}
.sync-input:focus { border-color: var(--brand); }
.sync-btn { align-self: flex-start; }
.sync-link { font-size: 11px; color: var(--brand); text-decoration: none; }
.sync-link:hover { text-decoration: underline; }

.sync-connected { display: flex; flex-direction: column; gap: 8px; }
.sync-row { font-size: 13px; display: flex; align-items: center; gap: 6px; }
.sync-row.sub { color: var(--muted); font-size: 12px; }
.sync-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #2ecc71; box-shadow: 0 0 6px #2ecc71;
}
.sync-actions { display: flex; gap: 10px; margin-top: 4px; }

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
