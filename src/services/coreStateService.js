import { get } from 'svelte/store';
import {
  _beatmapData,
  _viewState,
  defaultBeatmapData,
  defaultViewState,
} from '../stores/coreState';
import { connectBridge } from './bridgeUtils';

// Last known values for _beatmapData fields (used as reference guards)
let _lastItemsRef = null;
let _lastTodoRef = null;
let _lastDoneRef = null;

const applySnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return;

  // ── Beatmap data (stable – only update when renderer says something changed) ──
  // The renderer sets _itemsChanged to false on filter/sort events, sending
  // the cached (same-reference) snapshot to avoid O(n) cloning here too.
  const rawItems = Array.isArray(snapshot.beatmapItems) ? snapshot.beatmapItems : _lastItemsRef ?? [];
  const rawTodo = Array.isArray(snapshot.todoIds) ? snapshot.todoIds : _lastTodoRef ?? [];
  const rawDone = Array.isArray(snapshot.doneIds) ? snapshot.doneIds : _lastDoneRef ?? [];

  const itemsChanged = snapshot._itemsChanged !== false && (
    rawItems !== _lastItemsRef ||
    rawTodo !== _lastTodoRef ||
    rawDone !== _lastDoneRef
  );

  if (itemsChanged) {
    _lastItemsRef = rawItems;
    _lastTodoRef = rawTodo;
    _lastDoneRef = rawDone;
    _beatmapData.set({ beatmapItems: rawItems, todoIds: rawTodo, doneIds: rawDone });
  }

  // ── View state (volatile – update only when a field actually changed) ──────
  const nextView = {
    viewMode: snapshot.viewMode || defaultViewState.viewMode,
    sortState: {
      mode: snapshot.sortState?.mode || defaultViewState.sortState.mode,
      direction: snapshot.sortState?.direction || defaultViewState.sortState.direction,
    },
    searchQuery: snapshot.searchQuery || '',
    srFilter: {
      min: Number(snapshot.srFilter?.min ?? defaultViewState.srFilter.min),
      max: Number(snapshot.srFilter?.max ?? defaultViewState.srFilter.max),
    },
    settings: {
      ...defaultViewState.settings,
      ...(snapshot.settings || {}),
    },
    effectiveMapperName: snapshot.effectiveMapperName || '',
    itemsToRenderIds: Array.isArray(snapshot.itemsToRenderIds) ? snapshot.itemsToRenderIds : [],
  };

  const cur = get(_viewState);
  if (
    cur.viewMode !== nextView.viewMode ||
    cur.searchQuery !== nextView.searchQuery ||
    cur.srFilter.min !== nextView.srFilter.min ||
    cur.srFilter.max !== nextView.srFilter.max ||
    cur.sortState.mode !== nextView.sortState.mode ||
    cur.sortState.direction !== nextView.sortState.direction ||
    cur.settings.groupMapsBySong !== nextView.settings.groupMapsBySong ||
    cur.settings.ignoreGuestDifficulties !== nextView.settings.ignoreGuestDifficulties ||
    cur.effectiveMapperName !== nextView.effectiveMapperName
  ) {
    _viewState.set(nextView);
  }
};

export const connectCoreState = () =>
  connectBridge({
    bridgeName: 'mosuCoreState',
    applySnapshot,
  });
