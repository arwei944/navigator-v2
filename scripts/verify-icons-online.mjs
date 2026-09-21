import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const sites = JSON.parse(readFileSync(new URL('../api/sites-data.json', import.meta.url), 'utf-8'))
const icons = [...new Set(sites.filter(s => s.icon).map(s => s.icon))]

const BASE = 'https://navigator-v2-two.vercel.app/'
let bad = []
let idx = 0
const CONC = 10

async function check(icon) {
  const url = BASE + icon
  try {
    const out = execFileSync('curl.exe', ['-s', '-o', 'NUL', '-w', '%{content_type}', '--max-time', '20', url], { encoding: 'utf8', timeout: 25000 })
    if (!out.startsWith('image/') && !out.startsWith('application/')) {
      bad.push({ icon, ct: out })
    }
  } catch (e) {
    bad.push({ icon, ct: 'curl error: ' + e.message })
  }
  idx++
  if (idx % 50 === 0) console.log(`checked ${idx}/${icons.length}`)
}

async function main() {
  for (let i = 0; i < icons.length; i += CONC) {
    await Promise.all(icons.slice(i, i + CONC).map(check))
  }
  console.log(`--- done --- total=${icons.length} bad=${bad.length}`)
  bad.forEach(b => console.log(`  ${b.icon} -> ${b.ct}`))
}

main()
