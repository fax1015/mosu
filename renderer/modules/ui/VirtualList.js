/**
 * VirtualList.js - Virtual scrolling list implementation
 * Extracted from renderer.js (lines 698-701, 1935-2000)
 */

import { buildListItem } from './ListItemBuilder.js';
import { updateEmptyState } from './StateRenderer.js';
import { scheduleTimelineBatchRender, cancelTimelineBatchRender } from '../services/TimelineRenderer.js';

// ============================================
// Constants
// ============================================

/** @type {number} Virtual item height including gap */
export const VIRTUAL_ITEM_HEIGHT = 182; // 170px + 12px gap

// ============================================
// State
// ============================================

/** @type {Array<Object>} Items to render in virtual list */
let itemsToRender = [];

/** @type {number} Cached container top position */
let cachedContainerTop = 0;

/** @type {number|null} RAF id for virtual list sync */
let virtualListRaf = null;

/** @type {number} Token for grouped render pass */
let groupedRenderPassToken = 0;

/** @type {Array<{el: HTMLElement, index: number}>} Batch render queue for timelines */
const batchRenderTimelines = [];

/** @type {Object|null} Cached callbacks for scroll sync */
let cachedCallbacks = null;

// ============================================
// Virtual List Functions
// ============================================

/**
 * Synchronize the virtual list - renders visible items and removes off-screen items
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.updateEmptyState - Function to update empty state
 * @param {Array<string>} callbacks.todoIds - Array of todo item IDs
 * @param {Array<string>} callbacks.doneIds - Array of done item IDs
 * @param {Function} callbacks.scheduleSave - Function to schedule a save
 * @param {Array<Object>} callbacks.beatmapItems - All beatmap items
 * @param {string} callbacks.viewMode - Current view mode
 */
export const syncVirtualList = (callbacks) => {
    const container = document.querySelector('#listContainer');
    if (!container) return;

    // Don't run the virtual list logic in grouped mode — groups use flow layout
    if (container.classList.contains('view-grouped')) return;

    // Use cached callbacks if not provided
    const effectiveCallbacks = callbacks || cachedCallbacks;
    if (!effectiveCallbacks) return;

    const scrollTop = window.scrollY;
    const windowHeight = window.innerHeight;
    const containerTop = cachedContainerTop;

    // Calculate which items are in view
    // The visible area is the intersection of the viewport and the container's items
    const viewportTop = scrollTop;
    const viewportBottom = scrollTop + windowHeight;

    // Item positions are relative to containerTop
    // Item i spans from containerTop + (i * VIRTUAL_ITEM_HEIGHT) to containerTop + ((i+1) * VIRTUAL_ITEM_HEIGHT)
    // An item is visible if its span intersects with the viewport

    // Calculate which item indices are visible
    const firstVisibleItem = Math.floor((viewportTop - containerTop) / VIRTUAL_ITEM_HEIGHT);
    const lastVisibleItem = Math.ceil((viewportBottom - containerTop) / VIRTUAL_ITEM_HEIGHT);

    // Add buffer for smoother scrolling
    const startIndex = Math.max(0, firstVisibleItem - 5);
    const endIndex = Math.min(itemsToRender.length, lastVisibleItem + 5);


    const targetIdToIndex = new Map();
    for (let i = startIndex; i < endIndex; i++) {
        targetIdToIndex.set(itemsToRender[i].id, i);
    }

    const currentElements = Array.from(container.children);
    const currentIdsInDom = new Set();

    // Reconcile existing elements
    currentElements.forEach(el => {
        const id = el.dataset.itemId;
        const targetIdx = id ? targetIdToIndex.get(id) : undefined;

        if (el.classList.contains('list-box') && targetIdx !== undefined) {
            // Item is still in visible range. Update position if its index changed.
            if (Number(el.dataset.renderIndex) !== targetIdx) {
                el.dataset.renderIndex = targetIdx;
                el.style.top = `${targetIdx * VIRTUAL_ITEM_HEIGHT}px`;
            }
            currentIdsInDom.add(id);
        } else {
            // Item is either removed from filter, scrolled out, or is a leftover from another mode (e.g. .group-row)
            el.remove();
        }
    });

    // Add elements that just came into view but aren't in DOM yet
    const fragment = document.createDocumentFragment();
    for (let i = startIndex; i < endIndex; i++) {
        const item = itemsToRender[i];
        if (!currentIdsInDom.has(item.id)) {
            const el = buildListItem(item, i, effectiveCallbacks);
            el.dataset.renderIndex = i;
            el.style.top = `${i * VIRTUAL_ITEM_HEIGHT}px`;
            fragment.appendChild(el);

            // Render timeline after adding to DOM fragment
            batchRenderTimelines.push({ el, index: i });
        }
    }
    container.appendChild(fragment);

    // Process timeline rendering in small RAF batches
    scheduleTimelineBatchRender();

    if (effectiveCallbacks.updateEmptyState) {
        effectiveCallbacks.updateEmptyState(container);
    }
};

/**
 * Render the virtual beatmap list
 * @param {HTMLElement} listContainer - List container element
 * @param {Array<Object>} items - Items to render
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.updateEmptyState - Function to update empty state
 * @param {Array<string>} callbacks.todoIds - Array of todo item IDs
 * @param {Array<string>} callbacks.doneIds - Array of done item IDs
 * @param {Function} callbacks.scheduleSave - Function to schedule a save
 * @param {Array<Object>} callbacks.beatmapItems - All beatmap items
 * @param {string} callbacks.viewMode - Current view mode
 */
export const renderVirtualList = (listContainer, items, callbacks) => {
    // Cancel any in-flight incremental grouped render when switching modes.
    groupedRenderPassToken += 1;
    cancelTimelineBatchRender();
    itemsToRender = items;

    // Cache callbacks for use by syncVirtualList during scroll events
    cachedCallbacks = callbacks;

    const totalHeight = calculateTotalHeight(items.length);
    listContainer.style.height = `${totalHeight}px`;

    // Force reflow to ensure height is applied before measuring
    void listContainer.offsetHeight;

    // Clear innerHTML only if list is empty, otherwise let syncVirtualList reconcile.
    // This prevents the "flash" of an empty list during slider dragging.
    if (items.length === 0) {
        listContainer.innerHTML = '';
        if (callbacks.updateEmptyState) callbacks.updateEmptyState(listContainer);
        return;
    }

    // Check if we're switching from grouped mode - need to clear group elements
    // The view-grouped class disables virtual list logic, so ensure it's removed
    const hasGroupedElements = listContainer.querySelector('.group-row') !== null;
    if (hasGroupedElements || listContainer.classList.contains('view-grouped')) {
        listContainer.innerHTML = '';
        listContainer.classList.remove('view-grouped');
    }

    // Measure containerTop now while layout is stable.
    const rect = listContainer.getBoundingClientRect();
    cachedContainerTop = rect.top + window.scrollY;

    syncVirtualList(callbacks);
};

/**
 * Update visible items in a range
 * @param {number} startIndex - Start index
 * @param {number} endIndex - End index
 * @param {Object} callbacks - Callback functions
 */
export const updateVisibleItems = (startIndex, endIndex, callbacks) => {
    const container = document.querySelector('#listContainer');
    if (!container) return;

    // Filter out items that are already in DOM
    const currentElements = Array.from(container.querySelectorAll('.list-box'));
    const currentIds = new Set(currentElements.map(el => el.dataset.itemId));

    const fragment = document.createDocumentFragment();
    for (let i = startIndex; i < endIndex; i++) {
        const item = itemsToRender[i];
        if (item && !currentIds.has(item.id)) {
            const el = buildListItem(item, i, callbacks);
            el.dataset.renderIndex = i;
            el.style.top = `${i * VIRTUAL_ITEM_HEIGHT}px`;
            fragment.appendChild(el);
            batchRenderTimelines.push({ el, index: i });
        }
    }
    container.appendChild(fragment);
    scheduleTimelineBatchRender();
};

/**
 * Scroll to a specific item by index
 * @param {number} index - Item index
 * @param {ScrollBehavior} behavior - Scroll behavior ('auto' | 'smooth')
 */
export const scrollToItem = (index, behavior = 'smooth') => {
    const container = document.querySelector('#listContainer');
    if (!container) return;

    const scrollY = cachedContainerTop + (index * VIRTUAL_ITEM_HEIGHT);
    window.scrollTo({ top: scrollY, behavior });
};

/**
 * Get the currently visible item range
 * @returns {{startIndex: number, endIndex: number}} Visible range
 */
export const getVisibleRange = () => {
    const container = document.querySelector('#listContainer');
    if (!container) return { startIndex: 0, endIndex: 0 };

    const scrollTop = window.scrollY;
    const windowHeight = window.innerHeight;
    const containerTop = cachedContainerTop;

    const viewportTop = scrollTop;
    const viewportBottom = scrollTop + windowHeight;

    const firstVisibleItem = Math.floor((viewportTop - containerTop) / VIRTUAL_ITEM_HEIGHT);
    const lastVisibleItem = Math.ceil((viewportBottom - containerTop) / VIRTUAL_ITEM_HEIGHT);

    const startIndex = Math.max(0, firstVisibleItem);
    const endIndex = Math.min(itemsToRender.length, lastVisibleItem);

    return { startIndex, endIndex };
};

/**
 * Invalidate the cached container position
 */
export const invalidateCache = () => {
    cachedContainerTop = 0;
};

/**
 * Get items to render
 * @returns {Array<Object>} Items to render
 */
export const getItemsToRender = () => {
    return itemsToRender;
};

/**
 * Set items to render
 * @param {Array<Object>} items - Items to render
 */
export const setItemsToRender = (items) => {
    itemsToRender = items;
};

/**
 * Get cached container top
 * @returns {number} Cached container top
 */
export const getCachedContainerTop = () => {
    return cachedContainerTop;
};

/**
 * Set cached container top
 * @param {number} top - Container top position
 */
export const setCachedContainerTop = (top) => {
    cachedContainerTop = top;
};

/**
 * Schedule a virtual list sync
 * @param {Object} callbacks - Callback functions
 */
export const scheduleSync = (callbacks) => {
    if (virtualListRaf) {
        cancelAnimationFrame(virtualListRaf);
    }
    virtualListRaf = requestAnimationFrame(() => {
        syncVirtualList(callbacks);
        virtualListRaf = null;
    });
};

/**
 * Cancel pending virtual list sync
 */
export const cancelSync = () => {
    if (virtualListRaf) {
        cancelAnimationFrame(virtualListRaf);
        virtualListRaf = null;
    }
};

/**
 * Get virtual item height
 * @returns {number} Virtual item height
 */
export const getVirtualItemHeight = () => {
    return VIRTUAL_ITEM_HEIGHT;
};

/**
 * Calculate total height for items
 * @param {number} count - Number of items
 * @returns {number} Total height in pixels
 */
export const calculateTotalHeight = (count) => {
    return count > 0 ? (count * VIRTUAL_ITEM_HEIGHT - 12) : 0;
};
