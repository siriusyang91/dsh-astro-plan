/**
 * 近期热门天象：未来 45 天内值得关注的日食/月食、流星雨、冲日、大距、合。
 * 结果用于小程序加载页轮播；随数据库每周更新（同一周内列表固定）。
 */
import * as astro from './astro.js'
import * as catalog from './catalog.js'
import * as events from './events.js'

const DAY = 86400000
const iso = (d) => new Date(d).toISOString().slice(0, 10)
const localDate = (d) => astro.localDateString(new Date(d))

/** 数据库更新时间所在周的键：同周内返回同一个值，用于“每周更新一次”的缓存 */
export function hotWeekKey(updatedAt) {
  const t = updatedAt ? new Date(updatedAt) : new Date()
  const monday = new Date(t)
  const day = (monday.getUTCDay() + 6) % 7
  monday.setUTCDate(monday.getUTCDate() - day)
  monday.setUTCHours(0, 0, 0, 0)
  return iso(monday)
}

/**
 * @returns {{id:string,kind:string,priority:number,date:string,title:string,text:string}[]}
 */
export function hotEvents(now = new Date(), limit = 8) {
  const from = new Date(now.getTime() - DAY)
  const to = new Date(now.getTime() + 45 * DAY)
  const out = []
  const push = (priority, date, kind, title, text) => {
    const d = new Date(date)
    if (d >= from && d <= to) out.push({ id: kind + ':' + iso(d) + ':' + title, kind, priority, date: iso(d), title, text })
  }

  for (const e of events.solarEclipsesBetween(iso(from), iso(to))) {
    push(1, e.peakUtc, 'solarEclipse', events.SOLAR_LABEL[e.kind] || '日食',
      `${e.label}（${localDate(e.peakUtc)}）· 提前踩点，备巴德膜/长焦`)
  }
  for (const e of events.lunarEclipsesBetween(iso(from), iso(to))) {
    push(1, e.peakUtc, 'lunarEclipse', events.LUNAR_LABEL[e.kind] || '月食',
      `${e.label}（${localDate(e.peakUtc)}）· 长焦记录红月与亮度变化`)
  }
  for (const p of catalog.EVENTS.meteors || []) {
    if (Number(p.zhr) < 40) continue
    const md = String(p.peakUtc).slice(5, 10)
    for (const y of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
      const peak = `${y}-${md}`
      push(2, peak, 'meteor', p.name, `${p.name} 极大 ${peak.slice(5)} · ZHR ${p.zhr}，选辐射点高的夜晚`)
    }
  }
  for (const e of events.planetEventsBetween(iso(from), iso(to))) {
    const planet = events.PLANET_CN[e.body] || e.body || ''
    if (e.type === 'opposition') {
      push(3, e.utc, 'opposition', planet + '冲日', `${planet}冲日 ${localDate(e.utc)} · 整夜可见，长焦拍细节`)
    } else if (e.type === 'elongation') {
      push(4, e.utc, 'elongation', planet + '大距', `${planet}大距 ${localDate(e.utc)} · 晨昏低空，抓住窗口`)
    } else if (e.type === 'conjunction') {
      push(String(e.label || '').includes('月') ? 6 : 5, e.utc, 'conjunction', (e.label || '合'), `${e.label || '合'}（${localDate(e.utc)}）· 同框构图，按角距选焦段`)
    }
  }
  out.sort((a, b) => a.priority - b.priority || a.date.localeCompare(b.date))
  const seen = new Set()
  return out.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))).slice(0, limit)
}
