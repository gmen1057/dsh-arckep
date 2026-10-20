import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const pkg = JSON.parse(read('package.json'))
const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const libFiles = readdirSync(new URL('../lib/', import.meta.url)).filter(name => name.endsWith('.js'))

test('package metadata', () => {
  assert.equal(pkg.name, 'dsh-arckep')
  assert.equal(pkg.version, '0.1.3')
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

test('documentation: unofficial notice, install command, no marketing claims, no internal details', () => {
  const en = read('README.md')
  const ru = read('README.ru.md')
  assert.match(en, /\*\*Unofficial\.\*\*/)
  assert.match(en, /not made by, endorsed by or affiliated with\s+(?:>\s*)?DeepSeek/)
  assert.match(ru, /\*\*Неофициальный плагин\.\*\*/)
  for (const doc of [en, ru]) {
    assert.ok(doc.includes('dsh plugin --profile web add github:gmen1057/dsh-arckep'))
    assert.ok(doc.includes('dsh plugin --profile web add dsh-arckep'))
    assert.ok(doc.includes('balance:read') && doc.includes('MIT') && doc.includes('SECURITY.md'))
    assert.doesNotMatch(doc, /\b(best|number one|#1|№\s?1|лучш\w+|№1)\b/i)
    assert.doesNotMatch(doc, /\/opt\/|\/root\/|\/var\/tmp\/|\/home\/[a-z]/i)
  }
  assert.match(read('SECURITY.md'), /Security Advisories/)
  assert.match(read('CHANGELOG.md'), /## \[0\.1\.3\]/)
  assert.match(read('CHANGELOG.md'), /## \[0\.1\.2\]/)
  assert.match(read('CHANGELOG.md'), /## \[0\.1\.1\]/)
  assert.match(read('CHANGELOG.md'), /## \[0\.1\.0\]/)
  assert.equal(JSON.parse(read('package-lock.json')).version, pkg.version)
  assert.ok(existsSync(new URL('../.github/workflows/ci.yml', import.meta.url)))
  const ci = read('.github/workflows/ci.yml')
  assert.match(ci, /ubuntu-24\.04/)
  assert.match(ci, /node: \[22, 24\]/)
  assert.doesNotMatch(ci, /secrets\./)
})
