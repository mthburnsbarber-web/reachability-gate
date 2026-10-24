const reducers = new Map();
let state = { items: [] };

export const actions = {
  register(type, reducer) {
    reducers.set(type, reducer);
  },
};

export const store = {
  dispatch(action) {
    state = reducers.get(action.type)?.(state, action) ?? state;
  },
  get state() {
    return state;
  },
};
