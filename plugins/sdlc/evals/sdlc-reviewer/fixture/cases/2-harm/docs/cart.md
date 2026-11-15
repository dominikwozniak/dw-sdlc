# Cart

A cart is `{ items: [{ sku, price, qty }] }`; prices are whole cents.

- `addItem(cart, item)` returns a new cart with the item added.
- `removeItem(cart, sku)` returns a new cart without the item with that `sku`.
- `total(cart)` returns the sum of `price × qty`, in cents.
