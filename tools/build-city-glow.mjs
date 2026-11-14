/**
 * 生成城市光晕数据 `lib/data/city-glow.json`（构建期联网一次）。
 *
 * 数据源：GeoNames cities15000（实测 3.2 MB / 4s，中国城市 2132 个，人口 ≥20 万 476 个）。
 * 输出：[[lat, lon, popK], …]，只留中国、人口 ≥10 万的城市，供波特尔估算使用。
 *
 *   node tools/build-city-glow.mjs          # 下载并生成
 *   node tools/build-city-glow.mjs --check  # 只校验现有文件
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const OUT = join(ROOT, 'lib', 'data', 'city-glow.json')
const SOURCE = 'https://download.geonames.org/export/dump/cities15000.zip'
const MIN_POP = 100000

/** 从 zip 里取出唯一的 deflate 文本（cities15000.txt）。 */
function unzipText(buf) {
  const sig = Buffer.from([0x50, 0x4b, 0x03, 0x04])
  const at = buf.indexOf(sig)
  if (at < 0) throw new Error('不是有效的 zip')
  const method = buf.readUInt16LE(at + 8)
  let compSize = buf.readUInt32LE(at + 18)
  const nameLen = buf.readUInt16LE(at + 26)
  const extraLen = buf.readUInt16LE(at + 28)
  const start = at + 30 + nameLen + extraLen
  if (compSize === 0 || compSize === 0xffffffff) compSize = buf.length - start
  const comp = buf.subarray(start, start + compSize)
  return (method === 8 ? inflateRawSync(comp) : comp).toString('utf8')
}

async function build() {
  const res = await fetch(SOURCE, { signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`)
  const text = unzipText(Buffer.from(await res.arrayBuffer()))

  const cities = []
  let minLon = 180
  let minLat = 90
  let maxLon = -180
  let maxLat = -90
  for (const line of text.split('\n')) {
    const f = line.split('\t')
    if (f.length < 15) continue
    if (f[8] !== 'CN') continue                       // country code
    const pop = Number(f[14])
    if (!Number.isFinite(pop) || pop < MIN_POP) continue
    const lat = Number(f[4])
    const lon = Number(f[5])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    cities.push([Math.round(lat * 1000) / 1000, Math.round(lon * 1000) / 1000, Math.round(pop / 1000)])
    minLon = Math.min(minLon, lon)
    maxLon = Math.max(maxLon, lon)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  }
  if (cities.length < 400) throw new Error(`城市过少：${cities.length}`)
  cities.sort((a, b) => b[2] - a[2])

  const doc = {
    source: SOURCE,
    fetched: new Date().toISOString().slice(0, 10),
    minPopulation: MIN_POP,
    bbox: [minLon, minLat, maxLon, maxLat],
    cities,
  }
  mkdirSync(dirname(OUT), { recursive: true })
  const body = `${JSON.stringify(doc)}\n`
  writeFileSync(OUT, body)
  console.log(`✓ 写出 ${OUT}：${cities.length} 个城市，${(body.length / 1024).toFixed(0)} KB`)
  console.log(`  最大城市：${cities.slice(0, 5).map((c) => `${c[2]}k@${c[0]},${c[1]}`).join('  ')}`)
}

function check() {
  if (!existsSync(OUT)) throw new Error(`缺少 ${OUT}，先跑 node tools/build-city-glow.mjs`)
  const doc = JSON.parse(readFileSync(OUT, 'utf8'))
  if (!Array.isArray(doc.cities) || doc.cities.length < 400) throw new Error('城市数量不足 400')
  const [minLon, minLat, maxLon, maxLat] = doc.bbox
  for (const [lat, lon, popK] of doc.cities) {
    if (lat < minLat - 0.5 || lat > maxLat + 0.5) throw new Error(`纬度越界：${lat}`)
    if (lon < minLon - 0.5 || lon > maxLon + 0.5) throw new Error(`经度越界：${lon}`)
    if (popK < MIN_POP / 1000) throw new Error(`人口过小：${popK}`)
  }
  const size = readFileSync(OUT).length
  if (size > 200 * 1024) throw new Error(`文件 ${(size / 1024).toFixed(0)} KB 超过 200 KB`)
  console.log(`✓ ${OUT} 合法：${doc.cities.length} 个城市，${(size / 1024).toFixed(0)} KB`)
}

if (process.argv.includes('--check')) {
  try { check() } catch (error) { console.error(`✗ ${error.message}`); process.exit(1) }
} else {
  try { await build(); check() } catch (error) { console.error(`✗ ${error.message}`); process.exit(1) }
}
