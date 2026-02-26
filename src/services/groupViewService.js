import { defaultGroupView, groupView } from '../stores/groupView';
import { connectBridge, withBridge } from './bridgeUtils';

const applySnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return;
  groupView.set({
    expandedKeys: Array.isArray(snapshot.expandedKeys)
      ? snapshot.expandedKeys.map((key) => String(key))
      : defaultGroupView.expandedKeys,
  });
};

export const connectGroupView = () =>
  connectBridge({
    bridgeName: 'mosuGroupView',
    applySnapshot,
  });

export const toggleExpanded = (key) => {
  const snapshot = withBridge('mosuGroupView', (bridge) =>
    bridge.toggleExpanded?.(key)
  );
  if (snapshot) applySnapshot(snapshot);
  return snapshot;
};

export const setExpanded = (key, expanded) => {
  const snapshot = withBridge('mosuGroupView', (bridge) =>
    bridge.setExpanded?.(key, expanded)
  );
  if (snapshot) applySnapshot(snapshot);
  return snapshot;
};

export const replaceExpanded = (keys) => {
  const snapshot = withBridge('mosuGroupView', (bridge) =>
    bridge.replaceExpanded?.(keys)
  );
  if (snapshot) applySnapshot(snapshot);
  return snapshot;
};
