#!/usr/bin/env node
/**
 * Static checks that need no dependencies: JavaScript syntax of every source
 * file, valid JSON manifests, and the bundle patch shape.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0

function fail(message) {
  failed += 1
  console.error(`FAIL ${message}`)
}

function listJs(dir) {
  return readdirSync(join(root, dir)).filter(name => /\.(m?js)$/.test(name)).map(name => join(dir, name))
}

const files = [...listJs('lib'), ...listJs('scripts'), ...listJs('test')]
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', join(root, file)], { encoding: 'utf8' })
  if (result.status !== 0) fail(`${file}\n${result.stderr}`)
}
console.log(`syntax ok: ${files.length} files`)

for (const file of ['package.json', 'package-lock.json']) {
  try {
    JSON.parse(readFileSync(join(root, file), 'utf8'))
  } catch (error) {
    fail(`${file}: ${error.message}`)
  }
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
for (const target of [pkg.main, pkg.exports['.'].default, pkg.exports['./client'].default, pkg.dsh.bundle.patch, pkg.icon]) {
  try {
    readFileSync(join(root, target))
  } catch {
    fail(`package.json points at a missing file: ${target}`)
  }
}

const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const rows = patch.split('\n').filter(line => !line.trimStart().startsWith('#') && line.trim() !== '')
if (rows[0] !== '- insert:' || !rows.some(line => /^\s+name: dsh-arckep$/.test(line))) {
  fail('cordis.patch.yml must be a single "- insert:" row named dsh-arckep')
}

if (failed > 0) process.exit(1)
console.log('all checks passed')
