const search = document.querySelector("#search");

search.addEventListener("input", () => {
  window.bus.dispatch({ kind: "notes.search", query: search.value });
});
