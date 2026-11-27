#!/usr/bin/env node
/**
 * 每周刷新「天文/航天新闻」：抓取公开 RSS，只保留近 180 天的重大条目并入 lib/data/news.json。
 *
 * 用法：node tools/build-news.mjs
 * 失败时保留旧文件（不阻塞发布）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const FILE = join(ROOT, 'lib', 'data', 'news.json')
const DAY = 86400000
const MAX_AGE = 180
const FEEDS = [
  { url: 'https://rss.mydrivers.com/rss.aspx?Tid=1', source: '快科技' },
  { url: 'https://www.ithome.com/rss/', source: 'IT之家' },
  { url: 'https://www.space.com/feeds/all', source: 'Space.com' },
  { url: 'https://spacenews.com/feed/', source: 'SpaceNews' },
]
const SPACE = /航天|空间站|火箭|卫星|望远镜|月球|火星|探测器|黑洞|星系|星舰|天问|嫦娥|小行星|彗星|超新星|系外行星|暗物质|引力波|太空|发射|轨道|NASA|JAXA|ESA/i
const MAJOR = /重大|首次|首个|突破|诺贝尔|里程碑|采样|登陆|着陆|黑洞|刷新|纪录|证实|发现|捕获/i

function parseDate(raw) {
  const s = String(raw || '').trim()
  if (!s) return NaN
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s)
  if (m) return Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + '+08:00')
  return Date.parse(s)
}

function textOf(title, date, source) {
  let text = title + '（' + date + '，' + source + '）'
  text += '，点击可查看原文与观测建议；这类进展常影响拍摄计划，值得留意。'
  return text
}

async function grab(feed) {
  const res = await fetch(feed.url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const xml = await res.text()
  const out = []
  for (const block of xml.split(/<item>/).slice(1)) {
    const pick = (tag) => {
      const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(block)
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim() : ''
    }
    const title = pick('title')
    const link = pick('link')
    const dateRaw = pick('pubDate')
    const category = pick('category')
    if (!title || !link) continue
    if (!SPACE.test(title) && !/天文|航天/.test(category)) continue
    if (!MAJOR.test(title)) continue
    const t = parseDate(dateRaw)
    if (!Number.isFinite(t) || Date.now() - t > MAX_AGE * DAY) continue
    const date = new Date(t).toISOString().slice(0, 10)
    out.push({ id: link, date, title, source: feed.source, url: link, text: textOf(title, date, feed.source) })
  }
  return out
}

async function main() {
  let old = { updatedAt: '', items: [] }
  try { old = JSON.parse(readFileSync(FILE, 'utf8')) } catch (e) { /* 首次 */ }
  const fresh = []
  for (const feed of FEEDS) {
    try {
      const items = await grab(feed)
      console.log('✓', feed.source, items.length, '条')
      fresh.push(...items)
    } catch (e) {
      console.log('✗', feed.source, e.message)
    }
  }
  const seen = new Set()
  const merged = []
  for (const x of [...fresh, ...(old.items || [])]) {
    if (!x || !x.title) continue
    const key = (x.url || '') + '|' + x.title
    if (seen.has(key)) continue
    if (Date.now() - new Date(x.date + 'T00:00:00Z').getTime() > MAX_AGE * DAY) continue
    seen.add(key)
    merged.push(x)
  }
  merged.sort((a, b) => String(b.date).localeCompare(String(a.date)))
  const next = { updatedAt: new Date().toISOString(), items: merged.slice(0, 40) }
  writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n')
  console.log('写入', next.items.length, '条 → lib/data/news.json')
}

main().catch((e) => { console.error('新闻更新失败，保留旧文件：', e.message); process.exitCode = 0 })
