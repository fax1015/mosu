import { writable } from 'svelte/store';

export const defaultRefreshUi = {
  isRefreshing: false,
  isAnalyzing: false,
  progressPct: 0,
  tooltip: 'Refresh last directory',
  isPulsing: false,
};

export const refreshUi = writable(defaultRefreshUi);
