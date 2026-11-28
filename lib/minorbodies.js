/**
 * 小行星 / 矮行星：用轨道要素做两体近似，输出地心赤经赤纬、视星等与距离。
 * 复用 comets 的开普勒求解（q = a(1-e)，tp 由平近点角反推）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cometState } from './comets.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = JSON.parse(readFileSync(join(HERE, 'data', 'minor-bodies.json'), 'utf8'))
const K_GAUSS = 0.01720209895
const D2R = Math.PI / 180
const R2D = 180 / Math.PI
const cache = new Map()

function elementsOf(b) {
  const a = b.a
  const q = a * (1 - b.e)
  const n = K_GAUSS / Math.pow(a, 1.5)
  const tp = DATA.epochJD - (b.M0 * D2R) / n
  return { id: b.id, e: b.e, q, i: b.i, om: b.om, w: b.w, tp, H: b.H, G: b.G }
}

const ELEMENTS = new Map(DATA.bodies.map((b) => [b.id, elementsOf(b)]))

/** @returns {{raDeg:number,decDeg:number,mag:number,delta:number,r:number}} */
export function position(id, date) {
  const el = ELEMENTS.get(id)
  if (!el) throw new Error('未知小天体：' + id)
  const st = cometState(el, date)
  const { x, y, z } = st.vec
  const r = Math.hypot(x, y, z) || 1
  const ra = ((Math.atan2(y, x) * R2D) % 360 + 360) % 360
  const dec = Math.asin(Math.max(-1, Math.min(1, z / r))) * R2D
  return { raDeg: ra, decDeg: dec, mag: st.mag, delta: st.delta, r: st.r }
}

export function elementOf(id) { return ELEMENTS.get(id) || null }
export const MINOR_BODIES = DATA.bodies
