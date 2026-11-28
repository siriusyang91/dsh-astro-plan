#!/usr/bin/env node
/**
 * 把 catalog 的真实数量写进 README / 用户指南 / 小程序文档 / package.json / market.config.json。
 * 发布前自动运行，避免数字漂移。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = join(import.meta.dirname, '..')
const catalog = await import(pathToFileURL(join(ROOT, 'lib', 'catalog.js')).href)
const sites = catalog.SITES.length
const targets = catalog.TARGETS.length
const deep = catalog.TARGETS.filter((t) => t.type === 'deepsky')
const planets = catalog.TARGETS.filter((t) => t.type === 'planet').length
const bySub = {}
for (const t of deep) bySub[t.subtype] = (bySub[t.subtype] || 0) + 1
const summary = `深空 ${deep.length}（星系 ${bySub.galaxy || 0} / 星云 ${bySub.nebula || 0} / 星团 ${bySub.cluster || 0} / 行星状星云 ${bySub.planetary || 0}）`

const files = ['README.md', 'docs/user-guide.md', 'docs/miniprogram.md', 'package.json', 'market.config.json']
for (const rel of files) {
  const file = join(ROOT, rel)
  let s = readFileSync(file, 'utf8')
  s = s.replace(/全国 \d+ 站/g, `全国 ${sites} 站`)
  s = s.replace(/站点库 \*\*\d+ 个\*\*/g, `站点库 **${sites} 个**`)
  s = s.replace(/站点库 \d+ 个/g, `站点库 ${sites} 个`)
  s = s.replace(/\*\*\d+ 个\*\*，覆盖 \*\*34 个省级行政区\*\*/g, `**${sites} 个**，覆盖 **34 个省级行政区**`)
  s = s.replace(/\d+ 站点/g, `${sites} 站点`)
  s = s.replace(/\d+ 个站点/g, `${sites} 个站点`)
  s = s.replace(/只有 \d+ 个站点/g, `只有 ${sites} 个站点`)
  s = s.replace(/目标库 \| \*\*\d+ 个\*\*：深空 [^|]+/g, `目标库 | **${targets} 个**：${summary} + 银河 3、黄道光 2、星轨 1、极光 1、流星雨 11、行星 ${planets}、日月食 2 `)
  s = s.replace(/\| 目标 \| \d+ 个（深空 [^|]+/g, `| 目标 | ${targets} 个（${summary}`)
  s = s.replace(/目标 \d+ 个（深空 [^）]+）/g, `目标 ${targets} 个（${summary}）`)
  writeFileSync(file, s)
}
console.log('文档数字已同步：站点', sites, '| 目标', targets, '| 深空', deep.length, '| 行星', planets)
