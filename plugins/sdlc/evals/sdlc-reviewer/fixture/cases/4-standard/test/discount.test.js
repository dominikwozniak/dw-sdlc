import assert from "node:assert/strict"
import { test } from "node:test"

import { applyDiscount } from "../src/discount.js"

test("applyDiscount takes the percent off", () => {
  assert.equal(applyDiscount(1000, 25), 750)
})

test("applyDiscount rounds to whole cents", () => {
  assert.equal(applyDiscount(999, 10), 899)
})

test("applyDiscount rejects a percent outside 0 to 100", () => {
  assert.throws(() => applyDiscount(1000, 101), RangeError)
  assert.throws(() => applyDiscount(1000, -1), RangeError)
})
