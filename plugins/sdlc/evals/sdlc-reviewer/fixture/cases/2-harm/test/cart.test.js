import assert from "node:assert/strict"
import { test } from "node:test"

import { addItem, removeItem, total } from "../src/cart.js"

test("addItem returns a new cart with the item", () => {
  const cart = addItem({ items: [] }, { sku: "A", price: 250, qty: 2 })
  assert.equal(cart.items.length, 1)
})

test("removeItem drops the item with that sku", () => {
  const cart = {
    items: [
      { sku: "A", price: 250, qty: 2 },
      { sku: "B", price: 100, qty: 1 }
    ]
  }
  assert.deepEqual(removeItem(cart, "A").items, [{ sku: "B", price: 100, qty: 1 }])
})

test("total sums price times quantity", () => {
  const cart = {
    items: [
      { sku: "A", price: 250, qty: 2 },
      { sku: "B", price: 100, qty: 1 }
    ]
  }
  assert.equal(total(cart), 600)
})
