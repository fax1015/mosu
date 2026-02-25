import { writable } from 'svelte/store';

export const defaultSettingsControls = {
  autoRescan: false,
  rescanMode: 'mapper',
  rescanMapperName: '',
  songsDir: '',
  songsDirLabel: 'Not selected',
  ignoreStartAndBreaks: false,
  ignoreGuestDifficulties: false,
  volume: 0.5,
  volumePercent: '50%',
  groupMapsBySong: true,
  userId: '',
  userIdLabel: 'Not generated',
  embedApiKey: '',
  apiKeyLabel: 'Not generated',
  embedUrlLabel: 'Generate user ID first',
  embedLastSyncedLabel: 'Not synced yet',
  embedSyncStatus: 'idle',
  embedSyncButtonLabel: 'Sync Now',
  embedSyncButtonTooltip: 'Sync embed now',
  embedSyncButtonDisabled: false,
  embedShowTodoList: true,
  embedShowCompletedList: true,
  embedShowProgressStats: true,
  linkedAliases: [],
  hasLinkedAliases: false,
};

export const settingsControls = writable(defaultSettingsControls);
