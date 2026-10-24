let items = [];
let blurred = false;

module.exports = {
  list: () => items,
  save: (note) => {
    items = [...items.filter((n) => n.id !== note.id), note];
    return note;
  },
  purgeAll: () => {
    items = [];
  },
  resetSettings: () => ({ ok: true }),
  togglePrivacy: () => (blurred = !blurred),
};
