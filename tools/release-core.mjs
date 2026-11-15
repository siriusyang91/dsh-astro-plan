/**
 * 自动发布的纯逻辑（无副作用，便于单测）。
 *
 * 判定「有没有更新」只看可发布内容：
 *   lib/**\/*.js、lib/data/**（排除运行时周更的 comets.json / db-stamp.json）、
 *   package.json（去掉 version）、cordis.patch.yml
 * 文档、测试、工具脚本的改动不触发版本。
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, posix, relative } from 'node:path'

/** 运行时数据：内容每周会变，不能作为「有新版本」的依据。 */
export const VOLATILE = new Set(['lib/data/comets.json', 'lib/data/db-stamp.json'])

const SKIP_DIR = /^(?:node_modules|\.npm-cache|\.git|tmp)$/u

function walk(root, rel, out) {
  const abs = join(root, rel)
  let entries
  try {
    entries = readdirSync(abs, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (SKIP_DIR.test(entry.name)) continue
    const childRel = posix.join(rel, entry.name)
    if (entry.isDirectory()) { walk(root, childRel, out); continue }
    if (VOLATILE.has(childRel)) continue
    out.push(childRel)
  }
}

/** 参与「是否有更新」判定的文件（相对仓库根，posix 风格）。 */
export function listPublishable(root) {
  const out = []
  walk(root, 'lib', out)
  for (const name of ['package.json', 'cordis.patch.yml']) {
    if (existsSync(join(root, name))) out.push(name)
  }
  return out.sort()
}

/** 内容哈希：文件名 + 内容；package.json 先去掉 version 字段。 */
export function hashFiles(root, files) {
  const hash = createHash('sha256')
  for (const rel of files) {
    hash.update(rel)
    hash.update('\0')
    let text = readFileSync(join(root, rel), 'utf8')
    if (rel === 'package.json') {
      try {
        const pkg = JSON.parse(text)
        delete pkg.version
        text = JSON.stringify(pkg)
      } catch { /* 解析失败就按原文算 */ }
    }
    hash.update(text)
    hash.update('\0')
  }
  return hash.digest('hex')
}

/** 0.2.7 → 0.2.8；0.2.9 → 0.2.10；1.0.0 → 1.0.1。 */
export function nextPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/u.exec(String(version ?? '').trim())
  if (!m) throw new Error(`版本号不合法：${version}`)
  const [, major, minor, patch] = m
  return `${major}.${minor}.${Number(patch) + 1}`
}

/** 哈希与上次发布一致就不发。 */
export function shouldRelease(state, hash) {
  if (!state || typeof state !== 'object') return true
  if (!state.hash) return true
  return state.hash !== hash
}

/** 锁是否仍然有效（超过 staleMs 视为过期，可抢占）。 */
export function lockActive(lock, now = Date.now(), staleMs = 2 * 3600 * 1000) {
  if (!lock || typeof lock !== 'object') return false
  const at = Number(lock.at) || 0
  return at > 0 && now - at < staleMs
}

/** 相对路径（便于日志/断言）。 */
export function relOf(root, abs) {
  return relative(root, abs).replace(/\\/gu, '/')
}
