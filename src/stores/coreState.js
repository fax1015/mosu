import { derived, writable } from 'svelte/store';
import { computeGroupedItemsForView, computeItemsForView, computeTabStats } from '../core/listQuery';

// ─────────────────────────────────────────────────────────────
// Split coreState into two stores so that filter/sort/view
// changes don't trigger an expensive beatmapMap rebuild.
//
//  beatmapData  – items, todoIds, doneIds  (stable; changes only
//                 when maps are added/removed)
//  viewState    – viewMode, sortState, srFilter, searchQuery,
//                 settings, effectiveMapperName  (volatile; changes
//                 on every filter / sort / tab action)
// ─────────────────────────────────────────────────────────────

export const defaultBeatmapData = {
  beatmapItems: [],
  todoIds: [],
  doneIds: [],
};

export const defaultViewState = {
  viewMode: 'all',
  sortState: { mode: 'dateAdded', direction: 'desc' },
  searchQuery: '',
  srFilter: { min: 0, max: 10 },
  settings: {
    ignoreGuestDifficulties: false,
    groupMapsBySong: false,
  },
  effectiveMapperName: '',
  itemsToRenderIds: [],
};

// Keep the legacy combined store for backwards compat with services that still use it
export const defaultCoreState = {
  ...defaultBeatmapData,
  ...defaultViewState,
};

// Internal split writable stores
export const _beatmapData = writable(defaultBeatmapData);
export const _viewState = writable(defaultViewState);

// ─── Public combined read-only store (for components that need a single reference) ───
// Derived from both; only recomputes when either changes.
export const coreState = derived(
  [_beatmapData, _viewState],
  ([$beatmapData, $viewState]) => ({ ...$beatmapData, ...$viewState }),
);

// ─── coreBeatmapMap: only rebuilds when beatmapItems changes ───
export const coreBeatmapMap = derived(_beatmapData, ($beatmapData) => {
  const items = $beatmapData.beatmapItems || [];
  return new Map(items.map((item) => [item.id, item]));
});

// ─── coreTabStats: only touches items/todoIds/doneIds ───
export const coreTabStats = derived(
  [_beatmapData, _viewState],
  ([$beatmapData, $viewState]) =>
    computeTabStats({ ...$beatmapData, ...$viewState }),
);

// ─── coreItemsForView: stable beatmapMap + volatile view params ───
export const coreItemsForView = derived(
  [_beatmapData, _viewState],
  ([$beatmapData, $viewState]) =>
    computeItemsForView({ ...$beatmapData, ...$viewState }),
);

// ─── coreGroupedItemsForView: only needed in grouped mode ───
export const coreGroupedItemsForView = derived(
  [_beatmapData, _viewState],
  ([$beatmapData, $viewState]) =>
    computeGroupedItemsForView({ ...$beatmapData, ...$viewState }),
);
