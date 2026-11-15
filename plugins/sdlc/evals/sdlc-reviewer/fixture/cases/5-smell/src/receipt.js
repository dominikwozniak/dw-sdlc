export function receiptLine(item) {
  const cents = item.price * item.qty
  const dollars = Math.floor(cents / 100)
  const rest = String(cents % 100).padStart(2, "0")
  return `${item.sku} x${item.qty}  $${dollars}.${rest}`
}

export function receiptSubtotal(cents) {
  const dollars = Math.floor(cents / 100)
  const rest = String(cents % 100).padStart(2, "0")
  return `Subtotal  $${dollars}.${rest}`
}

export function receiptTotal(cents) {
  const dollars = Math.floor(cents / 100)
  const rest = String(cents % 100).padStart(2, "0")
  return `Total  $${dollars}.${rest}`
}
