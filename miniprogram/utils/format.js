/** 展示层格式化：日期、距离、曝光、便签分区。 */

function pad(n) {
  return String(n).padStart(2, '0')
}

function today(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function km(value) {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n >= 100 ? `${Math.round(n)} km` : `${n.toFixed(0)} km`
}

function deg(value, digits = 0) {
  if (value === null || value === undefined) return '—'
  return `${Number(value).toFixed(digits)}°`
}

function exposureText(params) {
  if (!params) return '—'
  const shots = params.frames > 1 ? ` × ${params.frames} 张` : ''
  return `${params.exposureText || `${params.exposureSec}s`}${shots} · ISO ${params.iso}`
}

function weatherText(weather) {
  if (!weather) return '—'
  if (weather.status === 'ok') {
    return `云 ${weather.cloudMean}% · 降水 ${weather.precipMax}% · 最低 ${weather.tMin}℃`
  }
  if (weather.status === 'out_of_range') return '超出 7 天预报范围，仅按天文条件评估'
  if (weather.status === 'unavailable') return '天气数据暂不可用，按天文条件排序'
  return '暂无天气'
}

/** 便签分区：[{ title, rows: [[key, value], …] }] */
function buildSections(item) {
  const target = item.target || {}
  const site = item.site || {}
  const win = item.window || {}
  const geo = item.geometry || {}
  const params = item.params || {}
  const fg = item.foreground || {}

  return [
    {
      title: '目标',
      rows: [
        ['名称', target.name || '—'],
        ['类型', target.typeLabel || target.type || '—'],
        ['最低波特尔', target.minBortle ? String(target.minBortle) : '—'],
        ['提示', target.tips || '—'],
      ],
    },
    {
      title: '时间与月相',
      rows: [
        ['日期', item.date || '—'],
        ['可见窗口', `${win.startShort || '—'} → ${win.endShort || '—'}`],
        ['可用时长', win.hours ? `${win.hours} h` : '—'],
        ['月照度', win.moon ? `${win.moon.illum}%（${win.moon.phase}）` : '—'],
      ],
    },
    {
      title: '地点',
      rows: [
        ['地区', [site.region, site.province].filter(Boolean).join(' · ') || '—'],
        ['具体地点', site.name || '—'],
        ['波特尔', site.bortle ? `B${site.bortle}` : '—'],
        ['海拔', site.altM ? `${site.altM} m` : '—'],
        ['直线距离', km(item.distanceKm)],
        ['坐标', site.lat !== undefined ? `${Math.abs(Number(site.lat)).toFixed(3)}° ${Number(site.lat) >= 0 ? 'N' : 'S'} · ${Math.abs(Number(site.lon)).toFixed(3)}° ${Number(site.lon) >= 0 ? 'E' : 'W'}` : '—'],
      ],
    },
    {
      title: '方位与构图',
      rows: [
        ['方向', geo.direction || '—'],
        ['方位角', geo.azStart !== undefined ? `${geo.azStart}° → ${geo.azEnd}°` : '—'],
        ['最高高度', `${deg(geo.altMax)}（${geo.directionAtMax || geo.direction || '—'}）`],
        ['地景', (fg.name || '自选前景') + (fg.azimuthIgnored ? '（不按方位评分）' : '')],
        ['不可替代性', fg.irreplaceability !== undefined
          ? `${fg.irreplaceability}%（全国 ${fg.sharedBy || 1} 站）`
          : '低'],
      ],
    },
    {
      title: '拍摄参数',
      rows: [
        ['全画幅焦段', params.ffFocal ? `${params.ffFocal} mm` : '—'],
        ['APS-C 焦段', params.apsFocal ? `${params.apsFocal} mm` : '—'],
        ['光圈', params.aperture || '—'],
        ['曝光', exposureText(params)],
        ['赤道仪', params.trackerRequired ? '必须使用' : (params.trackerNeeded ? '需要' : '可用可不用')],
        ['说明', params.note || '—'],
      ],
    },
    (() => {
      const w = item.weather || {}
      const rows = [['状态', weatherText(w)]]
      if (w.score != null) {
        rows.push(['数据源', w.source || '—'])
        rows.push(['综合评分', `${w.score} 分`])
        rows.push(['平均云量', `${w.cloudMean}%`])
        rows.push(['晴夜小时', `${w.clearHours} h`])
        rows.push(['最佳 3h 窗口', `${w.best3Start || '—'} 起 / 云 ${w.best3Cloud == null ? '—' : w.best3Cloud + '%'}`])
        rows.push(['降水概率峰值', `${w.precipMax}%`])
        rows.push(['最低温', w.tMin == null ? '—' : `${w.tMin}℃`])
        rows.push(['露点差', w.dewGap == null ? '—' : `${w.dewGap}℃`])
        rows.push(['最大风速', w.windMax == null ? '—' : `${w.windMax} km/h`])
        rows.push(['能见度', w.visKm == null ? '—' : `${w.visKm} km`])
      }
      return { title: '天气', rows }
    })(),
    {
      title: '推荐度明细',
      rows: [
        ['天象', item.breakdown && item.breakdown.sky !== null ? `${item.breakdown.sky} 分` : '—'],
        ['光污染', item.breakdown && item.breakdown.pollution !== null ? `${item.breakdown.pollution} 分` : '—'],
        ['月相', item.breakdown && item.breakdown.moon !== null ? `${item.breakdown.moon} 分` : '—'],
        ['天气', item.breakdown && item.breakdown.weather !== null ? `${item.breakdown.weather} 分` : '—'],
        ['地景', item.breakdown && item.breakdown.foreground !== null ? `${item.breakdown.foreground} 分` : '—'],
        ['总分', `${item.score} 分`],
      ],
    },
  ]
}

/** 推荐度五项：分数 + 说明（给横向评分条用） */
function buildGrades(item) {
  const b = item.breakdown || {}
  const rd = item.reasonDetail || {}
  const rows = [
    ['天象', b.sky, rd.sky],
    ['光污染', b.pollution, rd.pollution],
    ['月相', b.moon, rd.moon],
    ['天气', b.weather, rd.weather],
    ['地景', b.foreground, rd.foreground],
  ]
  return rows.map(([name, score, text]) => ({
    name,
    score: score == null ? null : Math.max(0, Math.min(100, Math.round(score))),
    text: text || '',
  }))
}

module.exports = { today, km, deg, exposureText, weatherText, buildSections, buildGrades }
