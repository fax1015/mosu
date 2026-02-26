/**
 * EmbedSync.js - Embed sync service for syncing data to external embed site
 * Extracted from renderer.js (lines 2829-3032)
 */

import { embedSyncApi } from '../bridge/Tauri.js';
import {
    beatmapItems,
    todoIds,
    doneIds,
    settings,
    updateSettings
} from '../state/Store.js';
import { showNotification } from '../components/NotificationSystem.js';
import { generateApiKey } from '../utils/Helpers.js';

// ============================================
// Constants
// ============================================

/** @type {number} Rate limit between syncs in milliseconds */
export const EMBED_SYNC_RATE_LIMIT_MS = 30000; // 30 seconds

// ============================================
// State
// ============================================

/** @type {number|null} */
let embedSyncTimer = null;

/** @type {number} */
let lastEmbedSyncTime = 0;

// ============================================
// Payload Building
// ============================================

/**
 * Build the condensed embed payload from current data
 * @param {Array<Object>} [beatmapItemsOverride] - Override beatmap items (optional)
 * @param {Object} [settingsOverride] - Override settings (optional)
 * @returns {Object} Embed payload object
 */
export const buildEmbedPayload = (beatmapItemsOverride, settingsOverride) => {
    const items = beatmapItemsOverride || beatmapItems;
    const s = settingsOverride || settings;
    const configuredName = String(s.embedDisplayName || '').trim();

    const todoItems = todoIds
        .map(id => items.find(item => item.id === id))
        .filter(Boolean)
        .map(item => ({
            id: item.id,
            title: item.title || 'Unknown',
            artist: item.artist || 'Unknown',
            creator: item.creator || 'Unknown',
            version: item.version || 'Unknown',
            progress: item.progress || 0,
            deadline: item.deadline || null,
            beatmapSetID: item.beatmapSetID || null,
            coverUrl: item.beatmapSetID ? `https://assets.ppy.sh/beatmaps/${item.beatmapSetID}/covers/cover.jpg` : null
        }));

    const completedItems = doneIds
        .map(id => items.find(item => item.id === id))
        .filter(Boolean)
        .map(item => ({
            id: item.id,
            title: item.title || 'Unknown',
            artist: item.artist || 'Unknown',
            creator: item.creator || 'Unknown',
            version: item.version || 'Unknown',
            progress: 100,
            beatmapSetID: item.beatmapSetID || null,
            coverUrl: item.beatmapSetID ? `https://assets.ppy.sh/beatmaps/${item.beatmapSetID}/covers/cover.jpg` : null
        }));

    const totalProgress = items.length > 0
        ? items.reduce((sum, item) => sum + (item.progress || 0), 0) / items.length
        : 0;

    return {
        version: 1,
        userid: s.userId,
        mapperName: configuredName || s.mapperAliases?.[0] || String(s.rescanMapperName || '').trim() || null,
        lastUpdated: new Date().toISOString(),
        settings: {
            showTodoList: s.embedShowTodoList,
            showCompletedList: s.embedShowCompletedList,
            showProgressStats: s.embedShowProgressStats
        },
        stats: {
            totalMaps: items.length,
            todoCount: todoIds.length,
            completedCount: doneIds.length,
            overallProgress: Math.round(totalProgress * 10) / 10
        },
        todoItems,
        completedItems
    };
};

// ============================================
// Sync Status
// ============================================

/**
 * Update sync status UI
 * @param {string} status - Status: 'syncing' | 'synced' | 'error' | 'idle'
 * @param {string|null} [message] - Error message or additional info
 */
export const updateEmbedSyncStatus = (status, message = null) => {
    const syncBtn = document.querySelector('#embedSyncNowBtn');
    const lastSyncEl = document.querySelector('#embedLastSynced');

    if (syncBtn) {
        // Clear previous status classes
        syncBtn.classList.remove('status-syncing', 'status-synced', 'status-error');

        if (status === 'syncing') {
            syncBtn.classList.add('status-syncing');
            syncBtn.textContent = 'Syncing...';
            syncBtn.dataset.tooltip = 'Syncing with embed tracker...';
        } else if (status === 'synced') {
            syncBtn.classList.add('status-synced');
            syncBtn.textContent = 'Synced';
            syncBtn.dataset.tooltip = 'Successfully synced!';

            // Reset to default state after 5 seconds
            setTimeout(() => {
                if (syncBtn.classList.contains('status-synced') && !syncBtn.disabled) {
                    syncBtn.classList.remove('status-synced');
                    syncBtn.textContent = 'Sync Now';
                    syncBtn.dataset.tooltip = 'Sync embed now';
                }
            }, 5000);
        } else if (status === 'error') {
            syncBtn.classList.add('status-error');
            syncBtn.textContent = `Error: ${message}`; // Prepend "Error: " to the reason
            syncBtn.dataset.tooltip = `Error: ${message}. Click to try again.`;

            // Reset to default state after 5 seconds
            setTimeout(() => {
                if (syncBtn.classList.contains('status-error') && !syncBtn.disabled) {
                    syncBtn.classList.remove('status-error');
                    syncBtn.textContent = 'Sync Now';
                    syncBtn.dataset.tooltip = 'Sync embed now';
                }
            }, 5000);
        } else {
            syncBtn.textContent = 'Sync Now';
            syncBtn.dataset.tooltip = 'Sync embed now';
        }
    }

    if (lastSyncEl && settings.embedLastSynced) {
        const date = new Date(settings.embedLastSynced);
        lastSyncEl.textContent = `Last synced: ${date.toLocaleString()}`;
    }
};

// ============================================
// Sync Execution
// ============================================

/**
 * Perform the sync to the embed site
 * @param {Object} [callbacks] - Optional callbacks
 * @param {Function} callbacks.onSuccess - Called when sync succeeds
 * @param {Function} callbacks.onError - Called when sync fails
 * @param {Function} callbacks.persistSettings - Function to persist settings
 */
export const performEmbedSync = async (callbacks = {}) => {
    if (!settings.embedApiKey) {
        updateSettings({ embedApiKey: generateApiKey() });
        if (callbacks.persistSettings) {
            callbacks.persistSettings();
        }
    }

    const payload = buildEmbedPayload();
    const syncUrl = `${settings.embedSyncUrl}/api/sync`;
    const syncBtn = document.querySelector('#embedSyncNowBtn');

    if (syncBtn) {
        syncBtn.disabled = true;
        updateEmbedSyncStatus('syncing');
    }

    console.log('Starting embed sync to:', syncUrl);

    try {
        const result = await embedSyncApi.sync(syncUrl, settings.embedApiKey, payload);

        console.log('Sync result:', result);

        if (result.success && (result.data?.success || result.data === true)) {
            updateSettings({ embedLastSynced: Date.now() });
            if (callbacks.persistSettings) {
                callbacks.persistSettings();
            }
            updateEmbedSyncStatus('synced');
            showNotification('Sync Complete', 'Embed tracker has been updated.', 'success');

            if (callbacks.onSuccess) {
                callbacks.onSuccess(result);
            }
        } else {
            let errorMsg = result.data?.error || result.error || 'Sync Failed';

            // Handle specific HTTP status codes
            if (result.status === 429) {
                errorMsg = 'Rate Limited';
            } else if (result.status === 401 || result.status === 403) {
                errorMsg = 'Invalid API Key';
            } else if (result.status === 404) {
                errorMsg = 'Invalid URL';
            } else if (result.status >= 500) {
                errorMsg = 'Server Error';
            }

            console.error('Embed sync failed:', errorMsg, result);
            updateEmbedSyncStatus('error', errorMsg);
            showNotification('Sync Failed', errorMsg, 'error');

            if (callbacks.onError) {
                callbacks.onError(errorMsg, result);
            }
        }
    } catch (err) {
        console.error('Embed sync error:', err);
        updateEmbedSyncStatus('error', 'Network Error');
        showNotification('Sync Failed', 'Network error - check your connection.', 'error');

        if (callbacks.onError) {
            callbacks.onError('Network Error', err);
        }
    } finally {
        if (syncBtn) {
            syncBtn.disabled = false;
        }
    }
};

/**
 * Schedule embed sync with rate limiting
 * @param {Object} [callbacks] - Optional callbacks passed to performEmbedSync
 */
export const scheduleEmbedSync = (callbacks = {}) => {
    if (embedSyncTimer) {
        clearTimeout(embedSyncTimer);
    }

    const timeSinceLastSync = Date.now() - lastEmbedSyncTime;
    const delay = Math.max(0, EMBED_SYNC_RATE_LIMIT_MS - timeSinceLastSync);

    embedSyncTimer = setTimeout(() => {
        lastEmbedSyncTime = Date.now();
        performEmbedSync(callbacks);
    }, delay);
};

/**
 * Manual sync trigger
 * @param {Object} [callbacks] - Optional callbacks passed to performEmbedSync
 */
export const triggerManualSync = async (callbacks = {}) => {
    updateEmbedSyncStatus('syncing');
    lastEmbedSyncTime = 0; // Reset rate limit for manual sync
    await performEmbedSync(callbacks);
};

/**
 * Check if sync is possible (has userId and API key)
 * @returns {boolean} Whether sync can be performed
 */
export const canSync = () => {
    return !!(settings.userId && settings.embedApiKey);
};

/**
 * Cancel any pending scheduled sync
 */
export const cancelScheduledSync = () => {
    if (embedSyncTimer) {
        clearTimeout(embedSyncTimer);
        embedSyncTimer = null;
    }
};

/**
 * Get sync status
 * @returns {{lastSyncTime: number, isScheduled: boolean, timeUntilNextSync: number}} Sync status
 */
export const getSyncStatus = () => {
    const now = Date.now();
    const timeSinceLastSync = now - lastEmbedSyncTime;
    const timeUntilNextSync = Math.max(0, EMBED_SYNC_RATE_LIMIT_MS - timeSinceLastSync);

    return {
        lastSyncTime: lastEmbedSyncTime,
        isScheduled: embedSyncTimer !== null,
        timeUntilNextSync
    };
};

export default {
    buildEmbedPayload,
    performEmbedSync,
    scheduleEmbedSync,
    updateEmbedSyncStatus,
    triggerManualSync,
    canSync,
    cancelScheduledSync,
    getSyncStatus,
    EMBED_SYNC_RATE_LIMIT_MS
};
