/**
 * 生成微信小程序用的云函数运行时 + 小程序端共用工具。
 *
 *   node tools/build-miniprogram.mjs            # 构建 cloud/astroPlan/runtime
 *   node tools/build-miniprogram.mjs --check    # 只校验现有产物
 *
 * 产物：
 *   cloud/astroPlan/runtime/            ESM 运行时（lib/ 全量 + vendor + data + app.mjs）
 *   cloud/astroPlan/runtime/package.json  {"type":"module"}，让 Node 以 ESM 加载
 *   miniprogram/utils/coord.js          由 lib/coord.js 转成的 CommonJS 版（小程序端解析经纬度）
 *
 * 微信云函数运行 Node 16 的 CommonJS，入口 index.js 用动态 import() 加载这里的 ESM 运行时。
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync, cpSync } from 'node:fs'
import { createHash } from 'node:crypto'

import * as skyview from '../lib/skyview.js'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const LIB = join(ROOT, 'lib')
const RUNTIME = join(ROOT, 'cloud', 'astroPlan', 'runtime')
const MP_UTILS = join(ROOT, 'miniprogram', 'utils')
const LIMIT_BYTES = 8 * 1024 * 1024

function copyLib() {
  rmSync(RUNTIME, { recursive: true, force: true })
  mkdirSync(RUNTIME, { recursive: true })
  for (const name of readdirSync(LIB)) {
    const abs = join(LIB, name)
    const stat = statSync(abs)
    if (stat.isDirectory()) {
      cpSync(abs, join(RUNTIME, name), { recursive: true })
      continue
    }
    if (name.endsWith('.js')) cpSync(abs, join(RUNTIME, name))
  }
  writeFileSync(join(RUNTIME, 'package.json'), `${JSON.stringify({ type: 'module', private: true }, null, 2)}\n`)
}

const APP_MJS = `/**
 * 云函数运行时入口（ESM）。由 tools/build-miniprogram.mjs 生成，请勿手改。
 */
import https from 'node:https'
import { search, meta, timeline } from './planner.js'
import { bortleAt } from './pollution.js'
import { setWeatherBudget } from './weather.js'

// 云函数默认超时只有 3 秒：天气这种可选数据最多给 2.5 秒，天文计算照常全量
setWeatherBudget(2500)

/** Node 16 没有全局 fetch：补一个够用的 JSON GET（天气、彗星库用）。 */
if (typeof globalThis.fetch !== 'function') {
  globalThis.fetch = function fetchPolyfill(url, init = {}) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: init.headers || {},
        timeout: init.timeout || 12000,
      }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: { get: (key) => res.headers[String(key).toLowerCase()] ?? null },
            text: async () => text,
            json: async () => JSON.parse(text),
            arrayBuffer: async () => Buffer.concat(chunks),
          })
        })
      })
      req.on('timeout', () => req.destroy(new Error('timeout')))
      req.on('error', reject)
      if (init.signal) init.signal.addEventListener('abort', () => req.destroy(new Error('aborted')))
    })
  }
}

const simCache = new Map()

function toJson(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * 云函数统一入口：按 event.action 分派，复用网页版同一套逻辑。
 *   meta                      → 站点/目标/事件/天气窗口等元数据
 *   search { opts }           → 检索（默认关闭画面模拟，控制返回体积）
 *   night { site, date, siteLat, siteLon } → 单夜时间轴
 *   bortle { lat, lon }       → 城市光晕模型估算的波特尔
 */
export async function handle(event = {}) {
  const action = event.action || 'search'
  if (action === 'meta') {
    return toJson({ ok: true, ...meta() })
  }
  if (action === 'search') {
    const opts = { ...(event.opts || {}) }
    if (opts.withSim === undefined) opts.withSim = false
    if (opts.maxContexts === undefined) opts.maxContexts = 4000
    const result = await search(opts)
    return toJson(result)
  }
  if (action === 'night') {
    const result = timeline(event.site || '', event.date, {
      siteLat: event.siteLat,
      siteLon: event.siteLon,
    })
    return toJson(result)
  }
  if (action === 'sim') {
    const cacheKey = [
      event.siteId || (event.siteLat + ',' + event.siteLon),
      event.date,
      event.targetId,
      (event.opts && event.opts.eventType) || 'any',
    ].join('|')
    const hit = simCache.get(cacheKey)
    if (hit) {
      simCache.delete(cacheKey)
      simCache.set(cacheKey, hit)
      return { ok: true, cached: true, sim: hit }
    }
    // 单结果画面模拟：用同一套查询条件，但锁定「站点 + 那一夜」，只回这一个结果的 sim
    const opts = { ...(event.opts || {}) }
    opts.dateStart = event.date
    opts.dateEnd = event.date
    opts.siteLimit = 1
    opts.pageSize = 60
    opts.page = 1
    opts.withSim = true
    if (event.siteId) opts.location = event.siteId
    else if (event.siteLat !== undefined && event.siteLon !== undefined) {
      opts.siteLat = event.siteLat
      opts.siteLon = event.siteLon
    }
    // 画面模拟不需要天气：把预算压到 0.6 秒，避免拖慢
    setWeatherBudget(600)
    let result
    try {
      result = await search(opts)
    } finally {
      setWeatherBudget(2500)
    }
    if (!result.ok) return toJson({ ok: false, error: result.error || 'search_failed', message: result.message })
    const picked = (result.ranked || []).find((item) => item.target && item.target.id === event.targetId)
    if (!picked) return { ok: false, error: 'sim_unavailable', message: '该目标当晚不可见，无法生成画面模拟' }
    if (!picked.sim) return { ok: false, error: 'sim_empty', message: '画面模拟数据为空' }
    simCache.set(cacheKey, picked.sim)
    while (simCache.size > 30) simCache.delete(simCache.keys().next().value)
    return toJson({ ok: true, cached: false, sim: picked.sim })
  }
  if (action === 'bortle') {
    const lat = Number(event.lat)
    const lon = Number(event.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return { ok: false, error: 'bad_coords', message: 'lat/lon 不合法' }
    }
    return toJson({ ok: true, ...bortleAt(lat, lon) })
  }
  return { ok: false, error: 'bad_action', message: \`未知 action：\${action}\` }
}
`

/** lib/skyview.js 的 RENDER_SRC → 小程序可 require 的绘制模块。 */
function buildSkyRenderer() {
  const { RENDER_SRC } = skyview
  const out = `/**
 * 3D 天球渲染（由 lib/skyview.js 的 RENDER_SRC 生成，请勿手改）。
 * 用法：require('./skyrender').skyRender(ctx, { sim, sky, camera, mode, w, h }, frameIndex)
 */
${RENDER_SRC}
module.exports = { skyRender }
`
  writeFileSync(join(MP_UTILS, 'skyrender.js'), out)
}

/** lib/coord.js（ESM）→ 小程序可 require 的 CommonJS。 */
function buildCoordModule() {
  const src = readFileSync(join(LIB, 'coord.js'), 'utf8')
  const body = src
    .replace(/^export function /gmu, 'function ')
    .replace(/^\/\*\*[\s\S]*?\*\/\s*$/mu, '')
  mkdirSync(MP_UTILS, { recursive: true })
  const out = `/**
 * 经纬度解析（由 lib/coord.js 生成，请勿手改；改逻辑请改 lib/coord.js 后重跑构建）。
 */
${body}
module.exports = { parseCoord, formatCoord, formatDms }
`
  writeFileSync(join(MP_UTILS, 'coord.js'), out)
}

function dirSize(dir) {
  let total = 0
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const stat = statSync(abs)
    total += stat.isDirectory() ? dirSize(abs) : stat.size
  }
  return total
}

/** lib 内容哈希：用于判断 runtime 是否过期（改过 lib 却没重新构建时要能发现）。 */
function libHash() {
  const hash = createHash('sha256')
  for (const name of readdirSync(LIB).sort()) {
    const abs = join(LIB, name)
    if (statSync(abs).isDirectory()) {
      for (const inner of readdirSync(abs).sort()) {
        const innerAbs = join(abs, inner)
        if (!statSync(innerAbs).isFile()) continue
        hash.update(inner).update(readFileSync(innerAbs))
      }
      continue
    }
    if (name.endsWith('.js')) hash.update(name).update(readFileSync(abs))
  }
  return hash.digest('hex')
}

function build() {
  copyLib()
  writeFileSync(join(RUNTIME, 'app.mjs'), APP_MJS)
  writeFileSync(join(RUNTIME, 'VERSION.json'), `${JSON.stringify({ libHash: libHash(), builtAt: new Date().toISOString() }, null, 2)}\n`)
  buildCoordModule()
  buildSkyRenderer()
  check()
}

function check() {
  const entry = join(ROOT, 'cloud', 'astroPlan', 'index.js')
  if (!existsSync(entry)) throw new Error('缺少 cloud/astroPlan/index.js')
  if (!existsSync(join(RUNTIME, 'app.mjs'))) throw new Error('缺少 runtime/app.mjs，先跑构建')
  for (const name of ['planner.js', 'catalog.js', 'pollution.js', 'coord.js']) {
    if (!existsSync(join(RUNTIME, name))) throw new Error(`运行时缺少 ${name}`)
  }
  if (!existsSync(join(RUNTIME, 'data', 'targets.json'))) throw new Error('运行时缺少 data/targets.json')
  if (!existsSync(join(RUNTIME, 'vendor', 'astronomy-engine.js'))) throw new Error('运行时缺少 astronomy-engine')
  const stamp = JSON.parse(readFileSync(join(RUNTIME, 'VERSION.json'), 'utf8'))
  if (stamp.libHash !== libHash()) throw new Error('运行时已过期：lib/ 改过但没重新构建，跑一次 node tools/build-miniprogram.mjs')
  const meta = JSON.parse(readFileSync(join(RUNTIME, 'package.json'), 'utf8'))
  if (meta.type !== 'module') throw new Error('runtime/package.json 需要 "type": "module"')
  const size = dirSize(RUNTIME)
  if (size > LIMIT_BYTES) throw new Error(`运行时 ${(size / 1024 / 1024).toFixed(1)} MB 超过 8 MB 上限`)
  const mp = join(ROOT, 'miniprogram')
  if (!existsSync(join(mp, 'app.json'))) throw new Error('缺少 miniprogram/app.json')
  if (!existsSync(join(MP_UTILS, 'skyrender.js'))) throw new Error('缺少 miniprogram/utils/skyrender.js，先跑构建')
  if (!existsSync(join(mp, 'assets', 'splash.jpg'))) throw new Error('缺少 miniprogram/assets/splash.jpg（开屏图）')
  console.log(`✓ 云函数运行时 ${(size / 1024).toFixed(0)} KB（上限 ${(LIMIT_BYTES / 1024 / 1024).toFixed(0)} MB）`)
  console.log(`  ${relative(ROOT, RUNTIME)} → 复制到微信云函数 astroPlan/runtime 即可`)
}

if (process.argv.includes('--check')) {
  try { check() } catch (error) { console.error(`✗ ${error.message}`); process.exit(1) }
} else {
  try { build() } catch (error) { console.error(`✗ ${error.message}`); process.exit(1) }
}
