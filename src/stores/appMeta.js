import { writable } from 'svelte/store';

export const appVersion = writable('0.0.0');

export const versionIndicatorState = writable({
  visible: false,
  text: '',
  tooltip: 'Checking for updates...',
  className: 'version-indicator',
  updateUrl: null,
});