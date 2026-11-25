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
        // 云函数默认超时只有 3 秒：给出可操作的提示，而不是原始错误码
        if (message.includes('-504003') || message.includes('TIME_LIMIT_EXCEEDED')) {
          reject(new Error('查询超时'))
          return
        }
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
  search: (opts) => {
    const once = () => call('search', { opts }, { timeout: 70000 })
    const isTimeout = (error) => /查询超时|超时|timeout|TIME_LIMIT|504003/iu.test(String(error && error.message))
    // 超时：云端通常已算完（结果缓存 10 分钟），重试两次多半秒回
    return once().catch((error) => {
      if (!isTimeout(error)) throw error
      return once().catch((error2) => {
        if (!isTimeout(error2)) throw error2
        return once()
      })
    })
  },
  night: (payload) => call('night', payload),
  bortle: (lat, lon) => call('bortle', { lat, lon }),
  sim: (payload) => call('sim', payload, { timeout: 60000 }),
}
