import { get } from 'svelte/store';
import { defaultSettingsControls, settingsControls } from '../stores/settingsControls';
import { connectBridge, withBridge } from './bridgeUtils';

const applySnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return;
  settingsControls.set({
    ...defaultSettingsControls,
    ...snapshot,
    linkedAliases: Array.isArray(snapshot.linkedAliases) ? snapshot.linkedAliases : [],
  });
};

const action = (fn, optimistic = null) => {
  const result = withBridge('mosuSettings', fn);
  if (result && typeof result === 'object') {
    applySnapshot(result);
  } else if (typeof optimistic === 'function') {
    settingsControls.update((state) => optimistic(state));
  }
  return get(settingsControls);
};

export const connectSettingsControls = () =>
  connectBridge({
    bridgeName: 'mosuSettings',
    applySnapshot,
  });

export const selectSongsDir = () => action((bridge) => bridge.selectSongsDir?.());
export const setSettingToggle = (id, checked) => action((bridge) => bridge.setSettingToggle?.(id, checked));
export const setEmbedToggle = (id, checked) => action((bridge) => bridge.setEmbedToggle?.(id, checked));
export const setRescanMode = (mode) => action((bridge) => bridge.setRescanMode?.(mode));
export const setGroupMapsBySong = (checked) => action((bridge) => bridge.setGroupMapsBySong?.(checked));
export const setVolume = (value) => action((bridge) => bridge.setVolume?.(value));
export const toggleLinkedAlias = (name) => action((bridge) => bridge.toggleLinkedAlias?.(name));
export const setRescanMapperName = (value) => action((bridge) => bridge.setRescanMapperName?.(value), (state) => ({
  ...state,
  rescanMapperName: String(value || ''),
}));

export const copyUserId = () =>
  withBridge('mosuSettings', (bridge) => bridge.copyUserId?.());
export const copyApiKey = () =>
  withBridge('mosuSettings', (bridge) => bridge.copyApiKey?.());
export const copyEmbedUrl = () =>
  withBridge('mosuSettings', (bridge) => bridge.copyEmbedUrl?.());
export const regenerateApiKey = () => action((bridge) => bridge.regenerateApiKey?.());
export const triggerManualSync = () => action((bridge) => bridge.triggerManualSync?.());
