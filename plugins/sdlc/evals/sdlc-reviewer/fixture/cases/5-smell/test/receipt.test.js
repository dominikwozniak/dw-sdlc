import assert from "node:assert/strict"
import { test } from "node:test"

import { receiptLine, receiptSubtotal, receiptTotal } from "../src/receipt.js"

test("receiptLine prints sku, quantity and price", () => {
  assert.equal(receiptLine({ sku: "A", price: 250, qty: 2 }), "A x2  $5.00")
})

test("receiptSubtotal prints the subtotal", () => {
  assert.equal(receiptSubtotal(1205), "Subtotal  $12.05")
})

test("receiptTotal prints the total", () => {
  assert.equal(receiptTotal(1205), "Total  $12.05")
})
