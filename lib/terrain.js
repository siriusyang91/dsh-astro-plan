/**
 * 真实高程天际线：任意经纬度 → 近景/远景两层剖面（与 tools/build-horizon.mjs 同一套公式）。
 *
 * 数据源：AWS Open Data Terrain Tiles（Mapzen terrarium）。zoom 8 远层（约 600 m/px），
 * zoom 12 近层（约 38 m/px）。采样含地球曲率与折射（R_eff = R/(1-0.13)）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { inflateSync } from 'node:zlib'

const Z = 8
const Z_V = 12
const STEP = 10
const STEP_V = 5
const NEAR_V_KM = 1.5
const NEAR_KM = 25
const MAX_KM = 140
const CAP_DEG = 45
const R_EARTH = 6371000
const R_EFF = R_EARTH / (1 - 0.13)
const D2R = Math.PI / 180
const R2D = 180 / Math.PI
const CACHE_DIR = join(tmpdir(), 'dsh-astro-plan-terrain')

const AZS = Array.from({ length: 360 / STEP }, (_, i) => i * STEP)
const AZS_V = Array.from({ length: 360 / STEP_V }, (_, i) => i * STEP_V)
const SAMPLES = (() => {
  const out = []
  for (let d = 1500; d <= 6000; d += 500) out.push(d)
  for (let d = 7000; d <= 30000; d += 1000) out.push(d)
  for (let d = 32000; d <= MAX_KM * 1000; d += 2000) out.push(d)
  return out
})()
const SAMPLES_V = (() => { const out = []; for (let d = 100; d <= NEAR_V_KM * 1000; d += 50) out.push(d); return out })()

function decodePng(buf) {
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 0
  let bitDepth = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error('unsupported png')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const ch = colorType === 6 ? 4 : 3
  const stride = width * ch
  const out = Buffer.alloc(width * height * ch)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = Buffer.from(line)
    for (let i = 0; i < stride; i += 1) {
      const a = i >= ch ? cur[i - ch] : 0
      const b = prev[i]
      const c = i >= ch ? prev[i - ch] : 0
      let v = cur[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : (pb <= pc ? b : c)
      }
      cur[i] = v & 255
    }
    cur.copy(out, y * stride)
    prev = cur
  }
  return { width, height, ch, data: out }
}

const tiles = new Map()

function tileXY(lat, lon, zoom) {
  const n = 2 ** zoom
  const x = ((lon + 180) / 360) * n
  const s = Math.sin(lat * D2R)
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n
  return { x, y }
}

async function fetchTile(tx, ty, zoom) {
  const key = zoom + '/' + tx + '/' + ty
  if (tiles.has(key)) return tiles.get(key)
  const file = join(CACHE_DIR, String(zoom), String(tx), ty + '.png')
  let buf = null
  if (existsSync(file)) buf = readFileSync(file)
  else {
    const url = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + zoom + '/' + tx + '/' + ty + '.png'
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    buf = Buffer.from(await res.arrayBuffer())
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, buf)
  }
  const png = decodePng(buf)
  tiles.set(key, png)
  return png
}

function elevationAt(lat, lon, zoom) {
  const p = tileXY(lat, lon, zoom)
  const tx = Math.floor(p.x); const ty = Math.floor(p.y)
  const png = tiles.get(zoom + '/' + tx + '/' + ty)
  if (!png) return null
  const px = Math.min(png.width - 1, Math.max(0, Math.floor((p.x - tx) * png.width)))
  const py = Math.min(png.height - 1, Math.max(0, Math.floor((p.y - ty) * png.height)))
  const i = (py * png.width + px) * png.ch
  return png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768
}

function destination(lat, lon, azDeg, dM) {
  const delta = dM / R_EARTH
  const theta = azDeg * D2R
  const phi1 = lat * D2R
  const lam1 = lon * D2R
  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta)
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)))
  const lam2 = lam1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * sinPhi2)
  return [phi2 * R2D, ((lam2 * R2D + 540) % 360) - 180]
}

async function prefetch(zoom, lat, lon, radius) {
  const n = 2 ** zoom
  const p = tileXY(lat, lon, zoom)
  const cx = Math.floor(p.x); const cy = Math.floor(p.y)
  const tasks = []
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      tasks.push(fetchTile((((cx + dx) % n) + n) % n, Math.max(0, Math.min(n - 1, cy + dy)), zoom))
    }
  }
  await Promise.all(tasks)
}

const cap = (v) => Math.round(Math.max(-6, Math.min(CAP_DEG, v === -90 ? 0 : v)) * 10) / 10

/** 远/中景 + 近景两份剖面 */
export async function horizonFor(lat, lon, altM) {
  const la = Number(lat); const lo = Number(lon)
  if (!Number.isFinite(la) || !Number.isFinite(lo)) throw new Error('坐标无效')
  await prefetch(Z, la, lo, 2)
  await prefetch(Z_V, la, lo, 1)
  const dem0 = elevationAt(la, lo, Z)
  const h0 = Number.isFinite(altM) && altM > 0 ? Math.max(altM, dem0 ?? 0) : (dem0 ?? 0)
  const n = []; const f = []
  for (const az of AZS) {
    let near = -90; let far = -90
    for (const dM of SAMPLES) {
      const [plat, plon] = destination(la, lo, az, dM)
      const h = elevationAt(plat, plon, Z)
      if (h == null) continue
      const ang = Math.atan2(h - h0 - (dM * dM) / (2 * R_EFF), dM) * R2D
      if (dM <= NEAR_KM * 1000) near = Math.max(near, ang)
      else far = Math.max(far, ang)
    }
    n.push(cap(near)); f.push(cap(far))
  }
  const dem0v = elevationAt(la, lo, Z_V)
  const h0v = Number.isFinite(altM) && altM > 0 ? Math.max(altM, dem0v ?? 0) : (dem0v ?? 0)
  const v = []
  for (const az of AZS_V) {
    let alt = -90
    for (const dM of SAMPLES_V) {
      const [plat, plon] = destination(la, lo, az, dM)
      const h = elevationAt(plat, plon, Z_V)
      if (h == null) continue
      const ang = Math.atan2(h - h0v - (dM * dM) / (2 * R_EFF), dM) * R2D
      alt = Math.max(alt, ang)
    }
    v.push(cap(alt))
  }
  return { v, n, f, altM: Math.round(h0) }
}
