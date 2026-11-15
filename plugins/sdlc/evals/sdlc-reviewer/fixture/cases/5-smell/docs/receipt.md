# Receipt

Each function takes whole cents and returns one printable line, with the price as `$d.cc`.

- `receiptLine(item)` returns `<sku> x<qty>  <price>` for `price × qty`.
- `receiptSubtotal(cents)` returns `Subtotal  <price>`.
- `receiptTotal(cents)` returns `Total  <price>`.
