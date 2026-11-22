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
    // 翻页缓存：命中后不再调云函数（云端也有整份结果缓存）
    this.pageCache = new Map()
    const app = getApp()
    if (!app.globalData.meta) {
      api.meta().then((meta) => { app.globalData.meta = meta }).catch(() => {})
    }
    this.load(1)
  },

  onUnload() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    wx.setEnablePullDownRefresh(true)
  },

  onPullDownRefresh() {
    if (this.pageCache) this.pageCache.clear()
    this.load(1, { force: true }).then(() => wx.stopPullDownRefresh())
  },

  /** 把云端返回的一页渲染出来 */
  applyResult(result, page) {
    const pagination = result.pagination || {}
    const pages = pagination.totalPages || pagination.pages || 1
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
      error: '',
      items,
      page: pagination.page || page,
      total: pagination.total || items.length,
      pages,
      poolText: result.poolSize
        ? `候选 ${result.poolSize.candidates} 条 · 评估站点 ${result.poolSize.sites} 个`
        : '',
    })
  },

  load(page, options = {}) {
    const cached = !options.force && this.pageCache && this.pageCache.get(page)
    if (cached) {
      this.applyResult(cached, page)
      return Promise.resolve()
    }
    this.setData({ loading: true, error: '', elapsed: 0 })
    if (this.timer) clearInterval(this.timer)
    const startedAt = Date.now()
    this.timer = setInterval(() => {
      this.setData({ elapsed: Math.round((Date.now() - startedAt) / 1000) })
    }, 1000)
    const done = () => {
      if (this.timer) { clearInterval(this.timer); this.timer = null }
    }
    return api.search({ ...this.query, page, pageSize: this.data.pageSize })
      .then((result) => {
        if (!result.ok) {
          this.setData({ loading: false, error: result.message || result.error || '查询失败' })
          return
        }
        if (this.pageCache) this.pageCache.set(page, result)
        this.applyResult(result, page)
      })
      .catch((error) => this.setData({ loading: false, error: error.message }))
      .then(done, done)
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
    wx.setEnablePullDownRefresh(false)
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
    wx.setEnablePullDownRefresh(true)
    this.setData({ sheetVisible: false })
  },

  prevPage() {
    if (this.data.page <= 1) return
    this.load(this.data.page - 1)
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  nextPage() {
    if (this.data.page >= this.data.pages) return
    this.load(this.data.page + 1)
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  backToSearch() {
    wx.navigateBack()
  },
})
