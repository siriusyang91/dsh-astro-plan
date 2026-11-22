const api = require('../../utils/api')
const { today } = require('../../utils/format')

const HERE = '@here'

Page({
  data: {
    loading: true,
    error: '',
    types: [],
    typeIndex: 0,
    regions: ['全国'],
    regionIndex: 0,
    provinces: [{ name: '', label: '全部省份' }],
    provinceIndex: 0,
    sites: [{ id: '', label: '全部具体地点' }],
    siteIndex: 0,
    d1: today(0),
    d2: today(6),
    minAlt: 0,
    bortle: 6,
    origins: [{ name: '', label: '不计算距离' }, { name: HERE, label: '目前所在地' }],
    originIndex: 1,
    originLabel: '目前所在地',
    custom: null,
    customLabel: '',
  },

  onLoad() {
    this.loadMeta()
  },

  onShow() {
    const app = getApp()
    const picked = app.globalData.pickedPoint
    if (picked) {
      app.globalData.pickedPoint = null
      this.setData({ custom: picked, customLabel: `自定义点 ${picked.lat.toFixed(3)}, ${picked.lon.toFixed(3)}` })
    }
  },

  loadMeta() {
    api.meta()
      .then((meta) => {
        const regions = ['全国'].concat(meta.regions || [])
        const origins = [{ name: '', label: '不计算距离' }, { name: HERE, label: '目前所在地' }]
          .concat((meta.cities || []).map((c) => ({ name: c.name, label: c.name })))
        this.meta = meta
        this.setData({
          loading: false,
          types: (meta.eventTypes || []).map((t) => ({ id: t.id, label: t.label })),
          regions,
          origins,
        })
        this.applyRegion(0)
      })
      .catch((error) => this.setData({ loading: false, error: error.message }))
  },

  /** 地区 → 省份列表；选地区后省份/地点清零 */
  applyRegion(regionIndex) {
    const region = this.data.regions[regionIndex]
    const provinces = (this.meta.provinces || [])
      .filter((p) => !region || region === '全国' || p.region === region)
      .map((p) => ({ name: p.name, label: p.name }))
    this.setData({
      regionIndex,
      provinces: [{ name: '', label: '全部省份' }].concat(provinces),
      provinceIndex: 0,
    })
    this.applyProvince(0)
  },

  /** 省份 → 地点列表 */
  applyProvince(provinceIndex, keepSite) {
    const region = this.data.regions[this.data.regionIndex]
    const province = this.data.provinces[provinceIndex].name
    const sites = (this.meta.sites || [])
      .filter((s) => {
        if (region && region !== '全国' && s.region !== region) return false
        if (province && s.province !== province) return false
        return true
      })
      .sort((a, b) => a.bortle - b.bortle)
      .map((s) => ({ id: s.id, label: `${s.name}（B${s.bortle}）` }))
    const data = {
      provinceIndex,
      sites: [{ id: '', label: '全部具体地点' }].concat(sites),
    }
    if (!keepSite) data.siteIndex = 0
    this.setData(data)
  },

  onType(e) { this.setData({ typeIndex: Number(e.detail.value) }) },

  onRegion(e) {
    this.setData({ custom: null, customLabel: '' })
    this.applyRegion(Number(e.detail.value))
  },

  onProvince(e) {
    const index = Number(e.detail.value)
    const name = this.data.provinces[index].name
    // 选省份时自动带出地区
    const region = name ? (this.meta.provinces.find((p) => p.name === name) || {}).region : ''
    const regionIndex = region ? Math.max(0, this.data.regions.indexOf(region)) : 0
    this.setData({ regionIndex, custom: null, customLabel: '' })
    this.applyRegionProvinces(regionIndex, index)
  },

  /** 重新按地区构建省份列表并保持选中，然后刷新地点 */
  applyRegionProvinces(regionIndex, wantProvinceIndex) {
    const region = this.data.regions[regionIndex]
    const provinces = (this.meta.provinces || [])
      .filter((p) => !region || region === '全国' || p.region === region)
      .map((p) => ({ name: p.name, label: p.name }))
    const list = [{ name: '', label: '全部省份' }].concat(provinces)
    const index = Math.min(wantProvinceIndex, list.length - 1)
    this.setData({ regionIndex, provinces: list, provinceIndex: index })
    this.applyProvince(index)
  },

  onSite(e) {
    const index = Number(e.detail.value)
    const id = this.data.sites[index].id
    const site = id ? (this.meta.sites || []).find((s) => s.id === id) : null
    if (site) {
      // 选地点 → 自动带出地区与省份
      const regionIndex = Math.max(0, this.data.regions.indexOf(site.region))
      const provinces = (this.meta.provinces || [])
        .filter((p) => !site.region || site.region === '全国' || p.region === site.region)
        .map((p) => ({ name: p.name, label: p.name }))
      const list = [{ name: '', label: '全部省份' }].concat(provinces)
      const provinceIndex = Math.max(0, list.findIndex((p) => p.name === site.province))
      const sites = (this.meta.sites || [])
        .filter((s) => s.region === site.region && s.province === site.province)
        .sort((a, b) => a.bortle - b.bortle)
        .map((s) => ({ id: s.id, label: `${s.name}（B${s.bortle}）` }))
      const siteIndex = Math.max(0, [{ id: '' }].concat(sites).findIndex((s) => s.id === id))
      this.setData({
        regionIndex,
        provinces: list,
        provinceIndex,
        sites: [{ id: '', label: '全部具体地点' }].concat(sites),
        siteIndex,
        custom: null,
        customLabel: '',
      })
      return
    }
    this.setData({ siteIndex: index, custom: null, customLabel: '' })
  },

  onDate1(e) { this.setData({ d1: e.detail.value }) },
  onDate2(e) { this.setData({ d2: e.detail.value }) },
  onAlt(e) { this.setData({ minAlt: Number(e.detail.value) }) },
  onBortle(e) { this.setData({ bortle: Number(e.detail.value) }) },

  onOrigin(e) {
    const index = Number(e.detail.value)
    this.setData({ originIndex: index, originLabel: this.data.origins[index].label })
  },

  openMap() {
    wx.navigateTo({ url: '/pages/map/index' })
  },

  clearCustom() {
    this.setData({ custom: null, customLabel: '' })
  },

  /** 出发地坐标：目前所在地 → 定位；失败按北京（与网页版一致） */
  resolveOrigin() {
    return new Promise((resolve) => {
      const picked = this.data.origins[this.data.originIndex]
      if (!picked || !picked.name) { resolve(null); return }
      if (picked.name !== HERE) {
        const city = (this.meta.cities || []).find((c) => c.name === picked.name)
        resolve(city ? { lat: city.lat, lon: city.lon } : null)
        return
      }
      wx.getLocation({
        type: 'gcj02',
        success: (res) => resolve({ lat: res.latitude, lon: res.longitude }),
        fail: () => {
          const beijing = (this.meta.cities || []).find((c) => c.name === '北京')
          this.setData({ originLabel: '北京' })
          wx.showToast({ title: '未获取到定位，按北京计算', icon: 'none' })
          resolve(beijing ? { lat: beijing.lat, lon: beijing.lon } : null)
        },
      })
    })
  },

  onReset() {
    const app = getApp()
    app.globalData.pickedPoint = null
    app.globalData.query = null
    this.setData({
      typeIndex: 0,
      d1: today(0),
      d2: today(6),
      minAlt: 0,
      bortle: 6,
      custom: null,
      customLabel: '',
      originIndex: 1,
      originLabel: '目前所在地',
    })
    this.applyRegion(0)
    wx.showToast({ title: '已恢复默认条件', icon: 'none' })
  },

  async onSearch() {
    if (this.data.d1 > this.data.d2) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' })
      return
    }
    wx.showLoading({ title: '准备中', mask: true })
    const origin = await this.resolveOrigin()
    const site = this.data.sites[this.data.siteIndex]
    const opts = {
      eventType: this.data.types[this.data.typeIndex].id,
      dateStart: this.data.d1,
      dateEnd: this.data.d2,
      minAltitude: this.data.minAlt,
      maxBortle: this.data.bortle,
      pageSize: 20,
      page: 1,
    }
    if (origin) { opts.originLat = origin.lat; opts.originLon = origin.lon }
    if (this.data.custom) {
      opts.siteLat = this.data.custom.lat
      opts.siteLon = this.data.custom.lon
      if (this.data.custom.bortle) opts.siteBortle = this.data.custom.bortle
    } else {
      if (site && site.id) opts.location = site.id
      const province = this.data.provinces[this.data.provinceIndex].name
      const region = this.data.regions[this.data.regionIndex]
      if (province) opts.province = province
      if (region && region !== '全国') opts.region = region
    }
    getApp().globalData.query = opts
    wx.hideLoading()
    wx.navigateTo({ url: '/pages/results/index' })
  },
})
