const api = require('../../utils/api')
const { parseCoord, formatCoord } = require('../../utils/coord')

const PICKED_ID = 99999

/** 经纬度显示成「38.737000 N」这种带半球字母的格式 */
function hemiText(value, kind) {
  const num = Number(value)
  const hemi = kind === 'lat' ? (num >= 0 ? 'N' : 'S') : (num >= 0 ? 'E' : 'W')
  return `${Math.abs(num).toFixed(6)} ${hemi}`
}

Page({
  data: {
    latitude: 35,
    longitude: 105,
    scale: 4,
    markers: [],
    polyline: [],
    pickedMarker: [],
    presets: [],
    presetIndex: 0,
    presetLabel: '选择预设地点',
    selectedText: '未选择位置',
    latText: '',
    lonText: '',
    hint: '',
    picked: null,
    selectedSiteId: '',
    loading: true,
  },

  onLoad() {
    this.loadSites()
  },

  loadSites() {
    const cached = getApp().globalData.meta
    const ready = (meta) => {
      this.siteList = meta.sites || []
      const presets = this.siteList.map((s, index) => ({
        index,
        label: `${s.name}（B${s.bortle}）`,
      }))
      this.setData({
        presets,
        markerBase: this.buildMarkers(''),
        markers: this.buildMarkers(''),
        loading: false,
      })
    }
    if (cached) { ready(cached); return }
    api.meta()
      .then((meta) => { getApp().globalData.meta = meta; ready(meta) })
      .catch((error) => this.setData({ loading: false, hint: error.message }))
  },

  /** 预设站点 marker：默认 10px、只给选中项挂常驻气泡（保证同时只选中一个） */
  buildMarkers(selectedId) {
    const list = this.siteList || []
    return list.map((s, index) => {
      const active = s.id === selectedId
      return {
        id: index,
        latitude: s.lat,
        longitude: s.lon,
        width: active ? 18 : 10,
        height: active ? 18 : 10,
        ...(active
          ? {
            callout: {
              content: `${s.name}（B${s.bortle}）`,
              display: 'ALWAYS',
              padding: 8,
              borderRadius: 6,
              bgColor: '#16223a',
              color: '#dfe7f5',
              fontSize: 12,
            },
          }
          : {}),
      }
    })
  },

  /** 选中一个预设站点（只保留一个选中态） */
  selectSite(index) {
    const site = (this.siteList || [])[index]
    if (!site) return
    this.setData({
      markers: this.buildMarkers(site.id),
      selectedSiteId: site.id,
      presetIndex: index,
      presetLabel: site.name,
    })
    this.setPoint(site.lat, site.lon, { siteId: site.id, name: site.name })
    return site
  },

  onMarkerTap(e) {
    const index = Number(e.detail && e.detail.markerId)
    if (!Number.isInteger(index)) return
    const site = this.selectSite(index)
    if (site) {
      this.setData({ latitude: site.lat, longitude: site.lon, scale: Math.max(this.data.scale, 6) })
    }
  },

  onPresetChange(e) {
    const index = Number(e.detail.value)
    if (!Number.isInteger(index) || index < 0 || index >= this.data.presets.length) return
    const site = this.selectSite(index)
    if (site) this.setData({ latitude: site.lat, longitude: site.lon, scale: 8 })
  },

  /** 点击地图空白：作为自定义点（清除预设选中态） */
  onMapTap(e) {
    const detail = e.detail || {}
    const lat = detail.latitude
    const lon = detail.longitude
    if (typeof lat !== 'number' || typeof lon !== 'number') return
    this.setData({ markers: this.buildMarkers(''), selectedSiteId: '', presetIndex: 0 })
    this.setPoint(lat, lon, {})
  },

  setPoint(lat, lon, extra = {}) {
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
    const name = extra.name || (nearest && best <= 3 ? nearest.name : '')
    const label = extra.siteId
      ? `预设点 · ${name}`
      : `自定义 · ${hemiText(lat, 'lat')}, ${hemiText(lon, 'lon')}`
    const origin = this.origin()
    this.setData({
      picked: { lat, lon, ...extra },
      latText: hemiText(lat, 'lat'),
      lonText: hemiText(lon, 'lon'),
      presetLabel: extra.siteId ? name : '自定义地点',
      selectedText: label,
      hint: origin
        ? (nearest ? `最近预设站：${nearest.name}（约 ${Math.round(best)} km）` : '')
        : '未设置出发地，不显示连线',
      pickedMarker: [{
        id: PICKED_ID,
        latitude: lat,
        longitude: lon,
        width: 22,
        height: 22,
        callout: {
          content: extra.siteId ? name : `${hemiText(lat, 'lat')}, ${hemiText(lon, 'lon')}`,
          display: 'ALWAYS',
          padding: 8,
          borderRadius: 6,
          bgColor: '#2f66c9',
          color: '#ffffff',
          fontSize: 12,
        },
      }],
      polyline: origin
        ? [{
          points: [
            { latitude: origin.lat, longitude: origin.lon },
            { latitude: lat, longitude: lon },
          ],
          color: '#ffd479',
          width: 3,
          dottedLine: true,
          arrowLine: false,
        }]
        : [],
    })
    this.checkBortle(lat, lon)
  },

  /** 出发地坐标（查询条件里的 origin） */
  origin() {
    const query = (getApp().globalData.query) || {}
    if (typeof query.originLat === 'number' && typeof query.originLon === 'number') {
      return { lat: query.originLat, lon: query.originLon }
    }
    return null
  },

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

  tryApply(latText, lonText) {
    const lat = parseCoord(latText, 'lat')
    const lon = parseCoord(lonText, 'lon')
    if (lat === null && lon === null) { this.setData({ hint: '' }); return }
    if (lat === null) { this.setData({ hint: '纬度格式不对：39.9042 或 39°54′15″N' }); return }
    if (lon === null) { this.setData({ hint: '经度格式不对：116.4074 或 116°24′27″E' }); return }
    this.setData({ latitude: lat, longitude: lon })
    this.setData({ markers: this.buildMarkers(''), selectedSiteId: '', presetLabel: '选择预设地点', presetIndex: 0 })
    this.setPoint(lat, lon, {})
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
      name: picked.name || '',
      siteId: picked.siteId || '',
    }
    wx.navigateBack()
  },

  onCancel() {
    wx.navigateBack()
  },
})
