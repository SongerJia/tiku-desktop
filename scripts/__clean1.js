const fs = require('fs')
let s = fs.readFileSync('src/components/Profile.vue', 'utf8')
const before = s
s = s.replace(/^import XpDetailModal[^\n]*\r?\n/gm, '')
s = s.replace(/^const showXpDetail[^\n]*\r?\n/gm, '')
s = s.replace(/^\s*<XpDetailModal[^\n]*\r?\n/gm, '')
if (s === before) { console.log('NO CHANGE'); process.exit(1) }
fs.writeFileSync('src/components/Profile.vue', s)
console.log('removed. remaining refs:', (s.match(/XpDetailModal|showXpDetail/g) || []).length)
