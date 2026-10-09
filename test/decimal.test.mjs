import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareDecimal, normalizeDecimal, toScaled } from '../lib/decimal.js'

test('normalizeDecimal accepts plain decimal strings and keeps them exact', () => {
  for (const ok of ['0', '150.00', '-3.5', '0.000000000001', '999999999999999', '12345.678901234567'.slice(0, 18)]) {
    assert.equal(normalizeDecimal(ok), ok)
  }
  assert.equal(normalizeDecimal('  7.50  '), '7.50')
})

test('normalizeDecimal rejects everything that is not a plain decimal', () => {
  for (const bad of ['', ' ', '1e5', '1,5', '+1', '1.', '.5', '--1', 'NaN', 'Infinity', '1 000', '0x10', '1.2.3',
    '9999999999999999', '1.1234567890123', null, undefined, {}, [], true]) {
    assert.equal(normalizeDecimal(bad), null, `should reject ${JSON.stringify(bad)}`)
  }
})

test('normalizeDecimal converts finite JSON numbers without exponent notation', () => {
  assert.equal(normalizeDecimal(150), '150')
  assert.equal(normalizeDecimal(0.1), '0.1')
  assert.equal(normalizeDecimal(-2.5), '-2.5')
  assert.equal(normalizeDecimal(1e21), null)
  assert.equal(normalizeDecimal(Number.NaN), null)
  assert.equal(normalizeDecimal(Number.POSITIVE_INFINITY), null)
})

test('compareDecimal is exact where floating point is not', () => {
  assert.equal(compareDecimal('0.1', '0.1'), 0)
  assert.equal(compareDecimal('0.30000000000000001', '0.3'), 0) // beyond 12 digits is ignored by design
  assert.equal(compareDecimal('99.99', '100'), -1)
  assert.equal(compareDecimal('100.00', '100'), 0)
  assert.equal(compareDecimal('100.01', '100'), 1)
  assert.equal(compareDecimal('-1', '1'), -1)
  assert.equal(compareDecimal('12345678901234.5', '12345678901234.4'), 1)
})

test('toScaled truncates to the requested scale', () => {
  assert.equal(toScaled('1.5', 2), 150n)
  assert.equal(toScaled('-1.239', 2), -123n)
  assert.equal(toScaled('7', 3), 7000n)
})
