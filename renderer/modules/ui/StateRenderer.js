/**
 * StateRenderer.js - State-based rendering system
 * Extracted from renderer.js (lines 2338-2381, 2426-2511, 2640-2758)
 */

import * as Store from '../state/Store.js';
import { isGuestDifficultyItem, getEffectiveMapperName as getMapperName } from '../parsers/GuestDifficultyFilter.js';
import { getStarRatingColor, formatDuration, normalizeMetadata } from '../utils/Helpers.js';
import { applyTimelineToBox } from '../services/TimelineRenderer.js';
import { buildListItem, applyCalculatedStarTagState } from './ListItemBuilder.js';
import { renderVirtualList, setItemsToRender } from './VirtualList.js';
import { renderGroupedView, groupItemsBySong } from './GroupViewBuilder.js';

// ============================================
// State Variables (references to external state)
// ============================================

let _beatmapItems = [];
let _todoIds = [];
let _doneIds = [];
let _viewMode = 'all';
let _sortState = { mode: 'dateAdded', direction: 'desc' };
let _searchQuery = '';
let _srFilter = { min: 0, max: 10 };
let _settings = {};
let _cachedMapperNeedles = [];

// ============================================
// Loading State
// ============================================

/**
 * Set loading state
 * @param {boolean} isLoading - Whether loading is active
 */
export const setLoading = (isLoading) => {
    const spinner = document.querySelector('#loadingSpinner');
    if (!spinner) {
        return;
    }
    spinner.classList.toggle('is-hidden', !isLoading);

    const progressSection = document.querySelector('#loadingProgress');
    if (!isLoading && progressSection) {
        progressSection.classList.add('is-hidden');
    }
};

/**
 * Update progress bar
 * @param {number} current - Current progress
 * @param {number} total - Total items
 */
export const updateProgress = (current, total) => {
    const progressSection = document.querySelector('#loadingProgress');
    const fill = document.querySelector('#progressBarFill');
    const label = document.querySelector('#progressLabel');
    if (!progressSection || !fill || !label) {
        return;
    }
    progressSection.classList.remove('is-hidden');
    const pct = total > 0 ? (current / total) * 100 : 0;
    fill.style.width = `${pct}%`;
    label.textContent = `Processing ${current} / ${total} files...`;
};

// ============================================
// Empty State
// ============================================

/**
 * Update empty state visibility
 * @param {HTMLElement} listContainer - List container element
 * @param {Array<Object>} items - Items to check (optional, uses itemsToRender if not provided)
 */
export const updateEmptyState = (listContainer, items) => {
    const emptyState = document.querySelector('#emptyState');
    const clearAllButton = document.querySelector('#clearAllBtn');
    if (!emptyState || !listContainer) {
        return;
    }

    // Use provided items or current items from VirtualList
    const itemsToCheck = items || [];
    const hasItems = itemsToCheck.length > 0;

    // Toggle is-active for transition, but avoid display: none so transitions work
    emptyState.classList.toggle('is-active', !hasItems);

    if (clearAllButton) {
        // Show clear button if there are any items in the current view
        clearAllButton.classList.toggle('is-hidden', !hasItems);
    }
};

// ============================================
// Tab Counts
// ============================================

/**
 * Update tab counter badges
 * @param {Array<string>} todoIds - Array of todo item IDs
 * @param {Array<string>} doneIds - Array of done item IDs
 * @param {number} total - Total item count
 * @param {Array<Object>} beatmapItems - All beatmap items
 * @param {Function} isGuestDifficultyItemFn - Function to check if item is a guest difficulty
 */
export const updateTabCounts = (todoIds, doneIds, total, beatmapItems, isGuestDifficultyItemFn) => {
    // Use parameters if provided, otherwise get from Store
    const effectiveTodoIds = todoIds ?? Store.todoIds;
    const effectiveDoneIds = doneIds ?? Store.doneIds;
    const effectiveBeatmapItems = beatmapItems ?? Store.beatmapItems;
    const effectiveIsGuestDifficultyItemFn = isGuestDifficultyItemFn ?? isGuestDifficultyItem;

    const allCountEl = document.querySelector('#allCount');
    const todoCountEl = document.querySelector('#todoCount');
    const completedCountEl = document.querySelector('#completedCount');

    const visibleItems = effectiveBeatmapItems.filter(item => !effectiveIsGuestDifficultyItemFn(item));
    const visibleAllCount = visibleItems.length;
    const visibleTodoCount = effectiveTodoIds.reduce((count, id) => {
        const item = effectiveBeatmapItems.find(i => i.id === id);
        if (!item) return count;
        if (effectiveIsGuestDifficultyItemFn(item)) return count;
        return count + 1;
    }, 0);
    const visibleDoneCount = effectiveDoneIds.reduce((count, id) => {
        const item = effectiveBeatmapItems.find(i => i.id === id);
        if (!item) return count;
        if (effectiveIsGuestDifficultyItemFn(item)) return count;
        return count + 1;
    }, 0);

    if (allCountEl) allCountEl.textContent = visibleAllCount;
    if (todoCountEl) todoCountEl.textContent = visibleTodoCount;
    if (completedCountEl) completedCountEl.textContent = visibleDoneCount;
};

// ============================================
// List Item Updates
// ============================================

/**
 * Update a single list item element in place
 * @param {string} itemId - Item ID
 * @param {Object} item - Item data (optional, will be looked up if not provided)
 * @param {Object} callbacks - Callback functions
 * @param {Array<string>} callbacks.todoIds - Array of todo item IDs
 * @param {Array<string>} callbacks.doneIds - Array of done item IDs
 * @param {string} callbacks.viewMode - Current view mode
 * @param {Array<Object>} callbacks.beatmapItems - All beatmap items
 */
export const updateListItemElement = (itemId, item, callbacks = {}) => {
    const listContainer = document.querySelector('#listContainer');
    if (!listContainer) return;

    // Use specific element selectors to avoid full re-scans of the DOM
    const el = listContainer.querySelector(`[data-item-id="${itemId}"]`);
    if (!el) return;

    // Use callbacks if provided, otherwise fallback to Store
    const todoIds = callbacks.todoIds ?? Store.todoIds;
    const doneIds = callbacks.doneIds ?? Store.doneIds;
    const viewMode = callbacks.viewMode ?? Store.viewMode;
    const beatmapItems = callbacks.beatmapItems ?? Store.beatmapItems;

    const isPinned = todoIds.includes(itemId);
    const isDone = doneIds.includes(itemId);

    // 1. Update list-box state classes
    el.classList.toggle('is-pinned', isPinned && viewMode === 'all');
    el.classList.toggle('is-done', isDone);

    // 2. Update Pin Button state
    const pinBtn = el.querySelector('.pin-btn');
    if (pinBtn) {
        pinBtn.classList.toggle('is-active', isPinned);
        if (viewMode === 'todo') {
            pinBtn.dataset.tooltip = 'Remove from Todo';
        } else {
            pinBtn.dataset.tooltip = isPinned ? 'Unpin from Todo' : 'Pin to Todo';
        }
    }

    // 3. Update Done Button (if exists in this view)
    const doneBtn = el.querySelector('.done-btn');
    if (doneBtn) {
        doneBtn.classList.toggle('is-active', isDone);
        const label = doneBtn.querySelector('span');
        if (label) {
            label.textContent = isDone ? 'Mark as Not Done' : 'Mark as Done';
        }
    }

    // 4. Update Stats (look up latest state from model if possible)
    const itemData = item || beatmapItems.find(i => i.id === itemId);
    if (itemData) {
        el.dataset.progress = String(itemData.progress || 0);
    }

    // Update calculated SR tag
    const calculatedSrTag = el.querySelector('.meta-tag--calculated-sr');
    if (calculatedSrTag) {
        applyCalculatedStarTagState(calculatedSrTag, itemData?.starRating);
    }

    // Update target SR tag
    if (itemData && (itemData.targetStarRating !== undefined)) {
        if (el._updateStarTag) {
            el._updateStarTag(itemData.targetStarRating);
        }
    }

    // Update progress stat
    const progressStat = el.querySelector('.progress-stat');
    if (progressStat) {
        const baseProgress = itemData ? (itemData.progress || 0) : (Number(el.dataset.progress) || 0);
        const displayProgress = isDone ? 1 : baseProgress;
        progressStat.innerHTML = `<strong>Progress:</strong> ${Math.round(displayProgress * 100)}%`;
    }

    // Update duration stat if we have duration data
    const durationStat = el.querySelector('.duration-stat');
    if (durationStat && itemData?.durationMs) {
        durationStat.innerHTML = `<strong>Duration:</strong> ${formatDuration(itemData.durationMs)}`;
    }

    // Update deadline text
    const deadlineInput = el.querySelector('.date-picker-input');
    if (deadlineInput && window.GlobalDatePicker) {
        if (itemData?.deadline) {
            deadlineInput.value = window.GlobalDatePicker.formatDDMMYYYY(new Date(itemData.deadline));
            deadlineInput.classList.add('has-value');
        } else {
            deadlineInput.value = '';
            deadlineInput.classList.remove('has-value');
        }
    }

    // 5. Update Timeline Canvas
    applyTimelineToBox(el, itemData);
};

// ============================================
// Sorting and Filtering
// ============================================

/**
 * Sort items based on mode and direction
 * @param {Array<Object>} items - Items to sort
 * @param {string} mode - Sort mode
 * @param {string} direction - Sort direction ('asc' | 'desc')
 * @param {Object} settings - Settings object
 * @returns {Array<Object>} Sorted items
 */
export const sortItemsArray = (items, mode, direction, settings = {}) => {
    const sorted = [...items];
    const multiplier = direction === 'asc' ? 1 : -1;
    const compareText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, {
        sensitivity: 'base',
        numeric: true
    });
    const toMode = (item) => {
        const value = Number(item?.mode);
        return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 0), 3) : 0;
    };
    switch (mode) {
        case 'dateModified':
            sorted.sort((a, b) => ((a.dateModified || 0) - (b.dateModified || 0)) * multiplier);
            break;
        case 'name':
            sorted.sort((a, b) => {
                const nameA = `${a.artist} - ${a.title}`.toLowerCase();
                const nameB = `${b.artist} - ${b.title}`.toLowerCase();
                return nameA.localeCompare(nameB) * multiplier;
            });
            break;
        case 'progress':
            sorted.sort((a, b) => ((a.progress || 0) - (b.progress || 0)) * multiplier);
            break;
        case 'starRating':
            sorted.sort((a, b) => ((a.starRating || 0) - (b.starRating || 0)) * multiplier);
            break;
        case 'difficulty':
            sorted.sort((a, b) => {
                const difficultyA = a.difficultyName || a.version;
                const difficultyB = b.difficultyName || b.version;
                const difficultyDiff = compareText(difficultyA, difficultyB) * multiplier;
                if (difficultyDiff !== 0) {
                    return difficultyDiff;
                }
                const titleDiff = compareText(`${a.artist} - ${a.title}`, `${b.artist} - ${b.title}`) * multiplier;
                if (titleDiff !== 0) {
                    return titleDiff;
                }
                return compareText(a.creator, b.creator) * multiplier;
            });
            break;
        case 'mode':
            sorted.sort((a, b) => {
                const modeDiff = (toMode(a) - toMode(b)) * multiplier;
                if (modeDiff !== 0) {
                    return modeDiff;
                }
                const nameA = `${a.artist} - ${a.title}`.toLowerCase();
                const nameB = `${b.artist} - ${b.title}`.toLowerCase();
                return nameA.localeCompare(nameB);
            });
            break;
        case 'dateAdded':
        default:
            sorted.sort((a, b) => ((a.dateAdded || 0) - (b.dateAdded || 0)) * multiplier);
            break;
    }
    return sorted;
};

/**
 * Filter items by search query and star rating
 * @param {Array<Object>} items - Items to filter
 * @param {string} query - Search query
 * @param {Object} srFilter - Star rating filter { min, max }
 * @param {'all'|'standard'|'taiko'|'catch'|'mania'} modeFilter - Mode filter
 * @returns {Array<Object>} Filtered items
 */
export const filterItemsArray = (items, query, srFilter, modeFilter = 'all') => {
    let filtered = items;
    const normalizedModeFilter = (
        modeFilter === 'standard' ||
        modeFilter === 'taiko' ||
        modeFilter === 'catch' ||
        modeFilter === 'mania'
    ) ? modeFilter : 'all';

    const matchesModeFilter = (item) => {
        if (normalizedModeFilter === 'all') {
            return true;
        }
        const mode = Number(item?.mode);
        const normalizedMode = Number.isFinite(mode) ? Math.min(Math.max(Math.floor(mode), 0), 3) : 0;
        if (normalizedModeFilter === 'standard') return normalizedMode === 0;
        if (normalizedModeFilter === 'taiko') return normalizedMode === 1;
        if (normalizedModeFilter === 'catch') return normalizedMode === 2;
        return normalizedMode === 3;
    };

    // Apply text search filter if query exists
    if (query) {
        const needle = query.toLowerCase();
        filtered = filtered.filter((item) => {
            return [
                item.title,
                item.titleUnicode,
                item.artist,
                item.artistUnicode,
                item.creator,
                item.version,
                item.beatmapSetID,
            ]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(needle));
        });
    }

    // Always apply star rating filter
    const isDefaultRange = srFilter.min === 0 && srFilter.max >= 10;
    if (!isDefaultRange) {
        filtered = filtered.filter(item => {
            const sr = item.starRating || 0;
            if (srFilter.max >= 10) {
                return sr >= srFilter.min;
            }
            return sr >= srFilter.min && sr <= srFilter.max;
        });
    }

    if (normalizedModeFilter !== 'all') {
        filtered = filtered.filter((item) => matchesModeFilter(item));
    }

    return filtered;
};

/**
 * Get filtered and sorted items based on current state
 * @param {Object} callbacks - Callback functions and state
 * @param {Array<Object>} callbacks.beatmapItems - All beatmap items
 * @param {string} callbacks.viewMode - Current view mode
 * @param {Array<string>} callbacks.todoIds - Todo item IDs
 * @param {Array<string>} callbacks.doneIds - Done item IDs
 * @param {string} callbacks.searchQuery - Search query
 * @param {Object} callbacks.sortState - Sort state { mode, direction }
 * @param {Object} callbacks.srFilter - Star rating filter { min, max }
 * @param {'all'|'standard'|'taiko'|'catch'|'mania'} callbacks.modeFilter - Mode filter
 * @param {Object} callbacks.settings - Settings object
 * @param {Function} callbacks.isGuestDifficultyItem - Function to check guest difficulties
 * @returns {Array<Object>} Filtered and sorted items
 */
export const getFilteredAndSortedItems = (callbacks) => {
    const visibleItems = callbacks.beatmapItems.filter(item => !callbacks.isGuestDifficultyItem(item));
    const filtered = filterItemsArray(
        visibleItems,
        callbacks.searchQuery,
        callbacks.srFilter,
        callbacks.modeFilter
    );
    return sortItemsArray(filtered, callbacks.sortState.mode, callbacks.sortState.direction, callbacks.settings);
};

// ============================================
// Main Render Dispatcher
// ============================================

/**
 * Main render dispatcher - renders based on current state
 * @param {Object} callbacks - Callback functions and state
 * @param {Array<Object>} callbacks.beatmapItems - All beatmap items
 * @param {string} callbacks.viewMode - Current view mode
 * @param {Array<string>} callbacks.todoIds - Todo item IDs
 * @param {Array<string>} callbacks.doneIds - Done item IDs
 * @param {string} callbacks.searchQuery - Search query
 * @param {Object} callbacks.sortState - Sort state { mode, direction }
 * @param {Object} callbacks.srFilter - Star rating filter { min, max }
 * @param {'all'|'standard'|'taiko'|'catch'|'mania'} callbacks.modeFilter - Mode filter
 * @param {Object} callbacks.settings - Settings object
 * @param {Function} callbacks.isGuestDifficultyItem - Function to check guest difficulties
 * @param {Function} callbacks.getEffectiveMapperName - Function to get effective mapper name
 * @param {Function} callbacks.scheduleSave - Function to schedule save
 */
export const renderFromState = (callbacks = {}) => {
    const listContainer = document.querySelector('#listContainer');
    if (!listContainer) {
        return;
    }

    // Use callbacks if provided, otherwise get from Store
    const effectiveCallbacks = Object.keys(callbacks).length > 0 ? callbacks : {
        viewMode: Store.viewMode,
        beatmapItems: Store.beatmapItems,
        todoIds: Store.todoIds,
        doneIds: Store.doneIds,
        searchQuery: Store.searchQuery,
        srFilter: Store.srFilter,
        modeFilter: Store.modeFilter,
        sortState: Store.sortState,
        settings: Store.settings,
        isGuestDifficultyItem,
        getEffectiveMapperName: getMapperName,
        scheduleSave: () => { }
    };

    // Cache mapper names once per render pass for guest difficulty filtering
    const mapperName = effectiveCallbacks.getEffectiveMapperName ? effectiveCallbacks.getEffectiveMapperName() : '';
    _cachedMapperNeedles = (mapperName || '').split(',').map(m => m.trim().toLowerCase()).filter(Boolean);

    let itemsToRender = [];
    if (effectiveCallbacks.viewMode === 'todo') {
        // Build a lookup map for O(1) access in todo/completed modes.
        const itemMap = new Map();
        for (const item of effectiveCallbacks.beatmapItems) {
            itemMap.set(item.id, item);
        }

        // In TODO mode, we only show items in todoIds (in that specific order) and exclude hidden guest difficulties
        for (const id of effectiveCallbacks.todoIds) {
            const item = itemMap.get(id);
            if (item && !effectiveCallbacks.isGuestDifficultyItem(item, _cachedMapperNeedles)) {
                const filtered = filterItemsArray([item], '', { min: 0, max: 10 }, effectiveCallbacks.modeFilter);
                if (!filtered.length) {
                    continue;
                }
                itemsToRender.push(item);
            }
        }
    } else if (effectiveCallbacks.viewMode === 'completed') {
        // Build a lookup map for O(1) access in todo/completed modes.
        const itemMap = new Map();
        for (const item of effectiveCallbacks.beatmapItems) {
            itemMap.set(item.id, item);
        }

        // In Completed mode, show items that have been marked done in the order of doneIds, excluding hidden
        for (const id of effectiveCallbacks.doneIds) {
            const item = itemMap.get(id);
            if (item && !effectiveCallbacks.isGuestDifficultyItem(item, _cachedMapperNeedles)) {
                const filtered = filterItemsArray([item], '', { min: 0, max: 10 }, effectiveCallbacks.modeFilter);
                if (!filtered.length) {
                    continue;
                }
                itemsToRender.push(item);
            }
        }
    } else {
        const visibleItems = effectiveCallbacks.beatmapItems.filter(item => !effectiveCallbacks.isGuestDifficultyItem(item, _cachedMapperNeedles));
        const filtered = filterItemsArray(
            visibleItems,
            effectiveCallbacks.searchQuery,
            effectiveCallbacks.srFilter,
            effectiveCallbacks.modeFilter
        );
        itemsToRender = sortItemsArray(filtered, effectiveCallbacks.sortState.mode, effectiveCallbacks.sortState.direction, effectiveCallbacks.settings);
    }

    listContainer.className = '';
    listContainer.classList.add(`view-${effectiveCallbacks.viewMode}`);

    // Use grouped view only on 'all' tab when the setting is enabled
    if (effectiveCallbacks.settings.groupMapsBySong && effectiveCallbacks.viewMode === 'all') {
        listContainer.classList.add('view-grouped');
        const groups = groupItemsBySong(itemsToRender);
        renderGroupedView(listContainer, groups, {
            ...effectiveCallbacks,
            updateEmptyState: (container) => updateEmptyState(container, itemsToRender),
            buildListItem
        });
    } else {
        // Store items for VirtualList
        setItemsToRender(itemsToRender);
        renderVirtualList(listContainer, itemsToRender, {
            ...effectiveCallbacks,
            updateEmptyState: (container) => updateEmptyState(container, itemsToRender)
        });
    }

    // Update the items in module state
    _beatmapItems = effectiveCallbacks.beatmapItems;
    _todoIds = effectiveCallbacks.todoIds;
    _doneIds = effectiveCallbacks.doneIds;
    _viewMode = effectiveCallbacks.viewMode;
    _sortState = effectiveCallbacks.sortState;
    _searchQuery = effectiveCallbacks.searchQuery;
    _srFilter = effectiveCallbacks.srFilter;
    _settings = effectiveCallbacks.settings;
};

// ============================================
// Getters/Setters for Module State
// ============================================

/**
 * Get cached mapper needles
 * @returns {Array<string>} Cached mapper needles
 */
export const getCachedMapperNeedles = () => {
    return _cachedMapperNeedles;
};

/**
 * Set cached mapper needles
 * @param {Array<string>} needles - Mapper needles
 */
export const setCachedMapperNeedles = (needles) => {
    _cachedMapperNeedles = needles;
};
