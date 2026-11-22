import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseCoord, formatCoord, formatDms } from '../lib/coord.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

test('coord：网页版与小程序的经纬度解析必须一致', () => {
  // 小程序 utils 是 CommonJS，但本仓库 package.json 是 type:module，
  // 直接 require 会被当成 ESM；这里按 CJS 语义就地求值。
  const source = readFileSync(join(ROOT, 'miniprogram', 'utils', 'coord.js'), 'utf8')
  const sandbox = { exports: {} }
  new Function('module', 'exports', source)(sandbox, sandbox.exports)
  const mp = sandbox.exports
  const samples = ['39.9042', '116.4074', '39°54′15″N', '116°24′27″E', '39 54 15 N', '39:54:15', '39.9 S', '116 W', '95', 'abc', '39°61′00″']
  for (const text of samples) {
    for (const kind of ['lat', 'lon']) {
      assert.equal(mp.parseCoord(text, kind), parseCoord(text, kind), `${text} / ${kind} 两端应一致`)
    }
  }
  assert.equal(mp.formatCoord(39.9042), formatCoord(39.9042))
  assert.equal(mp.formatDms(39.9042, 'lat'), formatDms(39.9042, 'lat'))
})

test('coord：角分秒与小数互转', () => {
  assert.equal(parseCoord('39°54′15″N', 'lat'), 39.904167)
  assert.equal(formatCoord(parseCoord('116°24′27″E', 'lon')), '116.407500')
  assert.match(formatDms(39.9042, 'lat'), /^39°54′\d+″N$/u)
  assert.match(formatDms(-118.5, 'lon'), /^118°30′0″W$/u)
})

test('云函数：meta / search / bortle / night 与非法 action', async () => {
  const fn = require(join(ROOT, 'cloud', 'astroPlan', 'index.js'))
  const meta = await fn.main({ action: 'meta' })
  assert.equal(meta.ok, true)
  assert.ok(meta.stats.total >= 173)
  assert.ok(meta.eventTypes.length >= 10)

  const search = await fn.main({
    action: 'search',
    opts: { eventType: 'meteor', dateStart: '2026-12-14', dateEnd: '2026-12-14', pageSize: 2, siteLimit: 6 },
  })
  assert.equal(search.ok, true)
  assert.ok(search.ranked.length >= 1)
  assert.equal(search.ranked[0].target.type, 'meteor')
  assert.equal(search.ranked[0].site.id.length > 0, true)

  const bortle = await fn.main({ action: 'bortle', lat: 31.2304, lon: 121.4737 })
  assert.equal(bortle.ok, true)
  assert.ok(bortle.bortle >= 8, '上海市中心应 ≥B8')

  const night = await fn.main({ action: 'night', siteLat: 38.737, siteLon: 93.332, date: '2026-12-14' })
  assert.equal(night.ok, true)
  assert.equal(night.site.custom, true)

  const bad = await fn.main({ action: 'nope' })
  assert.equal(bad.ok, false)
  assert.equal(bad.error, 'bad_action')
})

test('云函数运行时：产物存在、未过期、体积受控', () => {
  const runtime = join(ROOT, 'cloud', 'astroPlan', 'runtime')
  assert.ok(existsSync(join(runtime, 'app.mjs')), '缺少 runtime/app.mjs')
  assert.ok(existsSync(join(runtime, 'planner.js')), '缺少 runtime/planner.js')
  assert.ok(existsSync(join(runtime, 'data', 'targets.json')), '缺少运行时数据')
  const stamp = JSON.parse(readFileSync(join(runtime, 'VERSION.json'), 'utf8'))
  assert.ok(stamp.libHash && stamp.builtAt, 'VERSION.json 应记录 libHash 与构建时间')
  const pkg = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8'))
  assert.equal(pkg.type, 'module', 'runtime 需要 ESM')
  const entry = readFileSync(join(ROOT, 'cloud', 'astroPlan', 'package.json'), 'utf8')
  assert.ok(!JSON.parse(entry).type, '云函数入口目录必须是 CommonJS')
})

test('小程序工程：页面与组件文件齐全', () => {
  const app = JSON.parse(readFileSync(join(ROOT, 'miniprogram', 'app.json'), 'utf8'))
  assert.deepEqual(app.pages, ['pages/splash/index', 'pages/search/index', 'pages/results/index', 'pages/map/index'])
  for (const page of app.pages) {
    for (const ext of ['js', 'wxml', 'json']) {
      assert.ok(existsSync(join(ROOT, 'miniprogram', `${page}.${ext}`)), `缺少 ${page}.${ext}`)
    }
  }
  for (const ext of ['js', 'wxml', 'wxss', 'json']) {
    assert.ok(existsSync(join(ROOT, 'miniprogram', 'components', 'note-sheet', `index.${ext}`)), `便签组件缺少 index.${ext}`)
  }
  const project = JSON.parse(readFileSync(join(ROOT, 'project.config.json'), 'utf8'))
  assert.equal(project.compileType, 'miniprogram')
  assert.equal(project.miniprogramRoot, 'miniprogram/')
  assert.equal(project.cloudfunctionRoot, 'cloud/')
  assert.equal(project.appid, 'wx4b10ca10c39f00ab', 'AppID 应已填好')
})

test('小程序：npm 包不包含小程序与云函数源码（避免插件包膨胀）', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  for (const pattern of pkg.files) {
    assert.ok(!pattern.startsWith('miniprogram'), 'files 不应包含 miniprogram')
    assert.ok(!pattern.startsWith('cloud'), 'files 不应包含 cloud')
  }
})

/** 极简 WXML 校验：标签配对 + 自定义组件必须在 usingComponents 里声明。 */
function checkWxml(source, file) {
  const BUILTIN_HYPHEN = new Set(['scroll-view', 'picker-view', 'picker-view-column', 'swiper-item', 'cover-view',
    'cover-image', 'movable-view', 'movable-area', 'rich-text', 'web-view', 'functional-page-navigator',
    'official-account', 'open-data', 'live-player', 'live-pusher', 'live-pusher', 'video', 'camera', 'ad',
    'page-meta', 'navigation-bar', 'match-media', 'root-portal', 'share-element', 'voip-room'])
  const stack = []
  const tagRe = /<(\/?)([a-zA-Z][-\w]*)([^>]*?)(\/?)>/gu
  let match = tagRe.exec(source)
  while (match) {
    const [, closing, name, attrs, selfClose] = match
    const tag = name.toLowerCase()
    if (closing) {
      const top = stack.pop()
      assert.equal(top, tag, `${file}: </${tag}> 与 <${top ?? '?'}> 不配对`)
    } else if (!selfClose && !attrs.endsWith('/')) {
      stack.push(tag)
    }
    match = tagRe.exec(source)
  }
  assert.deepEqual(stack, [], `${file}: 有未闭合的标签 ${stack.join(', ')}`)
  return BUILTIN_HYPHEN
}

test('小程序 WXML：标签配对 + 自定义组件已声明（开发者工具会报这类错）', () => {
  const app = JSON.parse(readFileSync(join(ROOT, 'miniprogram', 'app.json'), 'utf8'))
  const files = app.pages.map((page) => `${page}.wxml`)
  files.push('components/note-sheet/index.wxml')
  for (const rel of files) {
    const file = join(ROOT, 'miniprogram', rel)
    const source = readFileSync(file, 'utf8')
    checkWxml(source, rel)

    // 找出用到的自定义组件
    const builtin = checkWxml(source, rel)
    const used = new Set()
    for (const m of source.matchAll(/<([a-z][a-z0-9]*-[a-z0-9-]+)[\s/>]/gu)) {
      if (!builtin.has(m[1])) used.add(m[1])
    }
    if (!used.size) continue
    const jsonPath = join(ROOT, 'miniprogram', rel.replace(/\.wxml$/u, '.json'))
    const conf = JSON.parse(readFileSync(jsonPath, 'utf8'))
    for (const tag of used) {
      assert.ok(conf.usingComponents && conf.usingComponents[tag],
        `${rel} 用了 <${tag}> 但 ${rel.replace(/\.wxml$/u, '.json')} 没声明 usingComponents`)
    }
  }
})

test('小程序页面脚本：能在 stub 环境里加载（无语法/顶层引用错误）', () => {
  const vm = require('node:vm')
  const path = require('node:path')

  function resolveSpec(fromFile, spec) {
    if (!spec.startsWith('.')) return spec
    let target = path.join(path.dirname(fromFile), spec)
    if (!target.endsWith('.js')) target += '.js'
    return target
  }

  function loadCjs(file, globals) {
    const module = { exports: {} }
    const sandbox = {
      module,
      exports: module.exports,
      console,
      require: (spec) => loadCjs(resolveSpec(file, spec), globals),
      ...globals,
    }
    vm.runInNewContext(readFileSync(file, 'utf8'), sandbox, { filename: file })
    return module.exports
  }

  const app = JSON.parse(readFileSync(join(ROOT, 'miniprogram', 'app.json'), 'utf8'))
  const pages = app.pages.concat(['components/note-sheet/index', 'components/sky-canvas/index'])
  for (const page of pages) {
    const file = join(ROOT, 'miniprogram', `${page}.js`)
    const captured = []
    const globals = {
      Page: (config) => captured.push(config),
      Component: (config) => captured.push(config),
      getApp: () => ({ globalData: { meta: null, query: null, pickedPoint: null, cloudEnv: 'x' } }),
      wx: {
        cloud: { init() {}, callFunction() {} },
        getLocation() {}, showToast() {}, showLoading() {}, hideLoading() {},
        navigateTo() {}, navigateBack() {}, stopPullDownRefresh() {},
        createSelectorQuery() { return { in() { return this }, select() { return this }, fields() { return this }, exec() {} } },
        getWindowInfo() { return { pixelRatio: 2 } },
      },
    }
    loadCjs(file, globals)
    assert.equal(captured.length, 1, `${page}.js 应调用一次 Page/Component`)
  }
})

test('云函数：超时与内存配置、天气预算已压到 2.5 秒', () => {
  const conf = JSON.parse(readFileSync(join(ROOT, 'cloud', 'astroPlan', 'config.json'), 'utf8'))
  assert.equal(conf.timeout, 60, 'config.json 应声明 60 秒超时（控制台仍以此为准）')
  const app = readFileSync(join(ROOT, 'cloud', 'astroPlan', 'runtime', 'app.mjs'), 'utf8')
  assert.ok(app.includes('setWeatherBudget(2500)'), '云函数里天气预算应为 2.5 秒')
})

test('小程序端：把 -504003 翻成可操作提示', () => {
  const src = readFileSync(join(ROOT, 'miniprogram', 'utils', 'api.js'), 'utf8')
  assert.ok(src.includes('-504003'), '应识别超时错误码')
  assert.ok(src.includes('超时时间'), '提示应告诉用户去改超时时间')
})

test('开屏页：首页是 splash，1 秒后跳查询页', () => {
  const app = JSON.parse(readFileSync(join(ROOT, 'miniprogram', 'app.json'), 'utf8'))
  assert.equal(app.pages[0], 'pages/splash/index', 'splash 必须是首个页面')
  assert.match(app.window.navigationBarTitleText, /by Sirius YANG/u, '全局标题应带作者')
  const js = readFileSync(join(ROOT, 'miniprogram', 'pages', 'splash', 'index.js'), 'utf8')
  assert.match(js, /setTimeout\([\s\S]*?, 1000\)/u, '开屏应 1 秒后跳转')
  assert.ok(js.includes("wx.redirectTo({ url: '/pages/search/index' })"), '应跳转到查询页')
  const wxml = readFileSync(join(ROOT, 'miniprogram', 'pages', 'splash', 'index.wxml'), 'utf8')
  assert.ok(wxml.includes('/assets/splash.jpg'), '开屏应使用附件图')
  assert.ok(wxml.includes('欢迎使用星野计划'), '开屏应显示欢迎语')
})

test('标题：各页都带「星野计划」', () => {
  for (const page of ['pages/search/index.json', 'pages/results/index.json', 'pages/map/index.json', 'pages/splash/index.json']) {
    const conf = JSON.parse(readFileSync(join(ROOT, 'miniprogram', page), 'utf8'))
    assert.match(conf.navigationBarTitleText, /星野计划/u, page + ' 标题应含星野计划')
  }
})

test('筛选条件：按网页版分为三组', () => {
  const wxml = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.wxml'), 'utf8')
  for (const title of ['拍摄日期', '目的地及出发地', '拍摄目标']) {
    assert.ok(wxml.includes(title), `缺少分组「${title}」`)
  }
  const js = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.js'), 'utf8')
  assert.ok(js.includes('onReset'), '应有重置按钮逻辑')
})

test('便签：右侧列不越界（可收缩 + 可换行）', () => {
  const css = readFileSync(join(ROOT, 'miniprogram', 'components', 'note-sheet', 'index.wxss'), 'utf8')
  assert.match(css, /grid-template-columns:\s*180rpx minmax\(0, 1fr\)/u, '两列布局应允许右列收缩')
  assert.ok(css.includes('min-width: 0'), '右列需要 min-width:0')
  assert.ok(css.includes('overflow-wrap: anywhere'), '长文本需要断行')
  assert.ok(css.includes('box-sizing: border-box'), '弹层需要 border-box，避免 padding 撑破')
})

test('3D 天球：渲染模块可加载，云端 sim 接口可用', async () => {
  const source = readFileSync(join(ROOT, 'miniprogram', 'utils', 'skyrender.js'), 'utf8')
  const sandbox = { exports: {} }
  new Function('module', 'exports', source)(sandbox, sandbox.exports)
  assert.equal(typeof sandbox.exports.skyRender, 'function', 'skyrender 应导出 skyRender')

  // 用真 sim 数据喂给渲染函数：假 ctx 全 noop，不应抛错
  const { search } = await import('../lib/planner.js')
  const result = await search({ eventType: 'milkyway', dateStart: '2026-12-14', dateEnd: '2026-12-14', pageSize: 1, withSim: true })
  const sim = result.ranked[0].sim
  const { meta } = await import('../lib/planner.js')
  const noop = () => {}
  const ctx = {
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    fillRect: noop, strokeRect: noop, fillText: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, arc: noop, fill: noop, stroke: noop, save: noop, restore: noop,
    clip: noop, setLineDash: noop, rect: noop, measureText: () => ({ width: 10 }),
    translate: noop, scale: noop, rotate: noop,
  }
  assert.doesNotThrow(() => {
    sandbox.exports.skyRender(ctx, { sim, sky: meta().sky, camera: sim.camera, mode: 'altaz', w: 480, h: 270 }, 0)
  }, 'skyRender 在假 ctx 上不应抛错')

  const fn = require(join(ROOT, 'cloud', 'astroPlan', 'index.js'))
  const simResult = await fn.main({
    action: 'sim',
    opts: { eventType: 'milkyway', minAltitude: 0, maxBortle: 6 },
    siteId: 'lenghu',
    date: '2026-12-14',
    targetId: result.ranked[0].target.id,
  })
  assert.equal(simResult.ok, true, simResult.message || '')
  assert.ok(simResult.sim.frames.length > 0, '云端 sim 应返回帧')
  assert.ok(JSON.stringify(simResult.sim).length < 300 * 1024, 'sim 体积应小于 300 KB')
})

test('小程序：合规与交互修复都在位', () => {
  const app = JSON.parse(readFileSync(join(ROOT, 'miniprogram', 'app.json'), 'utf8'))
  assert.deepEqual(app.requiredPrivateInfos, ['getLocation'], '需要声明定位用途，否则提审被驳回')

  const results = readFileSync(join(ROOT, 'miniprogram', 'pages', 'results', 'index.js'), 'utf8')
  assert.ok(results.includes('pagination.totalPages'), '翻页要读 totalPages')
  assert.ok(results.includes('setEnablePullDownRefresh(false)'), '便签打开时应禁用下拉刷新')
  assert.ok(results.includes('pageScrollTo'), '翻页后回到顶部')

  const wxml = readFileSync(join(ROOT, 'miniprogram', 'pages', 'results', 'index.wxml'), 'utf8')
  assert.ok(!wxml.includes('冷启动'), '加载文案不应再提冷启动')

  const noteCss = readFileSync(join(ROOT, 'miniprogram', 'components', 'note-sheet', 'index.wxss'), 'utf8')
  assert.match(noteCss, /\.sheet \{[^}]*height: 86vh/u, '便签弹层需要固定高度才能滚动')

  const sky = readFileSync(join(ROOT, 'miniprogram', 'components', 'sky-canvas', 'index.js'), 'utf8')
  assert.ok(sky.includes('Math.abs(dx) <= Math.abs(dy)'), '单指竖向滑动应交给页面滚动')
})

test('小程序：筛选页三组齐全且顺序为 目标/日期/地点', () => {
  const wxml = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.wxml'), 'utf8')
  const iTarget = wxml.indexOf('拍摄目标')
  const iDate = wxml.indexOf('拍摄日期')
  const iWhere = wxml.indexOf('目的地及出发地')
  assert.ok(iTarget >= 0 && iDate > iTarget && iWhere > iDate, '顺序应为 拍摄目标 → 拍摄日期 → 目的地及出发地')
})

test('文案：仓库里不再出现「18 类」，统一为「16 类拍摄目标」', () => {
  const files = ['README.md', 'docs/user-guide.md', 'package.json', 'market.config.json', 'miniprogram/pages/search/index.wxml']
  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), 'utf8')
    assert.ok(!/18\s*类/u.test(text), `${rel} 仍有「18 类」`)
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const market = JSON.parse(readFileSync(join(ROOT, 'market.config.json'), 'utf8'))
  assert.ok(pkg.description.includes('16 类拍摄目标'))
  assert.equal(pkg.description, market.description.zh)
  assert.ok(market.description.zh.includes('最长 5 年'))
})

test('网页版：拍摄目标分组在最前', () => {
  const src = readFileSync(join(ROOT, 'lib', 'webui.js'), 'utf8')
  const iTarget = src.indexOf('拍摄目标</div>')
  const iDate = src.indexOf('拍摄日期</div>')
  assert.ok(iTarget > 0 && iDate > iTarget, '拍摄目标应在拍摄日期之前')
})
