import { withBridge } from './bridgeUtils';

export const toggleTodo = (itemId) =>
  withBridge('mosuItemActions', (bridge) => bridge.toggleTodo?.(itemId));
export const toggleDone = (itemId) =>
  withBridge('mosuItemActions', (bridge) => bridge.toggleDone?.(itemId));
export const openWeb = (url) =>
  withBridge('mosuItemActions', (bridge) => bridge.openWeb?.(url));
export const showFolder = (path) =>
  withBridge('mosuItemActions', (bridge) => bridge.showFolder?.(path));
