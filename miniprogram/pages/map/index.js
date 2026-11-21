const api = require('../../utils/api')
const { parseCoord, formatCoord } = require('../../utils/coord')

Page({
  data: {
    latitude: 35,
    longitude: 105,
    scale: 4,
    markers: [],
    latText: '',
    lonText: '',
    hint: '',
    picked: null,
    siteName: '',
    loading: true,
  },

  onLoad() {
    this.loadSites()
  },

  loadSites() {
    const cached = getApp().globalData.meta
    const ready = (meta) => {
      const markers = (meta.sites || []).map((s, index) => ({
        id: index,
        latitude: s.lat,
        longitude: s.lon,
        width: 6,
        height: 6,
        callout: {
          content: `${s.name}（B${s.bortle}）`,
          display: 'BYCLICK',
          padding: 8,
          borderRadius: 6,
          bgColor: '#16223a',
          color: '#dfe7f5',
          fontSize: 12,
        },
      }))
      this.setData({ markers, loading: false })
    }
    if (cached) { ready(cached); return }
    api.meta()
      .then((meta) => { getApp().globalData.meta = meta; ready(meta) })
      .catch((error) => this.setData({ loading: false, hint: error.message }))
  },

  /** 点击地图空白：取该点经纬度（并显示最近的预设站点名） */
  onMapTap(e) {
    const detail = e.detail || {}
    const lat = detail.latitude
    const lon = detail.longitude
    if (typeof lat !== 'number' || typeof lon !== 'number') return
    this.setPoint(lat, lon)
  },

  setPoint(lat, lon) {
    const meta = getApp().globalData.meta
    let nearest = null
    let best = Infinity
    if (meta) {
      for (const site of meta.sites || []) {
        const dLat = (site.lat - lat) * 111
        const dLon = (site.lon - lon) * 111 * Math.cos(lat * Math.PI / 180)
        const d = Math.sqrt(dLat * dLat + dLon * dLon)
        if (d < best) { best = d; nearest = site }
      }
    }
    this.setData({
      picked: { lat, lon },
      latText: formatCoord(lat),
      lonText: formatCoord(lon),
      hint: nearest ? `最近站点：${nearest.name}（约 ${Math.round(best)} km）` : '',
      siteName: nearest && best <= 3 ? nearest.name : '',
    })
    this.checkBortle(lat, lon)
  },

  /** 城市光晕模型算波特尔（与网页版同一套逻辑） */
  checkBortle(lat, lon) {
    api.bortle(lat, lon)
      .then((res) => {
        if (res && Number.isFinite(res.bortle)) {
          this.setData({ hint: `${this.data.hint ? this.data.hint + ' · ' : ''}波特尔≈B${res.bortle}` })
        }
      })
      .catch(() => { /* 拿不到就不显示 */ })
  },

  onLatInput(e) {
    const text = e.detail.value
    this.setData({ latText: text })
    this.tryApply(text, this.data.lonText)
  },

  onLonInput(e) {
    const text = e.detail.value
    this.setData({ lonText: text })
    this.tryApply(this.data.latText, text)
  },

  /** 两个框都合法才落点（支持小数与角分秒） */
  tryApply(latText, lonText) {
    const lat = parseCoord(latText, 'lat')
    const lon = parseCoord(lonText, 'lon')
    if (lat === null && lon === null) { this.setData({ hint: '' }); return }
    if (lat === null) { this.setData({ hint: '纬度格式不对：39.9042 或 39°54′15″N' }); return }
    if (lon === null) { this.setData({ hint: '经度格式不对：116.4074 或 116°24′27″E' }); return }
    this.setData({
      latitude: lat,
      longitude: lon,
      picked: { lat, lon },
      hint: '',
    })
    this.checkBortle(lat, lon)
  },

  useNearestCity() {
    const beijing = { lat: 39.904, lon: 116.407 }
    this.setData({ latitude: beijing.lat, longitude: beijing.lon, scale: 6 })
    this.setPoint(beijing.lat, beijing.lon)
  },

  onConfirm() {
    const picked = this.data.picked
    if (!picked) {
      wx.showToast({ title: '请先在地图上点一个位置', icon: 'none' })
      return
    }
    getApp().globalData.pickedPoint = {
      lat: Math.round(picked.lat * 1e6) / 1e6,
      lon: Math.round(picked.lon * 1e6) / 1e6,
      name: this.data.siteName || '',
    }
    wx.navigateBack()
  },

  onCancel() {
    wx.navigateBack()
  },
})
