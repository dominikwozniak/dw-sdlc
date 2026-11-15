import assert from "node:assert/strict"
import { test } from "node:test"

import { addTax } from "../src/tax.js"

test("addTax adds the tax to the amount", () => {
  assert.equal(addTax(1000, 20), 1200)
})
