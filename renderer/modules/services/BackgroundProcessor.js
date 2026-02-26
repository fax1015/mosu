/**
 * BackgroundProcessor.js - Background processing queues for audio analysis and star rating
 * Extracted from renderer.js (lines 3051-3511)
 */

import { beatmapApi } from '../bridge/Tauri.js';
import {
    beatmapItems,
    audioAnalysisQueue,
    isAnalyzingAudio,
    audioAnalysisTotal,
    starRatingQueue,
    isCalculatingStarRating,
    starRatingTotal,
    updateState,
    setAudioAnalysisQueue,
    settings
} from '../state/Store.js';
import { showNotification } from '../components/NotificationSystem.js';
import { getDirectoryPath, computeProgress } from '../utils/Helpers.js';
import { isStarRatingMissing, isValidStarRating } from '../utils/Validation.js';
import {
    parseHitObjects,
    parseBreakPeriods,
    parseBookmarks,
    buildHighlightRanges,
    buildBreakRanges,
    buildBookmarkRanges
} from '../parsers/BeatmapParser.js';
import {
    STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    AUDIO_ANALYSIS_STATE_KEY,
    STAR_RATING_STATE_KEY
} from '../config/Constants.js';

// ============================================
// Constants
// ============================================

/** @type {number} Maximum concurrent audio analysis operations */
export const MAX_AUDIO_CONCURRENT = 8;

/** @type {number} Maximum concurrent star rating calculations */
export const MAX_SR_CONCURRENT = 6;

/** @type {number} UI update batch size */
const UI_UPDATE_BATCH_SIZE = 25;

/** @type {number} Save debounce delay in ms */
const SAVE_DEBOUNCE_MS = 500;

/** @type {number} Yield delay between batches in ms */
const YIELD_DELAY_MS = 16;

// ============================================
// Audio Duration Helper
// ============================================

const getAudioDurationMs = async (filePath) => {
    if (!filePath || !beatmapApi?.getAudioDuration) {
        return null;
    }

    try {
        const duration = await beatmapApi.getAudioDuration(filePath);
        return duration || null;
    } catch (error) {
        console.error('Audio analysis failed:', error);
        return null;
    }
};

const getStarRatingValue = async (filePath) => {
    if (!filePath || !beatmapApi?.calculateStarRating) {
        return null;
    }

    try {
        const rating = await beatmapApi.calculateStarRating(filePath);
        return isValidStarRating(rating) ? rating : null;
    } catch (error) {
        return null;
    }
};

// ============================================
// State Persistence
// ============================================

const persistAudioAnalysisState = () => {
    try {
        if (!audioAnalysisQueue.length) {
            localStorage.removeItem(AUDIO_ANALYSIS_STATE_KEY);
            return;
        }
        localStorage.setItem(AUDIO_ANALYSIS_STATE_KEY, JSON.stringify({
            queue: audioAnalysisQueue,
            total: audioAnalysisTotal,
        }));
    } catch (e) {
        // Non-fatal persistence failure.
    }
};

const persistStarRatingState = () => {
    try {
        if (!starRatingQueue.length) {
            localStorage.removeItem(STAR_RATING_STATE_KEY);
            return;
        }
        localStorage.setItem(STAR_RATING_STATE_KEY, JSON.stringify({
            queue: starRatingQueue,
            total: starRatingTotal,
        }));
    } catch (e) {
        // Non-fatal persistence failure.
    }
};

// ============================================
// Scheduling Functions
// ============================================

/**
 * Schedule audio analysis for an item
 * @param {string} itemId - Item ID to analyze
 */
export const scheduleAudioAnalysis = (itemId) => {
    if (!audioAnalysisQueue.includes(itemId)) {
        const newQueue = [...audioAnalysisQueue, itemId];
        updateState('audioAnalysisQueue', newQueue);
        if (isAnalyzingAudio || audioAnalysisTotal > 0) {
            updateState('audioAnalysisTotal', audioAnalysisTotal + 1);
        }
        persistAudioAnalysisState();
    }
};

/**
 * Schedule star rating calculation for an item
 * @param {string} itemId - Item ID to calculate
 */
export const scheduleStarRatingCalculation = (itemId) => {
    if (!starRatingQueue.includes(itemId)) {
        const newQueue = [...starRatingQueue, itemId];
        updateState('starRatingQueue', newQueue);
        if (isCalculatingStarRating || starRatingTotal > 0) {
            updateState('starRatingTotal', starRatingTotal + 1);
        }
        persistStarRatingState();
    }
};

/**
 * Queue missing audio analysis from items
 * @param {Array<Object>} items - Items to check
 */
export const queueMissingAudioAnalysisFromItems = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
        if (item && item.audio && typeof item.durationMs !== 'number' && item.id) {
            scheduleAudioAnalysis(item.id);
        }
    }
};

/**
 * Queue missing star rating from items
 * @param {Array<Object>} items - Items to check
 */
export const queueMissingStarRatingFromItems = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
        if (item && item.filePath && item.id && isStarRatingMissing(item.starRating)) {
            scheduleStarRatingCalculation(item.id);
        }
    }
};

// ============================================
// Progress Update
// ============================================

let _lastTooltipUpdate = 0;

/**
 * Update the refresh button progress indicator
 * @param {Object} [callbacks] - Optional callbacks
 * @param {Function} callbacks.onProgress - Called with progress info
 */
export const updateRefreshProgress = (callbacks = {}) => {
    const refreshBtn = document.querySelector('#refreshBtn');
    if (!refreshBtn) return;

    const audioTotal = Math.max(0, audioAnalysisTotal);
    const starTotal = Math.max(0, starRatingTotal);
    const total = audioTotal + starTotal;

    const audioCompleted = audioTotal > 0 ? Math.max(0, audioTotal - audioAnalysisQueue.length) : 0;
    const starCompleted = starTotal > 0 ? Math.max(0, starTotal - starRatingQueue.length) : 0;
    const completed = audioCompleted + starCompleted;

    if (callbacks.onProgress) {
        callbacks.onProgress({
            total,
            completed,
            audio: { total: audioTotal, completed: audioCompleted },
            starRating: { total: starTotal, completed: starCompleted }
        });
    }

    if (total <= 0) {
        refreshBtn.style.setProperty('--refresh-progress', '0%');
        refreshBtn.dataset.tooltip = 'Refresh last directory';
        refreshBtn.classList.remove('is-analyzing');
        _lastTooltipUpdate = 0;
        return;
    }

    refreshBtn.classList.add('is-analyzing');

    const progress = Math.min(100, Math.max(0, (completed / total) * 100));
    refreshBtn.style.setProperty('--refresh-progress', `${progress}%`);

    // Throttle tooltip text updates to every 2s — native tooltips flash when title changes
    const now = Date.now();
    if (now - _lastTooltipUpdate > 2000 || completed === total) {
        _lastTooltipUpdate = now;
        const hasAudio = audioTotal > 0;
        const hasStar = starTotal > 0;
        if (hasAudio && hasStar) {
            refreshBtn.dataset.tooltip = `Background analysis... ${Math.round(progress)}% (Audio ${audioCompleted}/${audioTotal}, SR ${starCompleted}/${starTotal})`;
        } else if (hasStar) {
            refreshBtn.dataset.tooltip = `Calculating star ratings... ${Math.round(progress)}% (${completed}/${total})`;
        } else {
            refreshBtn.dataset.tooltip = `Analyzing audio durations... ${Math.round(progress)}% (${completed}/${total})`;
        }
    }
};

// ============================================
// Queue Processing
// ============================================

/**
 * Process the audio analysis queue
 * @param {Object} [callbacks] - Optional callbacks
 * @param {Function} callbacks.onItemComplete - Called when an item is analyzed
 * @param {Function} callbacks.onComplete - Called when queue is empty
 * @param {Function} callbacks.saveToStorage - Function to save data
 * @param {Function} callbacks.updateListItemElement - Function to update UI
 */
export const processAudioQueue = async (callbacks = {}) => {
    if (isAnalyzingAudio || audioAnalysisQueue.length === 0) return;
    updateState('isAnalyzingAudio', true);
    const total = Math.max(audioAnalysisTotal, audioAnalysisQueue.length);
    updateState('audioAnalysisTotal', total);
    updateRefreshProgress(callbacks);

    let unsavedCount = 0;
    let totalProcessed = 0;
    const pendingUIUpdates = new Set();
    let uiUpdateRaf = null;

    // Batch UI updates into a single animation frame
    const flushUIUpdates = () => {
        if (pendingUIUpdates.size === 0) return;
        const ids = [...pendingUIUpdates];
        pendingUIUpdates.clear();
        for (const id of ids) {
            if (callbacks.updateListItemElement) {
                callbacks.updateListItemElement(id);
            }
        }
    };

    const scheduleUIUpdate = (itemId) => {
        pendingUIUpdates.add(itemId);
        if (!uiUpdateRaf) {
            uiUpdateRaf = requestAnimationFrame(() => {
                uiUpdateRaf = null;
                flushUIUpdates();
            });
        }
    };

    // Debounce persist calls to avoid excessive localStorage writes
    let persistTimer = null;
    const debouncedPersist = () => {
        if (persistTimer) return;
        persistTimer = setTimeout(() => {
            persistTimer = null;
            persistAudioAnalysisState();
        }, SAVE_DEBOUNCE_MS);
    };

    // Analyze a single item — returns true if duration was found
    const analyzeOne = async (itemId) => {
        const item = beatmapItems.find(i => i.id === itemId);
        if (!item || typeof item.durationMs === 'number' || !item.audio || !item.filePath) {
            return false;
        }

        try {
            const folderPath = getDirectoryPath(item.filePath);
            const audioPath = `${folderPath}${item.audio}`;
            const duration = await getAudioDurationMs(audioPath);

            if (duration) {
                item.durationMs = duration;

                // Recalculate accurately now that we have the real duration.
                // If raw timestamps are missing (e.g. item restored from cache without duration),
                // we attempt one-time re-parsing of the .osu file to get them.
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
                    item.progress = computeProgress(item.highlights, settings);

                    // Clean up temporary data
                    delete item.rawTimestamps;
                }

                scheduleUIUpdate(item.id);

                if (callbacks.onItemComplete) {
                    callbacks.onItemComplete(item);
                }

                return true;
            }
        } catch (err) {
            // Non-fatal
        }
        return false;
    };

    // Process queue with concurrent workers
    while (audioAnalysisQueue.length > 0) {
        // Take a batch from the queue
        const batch = audioAnalysisQueue.splice(0, MAX_AUDIO_CONCURRENT);
        debouncedPersist();

        const results = await Promise.all(batch.map(id => analyzeOne(id)));

        for (const found of results) {
            if (found) {
                unsavedCount++;
                totalProcessed++;
            }
        }

        updateRefreshProgress(callbacks);

        // Save periodically
        if (unsavedCount >= UI_UPDATE_BATCH_SIZE) {
            if (callbacks.saveToStorage) {
                callbacks.saveToStorage();
            }
            unsavedCount = 0;
        }

        // Brief yield to keep UI responsive (one frame)
        await new Promise(r => setTimeout(r, YIELD_DELAY_MS));
    }

    // Cleanup
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    persistAudioAnalysisState();

    if (uiUpdateRaf) {
        cancelAnimationFrame(uiUpdateRaf);
        uiUpdateRaf = null;
    }
    flushUIUpdates();

    if (unsavedCount > 0) {
        if (callbacks.saveToStorage) {
            callbacks.saveToStorage();
        }
    }

    updateState('isAnalyzingAudio', false);
    updateState('audioAnalysisTotal', 0);
    updateRefreshProgress(callbacks);
    localStorage.removeItem(AUDIO_ANALYSIS_STATE_KEY);

    // Notify if we processed any items
    if (totalProcessed > 0) {
        showNotification('Audio Analysis Complete', `Analyzed ${totalProcessed} audio file${totalProcessed !== 1 ? 's' : ''}.`, 'success');
    }

    if (callbacks.onComplete) {
        callbacks.onComplete(totalProcessed);
    }
};

/**
 * Process the star rating queue
 * @param {Object} [callbacks] - Optional callbacks
 * @param {Function} callbacks.onItemComplete - Called when an item is calculated
 * @param {Function} callbacks.onComplete - Called when queue is empty
 * @param {Function} callbacks.saveToStorage - Function to save data
 * @param {Function} callbacks.updateListItemElement - Function to update UI
 */
export const processStarRatingQueue = async (callbacks = {}) => {
    if (isCalculatingStarRating || starRatingQueue.length === 0) return;

    updateState('isCalculatingStarRating', true);
    const total = Math.max(starRatingTotal, starRatingQueue.length);
    updateState('starRatingTotal', total);
    updateRefreshProgress(callbacks);

    let unsavedCount = 0;
    let totalProcessed = 0;
    const pendingUIUpdates = new Set();
    let uiUpdateRaf = null;

    const flushUIUpdates = () => {
        if (pendingUIUpdates.size === 0) return;
        const ids = [...pendingUIUpdates];
        pendingUIUpdates.clear();
        for (const id of ids) {
            if (callbacks.updateListItemElement) {
                callbacks.updateListItemElement(id);
            }
        }
    };

    const scheduleUIUpdate = (itemId) => {
        pendingUIUpdates.add(itemId);
        if (!uiUpdateRaf) {
            uiUpdateRaf = requestAnimationFrame(() => {
                uiUpdateRaf = null;
                flushUIUpdates();
            });
        }
    };

    let persistTimer = null;
    const debouncedPersist = () => {
        if (persistTimer) return;
        persistTimer = setTimeout(() => {
            persistTimer = null;
            persistStarRatingState();
        }, SAVE_DEBOUNCE_MS);
    };

    const calculateOne = async (itemId) => {
        const item = beatmapItems.find(i => i.id === itemId);
        if (!item || !item.filePath || !isStarRatingMissing(item.starRating)) {
            return false;
        }

        try {
            const rating = await getStarRatingValue(item.filePath);
            if (isValidStarRating(rating)) {
                item.starRating = rating;
                scheduleUIUpdate(item.id);

                if (callbacks.onItemComplete) {
                    callbacks.onItemComplete(item);
                }

                return true;
            }
        } catch (err) {
            // Non-fatal
        }
        return false;
    };

    while (starRatingQueue.length > 0) {
        const batch = starRatingQueue.splice(0, MAX_SR_CONCURRENT);
        debouncedPersist();

        const results = await Promise.all(batch.map(id => calculateOne(id)));
        for (const found of results) {
            if (found) {
                unsavedCount++;
                totalProcessed++;
            }
        }

        updateRefreshProgress(callbacks);

        if (unsavedCount >= UI_UPDATE_BATCH_SIZE) {
            if (callbacks.saveToStorage) {
                callbacks.saveToStorage();
            }
            unsavedCount = 0;
        }

        await new Promise(r => setTimeout(r, YIELD_DELAY_MS));
    }

    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    persistStarRatingState();

    if (uiUpdateRaf) {
        cancelAnimationFrame(uiUpdateRaf);
        uiUpdateRaf = null;
    }
    flushUIUpdates();

    if (unsavedCount > 0) {
        if (callbacks.saveToStorage) {
            callbacks.saveToStorage();
        }
    }

    updateState('isCalculatingStarRating', false);
    updateState('starRatingTotal', 0);
    updateRefreshProgress(callbacks);
    localStorage.removeItem(STAR_RATING_STATE_KEY);

    // Notify if we processed any items
    if (totalProcessed > 0) {
        showNotification('Star Rating Complete', `Calculated ${totalProcessed} star rating${totalProcessed !== 1 ? 's' : ''}.`, 'success');
    }

    if (callbacks.onComplete) {
        callbacks.onComplete(totalProcessed);
    }
};

/**
 * Process both background queues
 * @param {Object} [callbacks] - Optional callbacks passed to individual processors
 */
export const processBackgroundQueues = (callbacks = {}) => {
    processStarRatingQueue(callbacks);
    processAudioQueue(callbacks);
};

/**
 * Clear all background queues
 */
export const clearBackgroundQueues = () => {
    updateState('audioAnalysisQueue', []);
    updateState('starRatingQueue', []);
    updateState('audioAnalysisTotal', 0);
    updateState('starRatingTotal', 0);
    localStorage.removeItem(AUDIO_ANALYSIS_STATE_KEY);
    localStorage.removeItem(STAR_RATING_STATE_KEY);
};

/**
 * Get queue status
 * @returns {{audio: {queueLength: number, isProcessing: boolean}, starRating: {queueLength: number, isProcessing: boolean}}} Queue status
 */
export const getQueueStatus = () => ({
    audio: {
        queueLength: audioAnalysisQueue.length,
        isProcessing: isAnalyzingAudio
    },
    starRating: {
        queueLength: starRatingQueue.length,
        isProcessing: isCalculatingStarRating
    }
});

export default {
    scheduleAudioAnalysis,
    scheduleStarRatingCalculation,
    processAudioQueue,
    processStarRatingQueue,
    processBackgroundQueues,
    queueMissingAudioAnalysisFromItems,
    queueMissingStarRatingFromItems,
    updateRefreshProgress,
    clearBackgroundQueues,
    getQueueStatus,
    MAX_AUDIO_CONCURRENT,
    MAX_SR_CONCURRENT
};
