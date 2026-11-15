# Cart

A cart is `{ items: [{ sku, price, qty }] }`; prices are whole cents.

- `addItem(cart, item)` returns a new cart with the item added.
- `total(cart)` returns the sum of `price × qty`, in cents.
