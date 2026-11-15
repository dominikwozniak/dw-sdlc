export function addTax(cents, ratePercent) {
  return Math.round(cents + (cents * ratePercent) / 100)
}
