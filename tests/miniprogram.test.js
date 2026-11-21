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
  assert.deepEqual(app.pages, ['pages/search/index', 'pages/results/index', 'pages/map/index'])
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
  const pages = app.pages.concat(['components/note-sheet/index'])
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
