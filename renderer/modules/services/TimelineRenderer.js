/**
 * TimelineRenderer.js - Timeline canvas rendering service
 * Extracted from renderer.js (lines 622-757, 1902-2035)
 */

import { doneIds, beatmapItems, isWindowResizeInProgress } from '../state/Store.js';
import { parseHighlights } from '../utils/Helpers.js';

// ============================================
// Constants
// ============================================

/** @type {number} Maximum number of retries for timeline rendering */
export const MAX_TIMELINE_RENDER_RETRIES = 8;

/** @type {number} Batch size for timeline rendering */
const TIMELINE_BATCH_RENDER_SIZE = 5;

// ============================================
// State
// ============================================

/** @type {Array<{el: HTMLElement, index: number}>} */
const batchRenderTimelines = [];

/** @type {number} */
let batchRenderRaf = 0;

/** @type {string} */
let currentHighlightColor = 'rgb(63, 155, 106)';

// ============================================
// Core Timeline Rendering
// ============================================

/**
 * Render timeline ranges to a canvas element
 * @param {HTMLCanvasElement} canvas - Canvas element to render to
 * @param {Array<{start: number, end: number, type?: string}>} ranges - Timeline ranges
 * @param {number} totalDuration - Total duration in ms (not used directly, ranges are 0-1)
 * @param {Object} [options] - Rendering options
 * @param {string} [options.highlightColor] - Color for object highlights
 * @param {boolean} [options.showBookmarks] - Whether to show bookmarks
 * @returns {boolean} Whether rendering succeeded
 */
export const renderTimeline = (canvas, ranges, totalDuration = 0, options = {}) => {
    if (!(canvas instanceof HTMLCanvasElement)) return false;

    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    // Timeline can briefly report 0x0 while layout is settling (or tab regains focus).
    // Defer the draw in that case and retry on the next frame.
    if (width <= 0 || height <= 0) {
        return false;
    }

    // Set internal resolution for crispness
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
    }

    // Use setTransform to avoid cumulative scaling if render is called multiple times
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const highlightColor = options.highlightColor || currentHighlightColor;

    // Sort to draw bookmarks on top
    const sorted = [...ranges].sort((a, b) => {
        if (a.type === b.type) return 0;
        if (a.type === 'bookmark') return 1;
        if (b.type === 'bookmark') return -1;
        return 0;
    });

    sorted.forEach((range) => {
        const x = range.start * width;
        const w = (range.end - range.start) * width;

        if (range.type === 'break') {
            ctx.fillStyle = 'rgba(73, 159, 113, 0.6)';
            ctx.fillRect(x, 0, w, height);
        } else if (range.type === 'bookmark') {
            if (options.showBookmarks !== false) {
                ctx.fillStyle = 'rgba(67, 145, 255, 0.8)';
                ctx.fillRect(x, 0, Math.max(2, w), height);
            }
        } else {
            ctx.fillStyle = highlightColor;
            ctx.fillRect(x, 0, w, height);
        }
    });

    return true;
};

/**
 * Apply timeline to a list box element
 * @param {HTMLElement} box - List box element
 * @param {Object|number} itemOrIndex - Beatmap item or its index
 * @param {Object} [callbacks] - Optional callbacks
 * @param {Function} callbacks.onRender - Called when timeline is rendered
 * @param {Function} callbacks.onRetry - Called when retry is scheduled
 */
export const applyTimelineToBox = (box, itemOrIndex, callbacks = {}) => {
    const timeline = box.querySelector('.list-timeline');
    if (!timeline) return;

    const itemId = box.dataset.itemId;
    const isDone = doneIds.includes(itemId);
    let ranges = [];

    if (isDone) {
        ranges = [{ start: 0, end: 1, type: 'object' }];
    } else {
        // Find the item properly. If itemOrIndex is already an object, use it.
        // Otherwise, try to find it in beatmapItems via index, or fallback to searching by ID.
        let item = (typeof itemOrIndex === 'object') ? itemOrIndex : null;

        if (!item) {
            const index = Number(itemOrIndex);
            const indexedItem = Number.isNaN(index) ? null : beatmapItems[index];
            if (indexedItem && indexedItem.id === itemId) {
                item = indexedItem;
            } else {
                item = beatmapItems.find(i => i.id === itemId);
            }
        }

        ranges = item?.highlights || [];

        const hasProgress = Number(item?.progress || box.dataset.progress || 0) > 0;
        if (!ranges.length && hasProgress) {
            // Use a stable index for fallback visual variety (the box's render index)
            const fallbackIndex = Number(box.dataset.renderIndex || 0);
            const fallback = fallbackIndex % 2 === 0 ? '0.1-0.18,0.42-0.52,0.76-0.96' : '0.15-0.22,0.58-0.72';
            ranges = parseHighlights(fallback);
        } else if (!hasProgress) {
            ranges = [];
        }
    }

    const didRender = renderTimeline(timeline, ranges);
    if (didRender) {
        timeline.dataset.renderRetryCount = '0';
        if (callbacks.onRender) {
            callbacks.onRender(box, ranges);
        }
        return;
    }

    const retryCount = Number(timeline.dataset.renderRetryCount || 0);
    if (retryCount >= MAX_TIMELINE_RENDER_RETRIES) return;

    timeline.dataset.renderRetryCount = String(retryCount + 1);
    requestAnimationFrame(() => {
        if (!box.isConnected) return;
        if (callbacks.onRetry) {
            callbacks.onRetry(box, retryCount + 1);
        }
        applyTimelineToBox(box, itemOrIndex, callbacks);
    });
};

// ============================================
// Batch Rendering
// ============================================

/**
 * Flush the batch timeline render queue
 * @private
 */
const flushTimelineBatchRender = () => {
    batchRenderRaf = 0;
    if (isWindowResizeInProgress) return;

    let processed = 0;
    while (batchRenderTimelines.length > 0 && processed < TIMELINE_BATCH_RENDER_SIZE) {
        const job = batchRenderTimelines.shift();
        if (!job?.el || !job.el.isConnected) continue;
        applyTimelineToBox(job.el, job.index);
        processed += 1;
    }

    if (batchRenderTimelines.length > 0) {
        batchRenderRaf = requestAnimationFrame(flushTimelineBatchRender);
    }
};

/**
 * Schedule timeline batch render
 */
export const scheduleTimelineBatchRender = () => {
    if (batchRenderRaf || isWindowResizeInProgress) return;
    batchRenderRaf = requestAnimationFrame(flushTimelineBatchRender);
};

/**
 * Cancel timeline batch render
 */
export const cancelTimelineBatchRender = () => {
    batchRenderTimelines.length = 0;
    if (!batchRenderRaf) return;
    cancelAnimationFrame(batchRenderRaf);
    batchRenderRaf = 0;
};

/**
 * Queue a timeline for batch rendering
 * @param {HTMLElement} el - List box element
 * @param {number} index - Item index
 */
export const queueTimelineBatchRender = (el, index) => {
    batchRenderTimelines.push({ el, index });
    scheduleTimelineBatchRender();
};

// ============================================
// Visible Timeline Updates
// ============================================

/**
 * Re-render timelines for all visible items
 * @param {Object} [options] - Options for re-rendering
 * @param {number} [options.batchSize] - Number of items per batch
 * @param {number} [options.viewportPadding] - Padding around viewport in pixels
 */
export const rerenderVisibleTimelines = (options = {}) => {
    const container = document.querySelector('#listContainer');
    if (!container) return;

    const batchSize = options.batchSize || 6;
    const viewportPadding = options.viewportPadding || 120;

    // Repaint only rows around the viewport and split work across frames
    // to avoid tab-switch hitches on large/grouped lists.
    const viewportTop = -viewportPadding;
    const viewportBottom = window.innerHeight + viewportPadding;
    const visibleBoxes = Array.from(container.querySelectorAll('.list-box')).filter((box) => {
        const rect = box.getBoundingClientRect();
        return rect.bottom >= viewportTop && rect.top <= viewportBottom;
    });

    if (!visibleBoxes.length) return;

    let cursor = 0;

    const processBatch = () => {
        const end = Math.min(cursor + batchSize, visibleBoxes.length);
        for (let i = cursor; i < end; i++) {
            const box = visibleBoxes[i];
            const index = Number(box.dataset.renderIndex);
            applyTimelineToBox(box, Number.isNaN(index) ? undefined : index);
        }
        cursor = end;

        if (cursor < visibleBoxes.length) {
            requestAnimationFrame(processBatch);
        }
    };

    requestAnimationFrame(processBatch);
};

/**
 * Clear all timeline retry counts
 */
export const clearTimelineRetries = () => {
    const timelines = document.querySelectorAll('.list-timeline');
    timelines.forEach(timeline => {
        timeline.dataset.renderRetryCount = '0';
    });
};

/**
 * Set the timeline highlight color
 * @param {string} color - CSS color string
 */
export const setTimelineHighlightColor = (color) => {
    currentHighlightColor = color;
};

/**
 * Get current batch render stats
 * @returns {{queueLength: number, isScheduled: boolean}} Batch stats
 */
export const getBatchRenderStats = () => ({
    queueLength: batchRenderTimelines.length,
    isScheduled: batchRenderRaf !== 0
});

export default {
    renderTimeline,
    applyTimelineToBox,
    rerenderVisibleTimelines,
    clearTimelineRetries,
    setTimelineHighlightColor,
    queueTimelineBatchRender,
    scheduleTimelineBatchRender,
    cancelTimelineBatchRender,
    getBatchRenderStats,
    MAX_TIMELINE_RENDER_RETRIES,
    TIMELINE_BATCH_RENDER_SIZE
};
