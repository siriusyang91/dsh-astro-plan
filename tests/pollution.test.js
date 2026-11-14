import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bortleAt, bortleFromGlow, glowAt, glowStats } from '../lib/pollution.js'
import { customSite } from '../lib/catalog.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('城市光晕数据：规模与范围合理', () => {
  const doc = JSON.parse(readFileSync(join(ROOT, 'lib', 'data', 'city-glow.json'), 'utf8'))
  assert.ok(doc.cities.length >= 400, `城市数只有 ${doc.cities.length}`)
  const [minLon, minLat, maxLon, maxLat] = doc.bbox
  for (const [lat, lon, popK] of doc.cities) {
    assert.ok(lat >= minLat - 0.5 && lat <= maxLat + 0.5, '纬度越界')
    assert.ok(lon >= minLon - 0.5 && lon <= maxLon + 0.5, '经度越界')
    assert.ok(popK >= 100, '人口应 ≥10 万')
  }
  assert.deepEqual(glowStats().cities, doc.cities.length)
})

test('波特尔锚点：城市中心 B8–9，郊区递减，暗夜 B1–2', () => {
  const shanghai = bortleAt(31.2304, 121.4737).bortle
  const beijing = bortleAt(39.9087, 116.3975).bortle
  const hangzhou = bortleAt(30.2489, 120.1444).bortle
  const sh50 = bortleAt(31.23, 120.94).bortle
  const haituo = bortleAt(40.6, 115.8).bortle
  const lenghu = bortleAt(38.737, 93.332).bortle
  const chongming = bortleAt(31.52, 121.95).bortle

  assert.ok(shanghai >= 8, `上海人民广场应 ≥B8，实际 B${shanghai}`)
  assert.ok(beijing >= 8, `天安门应 ≥B8，实际 B${beijing}`)
  assert.ok(hangzhou >= 7, `西湖应 ≥B7，实际 B${hangzhou}`)
  assert.ok(sh50 >= 5 && sh50 <= 7, `上海西 50km 应在 B5–7，实际 B${sh50}`)
  assert.ok(haituo >= 3 && haituo <= 5, `海坨山应在 B3–5，实际 B${haituo}`)
  assert.ok(chongming >= 4 && chongming <= 6, `崇明东滩应在 B4–6，实际 B${chongming}`)
  assert.ok(lenghu <= 2, `冷湖应 ≤B2，实际 B${lenghu}`)
})

test('波特尔：离城市越远越暗（单调性）', () => {
  // 往东是东海，沿途没有其他城市，能干净地检验衰减
  const east = [[31.23, 121.4737], [31.23, 121.90], [31.23, 122.30], [31.23, 122.90]]
  const values = east.map(([lat, lon]) => bortleAt(lat, lon).bortle)
  assert.ok(values[0] >= values[1], `市中心 ${values[0]} 应不暗于 30km ${values[1]}`)
  assert.ok(values[1] >= values[2], `40km ${values[1]} 应不暗于 80km ${values[2]}`)
  assert.ok(values[2] >= values[3], `80km ${values[2]} 应不暗于 135km ${values[3]}`)
  assert.ok(values[3] >= 2, '135km 海上也不该比 B2 更暗')
})

test('自定义点：3 km 内取站点策展值，之外用模型', () => {
  const near = customSite({ lat: 40.605, lon: 115.8 })
  assert.equal(near.bortle, 4, '海坨山附近应保持策展值 B4')
  assert.equal(near.bortleSource, 'site')
  const far = customSite({ lat: 40.9, lon: 116.4 })
  assert.equal(far.bortleSource, 'model')
  assert.equal(far.bortleConfidence, 'model')
  const city = customSite({ lat: 31.2304, lon: 121.4737 })
  assert.ok(city.bortle >= 8, `市中心应 ≥B8，实际 B${city.bortle}`)
  assert.match(city.note, /城市光晕模型/iu)
})

test('波特尔 API：/api/bortle 返回模型结果，非法坐标 400', async () => {
  const { installApi } = await import('../lib/api.js')
  const captured = {}
  const ctx = {
    webServer: { register(route) { captured.route = route } },
  }
  installApi(ctx)
  const call = async (url) => {
    const headers = {}
    let body = ''
    const res = {
      writeHead(status, extra) { headers.status = status; Object.assign(headers, extra ?? {}) },
      end(chunk) { body = chunk },
    }
    await captured.route.handler({ method: 'GET', url }, res)
    return { status: headers.status, json: () => JSON.parse(body) }
  }
  const ok = await call('/astro-plan/api/bortle?lat=31.2304&lon=121.4737')
  assert.equal(ok.status, 200)
  assert.ok(ok.json().bortle >= 8)
  assert.equal(ok.json().source, 'model')
  const bad = await call('/astro-plan/api/bortle?lat=999&lon=0')
  assert.equal(bad.status, 400)
})

test('检索：城市中心 B9 即使超过上限也保留该点', async () => {
  const { search } = await import('../lib/planner.js')
  const result = await search({
    eventType: 'any', siteLat: 31.2304, siteLon: 121.4737,
    dateStart: '2026-11-18', dateEnd: '2026-11-19', pageSize: 3, maxBortle: 6,
  })
  assert.equal(result.ok, true)
  assert.ok(result.ranked.length > 0)
  assert.equal(result.ranked[0].site.bortle, 9)
  assert.ok(result.notes.some((note) => note.includes('已保留该点继续评估')), '应有保留说明')
})
