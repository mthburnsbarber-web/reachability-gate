import { store } from "../store.js";

export function Checkout() {
  const pay = () => store.dispatch({ type: "cart/checkout" });
  return <button onClick={pay}>Pay now</button>;
}
