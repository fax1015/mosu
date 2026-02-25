import { writable } from 'svelte/store';

export const defaultGroupView = {
  expandedKeys: [],
};

export const groupView = writable(defaultGroupView);
