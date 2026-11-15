import assert from "node:assert/strict"
import { test } from "node:test"

import { shippingCost } from "../src/shipping.js"

test("a large order ships free", () => {
  assert.equal(shippingCost(6000), 0)
})

test("a small order pays the flat rate", () => {
  assert.equal(shippingCost(4000), 499)
})
