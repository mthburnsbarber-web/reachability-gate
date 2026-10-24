const list = document.querySelector("#list");

async function render() {
  const items = await window.notes.list();
  list.replaceChildren(...items.map((note) => Object.assign(document.createElement("li"), { textContent: note.title })));
}

document.querySelector("#minimize").addEventListener("click", () => window.notes.minimize());
window.notes.onPrivacyChanged((blurred) => document.body.classList.toggle("blurred", blurred));
render();
