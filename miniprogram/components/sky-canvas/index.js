/** 3D 天球画面模拟（复用 lib/skyview.js 的 skyRender）。 */
const { skyRender } = require('../../utils/skyrender')

Component({
  properties: {
    sim: { type: Object, value: null },
    sky: { type: Object, value: null },
    mode: { type: String, value: 'altaz' },
  },

  data: {
    k: 0,
    maxK: 1,
    playing: false,
    w: 0,
    h: 0,
    ready: false,
    label: '',
  },

  observers: {
    sim(value) {
      if (!value || !value.frames || !value.frames.length) return
      const k = Math.max(0, Math.min(value.startIndex || 0, value.frames.length - 1))
      this.camera = { yaw: (value.camera && value.camera.yaw) || 180, pitch: (value.camera && value.camera.pitch) || 30, fov: (value.camera && value.camera.fov) || 100 }
      this.setData({ k, maxK: value.frames.length - 1 })
      this.draw()
    },
    mode() { this.draw() },
  },

  lifetimes: {
    ready() { this.initCanvas() },
    detached() { this.stop() },
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
        const w = info.width
        const h = info.height
        const canvas = info.node
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
        const ctx = canvas.getContext('2d')
        ctx.scale(dpr, dpr)
        this.canvas = canvas
        this.ctx = ctx
        this.dpr = dpr
        this.setData({ w, h, ready: true })
        this.draw()
      })
    },

    draw() {
      if (!this.ctx || !this.data.ready) return
      const sim = this.data.sim || (this.properties && this.properties.sim)
      if (!sim || !sim.frames || !sim.frames.length) return
      const sky = this.properties.sky || {}
      const ctx = this.ctx
      ctx.clearRect(0, 0, this.data.w, this.data.h)
      try {
        skyRender(ctx, {
          sim,
          sky,
          camera: this.camera,
          mode: this.data.mode,
          w: this.data.w,
          h: this.data.h,
        }, this.data.k)
      } catch (error) {
        console.error('skyRender 失败', error)
      }
      const frame = sim.frames[this.data.k]
      if (frame && frame.t !== undefined) {
        this.setData({ label: String(frame.t) })
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

    toggleMode() {
      this.triggerEvent('modechange')
    },

    onTouchStart(e) {
      const touches = e.touches || []
      this.gesture = {
        x: touches[0] ? touches[0].clientX : 0,
        y: touches[0] ? touches[0].clientY : 0,
        dist: touches.length > 1 ? Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY) : 0,
        fov: this.camera ? this.camera.fov : 100,
      }
    },

    onTouchMove(e) {
      if (!this.camera || !this.gesture) return
      const touches = e.touches || []
      if (touches.length > 1 && this.gesture.dist) {
        const dist = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
        this.camera.fov = Math.max(20, Math.min(180, this.gesture.fov * (this.gesture.dist / Math.max(1, dist))))
        this.draw()
        return
      }
      if (touches.length !== 1) return
      const dx = touches[0].clientX - this.gesture.x
      const dy = touches[0].clientY - this.gesture.y
      // 只接管「横向为主」的拖动：竖向留给 scroll-view，避免抢走便签的上下滑动
      if (Math.abs(dx) <= Math.abs(dy)) return
      this.camera.yaw = ((this.camera.yaw - dx * 0.35) % 360 + 360) % 360
      this.gesture.x = touches[0].clientX
      this.gesture.y = touches[0].clientY
      this.draw()
    },

    reset() {
      const sim = this.properties.sim
      this.camera = {
        yaw: (sim && sim.camera && sim.camera.yaw) || 180,
        pitch: (sim && sim.camera && sim.camera.pitch) || 30,
        fov: (sim && sim.camera && sim.camera.fov) || 100,
      }
      this.draw()
    },
  },
})
