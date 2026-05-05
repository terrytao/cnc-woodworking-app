// Convert a decimal-inch value to the nearest 1/32" fraction string.
// Whole-and-fraction values use a hyphen separator (e.g. "1-1/2\"") so the
// dimension never breaks across a soft wrap in narrow table cells. Values
// that round to less than 1/64" are returned as "~0" since woodworkers
// can't reliably mark anything finer than that.

const TICKS_PER_INCH = 32

export function toFraction(decimal) {
  if (decimal == null || decimal === '') return ''
  const n = typeof decimal === 'number' ? decimal : parseFloat(decimal)
  if (!Number.isFinite(n)) return ''

  const sign = n < 0 ? '-' : ''
  const abs  = Math.abs(n)
  const ticks = Math.round(abs * TICKS_PER_INCH)

  if (ticks === 0) return abs > 0 ? '~0' : '0"'

  const whole = Math.floor(ticks / TICKS_PER_INCH)
  let num = ticks % TICKS_PER_INCH
  let den = TICKS_PER_INCH
  while (num !== 0 && num % 2 === 0) { num /= 2; den /= 2 }

  if (num === 0)    return `${sign}${whole}"`
  if (whole === 0)  return `${sign}${num}/${den}"`
  return `${sign}${whole}-${num}/${den}"`
}
