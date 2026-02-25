import { writable } from 'svelte/store';

export const defaultFilterControls = {
  viewMode: 'all',
  sortState: { mode: 'dateAdded', direction: 'desc' },
  searchQuery: '',
  srFilter: { min: 0, max: 10 },
};

export const filterControls = writable(defaultFilterControls);