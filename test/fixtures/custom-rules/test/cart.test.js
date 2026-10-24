import { test } from "node:test";
import assert from "node:assert/strict";
import { store } from "../src/store.js";
import "../src/actions.js";

test("checkout empties the cart", () => {
  store.dispatch({ type: "cart/add", item: { sku: "tee" } });
  store.dispatch({ type: "cart/checkout" });
  assert.equal(store.state.items.length, 0);
});
