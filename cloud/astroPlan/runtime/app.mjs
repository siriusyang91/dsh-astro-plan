/**
 * 云函数运行时入口（ESM）。由 tools/build-miniprogram.mjs 生成，请勿手改。
 */
import https from 'node:https'
import { search, meta, timeline } from './planner.js'
import { bortleAt } from './pollution.js'

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
