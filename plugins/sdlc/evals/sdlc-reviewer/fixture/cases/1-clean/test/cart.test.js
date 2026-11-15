import assert from "node:assert/strict"
import { test } from "node:test"

import { addItem, itemCount, total } from "../src/cart.js"

test("addItem returns a new cart with the item", () => {
  const cart = addItem({ items: [] }, { sku: "A", price: 250, qty: 2 })
  assert.equal(cart.items.length, 1)
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

test("itemCount sums the quantities", () => {
  const cart = {
    items: [
      { sku: "A", price: 250, qty: 2 },
      { sku: "B", price: 100, qty: 1 }
    ]
  }
  assert.equal(itemCount(cart), 3)
})
