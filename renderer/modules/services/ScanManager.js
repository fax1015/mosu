/**
 * ScanManager.js - Scan management service for streaming directory scans
 * Extracted from renderer.js (lines 4049-4231)
 */

import { tauriEvents } from '../bridge/Tauri.js';
import {
    beatmapItems,
    updateState,
    setBeatmapItems
} from '../state/Store.js';
import { isStarRatingMissing } from '../utils/Validation.js';
import { processWorkerResult } from '../itemProcessing/ItemBuilder.js';

// ============================================
// Scan State
// ============================================

/**
 * @typedef {Object} StreamingScanState
 * @property {string} directory - Scanned directory path
 * @property {Map<string, Object>} existingMap - Map of existing items by file path
 * @property {Array<Object>} items - Collected items from scan
 * @property {number} processed - Number of files processed
 * @property {number} totalFiles - Total files to process
 * @property {Function} resolveComplete - Promise resolve callback
 */

/** @type {StreamingScanState|null} */
let streamingScanState = null;

/** @type {Function|null} */
let scanBatchUnlisten = null;

/** @type {Function|null} */
let scanCompleteUnlisten = null;

/** @type {boolean} */
let isScanningActive = false;

// ============================================
// Event Listeners
// ============================================

/**
 * Initialize scan event listeners
 * @param {Object} [callbacks] - Optional callbacks
 * @param {Function} callbacks.scheduleAudioAnalysis - Function to schedule audio analysis
 * @param {Function} callbacks.scheduleStarRatingCalculation - Function to schedule star rating calculation
 * @param {Function} callbacks.updateProgress - Function to update progress UI
 * @param {Function} callbacks.setLoading - Function to set loading state
 * @param {Function} callbacks.updateTabCounts - Function to update tab counts
 * @param {Function} callbacks.renderFromState - Function to render from state
 * @param {Function} callbacks.saveToStorage - Function to save to storage
 * @param {Function} callbacks.processBackgroundQueues - Function to process background queues
 * @returns {Promise<boolean>} Whether listeners were initialized
 */
export const initScanEventListeners = async (callbacks = {}) => {
    if (!tauriEvents?.listen) return false;

    // Clean up existing listeners
    if (scanBatchUnlisten) {
        await scanBatchUnlisten();
    }
    if (scanCompleteUnlisten) {
        await scanCompleteUnlisten();
    }

    scanBatchUnlisten = await tauriEvents.listen('scan-batch', (payload) => {
        if (!streamingScanState) return;

        const { files, directory, totalFiles } = payload;

        if (directory) {
            streamingScanState.directory = directory;
        }
        if (totalFiles) {
            streamingScanState.totalFiles = totalFiles;
        }

        for (const file of files) {
            const existing = streamingScanState.existingMap.get(file.filePath);

            if (file.unchanged && existing) {
                streamingScanState.items.push(existing);
                if (existing.audio && typeof existing.durationMs !== 'number') {
                    if (callbacks.scheduleAudioAnalysis) {
                        callbacks.scheduleAudioAnalysis(existing.id);
                    }
                }
                if (isStarRatingMissing(existing.starRating)) {
                    if (callbacks.scheduleStarRatingCalculation) {
                        callbacks.scheduleStarRatingCalculation(existing.id);
                    }
                }
            } else {
                try {
                    const item = processWorkerResult(file, existing);
                    streamingScanState.items.push(item);
                } catch (err) {
                    console.error(`Failed to process beatmap: ${file.filePath}`, err);
                }
            }
        }

        streamingScanState.processed += files.length;
        if (callbacks.updateProgress) {
            callbacks.updateProgress(streamingScanState.processed, streamingScanState.totalFiles);
        }
    });

    scanCompleteUnlisten = await tauriEvents.listen('scan-complete', (payload) => {
        if (!streamingScanState) return;

        const { directory, totalFiles } = payload;

        if (directory) {
            streamingScanState.directory = directory;
            // Update lastScannedDirectory in localStorage
            localStorage.setItem('lastScannedDirectory', directory);
        }

        const items = streamingScanState.items;

        // Update beatmapItems based on directory (matching original renderer.js logic)
        if (streamingScanState.directory) {
            const normalizedDir = streamingScanState.directory.toLowerCase().replace(/\\/g, '/');
            const endWithSlash = normalizedDir.endsWith('/') ? normalizedDir : normalizedDir + '/';
            const newPaths = new Set(items.map(i => i.filePath));

            if (items.length === 0) {
                // No items - filter out items from this directory
                const keptItems = beatmapItems.filter(item => {
                    const itemPath = item.filePath.toLowerCase().replace(/\\/g, '/');
                    return !itemPath.startsWith(endWithSlash);
                });
                setBeatmapItems(keptItems);
            } else {
                // Replace items from this directory with new items
                const keptItems = beatmapItems.filter(i => !newPaths.has(i.filePath));
                setBeatmapItems([...keptItems, ...items]);
            }
        } else {
            // No directory - just merge items
            const newPaths = new Set(items.map(i => i.filePath));
            const keptItems = beatmapItems.filter(i => !newPaths.has(i.filePath));
            setBeatmapItems([...keptItems, ...items]);
        }

        // Call callbacks
        if (callbacks.updateTabCounts) {
            callbacks.updateTabCounts();
        }
        if (callbacks.renderFromState) {
            callbacks.renderFromState();
        }
        if (callbacks.saveToStorage) {
            callbacks.saveToStorage();
        }
        if (callbacks.queueMissingAudioAnalysis) {
            callbacks.queueMissingAudioAnalysis(items);
        }
        if (callbacks.queueMissingStarRating) {
            callbacks.queueMissingStarRating(items);
        }
        if (callbacks.processBackgroundQueues) {
            callbacks.processBackgroundQueues();
        }
        if (callbacks.setLoading) {
            callbacks.setLoading(false);
        }

        if (streamingScanState.resolveComplete) {
            streamingScanState.resolveComplete(items);
        }
        streamingScanState = null;
        isScanningActive = false;
    });

    return true;
};

// ============================================
// Scan Management
// ============================================

/**
 * Start a streaming scan
 * @param {string} [mode='directory'] - Scan mode
 * @param {Object} [options] - Scan options
 * @param {Map} [options.existingItemsMap] - Map of existing items
 * @param {Object} [options.callbacks] - Callbacks for UI updates
 * @returns {Promise<Array<Object>>} Promise that resolves with scanned items
 */
export const startStreamingScan = (mode = 'directory', options = {}) => {
    const existingMap = options.existingItemsMap instanceof Map
        ? options.existingItemsMap
        : new Map();

    if (!(options.existingItemsMap instanceof Map)) {
        beatmapItems.forEach(item => {
            if (item.filePath) existingMap.set(item.filePath, item);
        });
    }

    return new Promise((resolve) => {
        streamingScanState = {
            directory: '',
            existingMap,
            items: [],
            processed: 0,
            totalFiles: 0,
            resolveComplete: resolve,
        };
        isScanningActive = true;
        
        // Set initial loading state (matching original renderer.js)
        if (options.callbacks?.setLoading) {
            options.callbacks.setLoading(true);
        }
        if (options.callbacks?.updateProgress) {
            options.callbacks.updateProgress(0, 0);
        }
    });
};

/**
 * Load beatmaps from scan result
 * @param {Object} result - Scan result object
 * @param {Array<Object>} result.files - Array of scanned files
 * @param {string} [result.directory] - Scanned directory
 * @param {Object} [callbacks] - Optional callbacks
 * @param {Function} callbacks.setLoading - Set loading state
 * @param {Function} callbacks.updateProgress - Update progress UI
 * @param {Function} callbacks.updateTabCounts - Update tab counts
 * @param {Function} callbacks.renderFromState - Render from state
 * @param {Function} callbacks.saveToStorage - Save to storage
 * @param {Function} callbacks.queueMissingAudioAnalysis - Queue missing audio analysis
 * @param {Function} callbacks.queueMissingStarRating - Queue missing star rating
 * @param {Function} callbacks.processBackgroundQueues - Process background queues
 * @param {Map} [existingItemsMapOverride] - Override existing items map
 */
export const loadBeatmapsFromResult = async (result, callbacks = {}, existingItemsMapOverride) => {
    // For streaming scans, the IPC returns empty files array.
    // The real data comes via scan-batch/scan-complete events.
    // If we got actual files (e.g. from a non-streaming source), process them directly.
    if (result && Array.isArray(result.files) && result.files.length > 0) {
        const listContainer = document.querySelector('#listContainer');
        if (!listContainer) return;

        if (callbacks.setLoading) {
            callbacks.setLoading(true);
        }

        try {
            const existingItemsMap = existingItemsMapOverride instanceof Map
                ? existingItemsMapOverride
                : new Map();

            if (!(existingItemsMapOverride instanceof Map)) {
                beatmapItems.forEach(item => {
                    if (item.filePath) existingItemsMap.set(item.filePath, item);
                });
            }

            const items = [];
            for (const file of result.files) {
                const existing = existingItemsMap.get(file.filePath);
                if (file.unchanged && existing) {
                    items.push(existing);
                } else {
                    try {
                        items.push(processWorkerResult(file, existing));
                    } catch (err) {
                        console.error(`Failed to process beatmap: ${file.filePath}`, err);
                    }
                }
            }

            // Update beatmap items, replacing items from the same directory
            if (result.directory) {
                const normalizedDir = result.directory.toLowerCase().replace(/\\/g, '/');
                const endWithSlash = normalizedDir.endsWith('/') ? normalizedDir : normalizedDir + '/';
                const newPaths = new Set(items.map(i => i.filePath));

                if (items.length === 0) {
                    const keptItems = beatmapItems.filter(item => {
                        const itemPath = item.filePath.toLowerCase().replace(/\\/g, '/');
                        return !itemPath.startsWith(endWithSlash);
                    });
                    setBeatmapItems(keptItems);
                } else {
                    const keptItems = beatmapItems.filter(i => !newPaths.has(i.filePath));
                    setBeatmapItems([...keptItems, ...items]);
                }
            } else {
                const newPaths = new Set(items.map(i => i.filePath));
                const keptItems = beatmapItems.filter(i => !newPaths.has(i.filePath));
                setBeatmapItems([...keptItems, ...items]);
            }

            if (callbacks.updateTabCounts) {
                callbacks.updateTabCounts();
            }
            if (callbacks.renderFromState) {
                callbacks.renderFromState();
            }
            if (callbacks.saveToStorage) {
                callbacks.saveToStorage();
            }
            if (callbacks.queueMissingAudioAnalysis) {
                callbacks.queueMissingAudioAnalysis(items);
            }
            if (callbacks.queueMissingStarRating) {
                callbacks.queueMissingStarRating(items);
            }
            if (callbacks.processBackgroundQueues) {
                callbacks.processBackgroundQueues();
            }
        } catch (err) {
            console.error('loadBeatmapsFromResult failed:', err);
        } finally {
            if (callbacks.setLoading) {
                callbacks.setLoading(false);
            }
        }
    }
    // If files array is empty, streaming events handle everything
};

/**
 * Check if a scan is currently in progress
 * @returns {boolean} Whether scanning is active
 */
export const isScanning = () => {
    return isScanningActive || streamingScanState !== null;
};

/**
 * Cancel the current scan
 */
export const cancelScan = () => {
    if (streamingScanState && streamingScanState.resolveComplete) {
        streamingScanState.resolveComplete([]);
    }
    streamingScanState = null;
    isScanningActive = false;
};

/**
 * Get scan progress statistics
 * @returns {{processed: number, total: number, directory: string, percent: number}|null} Scan stats
 */
export const getScanStats = () => {
    if (!streamingScanState) return null;

    const { processed, totalFiles, directory } = streamingScanState;
    const percent = totalFiles > 0 ? Math.round((processed / totalFiles) * 100) : 0;

    return {
        processed,
        total: totalFiles,
        directory,
        percent
    };
};

/**
 * Clean up scan event listeners
 * @returns {Promise<void>}
 */
export const cleanupScanListeners = async () => {
    if (scanBatchUnlisten) {
        await scanBatchUnlisten();
        scanBatchUnlisten = null;
    }
    if (scanCompleteUnlisten) {
        await scanCompleteUnlisten();
        scanCompleteUnlisten = null;
    }
};

export default {
    initScanEventListeners,
    startStreamingScan,
    loadBeatmapsFromResult,
    isScanning,
    cancelScan,
    getScanStats,
    cleanupScanListeners
};
