#!/usr/bin/env node
/**
 * 从 OpenNGC 生成深空目标，追加进 lib/data/targets.json。
 *
 * 用法：node tools/build-targets.mjs [--limit=255]
 * 规则：MajAx >= 4'、V/B <= 9.5（缺测光时要求 MajAx >= 8'），按视大小与亮度排序取前 N 个。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import * as astro from '../lib/astro.js'

const ROOT = join(import.meta.dirname, '..')
const FILE = join(ROOT, 'lib', 'data', 'targets.json')
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '--limit=180').split('=')[1]) || 180
const SRC = [
  'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv',
  'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/addendum.csv',
]
const TYPE_MAP = { G: 'galaxy', GPair: 'galaxy', GTrpl: 'galaxy', GGroup: 'galaxy', PN: 'planetary', Neb: 'nebula', EmNeb: 'nebula', RfNeb: 'nebula', DrkNeb: 'nebula', OCl: 'cluster', Cl: 'cluster' }

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean)
  const head = lines.shift().split(';')
  return lines.map((line) => {
    const parts = line.split(';')
    const row = {}
    head.forEach((k, i) => { row[k] = parts[i] })
    return row
  })
}

function raHours(s) {
  const m = /^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(String(s || '').trim())
  if (!m) return null
  return Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600
}

function decDeg(s) {
  const m = /^([+-]?)(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(String(s || '').trim())
  if (!m) return null
  const v = Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600
  return m[1] === '-' ? -v : v
}

/** 该月 15 日 20/22/00/02 点（UTC+8）任一时段高度 >25° 即算可见 */
function monthsOf(raH, dec) {
  const out = []
  for (let month = 1; month <= 12; month += 1) {
    let visible = false
    for (const hour of [20, 22, 24, 26]) {
      const t = new Date(Date.UTC(2027, month - 1, 15, (hour - 8 + 24) % 24, 0, 0))
      const lst = astro.lstHours(t, 105) // 东经 105° 基准
      const alt = astro.altAzFromHA(raH * 15, dec, lst, 35).alt
      if (alt > 25) { visible = true; break }
    }
    if (visible) out.push(month)
  }
  return out
}

function focalOf(sizeDeg) {
  const fov = Math.max(0.3, sizeDeg * 1.8)
  const focal = 36 / (2 * Math.tan((fov * Math.PI) / 360))
  return [Math.max(50, Math.round(focal * 0.7 / 10) * 10), Math.round(focal * 1.6 / 10) * 10]
}

const CACHE = join(ROOT, 'tools', '.cache', 'openngc.csv')
const data = JSON.parse(readFileSync(FILE, 'utf8'))
const existing = new Set(data.targets.map((t) => t.id))
const seen = new Set()
const candidates = []
let csvText = ''
try { csvText = readFileSync(CACHE, 'utf8') } catch (e) { csvText = '' }
if (!csvText) {
  const MIRRORS = [
    'https://cdn.jsdelivr.net/gh/mattiaverga/OpenNGC@master/database_files/NGC.csv',
    'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv',
    'https://fastly.jsdelivr.net/gh/mattiaverga/OpenNGC@master/database_files/NGC.csv',
  ]
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) })
      if (!res.ok) { console.log('镜像失败', url, res.status); continue }
      csvText = await res.text()
      if (csvText.length > 100000) break
    } catch (e) { console.log('镜像异常', url, e.message.slice(0, 60)) }
  }
  if (!csvText) { console.log('OpenNGC 下载失败，保留现有目标库'); process.exit(0) }
  mkdirSync(join(ROOT, 'tools', '.cache'), { recursive: true })
  writeFileSync(CACHE, csvText)
  console.log('已缓存 OpenNGC', csvText.length)
} else {
  console.log('使用缓存 OpenNGC', csvText.length)
}
for (const url of [SRC[0]]) {
  const rows = parseCsv(csvText)
  for (const row of rows) {
    const type = TYPE_MAP[row.Type]
    if (!type) continue
    const maj = Number(row.MajAx)
    if (!Number.isFinite(maj) || maj < 3) continue
    const mag = Number(row['V-Mag'] || row['B-Mag'] || row.JMag)
    const hasMag = Number.isFinite(mag) && mag > 0
    if (hasMag && mag > 10.5) continue
    if (!hasMag && maj < 6) continue
    const ra = raHours(row.RA)
    const dec = decDeg(row.Dec)
    if (ra == null || dec == null) continue
    const mnum = String(row.M || '').trim()
    const id = mnum ? 'm' + String(Number(mnum)) : String(row.Name).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    if (existing.has(id) || seen.has(id)) continue
    const months = monthsOf(ra, dec)
    if (!months.length) continue
    seen.add(id)
    const name = mnum ? 'M' + String(Number(mnum)) : String(row.Name).replace(/^NGC\s*/, 'NGC ')
    candidates.push({
      id, name, en: String(row.Name), type: 'deepsky', raH: Math.round(ra * 1000) / 1000, dec: Math.round(dec * 100) / 100,
      sizeDeg: Math.round((maj / 60) * 100) / 100, minBortle: type === 'nebula' ? 3 : (hasMag && mag <= 6 ? 5 : 4),
      months, focalFF: focalOf(maj / 60), tracker: focalOf(maj / 60)[0] >= 200,
      fg: type === 'galaxy' ? '开阔北天/南天' : '树线或山脊', tips: '按视大小与亮度自动生成，实际以当晚透明度为准', subtype: type,
      _score: (maj || 0) * 1.5 + (hasMag ? Math.max(0, 12 - mag) : 2),
    })
  }
}

candidates.sort((a, b) => b._score - a._score)
// 按亚型配额挑选，避免全是疏散星团
const QUOTA = { galaxy: 90, nebula: 80, cluster: 70, planetary: 15 }
const taken = { galaxy: 0, nebula: 0, cluster: 0, planetary: 0 }
const picked = []
for (const x of candidates) {
  const cap = QUOTA[x.subtype] || 0
  if (taken[x.subtype] >= cap) continue
  taken[x.subtype] += 1
  const { _score, ...rest } = x
  picked.push(rest)
  if (picked.length >= LIMIT) break
}
data.targets.push(...picked)
writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n')
console.log('新增', picked.length, '个深空目标，总目标', data.targets.length, '| 深空', data.targets.filter((t) => t.type === 'deepsky').length)
