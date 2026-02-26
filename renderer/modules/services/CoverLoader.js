/**
 * CoverLoader.js - Cover image loading queue service
 * Extracted from renderer.js (lines 1231-1320)
 */

import { beatmapApi } from '../bridge/Tauri.js';
import { beatmapItems } from '../state/Store.js';

// ============================================
// Cover Loading State
// ============================================

/** @type {Array<{itemId: string, coverPath: string, callbacks: Object}>} */
const coverLoadQueue = [];

/** @type {Set<string>} */
const queuedCoverPaths = new Set();

/** @type {boolean} */
let isProcessingQueue = false;

/** @type {number} */
const CONCURRENT_LOADS = 30;

// ============================================
// Cover Loading Functions
// ============================================

/**
 * Process the cover load queue with concurrency limit
 * @private
 */
const processCoverLoadQueue = async () => {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    try {
        while (coverLoadQueue.length > 0) {
            const batch = coverLoadQueue.splice(0, CONCURRENT_LOADS);

            await Promise.all(batch.map(async ({ itemId, coverPath, callbacks }) => {
                const queueKey = `${itemId}::${coverPath}`;
                try {
                    // Handle group header covers (itemId starts with 'group||')
                    if (itemId && itemId.startsWith('group||')) {
                        let coverUrl = '';
                        if (beatmapApi?.convertFileSrc) {
                            coverUrl = beatmapApi.convertFileSrc(coverPath);
                        } else if (beatmapApi?.readImage) {
                            coverUrl = await beatmapApi.readImage(coverPath);
                        }
                        if (coverUrl) {
                            // Find the group row and update its cover img
                            const groupKey = itemId.slice('group||'.length);
                            const groupEl = document.querySelector(`[data-group-key="${CSS.escape(groupKey)}"]`);
                            if (groupEl) {
                                const img = groupEl.querySelector('.group-row-cover img');
                                if (img) {
                                    img.src = coverUrl;
                                    img.classList.remove('list-img--placeholder');
                                }
                            }
                            // Also update representative beatmap item
                            const repItem = beatmapItems.find(i => i.coverPath === coverPath);
                            if (repItem) repItem.coverUrl = coverUrl;
                        }

                        if (callbacks?.onSuccess) {
                            callbacks.onSuccess(coverUrl);
                        }
                        return;
                    }

                    const item = beatmapItems.find(i => i.id === itemId);
                    if (!item || item.coverPath !== coverPath) {
                        return;
                    }

                    // Use convertFileSrc for direct asset protocol URL (no IPC round-trip)
                    let coverUrl = '';
                    if (beatmapApi?.convertFileSrc) {
                        coverUrl = beatmapApi.convertFileSrc(coverPath);
                    } else if (beatmapApi?.readImage) {
                        coverUrl = await beatmapApi.readImage(coverPath);
                    }
                    if (!coverUrl) {
                        if (callbacks?.onError) {
                            callbacks.onError(new Error('Failed to load cover'));
                        }
                        return;
                    }

                    item.coverUrl = coverUrl;

                    const img = document.querySelector(`[data-item-id="${itemId}"] .list-img img`);
                    if (img) {
                        img.src = coverUrl;
                        img.classList.remove('list-img--placeholder');
                    }

                    if (callbacks?.onSuccess) {
                        callbacks.onSuccess(coverUrl);
                    }
                } catch (err) {
                    // Non-fatal: keep placeholder for failed covers.
                    if (callbacks?.onError) {
                        callbacks.onError(err);
                    }
                } finally {
                    queuedCoverPaths.delete(queueKey);
                }
            }));

            // Yield briefly to keep UI responsive
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    } finally {
        isProcessingQueue = false;
    }
};

/**
 * Schedule a cover load
 * @param {string} itemId - Item ID (or 'group||{groupKey}' for group headers)
 * @param {string} coverPath - Path to cover image
 * @param {Object} [callbacks] - Optional callbacks
 * @param {Function} callbacks.onSuccess - Called with loaded cover URL
 * @param {Function} callbacks.onError - Called with error if loading fails
 */
export const scheduleCoverLoad = (itemId, coverPath, callbacks = {}) => {
    if (!itemId || !coverPath) return;
    const queueKey = `${itemId}::${coverPath}`;
    if (queuedCoverPaths.has(queueKey)) return;

    queuedCoverPaths.add(queueKey);
    coverLoadQueue.push({ itemId, coverPath, callbacks });
    processCoverLoadQueue();
};

/**
 * Preload cover for a group header
 * @param {string} groupKey - Group key identifier
 * @param {string} coverPath - Path to cover image
 * @param {Object} [callbacks] - Optional callbacks
 * @param {Function} callbacks.onSuccess - Called with loaded cover URL
 * @param {Function} callbacks.onError - Called with error if loading fails
 */
export const preloadCoverForGroup = (groupKey, coverPath, callbacks = {}) => {
    if (!groupKey || !coverPath) return;
    const itemId = `group||${groupKey}`;
    scheduleCoverLoad(itemId, coverPath, callbacks);
};

/**
 * Clear the cover load queue
 */
export const clearCoverQueue = () => {
    coverLoadQueue.length = 0;
    queuedCoverPaths.clear();
};

/**
 * Check if a cover is already queued
 * @param {string} itemId - Item ID
 * @param {string} coverPath - Path to cover image
 * @returns {boolean} Whether the cover is queued
 */
export const isCoverQueued = (itemId, coverPath) => {
    const queueKey = `${itemId}::${coverPath}`;
    return queuedCoverPaths.has(queueKey);
};

/**
 * Get queue stats
 * @returns {{queueLength: number, queuedPathsCount: number}} Queue statistics
 */
export const getQueueStats = () => ({
    queueLength: coverLoadQueue.length,
    queuedPathsCount: queuedCoverPaths.size
});

export default {
    scheduleCoverLoad,
    preloadCoverForGroup,
    clearCoverQueue,
    isCoverQueued,
    getQueueStats,
    CONCURRENT_LOADS
};
