import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json'))
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const libFiles = readdirSync(new URL('../lib/', import.meta.url)).filter(name => name.endsWith('.js'))

test('package metadata', () => {
  assert.equal(pkg.name, 'dsh-arckep')
  assert.equal(pkg.version, '0.1.0')
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, 'lib/index.js')
  assert.equal(pkg.repository.url, 'git+https://github.com/gmen1057/dsh-arckep.git')
  assert.equal(pkg.homepage, 'https://github.com/gmen1057/dsh-arckep#readme')
  assert.equal(pkg.bugs.url, 'https://github.com/gmen1057/dsh-arckep/issues')
  assert.match(pkg.engines.node, />=20/)
  assert.ok(pkg.keywords.includes('dsh') && pkg.keywords.includes('arckep'))
  assert.deepEqual(pkg.dsh.client, { platform: 'web' })
  assert.deepEqual(pkg.dsh.bundle, { patch: './cordis.patch.yml' })
  for (const peer of Object.keys(pkg.peerDependencies)) assert.ok(pkg.devDependencies[peer], `${peer} is also a devDependency`)
})

test('every exported and published file exists', () => {
  for (const target of [pkg.main, pkg.exports['.'].default, pkg.exports['./client'].default, pkg.dsh.bundle.patch, pkg.icon]) {
    assert.ok(existsSync(new URL(`../${target.replace(/^\.\//, '')}`, import.meta.url)), target)
  }
  for (const entry of pkg.files) assert.ok(existsSync(new URL(`../${entry}`, import.meta.url)), `files: ${entry}`)
  assert.equal(pkg.exports['./package.json'], './package.json')
})

test('nothing runs at install time and there are no runtime dependencies', () => {
  assert.equal(pkg.dependencies, undefined)
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack']) {
    assert.equal(pkg.scripts[hook], undefined, hook)
  }
  assert.equal(pkg.bin, undefined)
})

test('the bundle patch is one row, the bare package name, and carries no secret', () => {
  const patch = read('cordis.patch.yml')
  const lines = patch.split('\n').filter(line => !line.trimStart().startsWith('#') && line.trim() !== '')
  assert.deepEqual(lines, ['- insert:', '    - id: arckep', '      name: dsh-arckep'])
  assert.doesNotMatch(lines.join('\n'), /key|token|secret|password|url|host/i)
})

test('LICENSE is MIT with the right holder', () => {
  const license = read('LICENSE')
  assert.match(license, /^MIT License/)
  assert.match(license, /Copyright \(c\) 2026 gmen1057/)
})

test('lib/ imports nothing from Node except node:crypto: no files, sockets or subprocesses', () => {
  for (const file of libFiles) {
    const source = stripComments(read(`lib/${file}`))
    const imports = [...source.matchAll(/(?:from|import\()\s*'([^']+)'/g)].map(m => m[1])
    for (const specifier of imports) {
      assert.ok(specifier.startsWith('./') || ['node:crypto', '@deepseek-ai/schemastery'].includes(specifier), `${file}: ${specifier}`)
    }
    assert.doesNotMatch(source, /child_process|node:fs|node:net|node:http|node:dgram|node:dns|node:tls|node:worker_threads/, file)
    assert.doesNotMatch(source, /\beval\(|new Function\(/, file)
  }
})

test('lib/ only ever mentions https://arckep.ru and loopback addresses', () => {
  const allowed = [/^https:\/\/arckep\.ru$/, /^http:\/\/127\.0\.0\.1(?::\d+)?$/, /^http:\/\/localhost(?::\d+)?$/, /^http:\/\/\[::1\](?::\d+)?$/]
  let seen = 0
  for (const file of libFiles) {
    for (const [url] of read(`lib/${file}`).matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
      const clean = url.replace(/[,.;)]+$/, '')
      let origin
      try { origin = new URL(clean).origin } catch { origin = clean }
      assert.ok(allowed.some(pattern => pattern.test(origin)), `${file}: ${url}`)
      seen += 1
    }
  }
  assert.ok(seen > 0)
})

test('the Host half reads exactly one environment variable', () => {
  const uses = libFiles.flatMap(file => [...read(`lib/${file}`).matchAll(/process\.env/g)].map(() => file))
  assert.deepEqual(uses, ['index.js'])
  assert.match(read('lib/index.js'), /resolveOrigin\(process\.env\)/)
})

test('no telemetry, analytics or third-party endpoints anywhere in the shipped code', () => {
  for (const file of libFiles) {
    assert.doesNotMatch(read(`lib/${file}`), /\b(telemetry|analytics|sentry|gtag|segment|mixpanel|posthog|datadog)\b/i, file)
  }
  assert.doesNotMatch(read('lib/client.js'), /\b(telemetry|analytics|sentry|gtag)\b/i)
})

test('the API key is only ever placed in the Authorization header', () => {
  const api = read('lib/api.js')
  const uses = [...api.matchAll(/\$\{key\}/g)]
  assert.equal(uses.length, 1)
  assert.match(api, /authorization: `Bearer \$\{key\}`/)
  for (const file of libFiles.filter(name => name !== 'api.js')) {
    assert.doesNotMatch(read(`lib/${file}`), /Bearer/, file)
  }
})

test('the client never logs: no console output of any kind except one error for a failing listener', () => {
  const source = read('lib/client.js')
  const calls = [...source.matchAll(/console\.(\w+)/g)].map(m => m[1])
  assert.deepEqual(calls, ['error'])
  for (const file of libFiles.filter(name => name !== 'client.js')) assert.doesNotMatch(read(`lib/${file}`), /console\./, file)
})
