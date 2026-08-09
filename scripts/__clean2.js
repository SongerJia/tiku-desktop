const fs = require('fs')

// 1) 删死组件文件
for (const f of ['src/components/CategoryTree.vue', 'src/components/ImportExport.vue', 'src/components/XpDetailModal.vue']) {
  if (fs.existsSync(f)) { fs.unlinkSync(f); console.log('deleted', f) }
  else console.log('skip(not exist)', f)
}

// 2) App.vue 删 startQuiz 死函数
let app = fs.readFileSync('src/App.vue', 'utf8')
const m = app.match(/function startQuiz\([^)]*\) \{[\s\S]*?\n\}/)
if (m) { app = app.replace(m[0], ''); fs.writeFileSync('src/App.vue', app); console.log('startQuiz removed') }
else console.log('startQuiz not found')

// 3) Profile.vue 清理未用 import（ACH_DEFS/seasonTarget 保留 ACH_SERIES 等）
let pr = fs.readFileSync('src/components/Profile.vue', 'utf8')
pr = pr.replace("import { evaluate, achLevel, ACH_DEFS, ACH_SERIES, ACH_RARITY, currentSeason, evaluateSeason, seasonTarget, syncSeasonArchive } from '../utils/achievements.js'", "import { evaluate, achLevel, ACH_SERIES, ACH_RARITY, currentSeason, evaluateSeason, syncSeasonArchive } from '../utils/achievements.js'")
fs.writeFileSync('src/components/Profile.vue', pr)
console.log('profile import cleaned:', pr.includes('ACH_DEFS'))

// 4) Home.vue 删 dailyAnalysisOpen 死状态
let hm = fs.readFileSync('src/components/Home.vue', 'utf8')
const d1 = hm.match(/^const dailyAnalysisOpen = ref\(false\)[^\n]*\r?\n/m)
if (d1) hm = hm.replace(d1[0], '')
const d2 = hm.match(/^  dailyAnalysisOpen\.value = false[^\n]*\r?\n/m)
if (d2) hm = hm.replace(d2[0], '')
fs.writeFileSync('src/components/Home.vue', hm)
console.log('dailyAnalysisOpen cleaned')

// 5) SubjectSelector Esc 关闭：App.vue 补 @close 绑定
let sub = fs.readFileSync('src/App.vue', 'utf8')
const beforeSub = sub
sub = sub.replace(/:currentId="currentSubject.id"\r?\n\s*@select="onSubjectSelected" \/>/, ':currentId="currentSubject.id"\n      @select="onSubjectSelected"\n      @close="showSubjectPicker = false"\n    />')
if (sub !== beforeSub) { fs.writeFileSync('src/App.vue', sub); console.log('SubjectSelector @close added') }
else console.log('SubjectSelector @close NOT matched')
