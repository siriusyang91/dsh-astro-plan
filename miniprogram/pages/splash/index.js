/** 开屏：1 秒后进入查询页（图片 + 欢迎语淡入）。 */
Page({
  data: { done: false },
  onLoad() {
    this.timer = setTimeout(() => {
      this.setData({ done: true })
      wx.redirectTo({ url: '/pages/search/index' })
    }, 1000)
  },
  onUnload() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
  },
  /** 急着用：点一下立刻进 */
  skip() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    wx.redirectTo({ url: '/pages/search/index' })
  },
})
