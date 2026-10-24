import { store } from "../store.js";

export function AddToCart({ item }) {
  return (
    <button type="button" onClick={() => store.dispatch({ type: "cart/add", item })}>
      Add to cart
    </button>
  );
}
