/**
 * 小程序入口：初始化云开发。
 *
 * env 填你自己的云开发环境 ID（微信开发者工具 → 云开发 → 设置 → 环境 ID）。
 * 未填时保持 'YOUR_CLOUD_ENV'，调用会失败并在页面提示。
 */
App({
  globalData: {
    cloudEnv: 'astroplan-d5gg67qu6533ce03c',
    miniVersion: '1.1.15',
    meta: null,
    /** 从地图页带回来的自定义点 */
    pickedPoint: null,
    /** 查询条件（跨页面传递，避免 URL 过长） */
    query: null,
  },
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发，请升级微信客户端')
      return
    }
    wx.cloud.init({
      env: this.globalData.cloudEnv,
      traceUser: false,
    })
  },
})
