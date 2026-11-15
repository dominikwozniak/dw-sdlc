import assert from "node:assert/strict"
import { test } from "node:test"

import { shippingCost } from "../src/shipping.js"

test("a large order ships free", () => {
  assert.equal(shippingCost(8000), 0)
})

test("an order from 7500 cents ships free", () => {
  assert.equal(shippingCost(7500), 0)
})

test("a small order pays the flat rate", () => {
  assert.equal(shippingCost(4000), 499)
})

test("an order just under 7500 cents pays the flat rate", () => {
  assert.equal(shippingCost(7499), 499)
})
