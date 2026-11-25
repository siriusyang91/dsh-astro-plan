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
  assert.deepEqual(app.pages, ['pages/splash/index', 'pages/note/index', 'pages/search/index', 'pages/results/index', 'pages/map/index'])
  for (const page of app.pages) {
    for (const ext of ['js', 'wxml', 'json']) {
      assert.ok(existsSync(join(ROOT, 'miniprogram', `${page}.${ext}`)), `缺少 ${page}.${ext}`)
    }
  }
  for (const ext of ['js', 'wxml', 'wxss', 'json']) {
    assert.ok(existsSync(join(ROOT, 'miniprogram', 'components', 'sky-canvas', `index.${ext}`)), `天球组件缺少 index.${ext}`)
  }
  assert.ok(!existsSync(join(ROOT, 'miniprogram', 'components', 'note-sheet')), '便签弹层组件应已删除（改为独立页面）')
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
  files.push('components/sky-canvas/index.wxml')
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
  const pages = app.pages.concat(['components/sky-canvas/index'])
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

test('小程序端：超时只提示「查询超时」', () => {
  const src = readFileSync(join(ROOT, 'miniprogram', 'utils', 'api.js'), 'utf8')
  assert.ok(src.includes('-504003'), '应识别超时错误码')
  assert.ok(src.includes("reject(new Error('查询超时'))"), '文案应只有「查询超时」')
  assert.ok(!src.includes('超时时间'), '不应提示去改控制台超时时间')
})

test('开屏页：首页是 splash，1 秒后跳查询页', () => {
  const app = JSON.parse(readFileSync(join(ROOT, 'miniprogram', 'app.json'), 'utf8'))
  assert.equal(app.pages[0], 'pages/splash/index', 'splash 必须是首个页面')
  assert.equal(app.window.navigationBarTitleText, '星野计划', '全局标题不应带 byline')
  const js = readFileSync(join(ROOT, 'miniprogram', 'pages', 'splash', 'index.js'), 'utf8')
  assert.match(js, /setTimeout\([\s\S]*?, 1000\)/u, '开屏应 1 秒后跳转')
  assert.ok(js.includes("wx.redirectTo({ url: '/pages/search/index' })"), '应跳转到查询页')
  const wxml = readFileSync(join(ROOT, 'miniprogram', 'pages', 'splash', 'index.wxml'), 'utf8')
  assert.ok(wxml.includes('/assets/splash.jpg'), '开屏应使用附件图')
  assert.ok(wxml.includes('欢迎使用星野计划'), '开屏应显示欢迎语')
})

test('标题：导航栏不带 byline', () => {
  const app = JSON.parse(readFileSync(join(ROOT, 'miniprogram', 'app.json'), 'utf8'))
  assert.equal(app.window.navigationBarTitleText, '星野计划')
  for (const page of ['pages/search/index.json', 'pages/results/index.json', 'pages/map/index.json', 'pages/splash/index.json', 'pages/note/index.json']) {
    const conf = JSON.parse(readFileSync(join(ROOT, 'miniprogram', page), 'utf8'))
    assert.ok(!/by Sirius YANG/u.test(conf.navigationBarTitleText || ''), page + ' 标题不应带 byline')
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
  const css = readFileSync(join(ROOT, 'miniprogram', 'pages', 'note', 'index.wxss'), 'utf8')
  assert.match(css, /grid-template-columns:\s*170rpx minmax\(0, 1fr\)/u, '两列布局应允许右列收缩')
  assert.ok(css.includes('min-width: 0'), '右列需要 min-width:0')
  assert.ok(css.includes('overflow-wrap: anywhere'), '长文本需要断行')
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
  assert.ok(!/wx\.setEnablePullDownRefresh\s*\(/u.test(results), '不存在该 API，不能再调用')
  assert.ok(!results.includes('sheetVisible'), '结果页不再有弹层状态')
  assert.ok(results.includes('pageScrollTo'), '翻页后回到顶部')

  const wxml = readFileSync(join(ROOT, 'miniprogram', 'pages', 'results', 'index.wxml'), 'utf8')
  assert.ok(!wxml.includes('冷启动'), '加载文案不应再提冷启动')

  const notePage = readFileSync(join(ROOT, 'miniprogram', 'pages', 'note', 'index.js'), 'utf8')
  assert.ok(notePage.includes('notePayload'), '便签页从 globalData 取数据')
  assert.ok(notePage.includes('api.sim('), '便签页懒加载画面模拟')

  const sky = readFileSync(join(ROOT, 'miniprogram', 'components', 'sky-canvas', 'index.js'), 'utf8')
  assert.ok(sky.includes('this.camera.pitch + dy'), '单指纵向应能改俯仰')
  assert.ok(sky.includes('baseDist'), '双指缩放要有动态基准')
  assert.ok(/FOV_MIN = 5/u.test(sky) && /FOV_MAX = 180/u.test(sky), '缩放范围应对齐渲染器 5–180°')
  const skyWxml = readFileSync(join(ROOT, 'miniprogram', 'components', 'sky-canvas', 'index.wxml'), 'utf8')
  assert.ok(skyWxml.includes('catchtouchmove'), 'canvas 区域需要拦截页面滚动')
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

test('翻页：云端 collectAll + 缓存切片，第 2 页不重算', async () => {
  const { search } = await import('../lib/planner.js')
  const base = { eventType: 'deepsky', dateStart: '2027-03-10', dateEnd: '2027-03-10', pageSize: 20, siteLimit: 3, maxBortle: 9, collectAll: true }
  const all = await search(base)
  assert.equal(all.all.length, all.pagination.total, 'collectAll 应返回完整列表')
  assert.equal(all.all[0].rank, 1)
  assert.equal(all.all[all.all.length - 1].rank, all.all.length, 'rank 应连续')

  const fn = require(join(ROOT, 'cloud', 'astroPlan', 'index.js'))
  const opts = { eventType: 'deepsky', dateStart: '2027-03-10', dateEnd: '2027-03-10', pageSize: 20, siteLimit: 3, maxBortle: 9 }
  const p1 = await fn.main({ action: 'search', opts: { ...opts, page: 1 } })
  const p2 = await fn.main({ action: 'search', opts: { ...opts, page: 2 } })
  assert.equal(p2.cached, true, '第 2 页应命中云端缓存')
  assert.equal(p2.ranked[0].rank, 21, '第 2 页首条 rank 应为 21')
  assert.equal(p1.ranked[0].rank, 1, '第 1 页首条 rank 应为 1')
  assert.equal(p2.ranked.length <= 20, true)
})

test('便签与查询页：弹层可点开、首页内容完整', () => {
  const splashCss = readFileSync(join(ROOT, 'miniprogram', 'pages', 'splash', 'index.wxss'), 'utf8')
  assert.ok(!/inset:/u.test(splashCss), '不要用 inset（部分安卓 WebView 不支持）')

  const results = readFileSync(join(ROOT, 'miniprogram', 'pages', 'results', 'index.wxml'), 'utf8')
  assert.ok(!results.includes('note-sheet'), '结果页不再内嵌弹层')
  assert.ok(results.includes('catchtap="openNote"'), '卡片上要有明确可点的「查看便签」')

  const search = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.wxml'), 'utf8')
  for (const label of ['拍摄目标', '拍摄日期', '目的地及出发地', '目标地区', '目标省份', '目标地点', '出发地点']) {
    assert.ok(search.includes(label), `查询页缺字段「${label}」`)
  }
  assert.ok(search.includes('multiSelector'), '拍摄目标应为两级筛选')
  assert.ok(!search.includes('全国 173 站'), '不应再有 173 站小字')
  assert.ok(!search.includes('波特尔越低越好'), '不应再有波特尔说明小字')
  assert.ok(search.includes('bindchanging'), '滑块应实时更新数字')
})

test('结果页：翻页优先用本地缓存', () => {
  const js = readFileSync(join(ROOT, 'miniprogram', 'pages', 'results', 'index.js'), 'utf8')
  assert.ok(js.includes('pageCache'), '应有页面级翻页缓存')
  assert.ok(js.includes('options.force'), '下拉刷新应强制重查')
})

test('app.json：定位权限声明齐全', () => {
  const app = JSON.parse(readFileSync(join(ROOT, 'miniprogram', 'app.json'), 'utf8'))
  assert.deepEqual(app.requiredPrivateInfos, ['getLocation'])
  assert.ok(app.permission && app.permission['scope.userLocation'] && app.permission['scope.userLocation'].desc)
  assert.ok(app.permission['scope.userLocation'].desc.length <= 30, 'desc 不能超过 30 字')
})

test('小程序：不得调用不存在的 wx.setEnablePullDownRefresh', () => {
  const files = []
  const walk = (dir) => {
    for (const name of require('node:fs').readdirSync(dir)) {
      const abs = join(dir, name)
      const stat = require('node:fs').statSync(abs)
      if (stat.isDirectory()) walk(abs)
      else if (name.endsWith('.js')) files.push(abs)
    }
  }
  walk(join(ROOT, 'miniprogram'))
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    assert.ok(!/wx\.setEnablePullDownRefresh\s*\(/u.test(text), `${file} 调用了不存在的 API`)
  }
})

test('手势：单指同时改 yaw/pitch，双指捏合改 fov（第二根手指后到也生效）', () => {
  const vm = require('node:vm')
  const caught = []
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console,
    require: () => ({ skyRender: () => {} }),
    Component: (config) => caught.push(config),
    wx: {},
  }
  const source = readFileSync(join(ROOT, 'miniprogram', 'components', 'sky-canvas', 'index.js'), 'utf8')
  vm.runInNewContext(source, sandbox, { filename: 'sky-canvas.js' })
  const def = caught[0]
  assert.ok(def, '应能加载 sky-canvas 组件')

  const inst = {
    data: { mode: 'altaz', ready: false, k: 0 },
    properties: { sim: null, sky: null },
    camera: { yaw: 180, pitch: 30, fov: 100 },
    setData(patch) { Object.assign(this.data, patch) },
    draw() {},
  }
  // 组件 methods 都挂到实例上（pinchDist 之类会被内部调用）
  for (const [name, fn] of Object.entries(def.methods)) inst[name] = fn.bind(inst)
  const call = (name, event) => inst[name](event)

  // 单指斜向拖动：yaw 与 pitch 都要变化
  call('onTouchStart', { touches: [{ clientX: 0, clientY: 0 }] })
  call('onTouchMove', { touches: [{ clientX: 12, clientY: 40 }] })
  assert.notEqual(inst.camera.yaw, 180, '横向拖动应改 yaw')
  assert.ok(inst.camera.pitch > 30, '纵向拖动应改 pitch')

  // 双指：先单指触摸，再两指进入（模拟第二根手指后到）
  inst.camera.fov = 100
  call('onTouchStart', { touches: [{ clientX: 0, clientY: 0 }] })
  call('onTouchMove', { touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] })
  call('onTouchMove', { touches: [{ clientX: 0, clientY: 0 }, { clientX: 200, clientY: 0 }] })
  assert.ok(Math.abs(inst.camera.fov - 50) < 1, `双指距离翻倍应让 fov 减半，实际 ${inst.camera.fov}`)

  // fov 边界与全屏/复位
  inst.camera.fov = 6
  inst.setFov(1)
  assert.equal(inst.camera.fov, 5, 'fov 不应低于 5°')
  inst.setFov(999)
  assert.equal(inst.camera.fov, 180, 'fov 不应超过 180°')
  assert.equal(typeof inst.toggleFullscreen, 'function', '应有全屏显示')
  assert.equal(typeof inst.reset, 'function')
})

test('两级筛选：分组变化时类型列重建', () => {
  const js = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.js'), 'utf8')
  assert.ok(js.includes('onTargetColumnChange'), '需要列变化联动')
  assert.ok(js.includes('targetColumns'), '需要两列数据')
  assert.ok(js.includes("'any'"), '默认应是不限')
  assert.ok(js.includes('eventType: this.data.eventType'), '查询应使用选中的 eventType')
})

test('地图页：小标点、单选、连线与预设地点按钮', () => {
  const js = readFileSync(join(ROOT, 'miniprogram', 'pages', 'map', 'index.js'), 'utf8')
  const wxml = readFileSync(join(ROOT, 'miniprogram', 'pages', 'map', 'index.wxml'), 'utf8')
  assert.ok(js.includes('width: active ? 18 : 10'), '预设点标点应小（10px）')
  assert.ok(js.includes('bindmarkertap') || wxml.includes('bindmarkertap'), '需要 marker 点击事件')
  assert.ok(js.includes('buildMarkers(site.id)'), '选中时只保留一个高亮')
  assert.ok(js.includes('polyline') && wxml.includes('polyline="{{polyline}}"'), '需要有连线')
  assert.ok(js.includes('pickedMarker'), '需要有选中点标记')
  assert.ok(js.includes('选择预设地点'), '左下按钮应为选择预设地点')
  assert.ok(!js.includes('useNearestCity'), '不应再有北京按钮')
  assert.ok(wxml.includes('bindchange="onPresetChange"'), '预设地点选择器')
})

test('画面模拟：去掉缩放/俯仰按钮与双击说明，保留横屏与实时拖动', () => {
  const wxml = readFileSync(join(ROOT, 'miniprogram', 'components', 'sky-canvas', 'index.wxml'), 'utf8')
  const js = readFileSync(join(ROOT, 'miniprogram', 'components', 'sky-canvas', 'index.js'), 'utf8')
  for (const handler of ['pitchUp', 'pitchDown', 'zoomIn', 'zoomOut']) {
    assert.ok(!wxml.includes(`bindtap="${handler}"`), `不应再有 ${handler} 按钮`)
    assert.ok(!js.includes(`${handler}(`), `应删除 ${handler} 方法`)
  }
  assert.ok(!wxml.includes('双击复位'), '不应再提示双击复位')
  assert.ok(wxml.includes('全屏显示'), '应有全屏显示按钮')
  assert.ok(wxml.includes('bindchanging="onSlide"'), '拖动进度条要实时重绘')
  assert.ok(js.includes('toggleFullscreen') && js.includes('onWindowResize'), '全屏与尺寸变化处理')
  const sky = readFileSync(join(ROOT, 'lib', 'skyview.js'), 'utf8')
  assert.ok(sky.includes("ctx.textAlign = 'right'") && sky.includes('W - 9 * S, H - 6 * S'), '最佳时段应在右下角')
})

test('结果页：加载文案为「计划中」且字号更大', () => {
  const wxml = readFileSync(join(ROOT, 'miniprogram', 'pages', 'results', 'index.wxml'), 'utf8')
  assert.ok(wxml.includes('计划中'), '加载文案应为计划中')
  assert.ok(!wxml.includes('正在计算'), '不应再显示正在计算')
  const css = readFileSync(join(ROOT, 'miniprogram', 'pages', 'results', 'index.wxss'), 'utf8')
  assert.ok(/\.loading \{[^}]*font-size: 30rpx/u.test(css), '加载文字应加大')
})

test('查询页：三张卡片有色差 class', () => {
  const wxml = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.wxml'), 'utf8')
  for (const cls of ['card-target', 'card-date', 'card-place']) {
    assert.ok(wxml.includes(cls), `缺少 ${cls}`)
  }
})

test('查询页：日期标签、页眉副标题同行、行间距放宽', () => {
  const wxml = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.wxml'), 'utf8')
  assert.ok(wxml.includes('开始日期') && wxml.includes('结束日期'), '日期要有标签')
  const heroLine = wxml.slice(wxml.indexOf('hero-line'), wxml.indexOf('hero-line') + 400)
  assert.ok(heroLine.includes('hero-title') && heroLine.includes('hero-sub'), 'byline 应与标题同行')
  assert.ok(!/class="hero"\s*>[\s\S]{0,120}<\/view>\s*<view class="hero-sub"/u.test(wxml), '不应再有独立一行的 byline')

  const css = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.wxss'), 'utf8')
  assert.match(css, /\.frow \{[^}]*padding: 10rpx 0/u, '行间距应放宽到 10rpx')
  assert.match(css, /\.card \{[^}]*margin-bottom: 14rpx/u, '卡片间距应放宽')

  const app = JSON.parse(readFileSync(join(ROOT, 'miniprogram', 'app.json'), 'utf8'))
  assert.equal(app.window.navigationBarTitleText, '星野计划', '导航栏标题不应再带 byline')
})

test('地图页：预设点单选、按钮文案与半球经纬度', () => {
  const js = readFileSync(join(ROOT, 'miniprogram', 'pages', 'map', 'index.js'), 'utf8')
  assert.ok(js.includes('const index = Number(e.detail.value)'), '预设选择不应再 -1')
  assert.ok(!/Number\(e\.detail\.value\) - 1/u.test(js), '不应残留 -1 偏移')
  assert.ok(js.includes('presetIndex: index,'), 'presetIndex 不应 +1')
  assert.ok(js.includes("presetLabel: site.name"), '选中预设点只显示站点名')
  assert.ok(js.includes("'自定义地点'"), '自选点显示「自定义地点」')
  assert.ok(js.includes('hemiText') && js.includes("'N' : 'S'") && js.includes("'E' : 'W'"), '经纬度要带 N/S/E/W')
})

test('查询页：去掉清除按钮、文案与按钮尺寸调整、自定义点可切回', () => {
  const wxml = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.wxml'), 'utf8')
  assert.ok(!wxml.includes('clearCustom'), '不应再有清除按钮')
  assert.ok(wxml.includes('拍摄目标高度角'), '高度角文案应改')
  assert.ok(wxml.includes('光污染波特尔指数'), '波特尔文案应改')
  assert.ok(!wxml.includes('disabled="{{custom}}"'), '目标地点不应被禁用')
  assert.ok(wxml.indexOf('reset-btn') < wxml.indexOf('search-btn'), '重置应在左、查询在右')

  const css = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.wxss'), 'utf8')
  assert.match(css, /\.reset-btn \{[^}]*flex: 0 0 150rpx/u, '重置按钮应更窄')
  assert.match(css, /\.search-btn \{[^}]*flex: 1/u, '查询按钮应更宽')

  const js = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.js'), 'utf8')
  assert.ok(!js.includes('clearCustom'), '处理函数也应移除')
})

test('出发地：查询页解析后传给地图页，地图优先用它', () => {
  const search = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.js'), 'utf8')
  assert.ok(search.includes('async openMap'), 'openMap 应先解析')
  assert.ok(search.includes('globalData.origin = origin'), '解析结果要缓存')
  assert.ok(search.includes('getApp().globalData.origin = origin || null'), '查询后也要缓存')

  const map = readFileSync(join(ROOT, 'miniprogram', 'pages', 'map', 'index.js'), 'utf8')
  const iOrigin = map.indexOf('g.origin &&')
  const iQuery = map.indexOf('query.originLat')
  assert.ok(iOrigin > 0 && iOrigin < iQuery, '应先读 globalData.origin')
  assert.ok(map.includes('已连线：出发地'), '有出发地时应提示已连线')
  assert.ok(map.includes('未设置出发地，不显示连线'), '无出发地时保留提示')
})

test('渲染器：hideHud 打开时不画内置 HUD', async () => {
  const { search, meta } = await import('../lib/planner.js')
  const r = await search({ eventType: 'milkyway', dateStart: '2026-12-14', dateEnd: '2026-12-14', pageSize: 1, withSim: true })
  const sim = r.ranked[0].sim
  const src = readFileSync(join(ROOT, 'miniprogram', 'utils', 'skyrender.js'), 'utf8')
  const sandbox = { exports: {} }
  new Function('module', 'exports', src)(sandbox, sandbox.exports)
  const calls = []
  const noop = () => {}
  const ctx = {
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    fillRect: noop, strokeRect: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, fill: noop, stroke: noop, save: noop, restore: noop, clip: noop, setLineDash: noop,
    rect: noop, translate: noop, scale: noop, rotate: noop, measureText: () => ({ width: 10 }),
    fillText: (text) => calls.push(String(text)),
  }
  const view = { sim, sky: meta().sky, camera: sim.camera, mode: 'altaz', w: 480, h: 270 }
  sandbox.exports.skyRender(ctx, view, 0)
  const withHud = calls.filter((x) => x.includes('最佳时段')).length
  assert.ok(withHud > 0, '默认应画 HUD')
  calls.length = 0
  sandbox.exports.skyRender(ctx, { ...view, hideHud: true }, 0)
  assert.equal(calls.filter((x) => x.includes('最佳时段')).length, 0, 'hideHud 时不应画 HUD')
})

test('全屏布局：顶/底操作栏、信息区、长按与动画', () => {
  const wxml = readFileSync(join(ROOT, 'miniprogram', 'components', 'sky-canvas', 'index.wxml'), 'utf8')
  const js = readFileSync(join(ROOT, 'miniprogram', 'components', 'sky-canvas', 'index.js'), 'utf8')
  const css = readFileSync(join(ROOT, 'miniprogram', 'components', 'sky-canvas', 'index.wxss'), 'utf8')

  assert.ok(wxml.includes('bindtap="onTap"'), '双击切换全屏（onTap 内判定）')
  assert.ok(wxml.includes('{{hud.modeLabel}}'), '坐标按钮显示当前坐标系')
  assert.ok(wxml.includes('toggleTracker'), '应有跟踪开关')
  assert.ok(!wxml.includes('地平坐标</view>'), '按钮不再显示坐标名')
  assert.ok(!wxml.includes('fs-top'), '全屏不再有顶部操作栏')
  assert.ok(wxml.includes('fs-bottom'), '全屏操作在底部')
  assert.ok(!wxml.includes('fs-info-top'), '全屏不再有顶部信息栏')
  assert.ok(wxml.includes('fs-info-bottom'), '参数在底部信息区')
  for (const word of ['高度角', '赤经', '最佳时段', '视野']) {
    assert.ok(wxml.includes(word), `信息区应含「${word}」`)
  }
  assert.ok(!js.includes('北纬'), 'HUD 数据不再含拍摄地经纬度')
  assert.ok(wxml.includes('bindchanging="onSlide"'), '进度条拖动实时')
  assert.ok(!wxml.includes('北纬'), '不应再显示拍摄地经纬度')
  assert.ok(js.includes('hideHud: this.data.fullscreen'), '全屏时隐藏 canvas HUD')
  assert.ok(js.includes('syncHud()') && js.includes('raText'), 'HUD 由组件同步')
  assert.ok(css.includes('zoomIn') && css.includes('zoomOut'), '应有缩放动画')
  const search = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.wxml'), 'utf8')
  assert.ok(search.includes('光污染波特尔指数'), '光污染文案已调整')
  const searchCss = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.wxss'), 'utf8')
  assert.ok(searchCss.includes('white-space: nowrap'), '标签不换行')
})

test('天气：不再展示逐时行与多源一致性', () => {
  const f = readFileSync(join(ROOT, 'miniprogram', 'utils', 'format.js'), 'utf8')
  assert.ok(!f.includes('w.hours'), '小程序便签不应再渲染逐时')
  assert.ok(!f.includes('多源一致性'), '已去掉多源一致性')
  const w = readFileSync(join(ROOT, 'lib', 'webui.js'), 'utf8')
  assert.ok(!w.includes('逐时云量'), '网页便签不应再渲染逐时')
  assert.ok(!w.includes('多源一致性'))
})

test('小程序：版本号、星座开关、间距与文案', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const ver = readFileSync(join(ROOT, 'lib', 'version.js'), 'utf8')
  assert.ok(ver.includes(pkg.version), 'lib/version.js 应等于 package.json 版本')

  const wxml = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.wxml'), 'utf8')
  assert.ok(wxml.includes('hero-ver') && wxml.includes('{{version}}'), '标题应显示版本号')

  const note = readFileSync(join(ROOT, 'miniprogram', 'pages', 'note', 'index.wxml'), 'utf8')
  assert.ok(!note.includes('1–3 秒'), '加载文案不应再写约 1–3 秒')

  const css = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.wxss'), 'utf8')
  assert.match(css, /\.frow \{[^}]*gap: 2rpx/u, '标签与控件间距应缩小')

  const skyWxml = readFileSync(join(ROOT, 'miniprogram', 'components', 'sky-canvas', 'index.wxml'), 'utf8')
  assert.ok(skyWxml.includes('toggleConstellations'), '应有星座名开关')
  assert.ok(skyWxml.includes("key {{trackerOn ? 'on' : ''}}"), '跟踪开启时按钮变色')
})

test('小程序：预设点回首页带出省市、评分条、全屏五行与翻面', () => {
  const search = readFileSync(join(ROOT, 'miniprogram', 'pages', 'search', 'index.js'), 'utf8')
  assert.ok(search.includes('带出目标地区 / 省份 / 地点'), '预设点应联动省市')
  assert.ok(search.includes('const site = picked.siteId'), '按 siteId 反查站点')

  const fmt = readFileSync(join(ROOT, 'miniprogram', 'utils', 'format.js'), 'utf8')
  for (const label of ['数据源', '综合评分', '平均云量', '晴夜小时', '最佳 3h 窗口', '降水概率峰值', '最低温', '露点差', '最大风速', '能见度']) {
    assert.ok(fmt.includes(label), `天气缺少「${label}」`)
  }
  assert.ok(fmt.includes('buildGrades'), '应有评分条数据')

  const note = readFileSync(join(ROOT, 'miniprogram', 'pages', 'note', 'index.wxml'), 'utf8')
  assert.ok(note.includes('grade-bar') && note.includes('grade-fill'), '应有横向评分条')

  const sky = readFileSync(join(ROOT, 'miniprogram', 'components', 'sky-canvas', 'index.wxml'), 'utf8')
  const order = ['hud.time', 'hud.window', 'hud.altaz', 'hud.radec', 'hud.fov'].map((k) => sky.indexOf(k))
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), '全屏信息应 5 行按序')
  assert.ok(sky.includes('{{hud.modeLabel}}'), '按钮显示当前坐标系')
  assert.ok(sky.includes("flipping ? 'flipping' : ''"), '应有翻面动画类')
})
