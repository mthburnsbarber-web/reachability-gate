const store = new Map();

export const notes = {
  open(id) {
    return store.get(id) ?? { id, text: "" };
  },
  search(query) {
    return [...store.values()].filter((note) => note.text.includes(query));
  },
};
