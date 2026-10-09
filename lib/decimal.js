/**
 * Exact decimal helpers for money strings such as "150.00".
 *
 * The API reports amounts as decimal strings. They are never converted to
 * floating point: validation is a regular expression, comparison and rounding
 * use BigInt, so "0.1" + "0.2" style drift cannot happen.
 */

const DECIMAL = /^-?\d{1,15}(?:\.\d{1,12})?$/

/**
 * Validate an amount and return it as a canonical decimal string.
 * Accepts decimal strings and (defensively) finite JSON numbers.
 * @param {unknown} value - raw value from an API response.
 * @returns {string | null} the validated string, or null when it is not a plain decimal.
 */
export function normalizeDecimal(value) {
  let text = value
  if (typeof text === 'number') {
    if (!Number.isFinite(text) || Math.abs(text) >= 1e15) return null
    text = Number.isInteger(text) ? String(text) : text.toFixed(8).replace(/\.?0+$/, '')
  }
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  return DECIMAL.test(trimmed) ? trimmed : null
}

/**
 * Scale a validated decimal string to an integer with `scale` fractional digits.
 * @param {string} text - a string accepted by {@link normalizeDecimal}.
 * @param {number} [scale] - number of fractional digits to keep.
 * @returns {bigint} the scaled integer (truncated, never rounded).
 */
export function toScaled(text, scale = 12) {
  const negative = text.startsWith('-')
  const body = negative ? text.slice(1) : text
  const [whole, fraction = ''] = body.split('.')
  const digits = BigInt(whole + fraction.padEnd(scale, '0').slice(0, scale))
  return negative ? -digits : digits
}

/**
 * Compare two validated decimal strings.
 * @param {string} a - left amount.
 * @param {string} b - right amount.
 * @returns {-1 | 0 | 1} the ordering of a relative to b.
 */
export function compareDecimal(a, b) {
  const left = toScaled(a)
  const right = toScaled(b)
  if (left === right) return 0
  return left < right ? -1 : 1
}
