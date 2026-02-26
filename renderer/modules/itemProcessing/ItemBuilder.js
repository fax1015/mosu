/**
 * ItemBuilder.js - Item building and processing module
 * Extracted from renderer.js (lines 3034-3591)
 * Handles creating beatmap items from file content and cache
 */

import { beatmapApi } from '../bridge/Tauri.js';
import { settings } from '../state/Store.js';
import { isValidStarRating, isStarRatingMissing } from '../utils/Validation.js';
import { getDirectoryPath, computeProgress, createItemId } from '../utils/Helpers.js';
import {
    parseMetadata,
    parseHitObjects,
    parseBreakPeriods,
    parseBookmarks,
    buildHighlightRanges,
    buildBreakRanges,
    buildBookmarkRanges
} from '../parsers/BeatmapParser.js';
import {
    scheduleAudioAnalysis,
    scheduleStarRatingCalculation
} from '../services/BackgroundProcessor.js';

// ============================================
// Item Building from Content
// ============================================

/**
 * Build a beatmap item from file content
 * @param {string} filePath - Path to the .osu file
 * @param {string} content - File content
 * @param {Object} stat - File stats
 * @param {Object|null} existing - Existing item data (for updates)
 * @returns {Promise<Object>} Built item object
 */
export async function buildItemFromContent(filePath, content, stat, existing) {
    const metadata = parseMetadata(content);
    const { hitStarts, hitEnds } = parseHitObjects(content);
    const breakPeriods = parseBreakPeriods(content);
    const bookmarks = parseBookmarks(content);

    return processWorkerResult({
        metadata,
        hitStarts,
        hitEnds,
        breakPeriods,
        bookmarks,
        filePath,
        stat
    }, existing);
}

/**
 * Process worker result and create/update item
 * NOTE: This function must be SYNCHRONOUS because it's called from Tauri event handlers
 * which don't wait for async handlers to complete. The backend should provide all metadata.
 * @param {Object} file - File processing result
 * @param {Object} file.metadata - Parsed metadata
 * @param {Array<number>} file.hitStarts - Hit object start times
 * @param {Array<number>} file.hitEnds - Hit object end times
 * @param {Array<Object>} file.breakPeriods - Break periods
 * @param {Array<number>} file.bookmarks - Bookmarks
 * @param {string} file.filePath - File path
 * @param {Object} file.stat - File stats
 * @param {Object|null} existing - Existing item data
 * @returns {Object} Processed item
 */
export function processWorkerResult(file, existing) {
    const { metadata, hitStarts, hitEnds, breakPeriods, bookmarks, filePath, stat } = file || {};

    let coverUrl = '';
    let coverPath = '';
    let highlights = [];

    if (metadata?.background) {
        const folderPath = getDirectoryPath(filePath || '');
        coverPath = `${folderPath}${metadata.background}`;
        if (existing?.coverPath === coverPath && existing?.coverUrl) {
            coverUrl = existing.coverUrl;
        } else if (beatmapApi?.convertFileSrc) {
            // Generate asset URL instantly — no IPC needed
            coverUrl = beatmapApi.convertFileSrc(coverPath);
        }
    }

    const maxObjectTime = arrayMax(hitEnds);
    let maxBreakTime = 0;
    if (breakPeriods?.length) {
        for (let i = 0; i < breakPeriods.length; i++) {
            if (breakPeriods[i].end > maxBreakTime) {
                maxBreakTime = breakPeriods[i].end;
            }
        }
    }
    const maxBookmarkTime = arrayMax(bookmarks);

    const maxTime = Math.max(maxObjectTime, maxBreakTime, maxBookmarkTime);
    const fallbackDuration = maxTime > 0 ? maxTime + 1000 : 0;

    // Preserve existing duration if audio hasn't changed
    let durationMs = (existing && existing.audio === metadata.audio)
        ? existing.durationMs
        : null;

    const totalDuration = durationMs || fallbackDuration;
    if (totalDuration) {
        const objectRanges = buildHighlightRanges(hitStarts || [], hitEnds || [], totalDuration);
        const breakRanges = buildBreakRanges(breakPeriods || [], totalDuration);
        const bookmarkRanges = buildBookmarkRanges(bookmarks || [], totalDuration);
        highlights = [...breakRanges, ...objectRanges, ...bookmarkRanges];
    }

    const item = {
        ...metadata,
        durationMs,
        deadline: existing?.deadline ?? null,
        targetStarRating: existing?.targetStarRating ?? null,
        notes: existing?.notes || '',
        coverUrl,
        coverPath,
        highlights,
        progress: computeProgress(highlights),
        dateAdded: existing?.dateAdded ?? Date.now(),
        dateModified: stat?.mtimeMs ?? 0,
        id: existing?.id ?? createItemId(filePath),
        filePath,
        starRating: isValidStarRating(metadata?.starRating) ? metadata.starRating : null,
    };

    // Schedule audio analysis if duration is missing
    if (!durationMs && metadata.audio && filePath) {
        // Store raw hit object/break timestamps temporarily so we can recalculate
        // accurate normalized highlights once the real audio duration is known.
        item.rawTimestamps = { hitStarts, hitEnds, breakPeriods, bookmarks };
        scheduleAudioAnalysis(item.id);
    }

    // Schedule star rating calculation if missing
    if (filePath && isStarRatingMissing(item.starRating)) {
        scheduleStarRatingCalculation(item.id);
    }

    return item;
}

// ============================================
// Item Building from Cache
// ============================================

/**
 * Build item from localStorage cache
 * @param {Object} cached - Cached item data
 * @param {Object} settingsObj - Settings object
 * @returns {Object|null} Rebuilt item or null if invalid
 */
export function buildItemFromCache(cached, settingsObj = settings) {
    if (!cached || !cached.id || !cached.filePath) {
        return null;
    }

    // Validate required fields
    if (!cached.title || !cached.version) {
        console.warn(`Invalid cached item: ${cached.id}`);
        return null;
    }

    // Rebuild highlights from cache if needed
    let highlights = cached.highlights || [];
    if (typeof highlights === 'string') {
        // Deserialize if stored as string
        highlights = deserializeHighlights(highlights);
    }

    // Recalculate progress from highlights
    const progress = computeProgress(highlights);

    // Build item with defaults for missing fields
    const item = {
        id: cached.id,
        filePath: cached.filePath,
        title: cached.title,
        titleUnicode: cached.titleUnicode || cached.title,
        artist: cached.artist || 'Unknown Artist',
        artistUnicode: cached.artistUnicode || cached.artist || 'Unknown Artist',
        creator: cached.creator || 'Unknown Creator',
        version: cached.version,
        beatmapSetID: cached.beatmapSetID || '-1',
        mode: Number.isFinite(cached.mode) ? Math.min(Math.max(cached.mode, 0), 3) : 0,
        audio: cached.audio || '',
        background: cached.background || '',
        durationMs: (typeof cached.durationMs === 'number') ? cached.durationMs : null,
        previewTime: cached.previewTime ?? -1,
        deadline: (typeof cached.deadline === 'number' || cached.deadline === null)
            ? cached.deadline
            : null,
        targetStarRating: (typeof cached.targetStarRating === 'number' || cached.targetStarRating === null)
            ? cached.targetStarRating
            : null,
        notes: cached.notes || '',
        starRating: isValidStarRating(cached.starRating) ? cached.starRating : null,
        highlights,
        progress,
        dateAdded: cached.dateAdded || Date.now(),
        dateModified: cached.dateModified || 0,
        coverUrl: '',
        coverPath: cached.coverPath || '',
    };

    // Regenerate cover URL if cover path exists
    if (item.coverPath && beatmapApi?.convertFileSrc) {
        item.coverUrl = beatmapApi.convertFileSrc(item.coverPath);
    }

    return item;
}

// ============================================
// Metadata Creation
// ============================================

/**
 * Create metadata object from parsed content
 * @param {string} filePath - Path to the .osu file
 * @param {string} content - File content
 * @param {Object} stat - File stats
 * @param {Object} settingsObj - Settings object
 * @returns {Object} Metadata object
 */
export function createItemMetadata(filePath, content, stat, settingsObj = settings) {
    const metadata = parseMetadata(content);
    const { hitStarts, hitEnds } = parseHitObjects(content);
    const breakPeriods = parseBreakPeriods(content);
    const bookmarks = parseBookmarks(content);

    return {
        metadata,
        hitStarts,
        hitEnds,
        breakPeriods,
        bookmarks,
        filePath,
        stat
    };
}

// ============================================
// Item Calculations
// ============================================

/**
 * Calculate/update item duration
 * @param {Object} item - Item to update
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.getAudioDurationMs - Function to get audio duration
 * @param {Function} callbacks.onDurationUpdated - Called when duration is updated
 * @returns {Promise<boolean>} Whether duration was updated
 */
export async function calculateItemDuration(item, callbacks = {}) {
    if (!item || typeof item.durationMs === 'number' || !item.audio || !item.filePath) {
        return false;
    }

    const { getAudioDurationMs, onDurationUpdated } = callbacks;

    if (!getAudioDurationMs) {
        return false;
    }

    try {
        const folderPath = getDirectoryPath(item.filePath);
        const audioPath = `${folderPath}${item.audio}`;
        const duration = await getAudioDurationMs(audioPath);

        if (duration) {
            item.durationMs = duration;

            // Recalculate highlights if we have raw timestamps
            if (!item.rawTimestamps && item.filePath && beatmapApi?.readOsuFile) {
                try {
                    const content = await beatmapApi.readOsuFile(item.filePath);
                    if (content) {
                        const { hitStarts, hitEnds } = parseHitObjects(content);
                        const breakPeriods = parseBreakPeriods(content);
                        const bookmarks = parseBookmarks(content);
                        item.rawTimestamps = { hitStarts, hitEnds, breakPeriods, bookmarks };
                    }
                } catch (err) {
                    // Non-fatal re-parse failure
                }
            }

            if (item.rawTimestamps) {
                const { hitStarts, hitEnds, breakPeriods, bookmarks } = item.rawTimestamps;
                const objectRanges = buildHighlightRanges(hitStarts || [], hitEnds || [], duration);
                const breakRanges = buildBreakRanges(breakPeriods || [], duration);
                const bookmarkRanges = buildBookmarkRanges(bookmarks || [], duration);

                item.highlights = [...breakRanges, ...objectRanges, ...bookmarkRanges];
                item.progress = computeProgress(item.highlights);

                // Clean up temporary data
                delete item.rawTimestamps;
            }

            if (onDurationUpdated) {
                onDurationUpdated(item.id, duration);
            }

            return true;
        }
    } catch (err) {
        console.error('Duration calculation failed:', err);
    }

    return false;
}

/**
 * Calculate/update item star rating
 * @param {Object} item - Item to update
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.getStarRatingValue - Function to get star rating
 * @param {Function} callbacks.onStarRatingUpdated - Called when star rating is updated
 * @returns {Promise<boolean>} Whether star rating was updated
 */
export async function calculateItemStarRating(item, callbacks = {}) {
    if (!item || !item.filePath || isValidStarRating(item.starRating)) {
        return false;
    }

    const { getStarRatingValue, onStarRatingUpdated } = callbacks;

    if (!getStarRatingValue) {
        return false;
    }

    try {
        const rating = await getStarRatingValue(item.filePath);
        if (isValidStarRating(rating)) {
            item.starRating = rating;

            if (onStarRatingUpdated) {
                onStarRatingUpdated(item.id, rating);
            }

            return true;
        }
    } catch (err) {
        console.error('Star rating calculation failed:', err);
    }

    return false;
}

// ============================================
// Item Data Management
// ============================================

/**
 * Merge existing and incoming item data
 * @param {Object} existing - Existing item data
 * @param {Object} incoming - New item data
 * @returns {Object} Merged item
 */
export function mergeItemData(existing, incoming) {
    if (!existing) {
        return incoming;
    }

    if (!incoming) {
        return existing;
    }

    // Preserve user-editable fields from existing
    return {
        ...incoming,
        deadline: existing.deadline ?? incoming.deadline ?? null,
        targetStarRating: existing.targetStarRating ?? incoming.targetStarRating ?? null,
        notes: existing.notes || incoming.notes || '',
        dateAdded: existing.dateAdded || incoming.dateAdded || Date.now(),
        id: existing.id || incoming.id,
        // Keep existing star rating if valid, otherwise use incoming
        starRating: isValidStarRating(existing.starRating)
            ? existing.starRating
            : (isValidStarRating(incoming.starRating) ? incoming.starRating : null),
        // Keep existing duration if available
        durationMs: existing.durationMs ?? incoming.durationMs ?? null,
    };
}

/**
 * Remove non-serializable data from item for storage
 * @param {Object} item - Item to sanitize
 * @returns {Object} Sanitized item
 */
export function sanitizeItemForStorage(item) {
    if (!item) {
        return null;
    }

    // Create a copy without non-serializable fields
    const sanitized = { ...item };

    // Remove temporary/raw data
    delete sanitized.rawTimestamps;
    delete sanitized._cachedElements;
    delete sanitized._processing;

    // Ensure star rating is valid
    sanitized.starRating = isValidStarRating(item.starRating) ? item.starRating : null;

    // Ensure deadline is number or null
    sanitized.deadline = (typeof item.deadline === 'number' || item.deadline === null)
        ? item.deadline
        : null;

    // Ensure target star rating is number or null
    sanitized.targetStarRating = (typeof item.targetStarRating === 'number' || item.targetStarRating === null)
        ? item.targetStarRating
        : null;

    // Ensure duration is number or null
    sanitized.durationMs = (typeof item.durationMs === 'number')
        ? item.durationMs
        : null;

    // Ensure mode is valid
    sanitized.mode = Number.isFinite(item.mode)
        ? Math.min(Math.max(item.mode, 0), 3)
        : 0;

    return sanitized;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get max value from array
 * @param {Array<number>} arr - Array of numbers
 * @returns {number} Max value or 0 if empty
 */
function arrayMax(arr) {
    if (!arr || arr.length === 0) {
        return 0;
    }
    let max = arr[0];
    for (let i = 1; i < arr.length; i++) {
        if (arr[i] > max) {
            max = arr[i];
        }
    }
    return max;
}

/**
 * Deserialize highlights from string format
 * @param {string} str - Serialized highlights
 * @returns {Array<Object>} Deserialized highlights
 */
function deserializeHighlights(str) {
    if (!str || typeof str !== 'string') {
        return [];
    }

    const highlights = [];
    const parts = str.split(',');

    for (const part of parts) {
        const [start, end] = part.split('-').map(Number);
        if (!isNaN(start) && !isNaN(end)) {
            highlights.push({ start, end });
        }
    }

    return highlights;
}
