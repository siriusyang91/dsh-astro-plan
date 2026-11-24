/**
 * 经纬度解析（由 lib/coord.js 生成，请勿手改；改逻辑请改 lib/coord.js 后重跑构建）。
 */

/** @returns {number|null} 解析失败返回 null */
function parseCoord(text, kind) {
  const raw = String(text == null ? '' : text).trim().toUpperCase()
  if (!raw) return null
  let hemi = null
  const body = raw.replace(/[NSEW]/gu, (ch) => { hemi = hemi || ch; return ' ' })
  const numbers = (body.match(/-?\d+(?:\.\d+)?/gu) || []).map(Number)
  if (!numbers.length) return null

  let value
  if (numbers.length === 1) {
    value = numbers[0]
  } else {
    const deg = Math.abs(numbers[0])
    const min = numbers[1]
    const sec = numbers.length > 2 ? numbers[2] : 0
    if (!(min >= 0 && min < 60)) return null
    if (!(sec >= 0 && sec < 60)) return null
    value = deg + min / 60 + sec / 3600
    if (numbers[0] < 0) value = -value
  }
  if (hemi === 'S' || hemi === 'W') value = -Math.abs(value)
  if (hemi === 'N' || hemi === 'E') value = Math.abs(value)
  if (!Number.isFinite(value)) return null

  if (kind === 'lat') {
    if (Math.abs(value) > 90) return null
    if (hemi && hemi !== 'N' && hemi !== 'S') return null
  } else {
    if (Math.abs(value) > 180) return null
    if (hemi && hemi !== 'E' && hemi !== 'W') return null
  }
  return Math.round(value * 1e6) / 1e6
}

/** 统一显示成 6 位小数（等宽数字排版好看）。 */
function formatCoord(value) {
  return Number(value).toFixed(6)
}

/** 小数 → 度分秒文案，用于结果说明（如 39°54′15″N）。 */
function formatDms(value, kind) {
  const abs = Math.abs(Number(value))
  if (!Number.isFinite(abs)) return '—'
  const deg = Math.floor(abs)
  const minFloat = (abs - deg) * 60
  const min = Math.floor(minFloat)
  const sec = Math.round((minFloat - min) * 60)
  const carrySec = sec === 60 ? 0 : sec
  const carryMin = sec === 60 ? min + 1 : min
  const hemi = kind === 'lat' ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W')
  return `${deg}°${carryMin}′${carrySec}″${hemi}`
}

/** 纬度/经度带半球字母：40.50° N · 115.83° E（南纬/西经自动 S/W）。 */
function formatLat(lat, digits = 2) {
  const value = Math.abs(Number(lat))
  return `${value.toFixed(digits)}° ${Number(lat) >= 0 ? 'N' : 'S'}`
}
function formatLon(lon, digits = 2) {
  const value = Math.abs(Number(lon))
  return `${value.toFixed(digits)}° ${Number(lon) >= 0 ? 'E' : 'W'}`
}
function formatLatLon(lat, lon, digits = 2) {
  return `${formatLat(lat, digits)} · ${formatLon(lon, digits)}`
}

module.exports = { parseCoord, formatCoord, formatDms, formatLat, formatLon, formatLatLon }
