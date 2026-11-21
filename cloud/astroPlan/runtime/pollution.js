/**
 * 波特尔（Bortle）估算：城市光晕模型。
 *
 * 数据：lib/data/city-glow.json（GeoNames cities15000，中国人口 ≥10 万的城市，707 个）
 * 模型：Walker 定律式叠加 —— L = Σ popK / (d^2.4 + 25)，只算 300 km 内的城市
 * 映射：log10(L) 分段线性映射到 Bortle 1–9（锚点用上海/北京中心、上海 30–50 km、
 *       崇明东滩、海坨山、拉萨、冷湖等地实测标定）
 *
 * 精度目标：城市中心 ±1 级、郊区 ±1 级；UI 一律标注「估算」。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXPONENT = 2.4
const SOFTENING = 25
const MAX_RANGE_KM = 300

/** log10(L) 分段阈值：从亮到暗。 */
const LEVELS = [
  { min: 2.7, bortle: 9 },
  { min: 2.0, bortle: 8 },
  { min: 1.3, bortle: 7 },
  { min: 0.85, bortle: 6 },
  { min: 0.45, bortle: 5 },
  { min: -0.45, bortle: 4 },
  { min: -1.0, bortle: 3 },
  { min: -1.6, bortle: 2 },
  { min: -Infinity, bortle: 1 },
]

let CITY_CACHE = null
function cities() {
  if (CITY_CACHE) return CITY_CACHE
  try {
    const doc = JSON.parse(readFileSync(join(HERE, 'data', 'city-glow.json'), 'utf8'))
    CITY_CACHE = Array.isArray(doc.cities) ? doc.cities : []
  } catch {
    CITY_CACHE = []
  }
  return CITY_CACHE
}

/** 该点的光晕强度 L（人口千人为单位，距离 km）。 */
export function glowAt(lat, lon) {
  const list = cities()
  if (!list.length) return null
  const latRad = (lat * Math.PI) / 180
  let sum = 0
  for (let i = 0; i < list.length; i += 1) {
    const [clat, clon, popK] = list[i]
    const dy = (clat - lat) * 111
    const dx = (clon - lon) * 111 * Math.cos(latRad)
    const d2 = dx * dx + dy * dy
    if (d2 > MAX_RANGE_KM * MAX_RANGE_KM) continue
    const d = Math.sqrt(d2)
    sum += popK / (Math.pow(d, EXPONENT) + SOFTENING)
  }
  return sum
}

/** log10 光晕 → Bortle。 */
export function bortleFromGlow(glow) {
  if (!Number.isFinite(glow) || glow <= 0) return 1
  const level = Math.log10(glow)
  for (const entry of LEVELS) {
    if (level >= entry.min) return entry.bortle
  }
  return 1
}

/**
 * 任意点的波特尔估算。
 * @returns {{bortle: number, glow: number|null, source: 'model'|'none'}}
 */
export function bortleAt(lat, lon) {
  const glow = glowAt(lat, lon)
  if (glow === null) return { bortle: 4, glow: null, source: 'none' }
  return { bortle: bortleFromGlow(glow), glow, source: 'model' }
}

/** 数据规模（meta/调试用）。 */
export function glowStats() {
  const list = cities()
  return { cities: list.length, exponent: EXPONENT, levels: LEVELS.length }
}
