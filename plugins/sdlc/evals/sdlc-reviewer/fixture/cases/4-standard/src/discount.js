export function applyDiscount(cents, percent) {
  const valid = percent >= 0 && percent <= 100
  if (!valid) {
    throw new RangeError(`percent must be from 0 to 100, got ${percent}`)
  }
  return Math.round((cents * (100 - percent)) / 100)
}
