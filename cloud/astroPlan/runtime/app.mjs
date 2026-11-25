/**
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
/** 完整结果缓存：翻页只切片不重算（键=查询签名，LRU 5，10 分钟过期） */
const searchCache = new Map()
const SEARCH_TTL = 10 * 60 * 1000

function signature(opts) {
  const copy = { ...opts }
  delete copy.page
  delete copy.pageSize
  delete copy.collectAll
  return JSON.stringify(copy)
}

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
    if (opts.maxContexts === undefined) opts.maxContexts = 2500
    if (opts.siteLimit === undefined) opts.siteLimit = 90
    const pageSize = Math.max(1, Math.min(100, Number(opts.pageSize) || 20))
    const wantPage = Math.max(1, Number(opts.page) || 1)
    const key = signature(opts)
    let entry = searchCache.get(key)
    const hit = Boolean(entry && Date.now() - entry.at < SEARCH_TTL)
    if (hit) {
      searchCache.delete(key)
      searchCache.set(key, entry)
    } else {
      const full = await search({ ...opts, collectAll: true, pageSize: 100, page: 1 })
      if (!full.ok) return toJson(full)
      entry = { at: Date.now(), data: full }
      searchCache.set(key, entry)
      while (searchCache.size > 5) searchCache.delete(searchCache.keys().next().value)
    }
    const { all, ranked, ...rest } = entry.data
    const total = (all || []).length
    const totalPages = Math.min(100, Math.max(1, Math.ceil(total / pageSize)))
    const page = Math.min(wantPage, totalPages)
    const start = (page - 1) * pageSize
    const slice = (all || []).slice(start, start + pageSize)
      .map((item, i) => ({ ...item, rank: start + i + 1 }))
    return toJson({
      ...rest,
      query: { ...rest.query, page, pageSize },
      ranked: slice,
      pagination: { total, page, pageSize, totalPages },
      cached: hit,
    })
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
  return { ok: false, error: 'bad_action', message: `未知 action：${action}` }
}
