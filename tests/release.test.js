import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { hashFiles, listPublishable, lockActive, nextPatch, shouldRelease } from '../tools/release-core.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'astro-release-'))
  mkdirSync(join(dir, 'lib', 'data'), { recursive: true })
  writeFileSync(join(dir, 'lib', 'a.js'), 'export const a = 1\n')
  writeFileSync(join(dir, 'lib', 'data', 'comets.json'), '{"count":1}\n')
  writeFileSync(join(dir, 'lib', 'data', 'db-stamp.json'), '{"lastSuccessAt":1}\n')
  writeFileSync(join(dir, 'lib', 'data', 'sites.json'), '[]\n')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.1.0' }, null, 2))
  writeFileSync(join(dir, 'cordis.patch.yml'), 'row: x\n')
  mkdirSync(join(dir, 'docs'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'guide.md'), 'v1\n')
  mkdirSync(join(dir, 'tests'), { recursive: true })
  writeFileSync(join(dir, 'tests', 'a.test.js'), '// test\n')
  return dir
}

test('nextPatch：补丁号自增并正确进位', () => {
  assert.equal(nextPatch('0.2.7'), '0.2.8')
  assert.equal(nextPatch('0.2.9'), '0.2.10')
  assert.equal(nextPatch('1.0.0'), '1.0.1')
  assert.equal(nextPatch('2.9.99'), '2.9.100')
  assert.throws(() => nextPatch('1.0'), /版本号不合法/u)
})

test('可发布文件：只含 lib 与两份清单，排除运行时周更数据', () => {
  const dir = makeRepo()
  try {
    const files = listPublishable(dir)
    assert.ok(files.includes('lib/a.js'))
    assert.ok(files.includes('lib/data/sites.json'))
    assert.ok(files.includes('package.json'))
    assert.ok(files.includes('cordis.patch.yml'))
    assert.ok(!files.includes('lib/data/comets.json'), '周更数据不应参与判定')
    assert.ok(!files.includes('lib/data/db-stamp.json'), 'stamp 不应参与判定')
    assert.ok(!files.some((f) => f.startsWith('docs/')), '文档不参与判定')
    assert.ok(!files.some((f) => f.startsWith('tests/')), '测试不参与判定')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('哈希：代码变化会变，文档/周更数据变化不变，version 变化不变', () => {
  const dir = makeRepo()
  try {
    const base = hashFiles(dir, listPublishable(dir))

    writeFileSync(join(dir, 'docs', 'guide.md'), 'v2\n')
    assert.equal(hashFiles(dir, listPublishable(dir)), base, '改文档不应改变哈希')

    writeFileSync(join(dir, 'lib', 'data', 'comets.json'), '{"count":2}\n')
    assert.equal(hashFiles(dir, listPublishable(dir)), base, '周更数据不应改变哈希')

    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.9.9' }, null, 2))
    assert.equal(hashFiles(dir, listPublishable(dir)), base, 'version 变化不应改变哈希')

    writeFileSync(join(dir, 'lib', 'a.js'), 'export const a = 2\n')
    assert.notEqual(hashFiles(dir, listPublishable(dir)), base, '改代码必须改变哈希')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('shouldRelease：无记录或哈希不同才发', () => {
  assert.equal(shouldRelease(null, 'h1'), true)
  assert.equal(shouldRelease({}, 'h1'), true)
  assert.equal(shouldRelease({ hash: 'h1' }, 'h1'), false)
  assert.equal(shouldRelease({ hash: 'h1' }, 'h2'), true)
})

test('锁：2 小时内有效，超过视为过期', () => {
  const now = Date.now()
  assert.equal(lockActive({ at: now - 60_000 }, now), true)
  assert.equal(lockActive({ at: now - 3 * 3600_000 }, now), false)
  assert.equal(lockActive(null, now), false)
})

/** 沙箱里不能给子进程接管道：输出写临时文件再读回。 */
function runReleaseScript(args) {
  const outFile = join(mkdtempSync(join(tmpdir(), 'astro-run-')), 'out.log')
  const fd = openSync(outFile, 'w')
  const res = spawnSync(process.execPath, ['tools/daily-release.mjs', ...args], {
    cwd: ROOT, stdio: ['ignore', fd, fd], timeout: 120000,
  })
  closeSync(fd)
  return { status: res.status, out: readFileSync(outFile, 'utf8') }
}

test('daily-release --dry-run：不写状态、不改版本', () => {
  const stateFile = join(ROOT, '.release-state.json')
  const before = existsSync(stateFile) ? readFileSync(stateFile, 'utf8') : null
  const pkgBefore = readFileSync(join(ROOT, 'package.json'), 'utf8')

  const res = runReleaseScript(['--dry-run'])
  assert.equal(res.status, 0, res.out)
  assert.match(res.out, /dry-run/u)
  assert.equal(readFileSync(join(ROOT, 'package.json'), 'utf8'), pkgBefore, 'dry-run 不应改 package.json')
  const after = existsSync(stateFile) ? readFileSync(stateFile, 'utf8') : null
  assert.equal(after, before, 'dry-run 不应写状态文件')
})

test('daily-release 不带 --allow-publish：只体检，不发布', () => {
  const res = runReleaseScript([])
  assert.equal(res.status, 0, res.out)
  // 没有待发布改动时会在更早的分支直接跳过，两种情况都算「没发布」
  assert.match(res.out, /未带 --allow-publish|无需发版/u)
})
