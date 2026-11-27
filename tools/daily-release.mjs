/**
 * 每天 00:00 的自动发布：有代码改动才发版，发布 = 打补丁号 → 测试 → npm publish
 * → 等 tarball 可达 → 刷新并推送市场索引 → 推 GitHub。
 *
 *   node tools/daily-release.mjs --dry-run          # 只体检：会不会发、为什么
 *   node tools/daily-release.mjs --allow-publish    # 真的发（定时任务用这个）
 *   node tools/daily-release.mjs --allow-publish --force   # 忽略哈希，强制发一版
 *
 * 设计约束：
 *   - 任一步失败即中止，绝不推索引/推仓库（避免索引指向不存在的版本）
 *   - 无更新直接跳过，不制造空版本
 *   - 锁文件防并发，超过 2 小时视为过期
 */

import { readFileSync, writeFileSync, existsSync, openSync, closeSync, appendFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import {hashFiles, listPublishable, lockActive, nextPatch, shouldRelease, syncVersionFile } from './release-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CACHE = join(ROOT, '.npm-cache')
const STATE_FILE = join(ROOT, '.release-state.json')
const LOCK_FILE = join(ROOT, '.release.lock')
const LOG_FILE = join(ROOT, '.release-log.jsonl')
const PKG_FILE = join(ROOT, 'package.json')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const allowPublish = args.includes('--allow-publish')
const force = args.includes('--force')

const started = Date.now()
function log(message) { console.log(message) }

function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

/** 跑一个 node 脚本，输出写文件再读回（沙箱里不能给子进程接管道）。 */
function runNode(scriptArgs, timeoutMs = 600000) {
  const logFile = join(CACHE, 'release-step.log')
  const fd = openSync(logFile, 'w')
  const res = spawnSync(process.execPath, scriptArgs, {
    cwd: ROOT,
    stdio: ['ignore', fd, fd],
    timeout: timeoutMs,
  })
  closeSync(fd)
  let out = ''
  try { out = readFileSync(logFile, 'utf8').trim() } catch { /* 忽略 */ }
  return { code: res.status ?? 1, out }
}

function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    const lock = readJson(LOCK_FILE)
    if (lockActive(lock)) {
      return { ok: false, reason: `已有发布在进行（pid ${lock?.pid ?? '?'}，${new Date(lock?.at ?? 0).toISOString()}）` }
    }
    log('· 发现过期锁，抢占')
  }
  writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'w' })
  return { ok: true }
}

function releaseLock() {
  try { if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE) } catch { /* 忽略 */ }
}

function finish(ok, message, extra = {}) {
  const entry = { at: new Date().toISOString(), ok, message, ...extra }
  try {
    const pkg = readJson(PKG_FILE, {})
    appendFileSync(LOG_FILE, `${JSON.stringify({ ...entry, version: pkg.version })}\n`)
  } catch { /* 忽略 */ }
  releaseLock()
  log(`\n${ok ? '✓' : '✗'} ${message}`)
  log(`  用时 ${((Date.now() - started) / 1000).toFixed(1)}s`)
  process.exit(ok ? 0 : 1)
}

async function waitForTarball(version, maxMs = 8 * 60 * 1000) {
  const url = `https://registry.npmjs.org/dsh-astro-plan/-/dsh-astro-plan-${version}.tgz`
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) })
      if (res.status === 200) return true
    } catch { /* 继续等 */ }
    await new Promise((r) => setTimeout(r, 20000))
  }
  return false
}

/** 每周刷新新闻（news.json 的周键变了才抓），失败保留旧文件 */
function refreshNewsWeekly() {
  try {
    const file = join(ROOT, 'lib', 'data', 'news.json')
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const week = (d2) => {
      const t = new Date(d2)
      const monday = new Date(t)
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
      return monday.toISOString().slice(0, 10)
    }
    if (data.updatedAt && week(data.updatedAt) === week(new Date())) return
    execFileSync(process.execPath, [join(ROOT, 'tools', 'build-news.mjs')], { stdio: 'inherit' })
  } catch (e) {
    console.warn('新闻周更失败（保留旧文件）：', e.message)
  }
}

async function main() {
  syncVersionFile()
  refreshNewsWeekly()
  log(`星野计划 · 自动发布 ${dryRun ? '（dry-run）' : ''}`)
  const files = listPublishable(ROOT)
  const hash = hashFiles(ROOT, files)
  const state = readJson(STATE_FILE, null)
  const pkg = readJson(PKG_FILE, {})
  const due = force || shouldRelease(state, hash)

  log(`· 可发布文件 ${files.length} 个，内容哈希 ${hash.slice(0, 12)}…`)
  log(`· 上次发布：${state?.version ?? '（无记录）'}${state?.at ? ` @ ${state.at}` : ''}`)

  if (!due) {
    log('· 与上次发布内容一致 → 无需发版')
    process.exit(0)
  }

  const next = nextPatch(pkg.version)
  log(`· 计划发布：${pkg.version} → ${next}`)

  if (dryRun) {
    log('· dry-run：不跑测试、不改版本、不发布')
    process.exit(0)
  }
  if (!allowPublish) {
    log('· 未带 --allow-publish：只体检，不发布')
    process.exit(0)
  }

  const lock = acquireLock()
  if (!lock.ok) finish(false, lock.reason)

  // 1) 测试
  log('· 跑测试…')
  const tests = runNode(['--test', '--test-isolation=none', 'tests'], 900000)
  if (tests.code !== 0) {
    log(tests.out.split('\n').slice(-15).join('\n'))
    finish(false, '测试未通过，已中止')
  }
  log('  测试通过')

  // 2) 密钥扫描
  log('· 密钥扫描…')
  const secrets = runNode(['tools/check-secrets.mjs'], 120000)
  if (secrets.code !== 0) {
    log(secrets.out.split('\n').slice(-10).join('\n'))
    finish(false, '密钥扫描未通过，已中止')
  }
  log('  干净')

  // 3) 版本号 +0.0.1（同时更新 README/指南里的版本串）
  const oldVersion = pkg.version
  pkg.version = next
  writeFileSync(PKG_FILE, `${JSON.stringify(pkg, null, 2)}\n`)
  for (const file of ['README.md', 'docs/user-guide.md']) {
    const abs = join(ROOT, file)
    if (!existsSync(abs)) continue
    writeFileSync(abs, readFileSync(abs, 'utf8').split(oldVersion).join(next))
  }
  log(`  版本已改为 ${next}`)

  // 4) 发布（内部会重建并校验市场索引）
  log('· npm publish…')
  const publish = runNode(['tools/publish.mjs', '--publish'], 900000)
  if (publish.code !== 0) {
    log(publish.out.split('\n').slice(-15).join('\n'))
    finish(false, 'npm publish 失败，已中止（索引未推送）')
  }
  log('  发布成功')

  // 5) 等 tarball 真正可下载，避免索引指向 404
  log('· 等待 npm tarball 可达…')
  if (!(await waitForTarball(next))) {
    finish(false, 'tarball 8 分钟内仍不可达，已中止（索引未推送）')
  }
  log('  tarball 可达')

  // 6) 推 GitHub（代码 + 索引）
  log('· 推 GitHub…')
  const push = runNode(['tools/push-repo.mjs', '--allow-push', `--message=release: v${next}（自动发布）`], 600000)
  if (push.code !== 0) {
    log(push.out.split('\n').slice(-10).join('\n'))
    finish(false, '推送 GitHub 失败（npm 已发布，索引可能滞后）')
  }
  log('  已推送')

  // 7) 记录状态
  writeFileSync(STATE_FILE, `${JSON.stringify({ hash, version: next, at: new Date().toISOString() }, null, 2)}\n`)
  finish(true, `已发布 v${next}`, { from: oldVersion, to: next, files: files.length })
}

main().catch((error) => {
  finish(false, `异常：${error?.message ?? error}`)
})
