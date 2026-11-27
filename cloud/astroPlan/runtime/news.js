/**
 * 天文/航天新闻：每周更新的重大发现与航天成就。
 *
 * 数据来自 tools/build-news.mjs 抓取并写入 lib/data/news.json（每周刷新一次，
 * 只保留最近 180 天、含重大关键词的条目）。这里只做读取、按周稳定抽样。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILE = join(HERE, 'data', 'news.json')
const DAY = 86400000
const MAX_AGE_DAYS = 180

let cache = null
let cacheKey = ''

function load() {
  try {
    const raw = readFileSync(FILE, 'utf8')
    if (cacheKey === raw) return cache
    const data = JSON.parse(raw)
    cacheKey = raw
    cache = data && Array.isArray(data.items) ? data : { updatedAt: '', items: [] }
    return cache
  } catch (e) {
    return { updatedAt: '', items: [] }
  }
}

/** 最近 180 天内的新闻（按日期倒序） */
export function recentNews(now = new Date()) {
  const cutoff = now.getTime() - MAX_AGE_DAYS * DAY
  return load().items
    .filter((x) => x && x.title && x.text && x.date && new Date(x.date + 'T00:00:00Z').getTime() >= cutoff)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
}

/** 按「周键」稳定抽 count 条：同一周内顺序固定，下一周换一批 */
export function newsForWeek(weekKey, count = 3, now = new Date()) {
  const list = recentNews(now)
  if (!list.length) return []
  let h = 0
  for (const ch of String(weekKey || '')) h = (h * 31 + ch.charCodeAt(0)) % 100003
  const picked = []
  const used = new Set()
  for (let i = 0; i < count && i < list.length; i += 1) {
    let idx = (h + i * 7 + i * i * 13) % list.length
    let guard = 0
    while (used.has(idx) && guard < list.length) { idx = (idx + 1) % list.length; guard += 1 }
    used.add(idx)
    picked.push(list[idx])
  }
  return picked
}
