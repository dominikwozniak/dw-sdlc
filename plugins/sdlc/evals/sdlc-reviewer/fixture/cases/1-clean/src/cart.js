export function addItem(cart, item) {
  return { ...cart, items: [...cart.items, item] }
}

export function total(cart) {
  return cart.items.reduce((sum, item) => sum + item.price * item.qty, 0)
}

export function itemCount(cart) {
  return cart.items.reduce((sum, item) => sum + item.qty, 0)
}
