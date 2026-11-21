/** 云函数调用封装：统一错误文案，避免每个页面重复 catch。 */
function call(action, payload = {}, options = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'astroPlan',
      data: { action, ...payload },
      timeout: options.timeout || 20000,
      success: (res) => {
        const result = res.result || {}
        if (result.ok === false) {
          reject(new Error(result.message || result.error || '查询失败'))
          return
        }
        resolve(result)
      },
      fail: (error) => {
        const message = error && error.errMsg ? error.errMsg : '网络异常'
        if (message.includes('YOUR_CLOUD_ENV') || message.includes('env')) {
          reject(new Error('云开发环境未配置：请在小程序 app.js 里填 cloudEnv'))
          return
        }
        reject(new Error(message))
      },
    })
  })
}

module.exports = {
  meta: () => call('meta'),
  search: (opts) => call('search', { opts }),
  night: (payload) => call('night', payload),
  bortle: (lat, lon) => call('bortle', { lat, lon }),
}
