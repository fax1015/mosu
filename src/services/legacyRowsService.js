import { withBridge } from './bridgeUtils';

export const mountListBox = (container, itemId, index = 0, options = {}) =>
  withBridge('mosuLegacyRows', (bridge) =>
    bridge.mountListBox?.(container, itemId, index, options)
  );

export const clearListBox = (container) =>
  withBridge('mosuLegacyRows', (bridge) => bridge.clearListBox?.(container));
