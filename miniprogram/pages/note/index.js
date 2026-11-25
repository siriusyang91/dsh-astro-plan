const api = require('../../utils/api')
const { buildSections, buildGrades } = require('../../utils/format')

Page({
  data: {
    ready: false,
    title: '',
    subtitle: '',
    sections: [],
    grades: [],
    reasons: [],
    score: '',
    error: '',
    sim: null,
    simLoading: true,
    simError: '',
    simSkip: false,
    sky: null,
  },

  onLoad() {
    const payload = getApp().globalData.notePayload
    if (!payload || !payload.item) {
      this.setData({ ready: false, error: '没有便签数据，请返回结果页重新打开' })
      return
    }
    const raw = payload.item
    const site = raw.site || {}
    const title = `${raw.target.name} · ${site.name}`
    wx.setNavigationBarTitle({ title })
    this.context = {
      date: raw.date,
      targetId: raw.target && raw.target.id,
      opts: payload.query || {},
    }
    if (site.custom) { this.context.siteLat = site.lat; this.context.siteLon = site.lon }
    else contextSite(this.context, site)

    this.setData({
      ready: true,
      title,
      subtitle: `${raw.date} · ${raw.target.typeLabel || raw.target.type || ''}`,
      sections: buildSections(raw),
      grades: buildGrades(raw),
      reasons: raw.reasons || [],
      score: String(raw.score || ''),
      sky: (getApp().globalData.meta && getApp().globalData.meta.sky) || null,
    })

    if (!getApp().globalData.meta) {
      api.meta()
        .then((meta) => {
          getApp().globalData.meta = meta
          this.setData({ sky: meta.sky || null })
        })
        .catch(() => {})
    }
    this.loadSim()
  },

  loadSim() {
    if (!this.context) return
    this.setData({ simLoading: true, simError: '', simSkip: false })
    api.sim(this.context)
      .then((result) => {
        const sim = result && result.sim
        if (!result || !result.ok || !sim) {
          this.setData({ simLoading: false, simError: (result && result.message) || '画面模拟不可用' })
          return
        }
        if (sim.skip) {
          this.setData({ simLoading: false, simSkip: true })
          return
        }
        this.setData({ simLoading: false, sim, simSkip: false })
      })
      .catch((error) => this.setData({ simLoading: false, simError: error.message }))
  },

  retrySim() {
    this.loadSim()
  },

  back() {
    wx.navigateBack()
  },
})

/** 预设站点：用 id 让云端锁定同一站 */
function contextSite(context, site) {
  if (site && site.id) context.siteId = site.id
}
