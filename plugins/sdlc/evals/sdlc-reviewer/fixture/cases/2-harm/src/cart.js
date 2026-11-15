export function addItem(cart, item) {
  return { ...cart, items: [...cart.items, item] }
}

export function removeItem(cart, sku) {
  const index = cart.items.findIndex((item) => item.sku === sku)
  return { ...cart, items: cart.items.toSpliced(index, 1) }
}

export function total(cart) {
  return cart.items.reduce((sum, item) => sum + item.price * item.qty, 0)
}
