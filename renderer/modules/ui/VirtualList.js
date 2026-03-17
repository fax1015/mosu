/**
 * VirtualList.js - Virtual scrolling list implementation
 * Extracted from renderer.js (lines 698-701, 1935-2000)
 */

import { buildListItem } from './ListItemBuilder.js';
import { updateEmptyState } from './StateRenderer.js';
import { scheduleTimelineBatchRender, cancelTimelineBatchRender } from '../services/TimelineRenderer.js';
import * as Store from '../state/Store.js';

// ============================================
// Constants
// ============================================

/** @type {number} Virtual item height including gap */
export const VIRTUAL_ITEM_HEIGHT = 182; // 170px + 12px gap

/**
 * Get the scrollable main container element
 * @returns {HTMLElement|null}
 */
const getScrollContainer = () => document.querySelector('.main-container');

/** @type {number} Maximum items to render per frame during initial render */
const MAX_ITEMS_PER_FRAME = 3;

/** @type {number} Maximum items to render per frame during scroll */
const MAX_ITEMS_PER_FRAME_SCROLL = 5;

// ============================================
// State
// ============================================

/** @type {Array<Object>} Items to render in virtual list */
let itemsToRender = [];

/** @type {number} Cached container top position */
let cachedContainerTop = 0;

/** @type {number|null} RAF id for virtual list sync */
let virtualListRaf = null;

/** @type {number|null} RAF id for chunked render */
let chunkedRenderRaf = null;

/** @type {boolean} Whether a chunked render is in progress */
let isChunkedRenderInProgress = false;


/** @type {Array<{el: HTMLElement, index: number}>} Batch render queue for timelines */
const batchRenderTimelines = [];

/** @type {Object|null} Cached callbacks for scroll sync */
let cachedCallbacks = null;

// ============================================
// Chunked Rendering
// ============================================

/**
 * Chunked virtual list renderer - adds items in small batches across frames
 * to maintain responsiveness during tab switches and large renders.
 * @param {HTMLElement} container - List container
 * @param {Array<number>} indicesToRender - Indices of items to render
 * @param {Set<string>} currentIdsInDom - Set of IDs already in DOM
 * @param {Object} callbacks - Callback functions
 * @param {number} maxPerFrame - Maximum items to render per frame
 * @param {Object} options - Options
 */
const renderVirtualListChunked = (container, indicesToRender, currentIdsInDom, callbacks, maxPerFrame, options = {}) => {
    // Cancel any in-progress chunked render
    if (chunkedRenderRaf) {
        cancelAnimationFrame(chunkedRenderRaf);
        chunkedRenderRaf = null;
    }

    isChunkedRenderInProgress = true;
    let currentIndex = 0;

    const renderChunk = () => {
        if (!container.isConnected) {
            isChunkedRenderInProgress = false;
            return;
        }

        const fragment = document.createDocumentFragment();
        const endIndex = Math.min(currentIndex + maxPerFrame, indicesToRender.length);
        let addedCount = 0;

        for (let i = currentIndex; i < endIndex; i++) {
            const itemIndex = indicesToRender[i];
            const item = itemsToRender[itemIndex];

            if (!item || currentIdsInDom.has(item.id)) continue;

            const el = buildListItem(item, itemIndex, callbacks);
            el.dataset.renderIndex = itemIndex;
            el.style.top = `${itemIndex * VIRTUAL_ITEM_HEIGHT}px`;
            
            // Add pop-in animation only for initial render (not scroll)
            if (options.isInitialRender) {
                const sc = getScrollContainer();
                const firstVisibleItem = Math.floor(((sc ? sc.scrollTop : 0) - cachedContainerTop) / VIRTUAL_ITEM_HEIGHT);
                const visibleIndex = itemIndex - firstVisibleItem;
                if (visibleIndex >= 0 && visibleIndex < 15) {
                    el.style.setProperty('--stagger-delay', `${visibleIndex * 40}ms`);
                    el.classList.add('pop-in');
                }
            }
            
            fragment.appendChild(el);
            batchRenderTimelines.push({ el, index: itemIndex });
            addedCount++
        }

        if (addedCount > 0) {
            container.appendChild(fragment);
        }

        currentIndex = endIndex;

        if (currentIndex < indicesToRender.length) {
            // More items to render - schedule next chunk
            chunkedRenderRaf = requestAnimationFrame(renderChunk);
        } else {
            // All items rendered
            isChunkedRenderInProgress = false;
            chunkedRenderRaf = null;
            scheduleTimelineBatchRender();
            if (callbacks.updateEmptyState) {
                callbacks.updateEmptyState(container);
            }
        }
    };

    // Start chunked rendering
    chunkedRenderRaf = requestAnimationFrame(renderChunk);
};

/**
 * Synchronize the virtual list - renders visible items and removes off-screen items
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.updateEmptyState - Function to update empty state
 * @param {Array<string>} callbacks.todoIds - Array of todo item IDs
 * @param {Array<string>} callbacks.doneIds - Array of done item IDs
 * @param {Function} callbacks.scheduleSave - Function to schedule a save
 * @param {Array<Object>} callbacks.beatmapItems - All beatmap items
 * @param {string} callbacks.viewMode - Current view mode
 * @param {Object} [options] - Options
 * @param {boolean} [options.chunked=false] - Whether to use chunked rendering
 */
export const syncVirtualList = (callbacks, options = {}) => {
    const container = document.querySelector('#listContainer');
    if (!container) return;

    // Don't run the virtual list logic in grouped mode — groups use flow layout
    if (container.classList.contains('view-grouped')) return;

    // Use cached callbacks if not provided
    const effectiveCallbacks = callbacks || cachedCallbacks;
    if (!effectiveCallbacks) return;

    const scrollContainer = getScrollContainer();
    const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
    const containerHeight = scrollContainer ? scrollContainer.clientHeight : window.innerHeight;
    const containerTop = cachedContainerTop;

    // Calculate which items are in view
    // The visible area is the intersection of the viewport and the container's items
    const viewportTop = scrollTop;
    const viewportBottom = scrollTop + containerHeight;

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

    // Collect indices of items that need to be rendered
    const indicesToRender = [];
    for (let i = startIndex; i < endIndex; i++) {
        const item = itemsToRender[i];
        if (item && !currentIdsInDom.has(item.id)) {
            indicesToRender.push(i);
        }
    }

    // Determine render strategy based on number of items
    const isLargeRender = indicesToRender.length > MAX_ITEMS_PER_FRAME;
    const useChunked = options.chunked !== false && isLargeRender;

    if (useChunked) {
        // Use chunked rendering for large initial paints (reduces INP)
        renderVirtualListChunked(
            container,
            indicesToRender,
            currentIdsInDom,
            effectiveCallbacks,
            MAX_ITEMS_PER_FRAME,
            options
        );
    } else {
        // Use synchronous rendering for small updates (scrolling)
        const fragment = document.createDocumentFragment();
        for (const i of indicesToRender) {
            const item = itemsToRender[i];
            const el = buildListItem(item, i, effectiveCallbacks);
            el.dataset.renderIndex = i;
            el.style.top = `${i * VIRTUAL_ITEM_HEIGHT}px`;
            
            // Add pop-in animation only for initial render (not scroll)
            if (options.isInitialRender) {
                const sc = getScrollContainer();
                const firstVisibleItem = Math.floor(((sc ? sc.scrollTop : 0) - cachedContainerTop) / VIRTUAL_ITEM_HEIGHT);
                const visibleIndex = i - firstVisibleItem;
                if (visibleIndex >= 0 && visibleIndex < 15) {
                    el.style.setProperty('--stagger-delay', `${visibleIndex * 40}ms`);
                    el.classList.add('pop-in');
                }
            }
            
            fragment.appendChild(el);
            batchRenderTimelines.push({ el, index: i });
        }
        container.appendChild(fragment);
        scheduleTimelineBatchRender();

        if (effectiveCallbacks.updateEmptyState) {
            effectiveCallbacks.updateEmptyState(container);
        }
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
    Store.updateState('groupedRenderPassToken', Store.groupedRenderPassToken + 1);
    cancelTimelineBatchRender();
    cancelChunkedRender();
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
    const scrollContainer = getScrollContainer();
    const rect = listContainer.getBoundingClientRect();
    const scrollContainerRect = scrollContainer ? scrollContainer.getBoundingClientRect() : { top: 0 };
    cachedContainerTop = rect.top - scrollContainerRect.top;

    // Use chunked rendering for initial render to improve INP
    // Skip pop-in animation when filters are active (search/SR)
    syncVirtualList(callbacks, { chunked: true, isInitialRender: !callbacks.isFiltering });
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

    const scrollContainer = getScrollContainer();
    if (!scrollContainer) return;

    const scrollY = cachedContainerTop + (index * VIRTUAL_ITEM_HEIGHT);
    scrollContainer.scrollTo({ top: scrollY, behavior });
};

/**
 * Get the currently visible item range
 * @returns {{startIndex: number, endIndex: number}} Visible range
 */
export const getVisibleRange = () => {
    const container = document.querySelector('#listContainer');
    if (!container) return { startIndex: 0, endIndex: 0 };

    const scrollContainer = getScrollContainer();
    const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
    const containerHeight = scrollContainer ? scrollContainer.clientHeight : window.innerHeight;
    const containerTop = cachedContainerTop;

    const viewportTop = scrollTop;
    const viewportBottom = scrollTop + containerHeight;

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
 * Cancel any in-progress chunked rendering
 */
export const cancelChunkedRender = () => {
    if (chunkedRenderRaf) {
        cancelAnimationFrame(chunkedRenderRaf);
        chunkedRenderRaf = null;
    }
    isChunkedRenderInProgress = false;
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
