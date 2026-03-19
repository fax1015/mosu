/**
 * Persistence.js - State persistence module
 * Handles localStorage operations for saving/loading app state
 * Extracted from renderer.js
 */

import {
    STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    AUDIO_ANALYSIS_STATE_KEY,
    STAR_RATING_STATE_KEY,
    STORAGE_VERSION
} from '../config/Constants.js';

import {
    isValidStarRating,
    isStarRatingMissing
} from '../utils/Validation.js';

import {
    serializeHighlights,
    deserializeHighlights,
    computeProgress
} from '../utils/Helpers.js';

import {
    beatmapItems,
    todoIds,
    doneIds,
    sortState,
    modeFilter,
    settings,
    audioAnalysisQueue,
    audioAnalysisTotal,
    starRatingQueue,
    starRatingTotal,
    saveTimer,
    setBeatmapItems,
    setTodoIds,
    setDoneIds,
    setSortState,
    setModeFilter,
    setSaveTimer,
    setAudioAnalysisQueue,
    setAudioAnalysisTotal,
    setStarRatingQueue,
    setStarRatingTotal
} from './Store.js';

// ============================================
// Web Worker for Offloading JSON.stringify
// ============================================

let storageWorker = null;
let workerMessageId = 0;
const pendingWorkerMessages = new Map();

/**
 * Initialize the storage worker lazily
 * @returns {Worker|null} The worker instance or null if not supported
 */
function getStorageWorker() {
    if (!storageWorker) {
        try {
            storageWorker = new Worker('./renderer/modules/workers/StorageWorker.js');
            storageWorker.onmessage = handleWorkerMessage;
            storageWorker.onerror = handleWorkerError;
        } catch (e) {
            // Worker creation failed (e.g., not supported), will fallback to main thread
            storageWorker = null;
        }
    }
    return storageWorker;
}

/**
 * Handle messages from the storage worker
 * @param {MessageEvent} event - The message event from the worker
 */
function handleWorkerMessage(event) {
    const { result, error, id } = event.data;
    const pending = pendingWorkerMessages.get(id);

    if (!pending) return;

    pendingWorkerMessages.delete(id);

    if (error) {
        // Worker failed, fallback to main thread
        pending.fallback();
    } else {
        // Success - save the stringified result
        try {
            localStorage.setItem(STORAGE_KEY, result);
        } catch (storageError) {
            // Storage may be full
            pending.handleStorageError(storageError);
        }
    }
}

/**
 * Handle worker errors
 * @param {ErrorEvent} event - The error event from the worker
 */
function handleWorkerError(event) {
    // On worker error, fail all pending operations and fallback to main thread
    pendingWorkerMessages.forEach((pending) => {
        pending.fallback();
    });
    pendingWorkerMessages.clear();

    // Disable worker for future operations
    if (storageWorker) {
        storageWorker.terminate();
        storageWorker = null;
    }
}

// ============================================
// Save to Storage
// ============================================

/**
 * Save current beatmap state to localStorage
 * @param {Object} options - Options object
 * @param {Function} options.showNotification - Callback to show notifications
 */
export function saveToStorage({ showNotification } = {}) {
    const payload = {
        version: STORAGE_VERSION,
        todoIds,
        doneIds,
        sortState: {
            mode: sortState.mode,
            direction: sortState.direction
        },
        modeFilter,
        items: beatmapItems.map((item) => ({
            id: item.id,
            filePath: item.filePath,
            dateAdded: item.dateAdded,
            dateModified: item.dateModified,
            title: item.title,
            titleUnicode: item.titleUnicode,
            artist: item.artist,
            artistUnicode: item.artistUnicode,
            creator: item.creator,
            version: item.version,
            beatmapSetID: item.beatmapSetID,
            mode: Number.isFinite(item.mode) ? Math.min(Math.max(item.mode, 0), 3) : 0,
            starRating: isValidStarRating(item.starRating) ? item.starRating : null,
            audio: item.audio || '',
            audioFileName: item.audioFileName || '',
            beatmapHash: item.beatmapHash || '',
            deadline: (typeof item.deadline === 'number' || item.deadline === null) ? item.deadline : null,
            targetStarRating: (typeof item.targetStarRating === 'number' || item.targetStarRating === null) ? item.targetStarRating : null,
            durationMs: (typeof item.durationMs === 'number') ? item.durationMs : null,
            previewTime: item.previewTime ?? -1,
            coverPath: item.coverPath || '',
            highlights: serializeHighlights(item.highlights || []),
            progress: item.progress || 0,
            notes: item.notes || '',
        })),
    };

    // Helper to handle storage errors
    const handleStorageError = (error) => {
        // Storage may be full
        if (showNotification) {
            showNotification('Storage Full', 'Could not save data. Try clearing some beatmaps.', 'error');
        }
    };

    // Helper for main thread fallback stringify
    const fallbackToMainThread = () => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (error) {
            handleStorageError(error);
        }
    };

    // Try to use Web Worker for JSON.stringify to avoid blocking main thread
    const worker = getStorageWorker();
    if (worker) {
        const id = ++workerMessageId;

        // Store pending operation for callback handling
        pendingWorkerMessages.set(id, {
            fallback: fallbackToMainThread,
            handleStorageError: handleStorageError
        });

        // Post payload to worker for stringification
        worker.postMessage({ payload, id });
    } else {
        // Worker not available, fallback to main thread
        fallbackToMainThread();
    }
}

/**
 * Schedule a debounced save (500ms delay)
 * @param {Object} options - Options object
 * @param {Function} options.scheduleEmbedSync - Callback to schedule embed sync
 */
export function scheduleSave({ scheduleEmbedSync } = {}) {
    if (saveTimer) {
        window.clearTimeout(saveTimer);
    }
    const timer = window.setTimeout(() => {
        saveToStorage();
        // Trigger embed sync after save (rate-limited)
        if (settings.embedApiKey && scheduleEmbedSync) {
            scheduleEmbedSync();
        }
    }, 500);
    setSaveTimer(timer);
}

// ============================================
// Load from Storage
// ============================================

/**
 * Build a beatmap item from cached storage data
 * @param {Object} cached - Cached item data
 * @returns {Object} Reconstructed beatmap item
 */
function buildItemFromCache(cached) {
    const highlights = cached.highlights ? deserializeHighlights(cached.highlights) : [];
    const isLazerClient = settings?.osuClient === 'lazer';
    const rawBeatmapSetId = String(cached?.beatmapSetID || '').trim();
    const beatmapSetIdMatch = rawBeatmapSetId.match(/beatmapsets\/(\d+)/i);
    const beatmapSetIdNumber = beatmapSetIdMatch?.[1] || (/^\d+$/.test(rawBeatmapSetId) ? rawBeatmapSetId : '');

    return {
        ...cached,
        audio: cached.audio || '',
        coverPath: isLazerClient ? '' : (cached.coverPath || ''),
        beatmapHash: cached.beatmapHash || (
            isLazerClient
                ? String(cached?.filePath || '').replace(/\\/g, '/').split('/').pop()?.toLowerCase() || ''
                : ''
        ),
        durationMs: (typeof cached.durationMs === 'number') ? cached.durationMs : null,
        coverUrl: isLazerClient && beatmapSetIdNumber
            ? `https://assets.ppy.sh/beatmaps/${beatmapSetIdNumber}/covers/cover.jpg`
            : '', // Let UI calculate this via beatmapApi.convertFileSrc
        highlights,
        progress: computeProgress(highlights, settings),
        dateModified: cached.dateModified ?? 0,
        id: cached.id ?? createItemId(cached.filePath),
        starRating: isValidStarRating(cached.starRating) ? cached.starRating : null,
        mode: Number.isFinite(cached.mode) ? Math.min(Math.max(cached.mode, 0), 3) : 0,
        progressPending: Boolean(cached.progressPending) || (Boolean(cached.audio) && typeof cached.durationMs !== 'number'),
    };
}

/**
 * Generate a unique item ID from a seed string
 * @param {string} seed - Seed string (usually file path)
 * @returns {string} Unique item ID
 */
function createItemId(seed) {
    if (!seed) return `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // Simple hash of the seed string
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        const char = seed.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return `${Math.abs(hash).toString(16)}-${Date.now().toString(16)}`;
}

/**
 * Load and restore state from localStorage
 * @param {Object} callbacks - Callback functions for UI updates
 * @param {Function} callbacks.updateTabCounts - Update tab counts UI
 * @param {Function} callbacks.updateSortUI - Update sort UI
 * @param {Function} callbacks.renderFromState - Render list from current state
 * @param {Function} callbacks.restoreAudioAnalysisStateFromStorage - Restore audio analysis queue
 * @param {Function} callbacks.restoreStarRatingStateFromStorage - Restore star rating queue
 * @param {Function} callbacks.queueMissingAudioAnalysisFromItems - Queue missing audio analysis
 * @param {Function} callbacks.queueMissingStarRatingFromItems - Queue missing star rating
 * @param {Function} callbacks.processBackgroundQueues - Process background queues
 * @returns {Promise<void>}
 */
export async function loadFromStorage(callbacks = {}) {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        return;
    }
    let stored = null;
    try {
        stored = JSON.parse(raw);
    } catch (error) {
        return;
    }
    if (!stored || stored.version !== STORAGE_VERSION || !Array.isArray(stored.items)) {
        return;
    }

    setTodoIds(stored.todoIds || []);
    setDoneIds(stored.doneIds || []);
    if (stored.sortState && typeof stored.sortState === 'object') {
        setSortState({
            mode: stored.sortState.mode || 'dateAdded',
            direction: stored.sortState.direction || 'desc'
        });
    }
    setModeFilter(
        stored.modeFilter === 'standard' ||
            stored.modeFilter === 'taiko' ||
            stored.modeFilter === 'catch' ||
            stored.modeFilter === 'mania'
            ? stored.modeFilter
            : 'all'
    );

    if (callbacks.updateTabCounts) callbacks.updateTabCounts();
    if (callbacks.updateSortUI) callbacks.updateSortUI();

    // Instant restore: trust the cache, no IPC calls per item
    // Cover images are deferred to the lazy load queue
    const items = [];
    for (const cached of stored.items) {
        if (!cached?.filePath) continue;
        items.push(buildItemFromCache(cached));
    }

    setBeatmapItems(items);

    if (callbacks.updateTabCounts) callbacks.updateTabCounts();
    if (callbacks.renderFromState) callbacks.renderFromState();

    // Resume interrupted background analysis first, then queue any newly-missing data
    if (callbacks.restoreAudioAnalysisStateFromStorage) {
        callbacks.restoreAudioAnalysisStateFromStorage();
    }
    if (callbacks.restoreStarRatingStateFromStorage) {
        callbacks.restoreStarRatingStateFromStorage();
    }

    // Queue background analysis for missing item metadata
    if (callbacks.queueMissingAudioAnalysisFromItems) {
        callbacks.queueMissingAudioAnalysisFromItems(beatmapItems);
    }
    if (callbacks.queueMissingStarRatingFromItems) {
        callbacks.queueMissingStarRatingFromItems(beatmapItems);
    }
    if (callbacks.processBackgroundQueues) {
        callbacks.processBackgroundQueues();
    }
}

// ============================================
// Settings Persistence
// ============================================

/**
 * Persist settings to localStorage
 */
export function persistSettings() {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (e) { /* storage full */ }
}

// ============================================
// Audio Analysis State Persistence
// ============================================

/**
 * Save audio analysis queue state to localStorage
 */
export function persistAudioAnalysisState() {
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
}

/**
 * Restore audio analysis queue from localStorage
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.updateRefreshProgress - Update refresh progress UI
 */
export function restoreAudioAnalysisStateFromStorage(callbacks = {}) {
    try {
        const raw = localStorage.getItem(AUDIO_ANALYSIS_STATE_KEY);
        if (!raw) return;
        const state = JSON.parse(raw);
        if (!state || !Array.isArray(state.queue)) return;

        const previousQueueLen = state.queue.length;
        const previousTotal = Number(state.total) || 0;
        const previousCompleted = Math.max(0, previousTotal - previousQueueLen);

        const validQueue = [];
        const seen = new Set();
        for (const id of state.queue) {
            if (!id || seen.has(id)) continue;
            const item = beatmapItems.find(i => i.id === id);
            if (item && item.audio && item.filePath && typeof item.durationMs !== 'number') {
                validQueue.push(id);
                seen.add(id);
            }
        }

        if (!validQueue.length) {
            localStorage.removeItem(AUDIO_ANALYSIS_STATE_KEY);
            return;
        }

        setAudioAnalysisQueue(validQueue);
        setAudioAnalysisTotal(previousCompleted + validQueue.length);
        if (callbacks.updateRefreshProgress) {
            callbacks.updateRefreshProgress(previousCompleted, audioAnalysisTotal);
        }
    } catch (e) {
        // Ignore malformed state.
    }
}

// ============================================
// Star Rating State Persistence
// ============================================

/**
 * Save star rating queue state to localStorage
 */
export function persistStarRatingState() {
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
}

/**
 * Restore star rating queue from localStorage
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.updateRefreshProgress - Update refresh progress UI
 */
export function restoreStarRatingStateFromStorage(callbacks = {}) {
    try {
        const raw = localStorage.getItem(STAR_RATING_STATE_KEY);
        if (!raw) return;

        const state = JSON.parse(raw);
        if (!state || !Array.isArray(state.queue)) return;

        const previousQueueLen = state.queue.length;
        const previousTotal = Number(state.total) || 0;
        const previousCompleted = Math.max(0, previousTotal - previousQueueLen);

        const validQueue = [];
        const seen = new Set();
        for (const id of state.queue) {
            if (!id || seen.has(id)) continue;
            const item = beatmapItems.find(i => i.id === id);
            if (item && item.filePath && isStarRatingMissing(item.starRating)) {
                validQueue.push(id);
                seen.add(id);
            }
        }

        if (!validQueue.length) {
            localStorage.removeItem(STAR_RATING_STATE_KEY);
            return;
        }

        setStarRatingQueue(validQueue);
        setStarRatingTotal(previousCompleted + validQueue.length);
        if (callbacks.updateRefreshProgress) {
            callbacks.updateRefreshProgress();
        }
    } catch (e) {
        // Ignore malformed state.
    }
}

// ============================================
// Clear All Data
// ============================================

/**
 * Clear all persisted data from localStorage
 */
export function clearAllStorage() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    localStorage.removeItem(AUDIO_ANALYSIS_STATE_KEY);
    localStorage.removeItem(STAR_RATING_STATE_KEY);
}

// ============================================
// Legacy Storage Migration (if needed in future)
// ============================================

/**
 * Check if storage migration is needed
 * @returns {boolean} True if migration is needed
 */
export function needsMigration() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    try {
        const stored = JSON.parse(raw);
        return stored && stored.version !== STORAGE_VERSION;
    } catch {
        return false;
    }
}
