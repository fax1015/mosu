import { writable } from 'svelte/store';

export const defaultViewModel = {
  viewMode: 'all',
  grouped: false,
  itemIds: [],
  groups: [],
  expandedKeys: [],
};

export const viewModel = writable(defaultViewModel);
