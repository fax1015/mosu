/**
 * DirectoryScanner.js - File operations and directory scanning module
 * Extracted from renderer.js (lines 3998-4047, 4232-4347)
 */

import { beatmapApi } from '../bridge/Tauri.js';
import {
    settings,
    setBeatmapItems,
    beatmapItems
} from '../state/Store.js';
import { scheduleSave, persistSettings } from '../state/Persistence.js';
import { startStreamingScan } from '../services/ScanManager.js';
import {
    queueMissingAudioAnalysisFromItems,
    queueMissingStarRatingFromItems
} from '../services/BackgroundProcessor.js';
import { buildItemFromContent } from '../itemProcessing/ItemBuilder.js';
import { getEffectiveMapperName, processMapperInput } from '../parsers/GuestDifficultyFilter.js';
import { closeDialogWithAnimation as defaultCloseDialogWithAnimation } from '../ui/DialogManager.js';

// ============================================
// State
// ============================================

/** @type {string|null} Last scanned directory path */
let lastScannedDirectory = localStorage.getItem('lastScannedDirectory') || null;

// ============================================
// Directory Getters/Setters
// ============================================

/**
 * Get the last scanned directory
 * @returns {string|null} Last scanned directory path
 */
export function getLastScannedDirectory() {
    return lastScannedDirectory;
}

/**
 * Set the last scanned directory
 * @param {string|null} dir - Directory path
 */
export function setLastScannedDirectory(dir) {
    lastScannedDirectory = dir;
    if (dir) {
        localStorage.setItem('lastScannedDirectory', dir);
    } else {
        localStorage.removeItem('lastScannedDirectory');
    }
}

/**
 * Validate the songs directory setting
 * @param {Object} settingsObj - Settings object
 * @returns {boolean} Whether the songs directory is valid
 */
export function validateSongsDir(settingsObj) {
    return !!(settingsObj?.songsDir && typeof settingsObj.songsDir === 'string');
}

// ============================================
// File Import Functions
// ============================================

/**
 * Load beatmaps from file dialog (single or multiple file import)
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.setLoading - Set loading state
 * @param {Function} callbacks.updateEmptyState - Update empty state UI
 * @param {Function} callbacks.updateTabCounts - Update tab counts
 * @param {Function} callbacks.renderFromState - Render from current state
 * @param {Function} callbacks.processBackgroundQueues - Process background queues
 */
export async function loadBeatmapFromDialog(callbacks) {
    if (!beatmapApi?.openOsuFile) {
        return;
    }

    const {
        setLoading,
        updateEmptyState,
        updateTabCounts,
        renderFromState,
        processBackgroundQueues
    } = callbacks;

    let didSetLoading = false;
    try {
        const result = await beatmapApi.openOsuFile();
        if (!result || !result.files || !result.files.length) {
            if (updateEmptyState) {
                updateEmptyState();
            }
            return;
        }

        if (setLoading) {
            setLoading(true);
        }
        didSetLoading = true;

        const items = [];
        for (const file of result.files) {
            if (!file?.content) {
                continue;
            }

            const item = await buildItemFromContent(
                file.filePath,
                file.content,
                file.stat,
                null
            );
            items.push(item);
        }

        if (!items.length) {
            if (updateEmptyState) {
                updateEmptyState();
            }
            return;
        }

        // Update global state
        const newItems = [...beatmapItems, ...items];
        setBeatmapItems(newItems);

        if (updateTabCounts) {
            updateTabCounts();
        }
        if (renderFromState) {
            renderFromState();
        }

        // Queue background processing
        queueMissingAudioAnalysisFromItems(items);
        queueMissingStarRatingFromItems(items);

        // Save and process
        scheduleSave();
        if (processBackgroundQueues) {
            processBackgroundQueues();
        }
    } finally {
        if (didSetLoading && setLoading) {
            setLoading(false);
        }
    }
}

/**
 * Refresh the last scanned directory
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.setLoading - Set loading state
 * @param {Function} callbacks.updateEmptyState - Update empty state UI
 * @param {Function} callbacks.showNotification - Show notification
 * @param {Function} callbacks.loadBeatmapsFromFolder - Fallback to folder picker
 * @param {Function} callbacks.updateRefreshProgress - Update refresh button progress
 */
export async function refreshLastDirectory(callbacks = {}) {
    const targetDir = settings.songsDir || lastScannedDirectory;

    if (!targetDir || !beatmapApi?.scanDirectoryOsuFiles) {
        if (callbacks.loadBeatmapsFromFolder) {
            await loadBeatmapsFromFolder(callbacks);
        }
        return;
    }

    const refreshBtn = document.querySelector('#refreshBtn');
    if (refreshBtn) {
        refreshBtn.classList.add('is-refreshing');
    }

    try {
        const mapperName = (getEffectiveMapperName() || '').trim() || null;

        // Build knownFiles cache (path -> mtime)
        const knownFiles = {};
        beatmapItems.forEach(item => {
            if (item.filePath) {
                knownFiles[item.filePath] = item.dateModified;
            }
        });

        // Start streaming scan — results arrive via scan-batch events
        const scanDone = startStreamingScan('directory', { callbacks });
        await beatmapApi.scanDirectoryOsuFiles(targetDir, mapperName, knownFiles);
        await scanDone;

        // Success animation
        if (refreshBtn) {
            refreshBtn.style.transform = 'scale(1.2)';
            setTimeout(() => {
                refreshBtn.style.transform = '';
            }, 200);
        }
    } catch (error) {
        console.error('Refresh failed:', error);
        if (callbacks.showNotification) {
            callbacks.showNotification('Scan Failed', error.message || 'Failed to scan directory.', 'error');
        }
        throw error;
    } finally {
        if (refreshBtn) {
            refreshBtn.classList.remove('is-refreshing');
        }
    }
}

/**
 * Load beatmaps by mapper name
 * @param {string} mapperName - Mapper name to filter by
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.setLoading - Set loading state
 * @param {Function} callbacks.closeDialogWithAnimation - Close dialog helper
 * @param {Function} callbacks.showNotification - Show notification
 */
export async function loadBeatmapsByMapper(mapperName, callbacks = {}) {
    if (!beatmapApi?.openMapperOsuFiles) {
        return;
    }

    const previousMapperName = (settings.rescanMapperName || '').trim().toLowerCase();

    const {
        setLoading,
        closeDialogWithAnimation = defaultCloseDialogWithAnimation,
        showNotification
    } = callbacks;

    if (!mapperName) {
        // Show dialog to get mapper name
        const dialog = document.querySelector('#mapperPrompt');
        const input = document.querySelector('#mapperNameInput');
        const cancelBtn = document.querySelector('#mapperPromptCancel');

        if (!dialog || !input) {
            return;
        }

        input.value = '';
        dialog.showModal();
        input.focus();

        const name = await new Promise((resolve) => {
            const cleanup = async () => {
                if (closeDialogWithAnimation) {
                    await closeDialogWithAnimation(dialog);
                } else {
                    dialog.close();
                }
                cancelBtn?.removeEventListener('click', onCancel);
                dialog.removeEventListener('submit', onSubmit);
                dialog.removeEventListener('cancel', onCancel);
            };

            const onCancel = async () => {
                await cleanup();
                resolve(null);
            };

            const onSubmit = async (event) => {
                event.preventDefault();
                const value = input.value.trim();
                if (!value) {
                    await cleanup();
                    resolve(null);
                    return;
                }

                if (setLoading) {
                    setLoading(true);
                }
                const processed = await processMapperInput(value);
                if (setLoading) {
                    setLoading(false);
                }

                const resolvedMapperName = (processed || value).trim();
                const isProfileUrl = value.includes('osu.ppy.sh/users/') || value.includes('osu.ppy.sh/u/');
                const isNumericUserId = /^\d+$/.test(value);

                settings.rescanMapperName = resolvedMapperName;
                if (!isProfileUrl && !isNumericUserId) {
                    settings.mapperAliases = [];
                    settings.ignoredAliases = [];
                }
                persistSettings();

                const settingsMapperInput = document.querySelector('#rescanMapperName');
                if (settingsMapperInput) {
                    settingsMapperInput.value = resolvedMapperName;
                }

                await cleanup();
                resolve(resolvedMapperName || null);
            };

            cancelBtn?.addEventListener('click', onCancel, { once: true });
            dialog.addEventListener('submit', onSubmit, { once: true });
            dialog.addEventListener('cancel', onCancel, { once: true });
        });

        if (!name) {
            return;
        }

        mapperName = name;
    }

    const normalizedMapperName = (mapperName || '').trim().toLowerCase();
    if (normalizedMapperName && normalizedMapperName !== previousMapperName) {
        setBeatmapItems([]);
        if (callbacks.updateTabCounts) {
            callbacks.updateTabCounts();
        }
        if (callbacks.renderFromState) {
            callbacks.renderFromState();
        }
        if (callbacks.saveToStorage) {
            callbacks.saveToStorage({ showNotification: callbacks.showNotification });
        }
    }

    const scanDone = startStreamingScan('mapper', { callbacks });
    const result = await beatmapApi.openMapperOsuFiles(mapperName);

    if (!result) {
        // User cancelled folder picker — clean up streaming state
        if (showNotification) {
            showNotification('Import Cancelled', 'No folder selected.', 'info');
        }
        return;
    }

    await scanDone;
}

/**
 * Load beatmaps from a folder picker
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.showNotification - Show notification
 */
export async function loadBeatmapsFromFolder(callbacks = {}) {
    if (!beatmapApi?.openFolderOsuFiles) {
        return;
    }

    const { showNotification } = callbacks;
    const scanDone = startStreamingScan('folder', { callbacks });
    const result = await beatmapApi.openFolderOsuFiles();

    if (!result) {
        // User cancelled folder picker
        if (showNotification) {
            showNotification('Import Cancelled', 'No folder selected.', 'info');
        }
        return;
    }

    await scanDone;
}
