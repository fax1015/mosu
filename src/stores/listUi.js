import { writable } from 'svelte/store';

export const defaultListUi = {
  isLoading: false,
  progressVisible: false,
  progressPct: 0,
  progressLabel: 'Processing files...',
  isEmpty: true,
  showClearAll: false,
};

export const listUi = writable(defaultListUi);
