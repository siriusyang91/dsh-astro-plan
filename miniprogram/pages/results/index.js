const api = require('../../utils/api')
const { buildSections, weatherText, km } = require('../../utils/format')

Page({
  data: {
    loading: true,
    error: '',
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    pages: 1,
    sections: null,
    sheetVisible: false,
    sheetTitle: '',
    reasons: [],
    poolText: '',
    elapsed: 0,
    simContext: null,
    sim: null,
    simLoading: false,
    simError: '',
    sky: null,
  },

  onLoad() {
    const query = getApp().globalData.query
    if (!query) {
      this.setData({ loading: false, error: '没有查询条件，请先回到查询页设置' })
      return
    }
    this.query = { ...query }
    const app = getApp()
    if (!app.globalData.meta) {
      api.meta().then((meta) => { app.globalData.meta = meta }).catch(() => {})
    }
    this.load(1)
  },

  onUnload() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  },

  onPullDownRefresh() {
    this.load(1).then(() => wx.stopPullDownRefresh())
  },

  load(page) {
    this.setData({ loading: true, error: '', elapsed: 0 })
    if (this.timer) clearInterval(this.timer)
    const startedAt = Date.now()
    this.timer = setInterval(() => {
      this.setData({ elapsed: Math.round((Date.now() - startedAt) / 1000) })
    }, 1000)
    return api.search({ ...this.query, page, pageSize: this.data.pageSize })
      .then((result) => {
        if (!result.ok) {
          this.setData({ loading: false, error: result.message || result.error || '查询失败' })
          return
        }
        const pagination = result.pagination || {}
        const items = (result.ranked || []).map((item, index) => ({
          key: `${page}-${index}`,
          rank: item.rank,
          score: item.score,
          targetName: item.target.name,
          typeLabel: item.target.typeLabel || item.target.type,
          siteName: item.site.name,
          siteMeta: `${item.site.province || ''} · B${item.site.bortle}`,
          date: item.date,
          window: `${item.window.startShort} → ${item.window.endShort}`,
          altMax: item.geometry.altMax,
          direction: item.geometry.directionAtMax || item.geometry.direction,
          distance: km(item.distanceKm),
          weather: weatherText(item.weather),
          raw: item,
        }))
        this.setData({
          loading: false,
          items,
          page: pagination.page || page,
          total: pagination.total || items.length,
          pages: pagination.pages || 1,
          poolText: result.poolSize
            ? `候选 ${result.poolSize.candidates} 条 · 评估站点 ${result.poolSize.sites} 个`
            : '',
        })
      })
      .catch((error) => this.setData({ loading: false, error: error.message }))
      .then(() => {
        if (this.timer) { clearInterval(this.timer); this.timer = null }
      })
  },

  openNote(e) {
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.items[index]
    if (!item) return
    const raw = item.raw
    const site = raw.site || {}
    const context = {
      date: raw.date,
      targetId: raw.target && raw.target.id,
      opts: this.query,
    }
    if (site.custom) { context.siteLat = site.lat; context.siteLon = site.lon }
    else context.siteId = site.id
    this.setData({
      sheetVisible: true,
      sheetTitle: `${item.targetName} · ${item.siteName}`,
      sections: buildSections(raw),
      reasons: raw.reasons || [],
      simContext: context,
      sim: null,
      simError: '',
      simLoading: false,
      sky: (getApp().globalData.meta && getApp().globalData.meta.sky) || null,
    })
  },

  /** 便签打开后按需拉该结果的画面模拟（云函数 action:'sim'） */
  onNeedSim(e) {
    const context = e.detail || this.data.simContext
    if (!context || this.data.simLoading) return
    this.setData({ simLoading: true, simError: '', sim: null })
    api.sim(context)
      .then((result) => {
        if (result && result.ok && result.sim) this.setData({ simLoading: false, sim: result.sim })
        else this.setData({ simLoading: false, simError: (result && result.message) || '画面模拟不可用' })
      })
      .catch((error) => this.setData({ simLoading: false, simError: error.message }))
  },

  closeNote() {
    this.setData({ sheetVisible: false })
  },

  prevPage() {
    if (this.data.page <= 1) return
    this.load(this.data.page - 1)
  },

  nextPage() {
    if (this.data.page >= this.data.pages) return
    this.load(this.data.page + 1)
  },

  backToSearch() {
    wx.navigateBack()
  },
})
