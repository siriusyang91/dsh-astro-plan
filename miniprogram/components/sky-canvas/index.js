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
    fovText: '100°',
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
      }
      this.setData({ k, maxK: value.frames.length - 1 })
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
        }, this.data.k)
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

    /** 放大横屏：铺满屏幕并重新初始化 canvas（配合页面 pageOrientation: auto） */
    toggleFullscreen() {
      const fullscreen = !this.data.fullscreen
      this.setData({ fullscreen }, () => {
        clearTimeout(this.resizeTimer)
        this.resizeTimer = setTimeout(() => this.initCanvas(), 120)
      })
    },

    toggleMode() {
      this.setData({ mode: this.data.mode === 'eq' ? 'altaz' : 'eq' })
      this.draw()
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
