/** 3D 天球画面模拟（复用 lib/skyview.js 的 skyRender）。 */
const { skyRender } = require('../../utils/skyrender')

const FOV_MIN = 5
const FOV_MAX = 180
const PITCH_MIN = -10
const PITCH_MAX = 90

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

Component({
  properties: {
    sim: { type: Object, value: null },
    sky: { type: Object, value: null },
  },

  data: {
    k: 0,
    maxK: 1,
    playing: false,
    mode: 'altaz',
    w: 0,
    h: 0,
    ready: false,
    fullscreen: false,
    justExited: false,
    fovText: '100°',
    trackerOn: false,
    constellationOn: true,
    hud: { time: '', window: '', altaz: '', radec: '', fov: '100°', modeLabel: '地平坐标' },
    flipping: '',
  },

  observers: {
    sim(value) {
      if (!value || !value.frames || !value.frames.length) return
      const k = Math.max(0, Math.min(value.startIndex || 0, value.frames.length - 1))
      const camera = value.camera || {}
      this.camera = {
        yaw: camera.yaw === undefined ? 180 : camera.yaw,
        pitch: camera.pitch === undefined ? 30 : camera.pitch,
        fov: camera.fov === undefined ? 100 : camera.fov,
        tracker: Boolean(camera.tracker),
      }
      this.setData({ k, maxK: value.frames.length - 1, trackerOn: Boolean(this.camera.tracker) })
      this.syncFovText()
      this.draw()
    },
  },

  lifetimes: {
    ready() {
      this.initCanvas()
      // 横屏/窗口尺寸变化后重新按新尺寸出图
      this.onResize = () => {
        if (!this.data.ready) return
        clearTimeout(this.resizeTimer)
        this.resizeTimer = setTimeout(() => this.initCanvas(), 200)
      }
      if (typeof wx.onWindowResize === 'function') wx.onWindowResize(this.onResize)
    },
    detached() {
      this.stop()
      if (typeof wx.offWindowResize === 'function' && this.onResize) wx.offWindowResize(this.onResize)
      if (this.resizeTimer) clearTimeout(this.resizeTimer)
    },
  },

  methods: {
    initCanvas() {
      const query = wx.createSelectorQuery().in(this)
      query.select('#sky').fields({ node: true, size: true }).exec((res) => {
        const info = res && res[0]
        if (!info || !info.node) return
        let dpr = 2
        try {
          if (typeof wx.getWindowInfo === 'function') dpr = wx.getWindowInfo().pixelRatio || 2
          else if (typeof wx.getSystemInfoSync === 'function') dpr = wx.getSystemInfoSync().pixelRatio || 2
        } catch (error) {
          dpr = 2
        }
        const canvas = info.node
        canvas.width = Math.round(info.width * dpr)
        canvas.height = Math.round(info.height * dpr)
        const ctx = canvas.getContext('2d')
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        this.canvas = canvas
        this.ctx = ctx
        this.dpr = dpr
        this.setData({ w: info.width, h: info.height, ready: true })
        this.draw()
      })
    },

    /** 全屏时由页面层显示 HUD 文案（渲染器 HUD 已隐藏） */
    syncHud() {
      const sim = this.properties.sim
      if (!sim || !sim.frames || !sim.frames.length || !this.camera) return
      const f = sim.frames[Math.min(this.data.k, sim.frames.length - 1)] || {}
      const tp = (f.tp && f.tp[0]) || null
      const raText = (() => {
        if (!tp) return '—'
        const hours = ((Number(tp[0]) % 24) + 24) % 24
        const h = Math.floor(hours)
        const m = Math.round((hours - h) * 60)
        return `${String(h).padStart(2, '0')}h${String(m).padStart(2, '0')}m`
      })()
      const dec = tp ? Number(tp[1]) : null
      const hud = {
        time: `${f.d ? f.d + ' ' : ''}${f.t || ''}`,
        modeLabel: this.data.mode === 'eq' ? '赤道坐标' : '地平坐标',
        fov: `${Math.round(this.camera.fov)}°`,
        altaz: tp ? `高度角 ${Number(tp[2]).toFixed(0)}° · 方位角 ${Number(tp[3]).toFixed(0)}°` : '高度角 —',
        radec: tp ? `赤经 ${raText} · 赤纬 ${dec >= 0 ? '+' : ''}${dec.toFixed(1)}°` : '赤经 —',
        window: sim.window ? `最佳时段 ${sim.window.start} – ${sim.window.end}` : '',
      }
      this.setData({ hud, fovText: hud.fov })
    },

    syncFovText() {
      const fov = this.camera ? this.camera.fov : 100
      this.setData({ fovText: `${Math.round(fov)}°` })
    },

    draw() {
      if (!this.ctx || !this.data.ready || !this.camera) return
      const sim = this.properties.sim
      if (!sim || !sim.frames || !sim.frames.length) return
      const ctx = this.ctx
      ctx.clearRect(0, 0, this.data.w, this.data.h)
      try {
        skyRender(ctx, {
          sim,
          sky: this.properties.sky || {},
          camera: this.camera,
          mode: this.data.mode,
          w: this.data.w,
          h: this.data.h,
          hideHud: this.data.fullscreen,
          showConstellations: this.data.constellationOn,
        }, this.data.k)
        if (this.data.fullscreen) this.syncHud()
      } catch (error) {
        console.error('skyRender 失败', error)
      }
    },

    onSlide(e) {
      this.setData({ k: Number(e.detail.value) })
      this.draw()
    },

    togglePlay() {
      if (this.data.playing) { this.stop(); return }
      if (!this.data.maxK) return
      this.setData({ playing: true })
      this.timer = setInterval(() => {
        const next = (this.data.k + 1) % (this.data.maxK + 1)
        this.setData({ k: next })
        this.draw()
      }, 160)
    },

    stop() {
      if (this.timer) { clearInterval(this.timer); this.timer = null }
      if (this.data.playing) this.setData({ playing: false })
    },

    /** 缩放：手势与按钮共用，范围对齐渲染器支持 5°–180° */
    setFov(next) {
      if (!this.camera) return
      this.camera.fov = clamp(next, FOV_MIN, FOV_MAX)
      this.syncFovText()
      this.draw()
    },

    /** 全屏/还原：铺满屏幕并重新初始化 canvas（配合页面 pageOrientation: auto） */
    toggleFullscreen() {
      const fullscreen = !this.data.fullscreen
      if (this.animTimer) clearTimeout(this.animTimer)
      this.setData({ fullscreen, justExited: !fullscreen }, () => {
        clearTimeout(this.resizeTimer)
        this.resizeTimer = setTimeout(() => this.initCanvas(), 120)
        if (!fullscreen) {
          // 退出动画结束后移除 class，避免影响后续操作
          this.animTimer = setTimeout(() => this.setData({ justExited: false }), 260)
        } else {
          this.animTimer = setTimeout(() => this.setData({ justExited: false }), 300)
        }
      })
    },

    /** 双击切换全屏（两次点击间隔 < 320ms，拖动不计） */
    onTap() {
      const now = Date.now()
      if (this.lastTapAt && now - this.lastTapAt < 320) {
        this.lastTapAt = 0
        this.toggleFullscreen()
        return
      }
      this.lastTapAt = now
    },

    toggleTracker() {
      if (!this.camera) return
      this.flipButton('track', () => {
        this.camera.tracker = !this.camera.tracker
        this.setData({ trackerOn: Boolean(this.camera.tracker) })
        this.draw()
      })
    },

    toggleConstellations() {
      this.flipButton('const', () => {
        this.setData({ constellationOn: !this.data.constellationOn })
        this.draw()
      })
    },

    /** 按钮翻面：先转 90°，换状态后再转回来 */
    flipButton(key, apply) {
      if (this.data.flipping) return
      this.setData({ flipping: key })
      clearTimeout(this.flipTimer)
      this.flipTimer = setTimeout(() => {
        apply()
        this.setData({ flipping: '' })
      }, 160)
    },

    toggleMode() {
      this.flipButton('mode', () => {
        this.setData({ mode: this.data.mode === 'eq' ? 'altaz' : 'eq' })
        this.draw()
        if (this.data.fullscreen) this.syncHud()
      })
    },

    reset() {
      const sim = this.properties.sim
      const camera = (sim && sim.camera) || {}
      this.camera = {
        yaw: camera.yaw === undefined ? 180 : camera.yaw,
        pitch: camera.pitch === undefined ? 30 : camera.pitch,
        fov: camera.fov === undefined ? 100 : camera.fov,
      }
      this.syncFovText()
      this.draw()
    },

    onTouchStart(e) {
      const touches = e.touches || []
      if (!touches.length) return
      this.gesture = {
        x: touches[0].clientX,
        y: touches[0].clientY,
        baseDist: touches.length > 1 ? this.pinchDist(touches) : 0,
        baseFov: this.camera ? this.camera.fov : 100,
      }
    },

    pinchDist(touches) {
      return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
    },

    onTouchMove(e) {
      if (!this.camera || !this.gesture) return
      const touches = e.touches || []

      // 双指：捏合缩放（第二根手指后到时也能立刻接管）
      if (touches.length > 1) {
        const dist = this.pinchDist(touches)
        if (!this.gesture.baseDist) {
          this.gesture.baseDist = dist
          this.gesture.baseFov = this.camera.fov
          return
        }
        if (dist > 1) this.setFov(this.gesture.baseFov * (this.gesture.baseDist / dist))
        return
      }

      if (touches.length !== 1) return
      if (this.gesture.baseDist) {
        // 从双指退回单指：重置基准，避免视角跳变
        this.gesture = { x: touches[0].clientX, y: touches[0].clientY, baseDist: 0, baseFov: this.camera.fov }
        return
      }
      const dx = touches[0].clientX - this.gesture.x
      const dy = touches[0].clientY - this.gesture.y
      this.camera.yaw = ((this.camera.yaw - dx * 0.35) % 360 + 360) % 360
      this.camera.pitch = clamp(this.camera.pitch + dy * 0.25, PITCH_MIN, PITCH_MAX)
      this.gesture.x = touches[0].clientX
      this.gesture.y = touches[0].clientY
      this.draw()
    },

    onDoubleTap() {
      this.reset()
    },
  },
})
