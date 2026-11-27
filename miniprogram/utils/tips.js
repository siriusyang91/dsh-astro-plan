/**
 * 加载页轮播：天文摄影知识 + 近期热门天象。
 * 知识为内置文案；热门天象来自云函数 meta.hotEvents（随数据库每周更新）。
 */
const KNOWLEDGE = [
  { title: '对焦', text: '星空拍摄要把镜头切到手动对焦，拧到无穷远后再对着最亮的一颗星放大十倍实时取景，慢慢微调直到星点变成最小最锐的圆点。' },
  { title: '曝光', text: '用 500 法则估算最长快门，全画幅 24mm 用 20 秒以内、14mm 可到 30 秒，超过就会出现明显星点拖线。' },
  { title: '光圈', text: '广角银河建议最大光圈起步，但光圈全开往往发软、边角彗差明显，收一到两档到 f/2–f/2.8 星点会更紧实。' },
  { title: 'ISO', text: '优先保证快门不拖线再调 ISO；多数机型 1600–3200 平衡最好，暗部噪点可在后期叠加降噪处理。' },
  { title: '赤道仪', text: '拍深空或长焦必须上赤道仪，极轴对准后单张可曝几分钟，配合导星还能把暗弱星系云气拍出来。' },
  { title: '月光', text: '月相超过一半时银河会被压暗，适合拍月照地景；想拍银河细节就挑新月前后一周的晴夜。' },
  { title: '光污染', text: '波特尔 4 级以下才能看清银河结构，2 级以内最通透；出发前用光污染地图确认方向和地平线亮度。' },
  { title: '构图', text: '前景占画面三分之一左右，让银河斜跨对角线更有动感；找一棵树、一座帐篷或一条路做视觉锚点。' },
  { title: '星轨', text: '与其单张长曝几十分钟，不如连拍几百张 30 秒再叠加，噪点更少，也能顺带做一段延时视频。' },
  { title: '蓝调时刻', text: '日落后 20–40 分钟天空还有余光，这时拍地景能保留细节，后期和星空合成最自然。' },
  { title: '保暖与结露', text: '山里夜里温差大，镜头容易起雾，备好加热带和擦镜布，电池放贴身口袋能多拍一小时。' },
  { title: '后期', text: '先在 RAW 里降色温、压噪点，再轻微提亮银河和暗部，避免过度饱和，让画面保持自然通透。' },
]

/** 周键：数据库更新时间所在周（同周内轮播内容固定） */
function weekKey(meta) {
  const t = meta && meta.hotWeek ? new Date(meta.hotWeek + 'T00:00:00Z') : new Date()
  return String(meta && meta.hotWeek || t.toISOString().slice(0, 10))
}

/** 知识与热门天象交替排列，最多 20 条 */
function buildFeed(meta) {
  const hot = (meta && meta.hotEvents) || []
  const news = (meta && meta.news) || []
  const feed = []
  const max = Math.max(KNOWLEDGE.length, hot.length, news.length)
  for (let i = 0; i < max; i += 1) {
    if (KNOWLEDGE[i]) feed.push({ kind: 'tip', title: '摄影知识 · ' + KNOWLEDGE[i].title, text: KNOWLEDGE[i].text })
    if (hot[i]) feed.push({ kind: 'hot', title: '近期天象 · ' + hot[i].title, text: hot[i].text })
    if (news[i]) feed.push({ kind: 'news', title: '航天新闻 · ' + news[i].title, text: news[i].text })
  }
  return feed.slice(0, 24)
}

/** Fisher–Yates 洗牌：轮播随机播放 */
function shuffle(list) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

module.exports = { KNOWLEDGE, weekKey, buildFeed, shuffle }
