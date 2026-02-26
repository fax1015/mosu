/**
 * ItemUpdater.js - Item property update module
 * Extracted from renderer.js
 * Handles updating individual item properties
 */

import { beatmapItems, setBeatmapItems } from '../state/Store.js';
import { scheduleSave } from '../state/Persistence.js';
import { isValidStarRating } from '../utils/Validation.js';
import { computeProgress } from '../utils/Helpers.js';
import {
    buildHighlightRanges,
    buildBreakRanges,
    buildBookmarkRanges
} from '../parsers/BeatmapParser.js';

// ============================================
// Item Finders
// ============================================

/**
 * Find an item by ID
 * @param {string} itemId - Item ID to find
 * @param {Array<Object>} [items=beatmapItems] - Array to search in
 * @returns {Object|undefined} Found item or undefined
 */
export function findItemById(itemId, items = beatmapItems) {
    if (!itemId || !Array.isArray(items)) {
        return undefined;
    }
    return items.find(i => i.id === itemId);
}

/**
 * Find an item index by ID
 * @param {string} itemId - Item ID to find
 * @param {Array<Object>} [items=beatmapItems] - Array to search in
 * @returns {number} Item index or -1 if not found
 */
export function findItemIndexById(itemId, items = beatmapItems) {
    if (!itemId || !Array.isArray(items)) {
        return -1;
    }
    return items.findIndex(i => i.id === itemId);
}

// ============================================
// Property Updaters
// ============================================

/**
 * Update item notes
 * @param {string} itemId - Item ID
 * @param {string} notes - New notes value
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onUpdated - Called when updated
 * @param {Function} callbacks.onError - Called on error
 * @returns {boolean} Whether update was successful
 */
export function updateItemNotes(itemId, notes, callbacks = {}) {
    try {
        const itemIndex = findItemIndexById(itemId);
        if (itemIndex === -1) {
            if (callbacks.onError) {
                callbacks.onError('Item not found');
            }
            return false;
        }

        // Update the item
        beatmapItems[itemIndex].notes = String(notes || '');

        // Schedule save
        scheduleSave();

        if (callbacks.onUpdated) {
            callbacks.onUpdated(itemId, 'notes', beatmapItems[itemIndex].notes);
        }

        return true;
    } catch (error) {
        console.error('Failed to update notes:', error);
        if (callbacks.onError) {
            callbacks.onError(error.message);
        }
        return false;
    }
}

/**
 * Update item deadline
 * @param {string} itemId - Item ID
 * @param {number|null} deadline - New deadline timestamp or null
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onUpdated - Called when updated
 * @param {Function} callbacks.onError - Called on error
 * @param {Function} callbacks.getDeadlineStatus - Get deadline status (overdue, due-soon)
 * @returns {boolean} Whether update was successful
 */
export function updateItemDeadline(itemId, deadline, callbacks = {}) {
    try {
        const itemIndex = findItemIndexById(itemId);
        if (itemIndex === -1) {
            if (callbacks.onError) {
                callbacks.onError('Item not found');
            }
            return false;
        }

        // Validate deadline (must be number or null)
        const validDeadline = (typeof deadline === 'number' || deadline === null)
            ? deadline
            : null;

        // Update the item
        beatmapItems[itemIndex].deadline = validDeadline;

        // Schedule save
        scheduleSave();

        // Calculate deadline status if callback provided
        let status = null;
        if (callbacks.getDeadlineStatus && validDeadline) {
            status = callbacks.getDeadlineStatus(validDeadline);
        }

        if (callbacks.onUpdated) {
            callbacks.onUpdated(itemId, 'deadline', validDeadline, status);
        }

        return true;
    } catch (error) {
        console.error('Failed to update deadline:', error);
        if (callbacks.onError) {
            callbacks.onError(error.message);
        }
        return false;
    }
}

/**
 * Update item target star rating
 * @param {string} itemId - Item ID
 * @param {number|null} targetSr - New target star rating or null
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onUpdated - Called when updated
 * @param {Function} callbacks.onError - Called on error
 * @returns {boolean} Whether update was successful
 */
export function updateItemTargetSr(itemId, targetSr, callbacks = {}) {
    try {
        const itemIndex = findItemIndexById(itemId);
        if (itemIndex === -1) {
            if (callbacks.onError) {
                callbacks.onError('Item not found');
            }
            return false;
        }

        // Validate target star rating
        let validTarget = null;
        if (typeof targetSr === 'number' && !isNaN(targetSr) && targetSr > 0) {
            validTarget = targetSr;
        } else if (typeof targetSr === 'string') {
            const parsed = parseFloat(targetSr);
            if (!isNaN(parsed) && parsed > 0) {
                validTarget = parsed;
            }
        }

        // Update the item
        beatmapItems[itemIndex].targetStarRating = validTarget;

        // Schedule save
        scheduleSave();

        if (callbacks.onUpdated) {
            callbacks.onUpdated(itemId, 'targetStarRating', validTarget);
        }

        return true;
    } catch (error) {
        console.error('Failed to update target star rating:', error);
        if (callbacks.onError) {
            callbacks.onError(error.message);
        }
        return false;
    }
}

/**
 * Update item highlights
 * @param {string} itemId - Item ID
 * @param {Array<Object>} highlights - New highlights array
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onUpdated - Called when updated
 * @param {Function} callbacks.onError - Called on error
 * @returns {boolean} Whether update was successful
 */
export function updateItemHighlights(itemId, highlights, callbacks = {}) {
    try {
        const itemIndex = findItemIndexById(itemId);
        if (itemIndex === -1) {
            if (callbacks.onError) {
                callbacks.onError('Item not found');
            }
            return false;
        }

        // Validate highlights
        const validHighlights = Array.isArray(highlights) ? highlights : [];

        // Update the item
        beatmapItems[itemIndex].highlights = validHighlights;
        beatmapItems[itemIndex].progress = computeProgress(validHighlights);

        // Schedule save
        scheduleSave();

        if (callbacks.onUpdated) {
            callbacks.onUpdated(itemId, 'highlights', validHighlights);
        }

        return true;
    } catch (error) {
        console.error('Failed to update highlights:', error);
        if (callbacks.onError) {
            callbacks.onError(error.message);
        }
        return false;
    }
}

/**
 * Update item audio duration
 * @param {string} itemId - Item ID
 * @param {number} duration - Duration in milliseconds
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onUpdated - Called when updated
 * @param {Function} callbacks.onError - Called on error
 * @param {boolean} [recalculateHighlights=true] - Whether to recalculate highlights
 * @returns {boolean} Whether update was successful
 */
export function updateItemDuration(itemId, duration, callbacks = {}, recalculateHighlights = true) {
    try {
        const itemIndex = findItemIndexById(itemId);
        if (itemIndex === -1) {
            if (callbacks.onError) {
                callbacks.onError('Item not found');
            }
            return false;
        }

        const item = beatmapItems[itemIndex];

        // Validate duration
        if (typeof duration !== 'number' || isNaN(duration) || duration <= 0) {
            if (callbacks.onError) {
                callbacks.onError('Invalid duration value');
            }
            return false;
        }

        // Update duration
        item.durationMs = duration;

        // Recalculate highlights if needed
        if (recalculateHighlights && item.rawTimestamps) {
            const { hitStarts, hitEnds, breakPeriods, bookmarks } = item.rawTimestamps;
            const objectRanges = buildHighlightRanges(hitStarts || [], hitEnds || [], duration);
            const breakRanges = buildBreakRanges(breakPeriods || [], duration);
            const bookmarkRanges = buildBookmarkRanges(bookmarks || [], duration);

            item.highlights = [...breakRanges, ...objectRanges, ...bookmarkRanges];
            item.progress = computeProgress(item.highlights);

            // Clean up temporary data
            delete item.rawTimestamps;
        }

        // Schedule save
        scheduleSave();

        if (callbacks.onUpdated) {
            callbacks.onUpdated(itemId, 'duration', duration);
        }

        return true;
    } catch (error) {
        console.error('Failed to update duration:', error);
        if (callbacks.onError) {
            callbacks.onError(error.message);
        }
        return false;
    }
}

/**
 * Update item calculated star rating
 * @param {string} itemId - Item ID
 * @param {number} starRating - Star rating value
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onUpdated - Called when updated
 * @param {Function} callbacks.onError - Called on error
 * @returns {boolean} Whether update was successful
 */
export function updateItemStarRating(itemId, starRating, callbacks = {}) {
    try {
        const itemIndex = findItemIndexById(itemId);
        if (itemIndex === -1) {
            if (callbacks.onError) {
                callbacks.onError('Item not found');
            }
            return false;
        }

        // Validate star rating
        if (!isValidStarRating(starRating)) {
            if (callbacks.onError) {
                callbacks.onError('Invalid star rating value');
            }
            return false;
        }

        // Update the item
        beatmapItems[itemIndex].starRating = starRating;

        // Schedule save
        scheduleSave();

        if (callbacks.onUpdated) {
            callbacks.onUpdated(itemId, 'starRating', starRating);
        }

        return true;
    } catch (error) {
        console.error('Failed to update star rating:', error);
        if (callbacks.onError) {
            callbacks.onError(error.message);
        }
        return false;
    }
}

// ============================================
// Batch Updates
// ============================================

/**
 * Update multiple items at once
 * @param {Array<string>} itemIds - Array of item IDs
 * @param {Object} updates - Object with property updates
 * @param {Object} callbacks - Callback functions
 * @returns {Object} Results with success and failed arrays
 */
export function updateMultipleItems(itemIds, updates, callbacks = {}) {
    const results = {
        success: [],
        failed: []
    };

    if (!Array.isArray(itemIds) || !updates || typeof updates !== 'object') {
        return results;
    }

    for (const itemId of itemIds) {
        let success = false;

        // Apply each update
        for (const [key, value] of Object.entries(updates)) {
            switch (key) {
                case 'notes':
                    success = updateItemNotes(itemId, value, callbacks);
                    break;
                case 'deadline':
                    success = updateItemDeadline(itemId, value, callbacks);
                    break;
                case 'targetStarRating':
                    success = updateItemTargetSr(itemId, value, callbacks);
                    break;
                case 'highlights':
                    success = updateItemHighlights(itemId, value, callbacks);
                    break;
                case 'duration':
                    success = updateItemDuration(itemId, value, callbacks);
                    break;
                case 'starRating':
                    success = updateItemStarRating(itemId, value, callbacks);
                    break;
                default:
                    console.warn(`Unknown update key: ${key}`);
            }
        }

        if (success) {
            results.success.push(itemId);
        } else {
            results.failed.push(itemId);
        }
    }

    return results;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get deadline status for an item
 * @param {number} deadline - Deadline timestamp
 * @param {number} [now=Date.now()] - Current timestamp
 * @returns {string|null} Status: 'overdue', 'due-soon', or null
 */
export function getDeadlineStatus(deadline, now = Date.now()) {
    if (!deadline || typeof deadline !== 'number') {
        return null;
    }

    const diffDays = (deadline - now) / (1000 * 60 * 60 * 24);

    if (diffDays < 0) {
        return 'overdue';
    } else if (diffDays <= 3) {
        return 'due-soon';
    }

    return null;
}

/**
 * Check if an item needs audio analysis
 * @param {Object} item - Item to check
 * @returns {boolean} Whether analysis is needed
 */
export function itemNeedsAudioAnalysis(item) {
    return item &&
           item.audio &&
           typeof item.durationMs !== 'number' &&
           !!item.id;
}

/**
 * Check if an item needs star rating calculation
 * @param {Object} item - Item to check
 * @returns {boolean} Whether calculation is needed
 */
export function itemNeedsStarRating(item) {
    return item &&
           item.filePath &&
           item.id &&
           !isValidStarRating(item.starRating);
}
