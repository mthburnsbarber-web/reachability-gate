import { actions } from "./store.js";
import * as cart from "./cart.js";

actions.register("cart/add", (state, { item }) => cart.add(state, item));
actions.register("cart/checkout", (state) => cart.checkout(state));
actions.register("cart/expireStale", (state) => cart.expireStale(state, Date.now()));
