import { store } from "./store.js";

const HOUR = 60 * 60 * 1000;

setInterval(() => store.dispatch({ type: "cart/expireStale" }), HOUR);
