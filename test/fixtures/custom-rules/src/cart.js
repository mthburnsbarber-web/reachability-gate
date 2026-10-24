const HOUR = 60 * 60 * 1000;

export const add = (state, item) => ({ ...state, items: [...state.items, { ...item, addedAt: Date.now() }] });
export const checkout = (state) => ({ ...state, items: [], lastOrder: state.items });
export const expireStale = (state, now) => ({ ...state, items: state.items.filter((i) => now - i.addedAt < 24 * HOUR) });
