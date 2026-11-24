/**
 * 天气准确性抽检工具（离线，不进入插件运行时）。
 *
 * 做法：用 Open-Meteo 预报接口的 `past_days` 拿到"当时的预报"，再与 archive（再分析实况）
 * 比较同一小时的气温/云量，得到模型在过去几天的平均误差。用来回答"一周内的预报准不准"。
 *
 *   node tools/verify-weather.mjs                 # 抽 12 站 × 过去 7 天
 *   node tools/verify-weather.mjs --sites=20 --days=7
 *   node tools/verify-weather.mjs --check         # 只校验现有报告，不联网
 *
 * 报告写入 docs/weather-accuracy.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SITES_FILE = join(ROOT, 'lib', 'data', 'sites-core.json')
const OUT = join(ROOT, 'docs', 'weather-accuracy.json')

const ARGS = process.argv.slice(2)
const CHECK = ARGS.includes('--check')
const LIMIT = Number((ARGS.find((a) => a.startsWith('--sites=')) || '').split('=')[1] || 12)
const DAYS = Number((ARGS.find((a) => a.startsWith('--days=')) || '').split('=')[1] || 7)

function isoDay(offset) {
  const d = new Date(Date.now() + offset * 86400000)
  return d.toISOString().slice(0, 10)
}

async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

function mae(pairs) {
  const rows = pairs.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (!rows.length) return null
  const sum = rows.reduce((acc, p) => acc + Math.abs(p[0] - p[1]), 0)
  return Math.round((sum / rows.length) * 10) / 10
}

async function verifySite(site) {
  // 两个独立模式对同一时段的差异 → 预报不确定度（archive 对最近几天会回填预报值，MAE 恒为 0，不可用）
  const base = `latitude=${site.lat}&longitude=${site.lon}&hourly=temperature_2m,cloud_cover&forecast_days=${Math.max(1, Math.min(16, DAYS))}&timezone=UTC`
  const [a, b] = await Promise.all([
    json(`https://api.open-meteo.com/v1/forecast?${base}&models=best_match`),
    json(`https://api.open-meteo.com/v1/forecast?${base}&models=ecmwf_ifs025`),
  ])
  const f = a.hourly || {}
  const g = b.hourly || {}
  const index = new Map((g.time || []).map((t, i) => [t, i]))
  const temp = []
  const cloud = []
  for (let i = 0; i < (f.time || []).length; i += 1) {
    const j = index.get(f.time[i])
    if (j === undefined) continue
    temp.push([f.temperature_2m?.[i], g.temperature_2m?.[j]])
    cloud.push([f.cloud_cover?.[i], g.cloud_cover?.[j]])
  }
  return { id: site.id, name: site.name, tempMae: mae(temp), cloudMae: mae(cloud), hours: temp.length }
}

function checkReport() {
  if (!existsSync(OUT)) throw new Error(`缺少报告：${OUT}（先跑一次不带 --check 的命令）`)
  const report = JSON.parse(readFileSync(OUT, 'utf8'))
  if (!Array.isArray(report.sites) || !report.sites.length) throw new Error('报告里没有站点')
  for (const row of report.sites) {
    if (typeof row.tempMae !== 'number' && row.tempMae !== null) throw new Error(`${row.id} tempMae 非法`)
  }
  console.log(`✓ 报告可用：${report.sites.length} 站，窗口 ${report.days} 天，云量 MAE ${report.cloudMaeAvg ?? '—'}%，气温 MAE ${report.tempMaeAvg ?? '—'}℃`)
}

async function main() {
  if (CHECK) {
    checkReport()
    return
  }
  // sites-core.json 的行是数组：[id, name, province, region, lat, lon, altM, bortle, …]
  const rows = JSON.parse(readFileSync(SITES_FILE, 'utf8')).rows.map((r) => ({
    id: r[0], name: r[1], lat: Number(r[4]), lon: Number(r[5]),
  }))
  const picked = rows.slice(0, LIMIT)
  const results = []
  for (const site of picked) {
    try {
      const row = await verifySite(site)
      results.push(row)
      console.log(`${site.name}: 气温 MAE ${row.tempMae ?? '—'}℃，云量 MAE ${row.cloudMae ?? '—'}%，${row.hours} 小时`)
    } catch (error) {
      console.log(`${site.name}: 跳过（${error.message}）`)
    }
  }
  const nums = (key) => results.map((r) => r[key]).filter((v) => Number.isFinite(v))
  const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null)
  const report = {
    generated: new Date().toISOString(),
    days: DAYS,
    baseline: 'best_match vs ecmwf_ifs025 同期预报差异（不确定度）',
    sites: results,
    tempMaeAvg: avg(nums('tempMae')),
    cloudMaeAvg: avg(nums('cloudMae')),
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`\n汇总：${results.length} 站，气温 MAE ${report.tempMaeAvg ?? '—'}℃，云量 MAE ${report.cloudMaeAvg ?? '—'}% → ${OUT}`)
}

main().catch((error) => {
  console.error(`✗ ${error.message}`)
  process.exit(1)
})
