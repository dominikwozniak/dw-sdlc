const FREE_SHIPPING_FROM = 7500
const FLAT_RATE = 499

export function shippingCost(cents) {
  return cents >= FREE_SHIPPING_FROM ? 0 : FLAT_RATE
}
