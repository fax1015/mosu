import { get } from 'svelte/store';
import { defaultViewModel, viewModel } from '../stores/viewModel';
import { connectBridge, withBridge } from './bridgeUtils';

const normalizeGroup = (group) => {
  if (!group || typeof group !== 'object') return null;
  return {
    key: String(group.key || ''),
    representativeId: String(group.representativeId || ''),
    itemIds: Array.isArray(group.itemIds) ? group.itemIds.map((id) => String(id)) : [],
    count: Number(group.count || 0),
  };
};

// Cheap deep-equal for the parts of viewModel that change frequently.
// Avoids triggering Svelte reactivity when the bridge sends an identical snapshot.
const snapshotChanged = (prev, next) => {
  if (!prev) return true;
  if (prev.viewMode !== next.viewMode) return true;
  if (prev.grouped !== next.grouped) return true;

  // length change is an obvious difference
  if ((prev.itemIds?.length ?? 0) !== (next.itemIds?.length ?? 0)) return true;
  if ((prev.groups?.length ?? 0) !== (next.groups?.length ?? 0)) return true;

  // if length is same, check if order changed by checking first and last elements
  if (next.itemIds?.length > 0) {
    if (prev.itemIds[0] !== next.itemIds[0]) return true;
    if (prev.itemIds[prev.itemIds.length - 1] !== next.itemIds[next.itemIds.length - 1]) return true;
  }

  if (next.groups?.length > 0) {
    if (prev.groups[0].key !== next.groups[0].key) return true;
    if (prev.groups[prev.groups.length - 1].key !== next.groups[next.groups.length - 1].key) return true;
  }

  // expandedKeys change
  if ((prev.expandedKeys?.length ?? 0) !== (next.expandedKeys?.length ?? 0)) return true;

  return false;
};

const applySnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return;

  const next = {
    viewMode: snapshot.viewMode || defaultViewModel.viewMode,
    grouped: !!snapshot.grouped,
    itemIds: Array.isArray(snapshot.itemIds)
      ? snapshot.itemIds.map((id) => String(id))
      : defaultViewModel.itemIds,
    groups: Array.isArray(snapshot.groups)
      ? snapshot.groups.map((group) => normalizeGroup(group)).filter(Boolean)
      : defaultViewModel.groups,
    expandedKeys: Array.isArray(snapshot.expandedKeys)
      ? snapshot.expandedKeys.map((key) => String(key))
      : defaultViewModel.expandedKeys,
  };

  // Only write to the store when something actually changed
  if (snapshotChanged(get(viewModel), next)) {
    viewModel.set(next);
  }
};

export const connectViewModel = () =>
  connectBridge({
    bridgeName: 'mosuViewModel',
    applySnapshot,
  });

export const getViewModelSnapshot = () =>
  withBridge('mosuViewModel', (bridge) => bridge.getState?.());
