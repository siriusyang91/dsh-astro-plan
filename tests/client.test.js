import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

import { RENDER_SRC } from '../lib/skyview.js'

let captured = null
globalThis.window = globalThis.window ?? {}
globalThis.window.__ModuleLoader__ = {
  load(entry) { captured = entry },
}
globalThis.document = {
  head: { appendChild() {} },
  getElementById() { return null },
  createElement() { return {} },
}

await import('../lib/client.js')

const fakeReact = {
  createElement() { return null },
  useState(value) { return [value, () => {}] },
  useEffect() {},
}

const fakeRequire = (id) => (id === 'react' ? fakeReact : {})

test('客户端 bundle 使用 loader 线格式且 id 正确', () => {
  assert.ok(captured, 'window.__ModuleLoader__.load 应被调用')
  assert.equal(captured.id, 'dsh-astro-plan')
  assert.equal(typeof captured.factory, 'function')
})

test('客户端导出 name / inject / apply', () => {
  const mod = captured.factory(fakeRequire)
  assert.equal(mod.name, 'dsh-astro-plan')
  assert.deepEqual(mod.inject, ['slots'])
  assert.equal(typeof mod.apply, 'function')
})

test('客户端：目标类型也是两级菜单，不再用 optgroup', () => {
  const src = captured.factory.toString()
  assert.ok(src.includes('function TypeMenu'), '应有两级菜单组件')
  assert.ok(src.includes('ap-tmenu-col'), '左列：一级分组')
  assert.ok(src.includes('ap-tmenu-sub'), '右列：二级类型')
  assert.ok(src.includes('onMouseEnter'), '一级悬停切换二级')
  assert.ok(!src.includes('optgroup'), '不再用原生 optgroup')
})

test('客户端：3D 天球渲染器与右列布局', () => {
  const src = captured.factory.toString()
  assert.ok(src.includes('function SkySim'), '应有画面模拟组件')
  assert.ok(src.includes('ap-simcanvas') && src.includes('ap-simctl'), '应有画布与控制条样式')
  assert.ok(src.includes('function skyRender'), '应有 3D 天球渲染器')
  assert.ok(src.includes('skyEqToAltAz'), '渲染器应带赤道→地平')
  assert.ok(src.includes('ap-notegrid') && src.includes('ap-noteleft') && src.includes('ap-noteright'), '两列布局（模拟在右列）')
  assert.ok(src.includes('ap-nsec.wide'), '推荐度明细应占两列宽')
  assert.ok(!src.includes('ap-bigwrap'), '不再有点击放大浮层')
  assert.ok(src.includes('addEventListener(\'wheel\''), '应有滚轮缩放')
  assert.ok(src.includes('setMode(\'altaz\')') || src.includes("setMode('altaz')"), '应有坐标系切换')
  assert.ok(src.includes("h('div', { className: 'ap-field ap-tmenu-field' }"), '类型菜单容器用 div（label 会把点击转发回按钮）')
  assert.ok(src.includes('withSim'), '查询请求应带上 withSim')
  assert.ok(src.includes('直线距离') && src.includes("kv('出发地'"), '地点便签里合并直线距离与出发地（各占一行）')
  assert.ok(src.includes('--ap-note-bg1:#1b2230'), '深色模式下便签也是深色')
  assert.ok(src.includes('background:var(--ap-note-sec);color:var(--ap-note-kv-val)'), '控制按钮要用便签主题色，深色下未选中按钮也得看清')
  assert.ok(!src.includes('color:#3a3117;border:1px solid rgba(120,95,40'), '不再用写死的深棕字色')
  assert.ok(src.includes('startIndex'), '默认帧取自 sim.startIndex')
  assert.ok(src.includes('Math.max(5, Math.min(180'), '缩放范围 5°–180°')
  assert.ok(src.includes('height:16px;margin:0;padding:0;align-self:center'), '进度条与文字垂直居中（右侧不再翘起）')
  assert.ok(src.includes('ctx.font = font(7)'), '网格角度标注字号缩小')
  // 「重置」要回到打开时的画面：默认视角 + 最佳时段开始那一帧 + 不播放 + 地平坐标
  const resetBlock = src.slice(src.indexOf('function resetView()'), src.indexOf('function resetView()') + 300)
  assert.ok(resetBlock.includes('setCam(null)'), '重置要清掉自由视角')
  assert.ok(resetBlock.includes('setPlaying(false)'), '重置要停止播放')
  assert.ok(resetBlock.includes('setK(Math.max(0, (sim && sim.startIndex) || 0))'), '重置要回到最佳时段开始那一帧')
  assert.ok(resetBlock.includes("setMode('altaz')"), '重置要回到地平坐标')
  // 跟踪勾选框 + 缩放不改机位
  assert.ok(src.includes('ap-simchk'), '播放区应有「跟踪」勾选框')
  assert.ok(src.includes('tracker: tracker'), '跟踪状态要传给渲染器')
  assert.ok(src.includes('free: Boolean(cur.free)'), '缩放不应把相机改成自由视角（否则会甩回默认机位）')
  assert.ok(src.includes('setTracker(false)'), '手动拖拽应退出跟随')
  // 画布位图尺寸跟随显示尺寸（按 DPR），免得 CSS 拉伸放大在平滑区出竖纹
  assert.ok(src.includes('function fitCanvas()'), '应有画布尺寸自适应')
  assert.ok(src.includes('devicePixelRatio'), '应按设备像素比放大位图')
  assert.ok(src.includes('fitCanvas()') && src.includes('w: c.width'), '渲染前先按实际尺寸重排位图')
  assert.ok(src.includes("window.addEventListener('resize'"), '窗口尺寸变化要重排重画')

  // 与 lib/skyview.js 的 RENDER_SRC 逐行一致，防止两份漂移
  const a = src.indexOf('/* === SKY RENDERER START === */')
  const b = src.indexOf('/* === SKY RENDERER END === */')
  assert.ok(a > 0 && b > a, '应有渲染器标记')
  const got = src.slice(a + '/* === SKY RENDERER START === */'.length, b)
    .split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
  const want = RENDER_SRC
    .split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
  assert.equal(got, want, '客户端渲染器应与 lib/skyview.js 的 RENDER_SRC 一致（改完跑 tools/sync-sky-renderer.mjs）')
})

test('客户端：窄屏时画面模拟置顶，其余便签移到下方', () => {
  const src = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(src, /@media \(max-width:1100px\)\{\.ap-notegrid\{grid-template-columns:1fr\}/u, 'Tab 应有同样的 1100px 单列规则')
  assert.match(src, /\.ap-noteright\{order:-1;position:static;max-width:880px\}/u, 'Tab 的画面模拟应置顶')
  assert.match(src, /\.ap-nsec\.wide\{grid-column:1\/-1\}/u, 'Tab 的宽区块应占满整行')
  assert.ok(!src.includes('@media (max-width:900px){.ap-notegrid'), '旧的 900px 规则应已移除')
})

test('客户端：便签改为浮窗（同层弹窗，点遮罩/Esc 关闭）', () => {
  const src = captured.factory.toString()
  assert.ok(src.includes('.ap-note-modal{position:fixed'), '便签应是浮层')
  assert.ok(src.includes('.ap-note-panel{'), '浮层要有面板')
  assert.ok(src.includes('.ap-note-head'), '浮层要有标题栏与关闭按钮')
  assert.ok(src.includes("className: 'ap-note-modal'"), '渲染时挂浮层')
  assert.ok(src.includes('function toggleRow(i)'), '点击行走 toggleRow')
  assert.ok(!src.includes("className: 'ap-detail'"), '不再在行内展开')
  assert.ok(!src.includes('.ap-detail{'), '旧的展开样式应删除')
  assert.ok(src.includes('e.target === e.currentTarget'), '点遮罩关闭')
})

test('apply 注册 conversation.view Tab 且 id/order 正确', () => {
  const mod = captured.factory(fakeRequire)
  const registered = []
  const ctx = {
    slots: {
      inject(name, cb) { assert.equal(name, 'conversation.view'); return cb() },
      register(options, component) {
        registered.push({ options, component })
        return () => {}
      },
    },
  }
  mod.apply(ctx)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].options.name, 'conversation.view')
  assert.equal(registered[0].options.id, 'astro-plan')
  assert.equal(registered[0].options.order, 85)
  assert.match(registered[0].options.label(), /^星野计划 v\d+\.\d+\.\d+$/, 'Tab 标题应带版本号')
  assert.equal(typeof registered[0].component, 'function')
})

test('apply 在没有 slots 的宿主上安全降级', () => {
  const mod = captured.factory(fakeRequire)
  assert.doesNotThrow(() => mod.apply({}))
  assert.doesNotThrow(() => mod.apply(null))
})

test('客户端：定位失败时不计算距离', () => {
  const src = captured.factory.toString()
  assert.ok(src.includes("setOriginLabel('不计算距离')"), '失败时标签应为不计算距离')
  assert.ok(!src.includes("patch({ origin: '北京' })"), '不应再切到北京')
  assert.ok(!src.includes('按北京计算'), '不应再按北京估算')
})

test('客户端：版本常量存在且 Tab 标题带版本（不能再引用未定义的 VERSION）', () => {
  const src = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(src, /var PLUGIN_VERSION = '\d+\.\d+\.\d+'/u, '工厂内应定义 PLUGIN_VERSION')
  assert.ok(!/\bVERSION\b/u.test(src.replace(/PLUGIN_VERSION/g, '')), '不能引用未定义的 VERSION')
  assert.ok(src.includes("'星野计划 v' + PLUGIN_VERSION"), 'Tab 标题应带版本号')
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.ok(src.includes(`PLUGIN_VERSION = '${pkg.version}'`), 'PLUGIN_VERSION 应与 package.json 一致')
})

test('地图：确认按钮独立成行、首次打开自动选最近站点', () => {
  const src = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.ok(src.includes('ap-map-foot'), '应有独立操作行')
  assert.ok(src.includes('class="ap-map-ok">确定'), '确定按钮存在')
  const view = readFileSync(join(ROOT, 'lib', 'mapview.js'), 'utf8')
  // 打开地图不再默认选预设点（用户要求）：state 初始化不调用 nearestSite，也不在之后兜底
  assert.ok(!view.includes('picked: o.picked || nearestSite'), '初始化不能自动选点')
  assert.ok(!view.includes('state.picked = nearestSite'), '不应再有默认选点兜底')
  assert.ok(view.includes("ctx.setLineDash([5, 5])"), '应有虚线连线')
  assert.ok(view.includes("ctx.setLineDash([5, 5])"), '应有虚线连线')
})

test('Tab：默认目前所在地、重置不查询', () => {
  const src = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(src, /site: '__here__'/u, '默认目标地点为目前所在地')
  const block = src.slice(src.indexOf('function reset() {', src.indexOf('function reset() {') + 1))
  const used = block.slice(0, block.indexOf('resolveOrigin(f.origin)') + 40)
  assert.ok(!used.includes('run(f'), 'Tab 重置不应查询')
})

test('Tab 详情：noteBox 可安全渲染（不再引用 View 作用域变量）', async () => {
  const reactStub = {
    createElement: (tag, props, ...kids) => ({ tag, props: props || {}, kids }),
    useState: (v) => [v, () => {}],
    useEffect() {},
  }
  const mod = captured.factory(() => reactStub)
  const { search, meta } = await import('../lib/planner.js')
  const r = await search({ eventType: 'deepsky', dateStart: '2027-03-10', dateEnd: '2027-03-10', siteLimit: 2, pageSize: 1, withSim: true })
  const item = r.ranked[0]
  const tree = mod.__noteBox(item, '—', meta().sky, false, () => {})
  const texts = []
  const walk = (n) => {
    if (!n) return
    if (typeof n === 'string') texts.push(n)
    if (Array.isArray(n.kids)) n.kids.forEach(walk)
  }
  walk(tree)
  const all = texts.join('|')
  assert.ok(all.includes('拍摄参数'), '详情应包含拍摄参数')
  assert.ok(all.includes('画面模拟'), '详情应包含画面模拟')

  const src = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  const start = src.indexOf('function noteBox(')
  const end = src.indexOf('function gradeRow', start)
  const body = src.slice(start, end)
  assert.ok(!body.includes('setSimFocus'), 'noteBox 不应引用 View 内的 setSimFocus')
})
