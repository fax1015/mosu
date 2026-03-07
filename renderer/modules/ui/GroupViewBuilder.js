/**
 * GroupViewBuilder.js - Grouped-by-song view building module
 * Extracted from renderer.js (lines 2037-2336)
 */

import { normalizeMetadata } from '../utils/Helpers.js';
import { scheduleCoverLoad } from '../services/CoverLoader.js';
import { queueTimelineBatchRender } from '../services/TimelineRenderer.js';

// ============================================
// State
// ============================================

/** @type {Set<string>} Set tracking expanded group keys */
const groupedExpandedKeys = new Set();

/** @type {number} Token for grouped render pass */
let groupedRenderPassToken = 0;

/** @type {Array<{el: HTMLElement, index: number}>} Batch render queue for timelines */
const batchRenderTimelines = [];

// ============================================
// Group Key Generation
// ============================================

/**
 * Returns a stable key for a song group.
 * Group by song + mapper so same-title mapsets by different creators stay separated.
 * @param {Object} item - Beatmap item
 * @returns {string} Group key
 */
export const getGroupKey = (item) => {
    const artist = (item.artistUnicode || item.artist || '').toLowerCase();
    const title = (item.titleUnicode || item.title || '').toLowerCase();
    const creator = (item.creator || '').toLowerCase();
    return `${artist}||${title}||${creator}`;
};

// ============================================
// Grouping Functions
// ============================================

/**
 * Groups an array of beatmap items by song (artist + title).
 * Returns an ordered array of { key, items[] }.
 * @param {Array<Object>} items - Array of beatmap items
 * @returns {Array<{key: string, items: Array<Object>}>} Grouped items
 */
export const groupItemsBySong = (items) => {
    const map = new Map();
    const order = [];
    for (const item of items) {
        const key = getGroupKey(item);
        if (!map.has(key)) {
            map.set(key, []);
            order.push(key);
        }
        map.get(key).push(item);
    }
    return order.map(key => ({ key, items: map.get(key) }));
};

// ============================================
// Group View Building
// ============================================

/**
 * Builds an individual "child" row for an expanded group.
 * It reuses buildListItem but wraps it with a hierarchy indicator.
 * @param {Object} item - Beatmap item
 * @param {number} index - Item index
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.buildListItem - buildListItem function
 * @returns {HTMLElement} Group child row element
 */
export const buildGroupChildRow = (item, index, callbacks) => {
    const wrapper = document.createElement('div');
    wrapper.classList.add('group-child-row');

    const indicator = document.createElement('div');
    indicator.classList.add('group-child-indicator');

    // Use provided buildListItem from callbacks
    const inner = callbacks.buildListItem(item, index, callbacks);
    inner.classList.add('list-box--group-child');

    wrapper.appendChild(indicator);
    wrapper.appendChild(inner);

    return wrapper;
};

/**
 * Builds the collapsed group header row shown when groupMapsBySong is enabled.
 * Uses CSS Grid (grid-template-rows: 0fr → 1fr) for the expand animation —
 * no JS height measurements, no race conditions.
 * @param {Object} group - Group object with key and items
 * @param {number} groupIndex - Group index
 * @param {Object} callbacks - Callback functions
 * @returns {HTMLElement} Group header row element
 */
export const buildGroupHeaderRow = (group, groupIndex, callbacks) => {
    const { key, items } = group;
    const rep = items[0];
    const isExpanded = groupedExpandedKeys.has(key);
    const normalized = normalizeMetadata(rep);

    const groupEl = document.createElement('div');
    groupEl.classList.add('group-row');
    groupEl.dataset.groupKey = key;
    if (isExpanded) groupEl.classList.add('is-expanded');

    // ---- Header (always visible, clickable to toggle) ----
    const header = document.createElement('div');
    header.classList.add('group-row-header');

    // Cover image (left)
    const imgWrap = document.createElement('div');
    imgWrap.classList.add('group-row-cover');
    const img = document.createElement('img');
    img.alt = `${normalized.artistUnicode} - ${normalized.titleUnicode}`;
    img.loading = 'lazy';
    img.decoding = 'async';

    // Determine cover URL
    let coverUrl = normalized.coverUrl;
    if (!coverUrl && normalized.coverPath && window.beatmapApi?.convertFileSrc) {
        coverUrl = window.beatmapApi.convertFileSrc(normalized.coverPath);
    }

    if (coverUrl) {
        img.src = coverUrl;
        img.onerror = () => {
            img.onerror = null;
            img.src = './assets/placeholder.png';
            img.classList.add('list-img--placeholder');
        };
    } else {
        img.src = './assets/placeholder.png';
        img.classList.add('list-img--placeholder');
        if (normalized.coverPath) {
            scheduleCoverLoad(`group||${key}`, normalized.coverPath, {
                onSuccess: (loadedUrl) => {
                    img.src = loadedUrl;
                    img.classList.remove('list-img--placeholder');
                }
            });
        }
    }
    imgWrap.appendChild(img);
    const overlay = document.createElement('div');
    overlay.classList.add('group-row-cover-overlay');
    imgWrap.appendChild(overlay);

    // Center: song info
    const info = document.createElement('div');
    info.classList.add('group-row-info');

    const titleEl = document.createElement('h3');
    titleEl.classList.add('group-row-title');
    titleEl.textContent = `${normalized.artistUnicode} - ${normalized.titleUnicode}`;
    info.appendChild(titleEl);

    const countEl = document.createElement('span');
    countEl.classList.add('group-row-count');
    countEl.textContent = `${items.length} difficult${items.length === 1 ? 'y' : 'ies'}`;
    info.appendChild(countEl);

    const creatorTag = document.createElement('span');
    creatorTag.classList.add('meta-tag', 'group-row-creator-tag');
    creatorTag.textContent = normalized.creator;
    creatorTag.dataset.tooltip = 'Mapper';
    info.appendChild(creatorTag);

    // Right: version carousel
    const carousel = document.createElement('div');
    carousel.classList.add('group-row-carousel');
    const carouselViewport = document.createElement('div');
    carouselViewport.classList.add('group-row-carousel-viewport');
    const carouselScrollbar = document.createElement('div');
    carouselScrollbar.classList.add('group-row-carousel-scrollbar');
    const carouselThumb = document.createElement('div');
    carouselThumb.classList.add('group-row-carousel-scrollbar-thumb');
    carouselScrollbar.appendChild(carouselThumb);
    carousel.appendChild(carouselViewport);
    carousel.appendChild(carouselScrollbar);

    // Expand/collapse chevron
    const chevronWrap = document.createElement('div');
    chevronWrap.classList.add('group-row-chevron');
    const chevronSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevronSvg.setAttribute('viewBox', '0 0 448 512');
    const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    chevronPath.setAttribute('d', 'M201.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 338.7 54.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z');
    chevronSvg.appendChild(chevronPath);
    chevronWrap.appendChild(chevronSvg);

    // Wrap cover + info so text can overlay the image
    const coverSection = document.createElement('div');
    coverSection.classList.add('group-row-cover-section');
    coverSection.appendChild(imgWrap);
    coverSection.appendChild(info);

    header.appendChild(coverSection);
    header.appendChild(carousel);
    header.appendChild(chevronWrap);

    const syncCarouselScrollbar = () => {
        const scrollHeight = carouselViewport.scrollHeight;
        const clientHeight = carouselViewport.clientHeight;
        const maxScrollTop = scrollHeight - clientHeight;

        if (maxScrollTop <= 1) {
            carouselScrollbar.classList.add('is-hidden');
            carouselThumb.style.height = '0';
            carouselThumb.style.transform = 'translateY(0)';
            return;
        }

        carouselScrollbar.classList.remove('is-hidden');
        const trackHeight = carouselScrollbar.clientHeight;
        const thumbHeight = Math.max(18, Math.round((clientHeight / scrollHeight) * trackHeight));
        const maxThumbOffset = Math.max(trackHeight - thumbHeight, 0);
        const scrollRatio = maxScrollTop > 0 ? (carouselViewport.scrollTop / maxScrollTop) : 0;
        const thumbOffset = Math.round(maxThumbOffset * scrollRatio);

        carouselThumb.style.height = `${thumbHeight}px`;
        carouselThumb.style.transform = `translateY(${thumbOffset}px)`;
    };

    carouselViewport.addEventListener('scroll', syncCarouselScrollbar, { passive: true });
    if (window.ResizeObserver) {
        const resizeObserver = new ResizeObserver(() => {
            syncCarouselScrollbar();
        });
        resizeObserver.observe(carousel);
        resizeObserver.observe(carouselViewport);
    } else {
        window.addEventListener('resize', syncCarouselScrollbar, { passive: true });
    }

    // ---- Children (CSS Grid animated: 0fr → 1fr, zero JS measurements needed) ----
    const childrenContainer = document.createElement('div');
    childrenContainer.classList.add('group-row-children');
    if (isExpanded) childrenContainer.classList.add('is-open');

    // Inner wrapper: overflow:hidden + min-height:0 enables the grid trick
    const childrenInner = document.createElement('div');
    childrenInner.classList.add('group-row-children-inner');
    childrenContainer.appendChild(childrenInner);

    // Helper: build child items once and cache them in childrenInner
    const ensureChildrenBuilt = () => {
        if (childrenInner.children.length > 0) return; // already built
        if (!callbacks.buildListItem) return; // buildListItem not provided

        items.forEach((item, i) => {
            const wrapper = document.createElement('div');
            wrapper.classList.add('group-child-row');

            const indicator = document.createElement('div');
            indicator.classList.add('group-child-indicator');

            const inner = callbacks.buildListItem(item, i, callbacks);
            inner.classList.add('list-box--group-child');

            wrapper.appendChild(indicator);
            wrapper.appendChild(inner);
            childrenInner.appendChild(wrapper);

            const box = wrapper.querySelector('.list-box');
            if (box) {
                batchRenderTimelines.push({ el: box, index: item });
            }
        });
        queueTimelineBatchRender();
    };

    // If starting expanded, build immediately
    if (isExpanded) ensureChildrenBuilt();

    // ---- Toggle logic ----
    let queuedOpenFrame = 0;
    let queuedOpenCommitFrame = 0;

    const cancelQueuedOpen = () => {
        if (queuedOpenFrame) {
            cancelAnimationFrame(queuedOpenFrame);
            queuedOpenFrame = 0;
        }
        if (queuedOpenCommitFrame) {
            cancelAnimationFrame(queuedOpenCommitFrame);
            queuedOpenCommitFrame = 0;
        }
    };

    const setExpandedState = (shouldExpand) => {
        cancelQueuedOpen();

        if (!shouldExpand) {
            groupedExpandedKeys.delete(key);
            groupEl.classList.remove('is-expanded');
            childrenContainer.classList.remove('is-open');
            return;
        }

        groupedExpandedKeys.add(key);
        groupEl.classList.add('is-expanded');
        ensureChildrenBuilt(); // lazy build on first expand

        // Defer the open class so the browser can animate from 0fr.
        queuedOpenFrame = requestAnimationFrame(() => {
            queuedOpenFrame = 0;
            queuedOpenCommitFrame = requestAnimationFrame(() => {
                queuedOpenCommitFrame = 0;
                if (!groupedExpandedKeys.has(key)) return;
                childrenContainer.classList.add('is-open');
            });
        });
    };

    header.addEventListener('click', () => {
        setExpandedState(!groupedExpandedKeys.has(key));
    });

    // ---- Build Chips (placed here to safely reference childrenInner in closure) ----
    items.forEach(item => {
        const chip = document.createElement('span');
        chip.classList.add('group-row-version-chip');
        chip.textContent = item.version || 'Unknown';
        chip.title = item.version || 'Unknown';
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasExpanded = groupedExpandedKeys.has(key);
            if (!wasExpanded) {
                header.click();
            }

            // Scroll to the item with a slight delay to allow expansion logic/DOM to catch up
            setTimeout(() => {
                const target = childrenInner.querySelector(`[data-item-id="${item.id}"]`);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

                    // Simple distance-based delay calculation
                    const rect = target.getBoundingClientRect();
                    const distance = Math.abs(rect.top - (window.innerHeight / 2));
                    // Base 350ms + roughly 0.2ms per pixel, capped at 1.2s
                    const highlightDelay = Math.min(1200, 350 + (distance / 5));

                    setTimeout(() => {
                        target.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), outline 0.3s ease';
                        target.style.transform = 'scale(1.01)';
                        target.style.outline = '2px solid var(--accent-primary)';
                        target.style.outlineOffset = '0px';
                        target.style.zIndex = '100';

                        setTimeout(() => {
                            target.style.transform = '';
                            target.style.outline = '';
                            target.style.outlineOffset = '';
                            target.style.zIndex = '';
                        }, 1200);
                    }, highlightDelay);
                }
            }, wasExpanded ? 50 : 500);
        });
        carouselViewport.appendChild(chip);
    });

    requestAnimationFrame(syncCarouselScrollbar);

    groupEl.appendChild(header);
    groupEl.appendChild(childrenContainer);

    return groupEl;
};

/**
 * Renders the grouped layout with chunked rendering for large datasets.
 * Uses incremental DOM insertion to maintain responsiveness with 2000+ items.
 * @param {HTMLElement} listContainer - List container element
 * @param {Array<Object>} groups - Array of groups
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.updateEmptyState - Function to update empty state
 */
export const renderGroupedView = (listContainer, groups, callbacks) => {
    const passToken = ++groupedRenderPassToken;

    // Import cancelTimelineBatchRender from TimelineRenderer
    import('../services/TimelineRenderer.js').then(({ cancelTimelineBatchRender }) => {
        cancelTimelineBatchRender();
    });

    // Clear and prepare container
    listContainer.innerHTML = '';
    listContainer.classList.add('view-grouped');

    if (!groups.length) {
        if (callbacks.updateEmptyState) {
            callbacks.updateEmptyState(listContainer);
        }
        return;
    }

    // For small datasets, render synchronously for instant feedback
    if (groups.length <= 20) {
        const fragment = document.createDocumentFragment();
        groups.forEach((group, index) => {
            const groupEl = buildGroupHeaderRow(group, index, callbacks);
            groupEl.dataset.groupKey = group.key;
            groupEl.dataset.groupIndex = index;
            fragment.appendChild(groupEl);
        });
        listContainer.appendChild(fragment);

        if (callbacks.updateEmptyState) {
            callbacks.updateEmptyState(listContainer);
        }
        return;
    }

    // For large datasets, use chunked rendering to maintain responsiveness
    // This prevents INP issues when switching to tabs with 2000+ items
    const CHUNK_SIZE = 15; // Groups per frame
    let currentIndex = 0;

    const renderChunk = () => {
        // Check if this render pass is still valid (token hasn't changed)
        if (passToken !== groupedRenderPassToken) {
            return;
        }

        const fragment = document.createDocumentFragment();
        const endIndex = Math.min(currentIndex + CHUNK_SIZE, groups.length);

        for (let i = currentIndex; i < endIndex; i++) {
            const group = groups[i];
            const groupEl = buildGroupHeaderRow(group, i, callbacks);
            groupEl.dataset.groupKey = group.key;
            groupEl.dataset.groupIndex = i;
            fragment.appendChild(groupEl);
        }

        listContainer.appendChild(fragment);
        currentIndex = endIndex;

        if (currentIndex < groups.length) {
            // Schedule next chunk
            requestAnimationFrame(renderChunk);
        } else {
            // Rendering complete
            if (callbacks.updateEmptyState) {
                callbacks.updateEmptyState(listContainer);
            }
        }
    };

    // Start chunked rendering
    requestAnimationFrame(renderChunk);
};

// ============================================
// Group Expansion Controls
// ============================================

/**
 * Toggle group expansion state
 * @param {string} groupKey - Group key
 * @param {HTMLElement} headerEl - Group header element
 */
export const toggleGroupExpansion = (groupKey, headerEl) => {
    if (headerEl) {
        headerEl.click();
        return;
    }

    if (groupedExpandedKeys.has(groupKey)) {
        groupedExpandedKeys.delete(groupKey);
    } else {
        groupedExpandedKeys.add(groupKey);
    }
};

/**
 * Check if a group is expanded
 * @param {string} groupKey - Group key
 * @returns {boolean} Whether group is expanded
 */
export const isGroupExpanded = (groupKey) => {
    return groupedExpandedKeys.has(groupKey);
};

/**
 * Expand all groups
 * @param {Array<Object>} groups - Array of groups to expand
 */
export const expandAllGroups = (groups) => {
    groups.forEach(group => {
        groupedExpandedKeys.add(group.key);
    });
};

/**
 * Collapse all groups
 */
export const collapseAllGroups = () => {
    groupedExpandedKeys.clear();
};

/**
 * Get the set of expanded group keys
 * @returns {Set<string>} Set of expanded group keys
 */
export const getExpandedGroupKeys = () => {
    return new Set(groupedExpandedKeys);
};

/**
 * Set expanded group keys
 * @param {Array<string>} keys - Array of keys to expand
 */
export const setExpandedGroupKeys = (keys) => {
    groupedExpandedKeys.clear();
    keys.forEach(key => groupedExpandedKeys.add(key));
};
