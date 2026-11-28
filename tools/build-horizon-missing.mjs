#!/usr/bin/env node
/**
 * 为缺剖面或近似剖面的站点生成真实高程天际线（严格模式：失败即从站点库剔除）。
 * 用法：node tools/build-horizon-missing.mjs [--concurrency=4]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { horizonFor } from '../lib/terrain.js'

const ROOT = join(import.meta.dirname, '..')
const CORE = join(ROOT, 'lib', 'data', 'sites-core.json')
const HZ = join(ROOT, 'lib', 'data', 'horizon.json')
const CONC = Number((process.argv.find((a) => a.startsWith('--concurrency=')) || '--concurrency=4').split('=')[1]) || 4

const core = JSON.parse(readFileSync(CORE, 'utf8'))
const hz = JSON.parse(readFileSync(HZ, 'utf8'))
const need = core.rows.filter((r) => {
  const rec = hz.sites[r[0]]
  return !rec || rec.approx || !Array.isArray(rec.v) || rec.v.length !== 72
})
console.log('需要真实剖面：', need.length, '站')

const failed = new Set()
let done = 0
async function worker(queue) {
  while (queue.length) {
    const row = queue.shift()
    const [id, name, , , lat, lon, altM] = row
    try {
      const prof = await horizonFor(lat, lon, Number(altM) || 0)
      if (!prof || prof.v.length !== 72 || prof.n.length !== 36 || prof.f.length !== 36) throw new Error('剖面长度异常')
      hz.sites[id] = { v: prof.v, n: prof.n, f: prof.f }
      done += 1
      console.log('✓', id, name, '(' + done + '/' + need.length + ')')
    } catch (e) {
      failed.add(id)
      console.log('✗', id, name, e.message)
    }
  }
}
const queue = need.slice()
await Promise.all(Array.from({ length: CONC }, () => worker(queue)))

// 严格模式：失败站点从站点库剔除
if (failed.size) {
  const before = core.rows.length
  core.rows = core.rows.filter((r) => !failed.has(r[0]))
  writeFileSync(CORE, JSON.stringify(core, null, 2) + '\n')
  console.log('剔除失败站点', before - core.rows.length, '个')
}
hz.generated = new Date().toISOString()
writeFileSync(HZ, JSON.stringify(hz, null, 2) + '\n')
console.log('完成：真实剖面', done, '失败', failed.size, '| 站点库', core.rows.length)
