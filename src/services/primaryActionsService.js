import { withBridge } from './bridgeUtils';

export const importOsuFile = () =>
  withBridge('mosuActions', (bridge) => bridge.importOsuFile?.());
export const importByMapper = () =>
  withBridge('mosuActions', (bridge) => bridge.importByMapper?.());
export const importFromFolder = () =>
  withBridge('mosuActions', (bridge) => bridge.importFromFolder?.());
export const refreshLastDirectory = () =>
  withBridge('mosuActions', (bridge) => bridge.refreshLastDirectory?.());
export const clearAllBeatmaps = () =>
  withBridge('mosuActions', (bridge) => bridge.clearAll?.());
