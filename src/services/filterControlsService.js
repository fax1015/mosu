import { get } from 'svelte/store';
import { defaultFilterControls, filterControls } from '../stores/filterControls';
import { _viewState } from '../stores/coreState';
import { connectBridge, withBridge } from './bridgeUtils';

const applySnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return;

  const state = {
    viewMode: snapshot.viewMode || defaultFilterControls.viewMode,
    sortState: {
      mode: snapshot.sortState?.mode || defaultFilterControls.sortState.mode,
      direction: snapshot.sortState?.direction || defaultFilterControls.sortState.direction,
    },
    searchQuery: snapshot.searchQuery || '',
    srFilter: {
      min: Number(snapshot.srFilter?.min ?? defaultFilterControls.srFilter.min),
      max: Number(snapshot.srFilter?.max ?? defaultFilterControls.srFilter.max),
    },
  };

  filterControls.set(state);

  // Instantly propagate filter changes to the underlying Svelte view state,
  // bypassing the renderer's `renderFromState` 80ms debounce. The Svelte
  // UI lists will filter instantly using `$coreItemsForView`.
  _viewState.update((s) => ({
    ...s,
    sortState: state.sortState,
    searchQuery: state.searchQuery,
    srFilter: state.srFilter,
  }));
};

export const connectFilterControls = () =>
  connectBridge({
    bridgeName: 'mosuFilters',
    applySnapshot,
  });

export const setViewMode = (mode) => {
  const result = withBridge('mosuFilters', (bridge) => bridge.setViewMode?.(mode));
  if (result && typeof result === 'object') {
    applySnapshot(result);
  } else {
    filterControls.update((state) => ({ ...state, viewMode: mode || state.viewMode }));
  }
  return get(filterControls);
};
export const setSortMode = (mode) => {
  const result = withBridge('mosuFilters', (bridge) => bridge.setSortMode?.(mode));
  if (result && typeof result === 'object') {
    applySnapshot(result);
  }
  return get(filterControls);
};
export const setSearchQuery = (query) => {
  const result = withBridge('mosuFilters', (bridge) => bridge.setSearchQuery?.(query));
  if (result && typeof result === 'object') {
    applySnapshot(result);
  } else {
    filterControls.update((state) => ({ ...state, searchQuery: String(query || '') }));
    _viewState.update(s => ({ ...s, searchQuery: String(query || '') }));
  }
  return get(filterControls);
};

/**
 * Set star range from Svelte UI - updates store and calls legacy code for filtering,
 * but does NOT trigger legacy DOM manipulation (Svelte controls the slider inputs)
 */
export const setStarRange = (min, max, activeHandle = null) => {
  // Update the store first (Svelte's source of truth)
  filterControls.update((state) => ({
    ...state,
    srFilter: { min: Number(min), max: Number(max) },
  }));

  // Optimistic instantaneous update for list filtering
  _viewState.update(s => ({
    ...s,
    srFilter: { min: Number(min), max: Number(max) },
  }));

  // Call legacy code for filtering, but skip DOM updates
  const result = withBridge('mosuFilters', (bridge) =>
    bridge.setStarRange?.(min, max, activeHandle)
  );

  // If bridge returns a snapshot, apply it
  if (result && typeof result === 'object') {
    applySnapshot(result);
  }

  return get(filterControls);
};

