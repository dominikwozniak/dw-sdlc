export function addTax(cents, ratePercent) {
  return cents + (cents * ratePercent) / 100
}
