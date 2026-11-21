/**
 * 微信云函数入口（CommonJS）。
 *
 * 微信云函数的运行环境是 Node 16 的 CommonJS 上下文，而 lib/ 是 ESM，
 * 所以这里用动态 import() 懒加载 runtime/app.mjs（由 tools/build-miniprogram.mjs 生成）。
 * 首次调用会有一次模块加载开销，之后进程内缓存。
 */

let appPromise = null

function loadApp() {
  if (!appPromise) {
    appPromise = import('./runtime/app.mjs').catch((error) => {
      appPromise = null
      throw error
    })
  }
  return appPromise
}

exports.main = async function main(event = {}, context = {}) {
  try {
    const app = await loadApp()
    return await app.handle(event, context)
  } catch (error) {
    return {
      ok: false,
      error: 'runtime_error',
      message: String(error && error.message ? error.message : error),
    }
  }
}
