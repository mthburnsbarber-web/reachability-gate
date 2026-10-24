let active = false;

export const privateMode = {
  get active() {
    return active;
  },
  enter() {
    active = true; // hide every window and stop sync
  },
  exit() {
    active = false;
  },
};
