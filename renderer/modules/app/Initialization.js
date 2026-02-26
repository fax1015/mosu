/**
 * Initialization.js - Main application initialization module
 * Extracted from renderer.js (lines 4387-5733)
 *
 * This is the main entry point for the application initialization.
 * It wires together all modules and sets up event listeners.
 */

// ============================================
// Imports
// ============================================

import { SETTINGS_STORAGE_KEY } from '../config/Constants.js';
import { generateUserId, generateApiKey } from '../utils/Helpers.js';
import { showNotification } from '../components/NotificationSystem.js';
import { closeDialogWithAnimation } from '../ui/DialogManager.js';
import { createDropdownMenu } from '../ui/DropdownMenu.js';
import { updateSortUI, updateSRRangeUI, setupSRRangeResizeObserver, updateVersionLabels } from '../ui/SettingsUI.js';
import { renderFromState, updateTabCounts, setLoading, updateProgress, updateEmptyState } from '../ui/StateRenderer.js';
import { initEventDelegation } from '../interaction/EventDelegation.js';
import { AudioController } from '../services/AudioController.js';
import { initMapPreview, openMapPreview } from '../services/MapPreview.js';
import { initScanEventListeners, startStreamingScan } from '../services/ScanManager.js';
import * as Persistence from '../state/Persistence.js';
import * as BackgroundProcessor from '../services/BackgroundProcessor.js';
import { isStarRatingMissing } from '../utils/Validation.js';
import { processMapperInput } from '../parsers/GuestDifficultyFilter.js';
import { checkForUpdatesAndUpdateIndicator } from './UpdateChecker.js';
import { triggerManualSync } from '../services/EmbedSync.js';
import * as Store from '../state/Store.js';

// ============================================
// Module State
// ============================================

/** @type {number|null} Resize settle timer */
let resizeSettleTimer = null;

/** @type {number|null} Scroll RAF id */
let scrollRAF = null;

/** @type {number|null} Timeline refresh RAF id */
let timelineRefreshRAF = null;

/** @type {number|null} Timeline refresh timer */
let timelineRefreshTimer = null;

/** @type {number|null} Rescan mapper name input timer */
let rescanMapperTimer = null;

/** @type {Object|null} Sort dropdown controller */
let sortDropdownMenu = null;

/** @type {Object|null} Mode filter dropdown controller */
let modeFilterDropdownMenu = null;

/** @type {Object|null} Upload dropdown controller */
let uploadDropdownMenu = null;

// ============================================
// Load Settings
// ============================================

/**
 * Load and migrate settings from localStorage
 * Handles migration from old settings format to new format
 */
export const loadSettings = () => {
    const isCurrentUserIdFormat = (value) => /^msu[a-z0-9]{6}$/i.test(String(value || '').trim());

    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
        try {
            const parsed = JSON.parse(raw);

            // Migration: Merge old mutually exclusive toggles into new autoRescan + rescanMode
            if (parsed.autoDetectMaps !== undefined || parsed.autoRescanMapper !== undefined) {
                if (parsed.autoRescan === undefined) {
                    parsed.autoRescan = parsed.autoDetectMaps || parsed.autoRescanMapper || false;
                    parsed.rescanMode = parsed.autoDetectMaps ? 'all' : 'mapper';
                    // Clean up old keys
                    delete parsed.autoDetectMaps;
                    delete parsed.autoRescanMapper;
                }
            }

            Store.updateSettings(parsed);
            const height = 170; // Forced to 170px
            Store.updateState('VIRTUAL_ITEM_HEIGHT', height + 12);
            document.documentElement.style.setProperty('--list-item-height', `${height}px`);
            document.documentElement.style.setProperty('--title-lines', 2);
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }
    // Generate or migrate userId if missing/legacy
    if (!isCurrentUserIdFormat(Store.settings.userId)) {
        Store.updateSettings({ userId: generateUserId() });
        Persistence.persistSettings();
    }
};

// ============================================
// Apply Settings to UI
// ============================================

/**
 * Apply loaded settings to UI elements
 * Updates all settings-related UI components
 */
export const applySettings = () => {
    const autoRescan = document.querySelector('#autoRescan');
    const rescanModeMapper = document.querySelector('#rescanModeMapper');
    const rescanModeAll = document.querySelector('#rescanModeAll');
    const rescanName = document.querySelector('#rescanMapperName');
    const dirLabel = document.querySelector('#songsDirLabel');
    const autoRescanOptions = document.querySelector('#autoRescanOptions');
    const mapperRescanConfig = document.querySelector('#mapperRescanConfig');
    const linkedAliasesContainer = document.querySelector('#linkedAliasesContainer');
    const linkedAliasesList = document.querySelector('#linkedAliasesList');

    if (autoRescan) autoRescan.checked = !!Store.settings.autoRescan;

    if (autoRescanOptions) {
        autoRescanOptions.style.display = Store.settings.autoRescan ? 'block' : 'none';
    }

    if (rescanModeMapper && rescanModeAll) {
        if (Store.settings.rescanMode === 'mapper') rescanModeMapper.checked = true;
        else rescanModeAll.checked = true;
    }

    if (mapperRescanConfig) {
        mapperRescanConfig.style.display = (Store.settings.autoRescan && Store.settings.rescanMode === 'mapper') ? 'block' : 'none';
    }

    if (rescanName) {
        rescanName.value = Store.settings.rescanMapperName || '';
    }

    // Update alias tags
    if (linkedAliasesList && linkedAliasesContainer) {
        if (Store.settings.mapperAliases && Store.settings.mapperAliases.length > 0) {
            linkedAliasesContainer.style.display = 'block';
            linkedAliasesList.innerHTML = Store.settings.mapperAliases.map((name, i) => {
                const isIgnored = Store.settings.ignoredAliases?.includes(name.toLowerCase());
                const icon = isIgnored
                    ? '<svg viewBox="0 0 448 512"><path d="M256 80c0-8.8-7.2-16-16-16s-16 7.2-16 16V240H64c-8.8 0-16 7.2-16 16s7.2 16 16 16H224V432c0 8.8 7.2 16 16 16s16-7.2 16-16V272H400c8.8 0 16-7.2 16-16s-7.2-16-16-16H256V80z"/></svg>' // Plus
                    : '<svg viewBox="0 0 448 512"><path d="M432 256c0 17.7-14.3 32-32 32L48 288c-17.7 0-32-14.3-32-32s14.3-32 32-32l352 0c17.7 0 32 14.3 32 32z"/></svg>'; // Minus
                return `
                    <div class="alias-tag ${i === 0 ? 'is-primary' : ''} ${isIgnored ? 'is-ignored' : ''}" data-name="${name}">
                        <span>${name}</span>
                        <div class="alias-tag-icon">
                            ${icon}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            linkedAliasesContainer.style.display = 'none';
        }
    }

    if (dirLabel) dirLabel.textContent = Store.settings.songsDir || 'Not selected';

    const ignoreStartAndBreaks = document.querySelector('#ignoreStartAndBreaks');
    const ignoreGuests = document.querySelector('#ignoreGuestDifficulties');
    if (ignoreStartAndBreaks) ignoreStartAndBreaks.checked = Store.settings.ignoreStartAndBreaks;
    if (ignoreGuests) ignoreGuests.checked = Store.settings.ignoreGuestDifficulties;

    const volumeSlider = document.querySelector('#previewVolume');
    const volumeValue = document.querySelector('#volumeValue');
    if (volumeSlider) volumeSlider.value = Store.settings.volume ?? 0.5;
    if (volumeValue) volumeValue.textContent = `${Math.round((Store.settings.volume ?? 0.5) * 100)}%`;

    // Update user ID display
    const userIdValue = document.querySelector('#userIdValue');
    if (userIdValue) userIdValue.textContent = Store.settings.userId || 'Not generated';

    // Update embed settings
    const embedDisplayName = document.querySelector('#embedDisplayName');
    if (embedDisplayName) embedDisplayName.value = Store.settings.embedDisplayName || '';

    const apiKeyValue = document.querySelector('#apiKeyValue');
    if (apiKeyValue) apiKeyValue.textContent = Store.settings.embedApiKey || 'Not generated';

    const embedUrlValue = document.querySelector('#embedUrlValue');
    const imageApiUrlValue = document.querySelector('#imageApiUrlValue');
    const imageApiBbcodeValue = document.querySelector('#imageApiBbcodeValue');
    const imageApiUrl = Store.settings.userId
        ? `${Store.settings.embedSyncUrl}/api/image/${Store.settings.userId}`
        : '';
    if (embedUrlValue) {
        embedUrlValue.textContent = Store.settings.userId
            ? `${Store.settings.embedSyncUrl}/embed/${Store.settings.userId}`
            : 'Generate user ID first';
    }
    if (imageApiUrlValue) imageApiUrlValue.textContent = imageApiUrl || 'Generate user ID first';
    if (imageApiBbcodeValue) imageApiBbcodeValue.textContent = imageApiUrl ? `[img]${imageApiUrl}[/img]` : 'Generate user ID first';

    const embedLastSynced = document.querySelector('#embedLastSynced');
    if (embedLastSynced) {
        if (Store.settings.embedLastSynced) {
            const date = new Date(Store.settings.embedLastSynced);
            embedLastSynced.textContent = `Last synced: ${date.toLocaleString()}`;
        } else {
            embedLastSynced.textContent = 'Not synced yet';
        }
    }

    // Embed toggles
    const embedShowTodoList = document.querySelector('#embedShowTodoList');
    const embedShowCompletedList = document.querySelector('#embedShowCompletedList');
    const embedShowProgressStats = document.querySelector('#embedShowProgressStats');

    if (embedShowTodoList) embedShowTodoList.checked = Store.settings.embedShowTodoList;
    if (embedShowCompletedList) embedShowCompletedList.checked = Store.settings.embedShowCompletedList;
    if (embedShowProgressStats) embedShowProgressStats.checked = Store.settings.embedShowProgressStats;

    const groupMapsBySongEl = document.querySelector('#groupMapsBySong');
    if (groupMapsBySongEl) groupMapsBySongEl.checked = !!Store.settings.groupMapsBySong;

    if (modeFilterDropdownMenu) modeFilterDropdownMenu.setValue(Store.modeFilter || 'all');
};

// ============================================
// Initialize Tabs
// ============================================

/**
 * Initialize tab switching logic
 */
export const initTabs = () => {
    const tabButtons = document.querySelectorAll('.tab-button');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            if (tab === Store.viewMode) return;
            Store.updateState('viewMode', tab);
            tabButtons.forEach(b => b.classList.toggle('is-active', b.dataset.tab === Store.viewMode));

            // Yield one frame so the tab active state paints immediately,
            // then run potentially heavy list rendering work.
            if (Store.pendingTabRenderRaf) {
                cancelAnimationFrame(Store.pendingTabRenderRaf);
            }
            Store.updateState('pendingTabRenderRaf', requestAnimationFrame(() => {
                Store.updateState('pendingTabRenderRaf', 0);
                if (Store.viewMode !== tab) return;
                renderFromState();
            }));
        });
    });
};

// ============================================
// Initialize Import Buttons
// ============================================

/**
 * Initialize import button handlers
 * @param {Object} callbacks - Import callbacks
 * @param {Function} callbacks.loadBeatmapFromDialog - Load single beatmap
 * @param {Function} callbacks.loadBeatmapsByMapper - Load by mapper
 * @param {Function} callbacks.loadBeatmapsFromFolder - Load from folder
 */
export const initImportButtons = (callbacks = {}) => {
    const uploadButton = document.querySelector('#osuUploadBtn');
    const uploadDropdown = document.querySelector('#uploadDropdown');

    // Upload Listeners
    if (uploadButton && callbacks.loadBeatmapFromDialog) {
        uploadButton.addEventListener('click', () => {
            callbacks.loadBeatmapFromDialog(callbacks);
        });
    }

    if (uploadDropdown) {
        if (uploadDropdownMenu) uploadDropdownMenu.destroy();
        uploadDropdownMenu = createDropdownMenu({
            root: uploadDropdown,
            triggerSelector: '#uploadMenuToggle',
            optionSelector: '.upload-option',
            labelSelector: '',
            valueAttribute: 'upload',
            activeClass: 'upload-option-active',
            onChange: ({ value }) => {
                const type = value;
                if (type === 'mapper' && callbacks.loadBeatmapsByMapper) {
                    callbacks.loadBeatmapsByMapper(undefined, callbacks);
                } else if (type === 'folder' && callbacks.loadBeatmapsFromFolder) {
                    callbacks.loadBeatmapsFromFolder(callbacks);
                }
            }
        });
    }

    // Backward-compatible action handling if dropdown module could not initialize
    if (!uploadDropdownMenu) {
        const uploadOptions = document.querySelectorAll('.upload-option');
        uploadOptions.forEach(option => {
            option.addEventListener('click', () => {
                const type = option.dataset.upload;
                if (type === 'mapper' && callbacks.loadBeatmapsByMapper) {
                    callbacks.loadBeatmapsByMapper(undefined, callbacks);
                } else if (type === 'folder' && callbacks.loadBeatmapsFromFolder) {
                    callbacks.loadBeatmapsFromFolder(callbacks);
                }
            });
        });
    }
};

// ============================================
// Initialize Toolbar
// ============================================

/**
 * Initialize toolbar buttons (refresh, clear all, search, menu)
 * @param {Object} callbacks - Toolbar callbacks
 * @param {Function} callbacks.refreshLastDirectory - Refresh last directory
 * @param {Function} callbacks.loadBeatmapFromDialog - Load beatmap dialog
 */
export const initToolbar = (callbacks = {}) => {
    const searchInput = document.querySelector('#searchInput');
    const menuToggle = document.querySelector('#menuToggle');
    const headerMenu = document.querySelector('#headerMenu');
    const settingsBtn = document.querySelector('#settingsBtn');
    const settingsDialog = document.querySelector('#settingsDialog');
    const listContainer = document.querySelector('#listContainer');

    // Search
    if (searchInput) {
        searchInput.addEventListener('input', (event) => {
            Store.updateState('searchQuery', event.target.value.trim());
            renderFromState();
        });
    }

    // Header menu toggle
    const setHeaderMenuOpen = (isOpen) => {
        if (!headerMenu || !menuToggle) return;
        headerMenu.classList.toggle('is-open', isOpen);
        menuToggle.setAttribute('aria-expanded', String(isOpen));
        if (!isOpen) {
            if (sortDropdownMenu) sortDropdownMenu.close();
        }
    };

    if (menuToggle && headerMenu) {
        menuToggle.addEventListener('click', () => {
            const isOpen = !headerMenu.classList.contains('is-open');
            setHeaderMenuOpen(isOpen);
        });
    }

    // Document click handler for closing menus
    document.addEventListener('click', (event) => {
        const target = event.target;
        const clickedMenuToggle = menuToggle && menuToggle.contains(target);
        const clickedSettingsBtn = settingsBtn && settingsBtn.contains(target);

        const isAnyDialogOpen = (settingsDialog && settingsDialog.open) ||
            document.querySelector('#mapperPrompt')?.open ||
            document.querySelector('#aboutDialog')?.open ||
            document.querySelector('#changelogDialog')?.open;

        if (isAnyDialogOpen) return;
        if (clickedSettingsBtn) return;

        if (headerMenu && menuToggle && !headerMenu.contains(target) && !clickedMenuToggle) {
            setHeaderMenuOpen(false);
        }

        // Stop audio preview when clicking outside the timeline
        if (AudioController.currentItemId && !target.closest('.list-timeline') &&
            !target.closest('#settingsDialog') && !target.closest('#settingsBtn')) {
            AudioController.stop();
        }
    });

    // Refresh button
    const refreshBtn = document.querySelector('#refreshBtn');
    if (refreshBtn && callbacks.refreshLastDirectory) {
        refreshBtn.addEventListener('click', () => {
            // Ensure any pending background analysis resumes when the user clicks Refresh.
            try {
                if (Array.isArray(Store.beatmapItems) && Store.beatmapItems.length) {
                    Store.beatmapItems.forEach(item => {
                        if (item && item.audio && !item.durationMs) {
                            BackgroundProcessor.scheduleAudioAnalysis(item.id);
                        }
                        if (item && item.filePath && isStarRatingMissing(item.starRating)) {
                            BackgroundProcessor.scheduleStarRatingCalculation(item.id);
                        }
                    });
                }
                try { callbacks.processBackgroundQueues(callbacks); } catch (e) { /* swallow */ }
            } catch (e) {
                // non-fatal
            }

            callbacks.refreshLastDirectory(callbacks);
        });
    }

    // Clear all button
    const clearAllButton = document.querySelector('#clearAllBtn');
    if (clearAllButton && listContainer) {
        clearAllButton.addEventListener('click', async () => {
            const clearDialog = document.querySelector('#clearAllPrompt');
            if (!clearDialog) return;

            const confirmed = await new Promise((resolve) => {
                const cancelBtn = document.querySelector('#clearAllCancel');
                const confirmBtn = document.querySelector('#clearAllConfirm');

                const cleanup = async () => {
                    await closeDialogWithAnimation(clearDialog);
                    cancelBtn?.removeEventListener('click', onCancel);
                    clearDialog.removeEventListener('submit', onSubmit);
                    clearDialog.removeEventListener('cancel', onCancel);
                };

                const onCancel = async () => { await cleanup(); resolve(false); };
                const onSubmit = async (e) => {
                    e.preventDefault();
                    await cleanup();
                    resolve(true);
                };

                clearDialog.showModal();
                cancelBtn?.addEventListener('click', onCancel, { once: true });
                clearDialog.addEventListener('submit', onSubmit, { once: true });
                clearDialog.addEventListener('cancel', onCancel, { once: true });
            });

            if (!confirmed) return;

            // Keep todoIds and doneIds so they persist across rescans
            Store.setBeatmapItems([]);
            updateTabCounts();
            listContainer.innerHTML = '';
            updateEmptyState(listContainer);
            renderFromState();
            Persistence.saveToStorage({ showNotification });
            showNotification('Cleared', 'All beatmaps have been removed.', 'success');
        });
    }
};

// ============================================
// Initialize Settings Panel
// ============================================

/**
 * Initialize settings panel events
 * @param {Object} callbacks - Settings callbacks
 * @param {Function} callbacks.refreshLastDirectory - Refresh last directory
 */
export const initSettingsPanel = (callbacks = {}) => {
    const settingsDialog = document.querySelector('#settingsDialog');
    const settingsBtn = document.querySelector('#settingsBtn');
    const closeSettingsBtn = document.querySelector('#closeSettingsBtn');
    const aboutDialog = document.querySelector('#aboutDialog');
    const aboutBtn = document.querySelector('#aboutBtn');
    const closeAboutBtn = document.querySelector('#closeAboutBtn');
    const changelogDialog = document.querySelector('#changelogDialog');
    const closeChangelogBtn = document.querySelector('#closeChangelogBtn');
    const versionIndicator = document.querySelector('#versionIndicator');
    const selectSongsDirBtn = document.querySelector('#selectSongsDirBtn');
    const rescanNameInput = document.getElementById('rescanMapperName');
    const modeFilterDropdown = document.getElementById('modeFilterDropdown');

    const bindBackdropClose = (dialog) => {
        if (!dialog) return;
        dialog.addEventListener('click', (event) => {
            if (!dialog.open) return;
            const rect = dialog.getBoundingClientRect();
            const isInside =
                event.clientX >= rect.left &&
                event.clientX <= rect.right &&
                event.clientY >= rect.top &&
                event.clientY <= rect.bottom;
            if (!isInside) {
                closeDialogWithAnimation(dialog);
            }
        });
    };

    const showChangelog = async () => {
        if (!changelogDialog) return;
        await updateVersionLabels();
        changelogDialog.showModal();
    };

    if (aboutBtn && aboutDialog) {
        aboutBtn.addEventListener('click', async () => {
            await updateVersionLabels();
            aboutDialog.showModal();
        });
    }
    if (closeAboutBtn && aboutDialog) {
        closeAboutBtn.addEventListener('click', () => closeDialogWithAnimation(aboutDialog));
    }
    bindBackdropClose(aboutDialog);

    if (closeChangelogBtn && changelogDialog) {
        closeChangelogBtn.addEventListener('click', () => closeDialogWithAnimation(changelogDialog));
    }
    bindBackdropClose(changelogDialog);
    if (versionIndicator) {
        versionIndicator.addEventListener('click', showChangelog);
    }

    // Settings Listeners
    if (settingsBtn && settingsDialog) {
        settingsBtn.addEventListener('click', () => {
            applySettings();
            settingsDialog.showModal();
        });
    }
    if (closeSettingsBtn && settingsDialog) {
        closeSettingsBtn.addEventListener('click', () => closeDialogWithAnimation(settingsDialog));
    }
    bindBackdropClose(settingsDialog);
    bindBackdropClose(document.querySelector('#clearAllPrompt'));
    bindBackdropClose(document.querySelector('#mapperPrompt'));
    bindBackdropClose(document.querySelector('#songsDirPrompt'));

    // Embed advanced toggle (custom animated disclosure)
    const embedAdvancedDetails = document.getElementById('embedAdvancedDetails');
    const embedAdvancedToggle = document.getElementById('embedAdvancedToggle');
    if (embedAdvancedDetails && embedAdvancedToggle) {
        const setEmbedAdvancedOpen = (isOpen) => {
            embedAdvancedDetails.classList.toggle('is-open', isOpen);
            embedAdvancedToggle.setAttribute('aria-expanded', String(isOpen));
        };
        setEmbedAdvancedOpen(false);
        embedAdvancedToggle.addEventListener('click', () => {
            const isOpen = embedAdvancedDetails.classList.contains('is-open');
            setEmbedAdvancedOpen(!isOpen);
        });
    }

    // User ID copy functionality
    const userIdDisplay = document.querySelector('#userIdDisplay');
    if (userIdDisplay) {
        const copyUserId = async () => {
            if (Store.settings.userId) {
                try {
                    await navigator.clipboard.writeText(Store.settings.userId);
                    userIdDisplay.classList.add('copied');
                    setTimeout(() => userIdDisplay.classList.remove('copied'), 1500);
                    showNotification('Copied', 'User ID copied to clipboard.', 'success');
                } catch (e) {
                    console.error('Failed to copy user ID:', e);
                    showNotification('Copy Failed', 'Could not copy user ID.', 'error');
                }
            }
        };
        userIdDisplay.addEventListener('click', copyUserId);
        userIdDisplay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                copyUserId();
            }
        });
    }

    // API Key copy functionality
    const apiKeyDisplay = document.querySelector('#apiKeyDisplay');
    if (apiKeyDisplay) {
        const copyApiKey = async () => {
            if (Store.settings.embedApiKey) {
                try {
                    await navigator.clipboard.writeText(Store.settings.embedApiKey);
                    apiKeyDisplay.classList.add('copied');
                    setTimeout(() => apiKeyDisplay.classList.remove('copied'), 1500);
                    showNotification('Copied', 'API key copied to clipboard.', 'success');
                } catch (e) {
                    console.error('Failed to copy API key:', e);
                    showNotification('Copy Failed', 'Could not copy API key.', 'error');
                }
            }
        };
        apiKeyDisplay.addEventListener('click', copyApiKey);
        apiKeyDisplay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                copyApiKey();
            }
        });
    }

    // Embed URL copy functionality
    const embedUrlDisplay = document.querySelector('#embedUrlDisplay');
    if (embedUrlDisplay) {
        const copyEmbedUrl = async () => {
            if (Store.settings.userId) {
                const url = `${Store.settings.embedSyncUrl}/embed/${Store.settings.userId}`;
                try {
                    await navigator.clipboard.writeText(url);
                    embedUrlDisplay.classList.add('copied');
                    setTimeout(() => embedUrlDisplay.classList.remove('copied'), 1500);
                    showNotification('Copied', 'Embed URL copied to clipboard.', 'success');
                } catch (e) {
                    console.error('Failed to copy embed URL:', e);
                    showNotification('Copy Failed', 'Could not copy embed URL.', 'error');
                }
            }
        };
        embedUrlDisplay.addEventListener('click', copyEmbedUrl);
        embedUrlDisplay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                copyEmbedUrl();
            }
        });
    }

    // Embed sync now button
    const embedSyncNowBtn = document.querySelector('#embedSyncNowBtn');
    if (embedSyncNowBtn) {
        embedSyncNowBtn.addEventListener('click', triggerManualSync);
    }

    // Regenerate API key button
    const regenerateApiKeyBtn = document.querySelector('#regenerateApiKeyBtn');
    if (regenerateApiKeyBtn) {
        regenerateApiKeyBtn.addEventListener('click', () => {
            Store.updateSettings({
                embedApiKey: generateApiKey(),
                embedLastSynced: null
            });
            Persistence.persistSettings();
            applySettings();
            showNotification('API Key Reset', 'A new API key has been generated and ready for sync.', 'success');
        });
    }

    // Image API URL copy functionality
    const imageApiUrlDisplay = document.querySelector('#imageApiUrlDisplay');
    if (imageApiUrlDisplay) {
        const copyImageApiUrl = async () => {
            if (Store.settings.userId) {
                const imageApiUrl = `${Store.settings.embedSyncUrl}/api/image/${Store.settings.userId}`;
                try {
                    await navigator.clipboard.writeText(imageApiUrl);
                    imageApiUrlDisplay.classList.add('copied');
                    setTimeout(() => imageApiUrlDisplay.classList.remove('copied'), 1500);
                    showNotification('Copied', 'Image URL copied to clipboard.', 'success');
                } catch (e) {
                    console.error('Failed to copy image URL:', e);
                    showNotification('Copy Failed', 'Could not copy image URL.', 'error');
                }
            }
        };
        imageApiUrlDisplay.addEventListener('click', copyImageApiUrl);
        imageApiUrlDisplay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                copyImageApiUrl();
            }
        });
    }

    // Image API BBCode copy functionality
    const imageApiBbcodeDisplay = document.querySelector('#imageApiBbcodeDisplay');
    if (imageApiBbcodeDisplay) {
        const copyImageApiBbcode = async () => {
            if (Store.settings.userId) {
                const imageApiUrl = `${Store.settings.embedSyncUrl}/api/image/${Store.settings.userId}`;
                const bbcode = `[img]${imageApiUrl}[/img]`;
                try {
                    await navigator.clipboard.writeText(bbcode);
                    imageApiBbcodeDisplay.classList.add('copied');
                    setTimeout(() => imageApiBbcodeDisplay.classList.remove('copied'), 1500);
                    showNotification('Copied', 'Image BBCode copied to clipboard.', 'success');
                } catch (e) {
                    console.error('Failed to copy image BBCode:', e);
                    showNotification('Copy Failed', 'Could not copy image BBCode.', 'error');
                }
            }
        };
        imageApiBbcodeDisplay.addEventListener('click', copyImageApiBbcode);
        imageApiBbcodeDisplay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                copyImageApiBbcode();
            }
        });
    }

    // Embed display name input
    const embedDisplayName = document.getElementById('embedDisplayName');
    if (embedDisplayName) {
        embedDisplayName.addEventListener('input', (e) => {
            Store.updateSettings({ embedDisplayName: e.target.value });
            Persistence.persistSettings();
        });
    }

    // Embed settings toggles
    ['embedShowTodoList', 'embedShowCompletedList', 'embedShowProgressStats'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                Store.updateSettings({ [id]: e.target.checked });
                Persistence.persistSettings();
            });
        }
    });

    // Songs directory selection
    if (selectSongsDirBtn) {
        selectSongsDirBtn.addEventListener('click', async () => {
            if (window.beatmapApi?.selectDirectory) {
                const dir = await window.beatmapApi.selectDirectory();
                if (dir) {
                    Store.updateSettings({ songsDir: dir });
                    Persistence.persistSettings();
                    applySettings();
                    showNotification('Directory Set', 'Songs folder has been updated.', 'success');
                }
            }
        });
    }

    // Generic Setting Toggles
    ['autoRescan', 'ignoreStartAndBreaks', 'ignoreGuestDifficulties'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                const checked = e.target.checked;
                Store.updateSettings({ [id]: checked });
                Persistence.persistSettings();
                try { applySettings(); } catch (e) { }

                if (id === 'autoRescan' && checked && callbacks.refreshLastDirectory) {
                    callbacks.refreshLastDirectory();
                } else if (id === 'ignoreStartAndBreaks') {
                    Store.setBeatmapItems(Store.beatmapItems.map(item => ({
                        ...item,
                        progress: item.highlights ?
                            item.highlights.reduce((sum, h) => sum + (h.end - h.start), 0) : 0
                    })));
                    renderFromState();
                } else if (id === 'ignoreGuestDifficulties') {
                    updateTabCounts();
                    renderFromState();
                }
            });
        }
    });

    // Rescan Mode Radios
    ['rescanModeMapper', 'rescanModeAll'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                if (e.target.checked) {
                    const mode = e.target.value;
                    const prevMode = Store.settings.rescanMode;
                    Store.updateSettings({ rescanMode: mode });
                    Persistence.persistSettings();
                    try { applySettings(); } catch (e) { }

                    // Trigger refresh if we switched modes while autoRescan is on
                    if (Store.settings.autoRescan && prevMode !== mode && callbacks.refreshLastDirectory) {
                        // When switching from "All Maps" to "Specific Mapper", clear the list
                        // so that we only see the targeted mapper's maps after rescan.
                        if (mode === 'mapper' && prevMode === 'all') {
                            Store.setBeatmapItems([]);
                            updateTabCounts();
                            const listContainer = document.querySelector('#listContainer');
                            if (listContainer) listContainer.innerHTML = '';
                            updateEmptyState(listContainer);
                            Persistence.saveToStorage({ showNotification });
                        }
                        callbacks.refreshLastDirectory();
                    }
                }
            });
        }
    });

    // Group Maps By Song Toggle
    const groupMapsBySongEl = document.getElementById('groupMapsBySong');
    if (groupMapsBySongEl) {
        groupMapsBySongEl.addEventListener('change', (e) => {
            Store.updateSettings({ groupMapsBySong: e.target.checked });
            Persistence.persistSettings();
            // Clear expanded state so old groups don't persist after toggle
            // groupedExpandedKeys is managed by GroupViewBuilder
            renderFromState();
        });
    }

    // Mode filter dropdown
    if (modeFilterDropdown) {
        if (modeFilterDropdownMenu) modeFilterDropdownMenu.destroy();
        modeFilterDropdownMenu = createDropdownMenu({
            root: modeFilterDropdown,
            valueAttribute: 'value',
            onChange: ({ value, previousValue }) => {
                const nextFilter = (value === 'standard' || value === 'taiko' || value === 'catch' || value === 'mania')
                    ? value
                    : 'all';
                if (nextFilter === previousValue) return;
                Store.updateState('modeFilter', nextFilter);
                renderFromState();
                Persistence.scheduleSave();
            }
        });
        if (modeFilterDropdownMenu) {
            modeFilterDropdownMenu.setValue(Store.modeFilter || 'all');
        }
    }

    // Volume slider
    const volumeSlider = document.getElementById('previewVolume');
    const volumeValueText = document.getElementById('volumeValue');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            const vol = parseFloat(e.target.value);
            Store.updateSettings({ volume: vol });
            if (volumeValueText) volumeValueText.textContent = `${Math.round(vol * 100)}%`;
            AudioController.updateVolume();
            Persistence.persistSettings();
        });
    }

    // Alias Tag Click Listener (Toggle Ignore)
    const linkedAliasesList = document.querySelector('#linkedAliasesList');
    if (linkedAliasesList) {
        linkedAliasesList.addEventListener('click', (e) => {
            const tag = e.target.closest('.alias-tag');
            if (!tag) return;

            const name = tag.dataset.name.toLowerCase();
            const ignoredAliases = Store.settings.ignoredAliases || [];

            const index = ignoredAliases.indexOf(name);
            if (index > -1) {
                ignoredAliases.splice(index, 1);
            } else {
                ignoredAliases.push(name);
            }

            Store.updateSettings({ ignoredAliases });
            Persistence.persistSettings();
            applySettings();

            // Refresh list if autoRescan is on
            if (Store.settings.autoRescan && Store.settings.rescanMode === 'mapper' && callbacks.refreshLastDirectory) {
                callbacks.refreshLastDirectory();
            }
        });
    }

    // Rescan Mapper Name Input
    if (rescanNameInput) {
        rescanNameInput.addEventListener('input', (e) => {
            const value = e.target.value.trim();
            const previousMapper = (Store.settings.rescanMapperName || '').trim();

            Store.updateSettings({ rescanMapperName: value });
            Persistence.persistSettings();

            if (rescanMapperTimer) clearTimeout(rescanMapperTimer);
            rescanMapperTimer = setTimeout(async () => {
                if (!value) {
                    // Input cleared: Reset profile-derived scan aliases only.
                    Store.updateSettings({
                        mapperAliases: [],
                        ignoredAliases: [],
                        rescanMapperName: ''
                    });
                    Persistence.persistSettings();

                    Store.setBeatmapItems([]);
                    updateTabCounts();
                    const listContainer = document.querySelector('#listContainer');
                    if (listContainer) listContainer.innerHTML = '';
                    updateEmptyState(listContainer);
                    Persistence.saveToStorage({ showNotification });

                    applySettings();
                    return;
                }

                const isProfileUrl = value.includes('osu.ppy.sh/users/') || value.includes('osu.ppy.sh/u/');
                const isNumericUserId = /^\d+$/.test(value);

                // Resolve mapper input for URL, ID, or username to keep aliases in sync.
                if (value) {
                    const processed = await processMapperInput(value);
                    if (processed) {
                        if (processed !== Store.settings.rescanMapperName) {
                            Store.updateSettings({ rescanMapperName: processed });
                        }
                        Persistence.persistSettings();
                        applySettings();
                    }
                }

                // If user enters a plain username (not URL/ID), clear stale alias data
                // that may have come from the previous linked profile.
                if (!isProfileUrl && !isNumericUserId) {
                    if ((Store.settings.mapperAliases?.length || 0) > 0 || (Store.settings.ignoredAliases?.length || 0) > 0) {
                        Store.updateSettings({
                            mapperAliases: [],
                            ignoredAliases: []
                        });
                        Persistence.persistSettings();
                        applySettings();
                    }
                }

                const mapperChanged = value.toLowerCase() !== previousMapper.toLowerCase();
                if (mapperChanged) {
                    Store.setBeatmapItems([]);
                    updateTabCounts();

                    const listContainer = document.querySelector('#listContainer');
                    if (listContainer) {
                        listContainer.innerHTML = '';
                        updateEmptyState(listContainer);
                    }

                    Persistence.saveToStorage({ showNotification });
                }

                const currentListContainer = document.querySelector('#listContainer');
                if (currentListContainer) currentListContainer.innerHTML = '';

                const targetDir = Store.settings.songsDir;
                if (!targetDir || !window.beatmapApi?.scanDirectoryOsuFiles) {
                    updateTabCounts();
                    renderFromState();
                    return;
                }

                try {
                    const knownFiles = {};
                    Store.beatmapItems.forEach(item => {
                        if (item.filePath) knownFiles[item.filePath] = item.dateModified;
                    });

                    const mapper = Store.settings.rescanMapperName || null;
                    const scanDone = startStreamingScan('directory', {
                        callbacks: {
                            setLoading,
                            updateProgress
                        }
                    });

                    await window.beatmapApi.scanDirectoryOsuFiles(targetDir, mapper, knownFiles);
                    await scanDone;
                } catch (err) {
                    console.error('Mapper rescan failed:', err);
                    setLoading(false);
                    updateTabCounts();
                    renderFromState();
                    showNotification('Rescan Failed', err.message || 'Failed to rescan for maps.', 'error');
                }
            }, 800);
        });
    }
};

// ============================================
// Initialize First Run Wizard
// ============================================

/**
 * Initialize first-run setup wizard
 * Guides users through initial setup
 * @param {Object} callbacks - Wizard callbacks
 * @param {Function} callbacks.refreshLastDirectory - Refresh last directory
 */
export const initFirstRunWizard = async (callbacks = {}) => {
    if (Store.settings.initialSetupDone) return;

    const welcomeDialog = document.querySelector('#welcomePrompt');
    const firstRunDialog = document.querySelector('#firstRunPrompt');
    const songsDirDialog = document.querySelector('#songsDirPrompt');
    const mapperDialog = document.querySelector('#mapperPrompt');

    // Show welcome greeting first
    if (welcomeDialog) {
        await new Promise((resolve) => {
            const continueBtn = document.querySelector('#welcomeContinueBtn');
            const onContinue = async () => {
                await closeDialogWithAnimation(welcomeDialog);
                resolve();
            };
            welcomeDialog.showModal();
            continueBtn?.addEventListener('click', onContinue, { once: true });
            welcomeDialog.addEventListener('cancel', (e) => { e.preventDefault(); }, { once: true });
        });
    }

    if (firstRunDialog) {
        const choice = await new Promise((resolve) => {
            const allBtn = document.querySelector('#firstRunAllBtn');
            const mapperBtn = document.querySelector('#firstRunMapperBtn');

            const cleanup = async () => {
                await closeDialogWithAnimation(firstRunDialog);
                allBtn?.removeEventListener('click', onAll);
                mapperBtn?.removeEventListener('click', onMapper);
                firstRunDialog.removeEventListener('cancel', onCancel);
            };

            const onAll = async () => { await cleanup(); resolve('all'); };
            const onMapper = async () => { await cleanup(); resolve('mapper'); };
            const onCancel = async () => { await cleanup(); resolve(null); };

            firstRunDialog.showModal();
            allBtn?.addEventListener('click', onAll, { once: true });
            mapperBtn?.addEventListener('click', onMapper, { once: true });
            firstRunDialog.addEventListener('cancel', onCancel, { once: true });
        });

        // If user explicitly chose an option, mark setup done and follow flow
        if (choice === 'all') {
            Store.updateSettings({
                initialSetupDone: true,
                initialImportChoice: 'all'
            });
            Persistence.persistSettings();

            // Prompt for songs dir only
            if (!Store.settings.songsDir && window.beatmapApi?.selectDirectory && songsDirDialog) {
                await new Promise((resolve) => {
                    const cancelBtn = document.querySelector('#songsDirPromptCancel');
                    songsDirDialog.showModal();

                    const onCancel = async () => {
                        await closeDialogWithAnimation(songsDirDialog);
                        cleanup();
                        resolve();
                    };

                    const onSubmit = async (event) => {
                        event.preventDefault();
                        await closeDialogWithAnimation(songsDirDialog);

                        // Small delay for focus/animation
                        await new Promise(r => setTimeout(r, 400));
                        const dir = await window.beatmapApi.selectDirectory();
                        if (dir) {
                            Store.updateSettings({ songsDir: dir });
                            Persistence.persistSettings();
                            applySettings();
                        }
                        cleanup();
                        resolve();
                    };

                    const cleanup = () => {
                        cancelBtn?.removeEventListener('click', onCancel);
                        songsDirDialog.removeEventListener('submit', onSubmit);
                        songsDirDialog.removeEventListener('cancel', onCancel);
                    };

                    cancelBtn?.addEventListener('click', onCancel, { once: true });
                    songsDirDialog.addEventListener('submit', onSubmit, { once: true });
                    songsDirDialog.addEventListener('cancel', onCancel, { once: true });
                });
            }

            if (Store.settings.songsDir && callbacks.refreshLastDirectory) {
                await callbacks.refreshLastDirectory(callbacks);
            }
        } else if (choice === 'mapper') {
            Store.updateSettings({
                initialSetupDone: true,
                initialImportChoice: 'mapper'
            });
            Persistence.persistSettings();

            // Ask for songs directory first
            if (!Store.settings.songsDir && window.beatmapApi?.selectDirectory && songsDirDialog) {
                await new Promise((resolve) => {
                    const cancelBtn = document.querySelector('#songsDirPromptCancel');
                    songsDirDialog.showModal();

                    const onCancel = async () => {
                        await closeDialogWithAnimation(songsDirDialog);
                        cleanup();
                        resolve();
                    };

                    const onSubmit = async (event) => {
                        event.preventDefault();
                        await closeDialogWithAnimation(songsDirDialog);

                        // Small delay for focus/animation
                        await new Promise(r => setTimeout(r, 400));
                        const dir = await window.beatmapApi.selectDirectory();
                        if (dir) {
                            Store.updateSettings({ songsDir: dir });
                            Persistence.persistSettings();
                            applySettings();
                        }
                        cleanup();
                        resolve();
                    };

                    const cleanup = () => {
                        cancelBtn?.removeEventListener('click', onCancel);
                        songsDirDialog.removeEventListener('submit', onSubmit);
                        songsDirDialog.removeEventListener('cancel', onCancel);
                    };

                    cancelBtn?.addEventListener('click', onCancel, { once: true });
                    songsDirDialog.addEventListener('submit', onSubmit, { once: true });
                    songsDirDialog.addEventListener('cancel', onCancel, { once: true });
                });
            }

            // Then ask for mapper name
            if (!Store.settings.rescanMapperName && mapperDialog) {
                await new Promise((resolve) => {
                    const input = document.querySelector('#mapperNameInput');
                    const cancelBtn = document.querySelector('#mapperPromptCancel');

                    input.value = '';
                    mapperDialog.showModal();
                    input.focus();

                    const cleanup = async () => {
                        await closeDialogWithAnimation(mapperDialog);
                        cancelBtn?.removeEventListener('click', onCancel);
                        mapperDialog.removeEventListener('submit', onSubmit);
                        mapperDialog.removeEventListener('cancel', onCancel);
                        resolve();
                    };

                    const onCancel = async () => { await cleanup(); };
                    const onSubmit = async (event) => {
                        event.preventDefault();
                        const value = input.value.trim();
                        if (value) {
                            setLoading(true);
                            const processed = await processMapperInput(value);
                            setLoading(false);
                            Store.updateSettings({ rescanMapperName: processed });
                            Persistence.persistSettings();
                            applySettings();
                        }
                        await cleanup();
                    };

                    cancelBtn?.addEventListener('click', onCancel, { once: true });
                    mapperDialog.addEventListener('submit', onSubmit, { once: true });
                    mapperDialog.addEventListener('cancel', onCancel, { once: true });
                });
            }

            if (Store.settings.songsDir && Store.settings.rescanMapperName && callbacks.refreshLastDirectory) {
                await callbacks.refreshLastDirectory(callbacks);
            }
        }
    }
};

// ============================================
// Initialize Drag and Drop (Pointer-driven)
// ============================================

/**
 * Initialize drag and drop for todo list reordering
 */
const initDragAndDrop = () => {
    const listContainer = document.querySelector('#listContainer');
    if (!listContainer) return;

    const stopAutoScroll = () => {
        if (Store.autoScrollTimer) {
            clearInterval(Store.autoScrollTimer);
            Store.updateState('autoScrollTimer', null);
        }
    };

    const startAutoScroll = () => {
        if (Store.autoScrollTimer) return;
        Store.updateState('autoScrollTimer', setInterval(() => {
            const threshold = 120;
            const maxSpeed = 20;
            const h = window.innerHeight;

            let speed = 0;
            if (Store.currentMouseY < threshold) {
                speed = -Math.max(2, (1 - (Store.currentMouseY / threshold)) * maxSpeed);
            } else if (Store.currentMouseY > h - threshold) {
                speed = Math.max(2, (1 - ((h - Store.currentMouseY) / threshold)) * maxSpeed);
            }

            if (speed !== 0) {
                window.scrollBy(0, speed);
            }
        }, 16));
    };

    const pointerDragState = {
        pointerId: null,
        isPointerDown: false,
        isDragging: false,
        draggedElement: null,
        draggedId: null,
        dropTarget: null,
        startX: 0,
        startY: 0,
    };

    const clearDropTarget = () => {
        if (pointerDragState.dropTarget) {
            pointerDragState.dropTarget.classList.remove('drop-target');
            pointerDragState.dropTarget = null;
        }
    };

    const resetPointerDragState = () => {
        stopAutoScroll();
        clearDropTarget();
        if (pointerDragState.draggedElement) {
            pointerDragState.draggedElement.classList.remove('is-dragging');
        }
        document.body?.classList.remove('is-dragging-any');
        pointerDragState.pointerId = null;
        pointerDragState.isPointerDown = false;
        pointerDragState.isDragging = false;
        pointerDragState.draggedElement = null;
        pointerDragState.draggedId = null;
        pointerDragState.startX = 0;
        pointerDragState.startY = 0;
    };

    const shouldIgnoreDragStart = (target) => {
        if (!target) return false;
        return Boolean(target.closest('button, a, input, textarea, select, .list-timeline, .deadline-container, .target-star-container, .extra-actions, .list-action-links'));
    };

    const updateDropTarget = (clientX, clientY) => {
        const candidate = document.elementFromPoint(clientX, clientY)?.closest('.list-box');
        if (!candidate || candidate === pointerDragState.draggedElement) {
            clearDropTarget();
            return;
        }

        if (pointerDragState.dropTarget !== candidate) {
            clearDropTarget();
            candidate.classList.add('drop-target');
            pointerDragState.dropTarget = candidate;
        }
    };

    const handlePointerDown = (e) => {
        if (Store.viewMode !== 'todo') return;
        if (e.button !== 0) return;
        const listBox = e.target.closest('.list-box');
        if (!listBox || shouldIgnoreDragStart(e.target)) return;

        pointerDragState.isPointerDown = true;
        pointerDragState.pointerId = e.pointerId;
        pointerDragState.draggedElement = listBox;
        pointerDragState.draggedId = listBox.dataset.itemId;
        pointerDragState.startX = e.clientX;
        pointerDragState.startY = e.clientY;
        Store.updateState('currentMouseY', e.clientY);
    };

    const maybeStartDragging = () => {
        if (pointerDragState.isDragging || !pointerDragState.draggedElement) return;
        pointerDragState.isDragging = true;
        pointerDragState.draggedElement.classList.add('is-dragging');
        document.body?.classList.add('is-dragging-any');
        startAutoScroll();
    };

    const handlePointerMove = (e) => {
        if (!pointerDragState.isPointerDown || e.pointerId !== pointerDragState.pointerId) return;

        const deltaX = Math.abs(e.clientX - pointerDragState.startX);
        const deltaY = Math.abs(e.clientY - pointerDragState.startY);
        if (!pointerDragState.isDragging && deltaX + deltaY > 6) {
            maybeStartDragging();
        }

        if (!pointerDragState.isDragging) return;

        e.preventDefault();
        Store.updateState('currentMouseY', e.clientY);
        updateDropTarget(e.clientX, e.clientY);
    };

    const commitReorder = () => {
        if (!pointerDragState.draggedId || !pointerDragState.dropTarget) return;

        const draggedId = pointerDragState.draggedId;
        const dropId = pointerDragState.dropTarget.dataset.itemId;
        if (!dropId || dropId === draggedId) return;

        const fromIndex = Store.todoIds.indexOf(draggedId);
        const toIndex = Store.todoIds.indexOf(dropId);
        if (fromIndex === -1 || toIndex === -1) return;

        const newTodoIds = [...Store.todoIds];
        const [movedItem] = newTodoIds.splice(fromIndex, 1);
        newTodoIds.splice(toIndex, 0, movedItem);
        Store.setTodoIds(newTodoIds);

        // Schedule save
        if (Store.saveTimer) {
            clearTimeout(Store.saveTimer);
        }
        Store.updateState('saveTimer', setTimeout(() => {
            Persistence.saveToStorage({ showNotification });
            Store.updateState('saveTimer', null);
        }, 2000));

        renderFromState();
    };

    const handlePointerUp = (e) => {
        if (!pointerDragState.isPointerDown || e.pointerId !== pointerDragState.pointerId) return;

        if (pointerDragState.isDragging) {
            commitReorder();
        }

        resetPointerDragState();
    };

    listContainer.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
};

// ============================================
// Initialize Virtual Scroll
// ============================================

/**
 * Initialize virtual scroll sync
 * @param {Object} callbacks - Scroll callbacks
 * @param {Function} callbacks.syncVirtualList - Sync virtual list
 * @param {Function} callbacks.rerenderVisibleTimelines - Rerender visible timelines
 * @param {Function} callbacks.scheduleTimelineBatchRender - Schedule timeline batch render
 */
const initVirtualScroll = (callbacks = {}) => {
    const debouncedSync = () => {
        if (Store.isWindowResizeInProgress) return;
        if (scrollRAF) return;
        scrollRAF = requestAnimationFrame(() => {
            scrollRAF = null;
            if (Store.isWindowResizeInProgress) return;
            if (callbacks.syncVirtualList) callbacks.syncVirtualList();
        });
    };

    const scheduleTimelineRefresh = () => {
        if (Store.isWindowResizeInProgress) return;
        if (timelineRefreshRAF) return;
        timelineRefreshRAF = requestAnimationFrame(() => {
            timelineRefreshRAF = null;
            if (callbacks.rerenderVisibleTimelines) callbacks.rerenderVisibleTimelines();
        });
    };

    const queueTimelineRefresh = ({ includeSync = false } = {}) => {
        if (Store.isWindowResizeInProgress) return;
        if (includeSync) debouncedSync();

        if (timelineRefreshTimer) clearTimeout(timelineRefreshTimer);

        // Slight delay lets browser restore layout state after tab/window focus.
        timelineRefreshTimer = setTimeout(() => {
            timelineRefreshTimer = null;
            scheduleTimelineRefresh();
        }, 90);
    };

    window.addEventListener('scroll', debouncedSync, { passive: true });
    window.addEventListener('resize', () => {
        Store.updateState('isWindowResizeInProgress', true);
        document.body?.classList.add('window-resizing');

        // Run a single final paint pass after resize settles to avoid artifacts.
        if (resizeSettleTimer) clearTimeout(resizeSettleTimer);
        resizeSettleTimer = setTimeout(() => {
            resizeSettleTimer = null;
            Store.updateState('isWindowResizeInProgress', false);
            document.body?.classList.remove('window-resizing');
            debouncedSync();
            scheduleTimelineRefresh();
            if (callbacks.scheduleTimelineBatchRender) callbacks.scheduleTimelineBatchRender();
        }, 170);
    }, { passive: true });

    window.addEventListener('focus', () => queueTimelineRefresh(), { passive: true });
    window.addEventListener('pageshow', () => queueTimelineRefresh(), { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) queueTimelineRefresh();
    });
};

// ============================================
// Initialize Sort Listeners
// ============================================

/**
 * Initialize sort dropdown listeners
 */
const initSortListeners = () => {
    const sortDropdown = document.querySelector('#sortDropdown');
    if (!sortDropdown) return;

    if (sortDropdownMenu) sortDropdownMenu.destroy();
    sortDropdownMenu = createDropdownMenu({
        root: sortDropdown,
        valueAttribute: 'sort',
        onChange: ({ value }) => {
            const mode = value;
            const currentSort = { ...Store.sortState };

            if (currentSort.mode === mode) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.mode = mode;
                currentSort.direction = 'desc';
            }

            Store.updateState('sortState', currentSort);
            updateSortUI(currentSort);
            renderFromState();

            // Schedule save
            if (Store.saveTimer) clearTimeout(Store.saveTimer);
            Store.updateState('saveTimer', setTimeout(() => {
                Persistence.saveToStorage({ showNotification });
                Store.updateState('saveTimer', null);
            }, 2000));
        }
    });

    if (sortDropdownMenu) {
        sortDropdownMenu.setValue(Store.sortState.mode);
    }
};

// ============================================
// Main Init Function
// ============================================

/**
 * Main initialization function - entry point for the application
 * @param {Object} callbacks - Optional callbacks for external functions
 */
export const init = async (callbacks = {}) => {
    // Get DOM element references
    const listContainer = document.querySelector('#listContainer');

    // Initialize audio controller
    AudioController.init();
    initMapPreview();

    // Load settings
    loadSettings();

    // Initialize scan event listeners
    await initScanEventListeners({
        scheduleAudioAnalysis: BackgroundProcessor.scheduleAudioAnalysis,
        scheduleStarRatingCalculation: BackgroundProcessor.scheduleStarRatingCalculation,
        updateProgress,
        setLoading,
        updateTabCounts,
        renderFromState,
        saveToStorage: () => Persistence.saveToStorage({ showNotification }),
        processBackgroundQueues: () => callbacks.processBackgroundQueues(callbacks)
    });

    // Load from storage
    await Persistence.loadFromStorage({
        showNotification,
        updateTabCounts: () => updateTabCounts(),
        updateSortUI: (state) => updateSortUI(state || Store.sortState),
        renderFromState: () => renderFromState(),
        restoreAudioAnalysisStateFromStorage: () => Persistence.restoreAudioAnalysisStateFromStorage({
            updateRefreshProgress: BackgroundProcessor.updateRefreshProgress
        }),
        restoreStarRatingStateFromStorage: () => Persistence.restoreStarRatingStateFromStorage({
            updateRefreshProgress: BackgroundProcessor.updateRefreshProgress
        }),
        queueMissingAudioAnalysisFromItems: (items) => BackgroundProcessor.queueMissingAudioAnalysisFromItems(items),
        queueMissingStarRatingFromItems: (items) => BackgroundProcessor.queueMissingStarRatingFromItems(items),
        processBackgroundQueues: () => callbacks.processBackgroundQueues(callbacks)
    });

    // Initialize event delegation with proper callbacks
    initEventDelegation({
        get viewMode() { return Store.viewMode; },
        toggleTodo: (itemId) => {
            const wasPinned = Store.todoIds.includes(itemId);
            if (wasPinned) {
                Store.setTodoIds(Store.todoIds.filter(id => id !== itemId));
            } else {
                Store.setTodoIds([...Store.todoIds, itemId]);
            }
            updateTabCounts();
            Persistence.scheduleSave();
            // Only update the specific element instead of re-rendering the whole list
            import('../ui/StateRenderer.js').then(({ updateListItemElement }) => {
                updateListItemElement(itemId, null, {
                    todoIds: Store.todoIds,
                    doneIds: Store.doneIds,
                    viewMode: Store.viewMode,
                    beatmapItems: Store.beatmapItems
                });
            });
        },
        toggleDone: (itemId) => {
            const wasDone = Store.doneIds.includes(itemId);
            if (wasDone) {
                Store.setDoneIds(Store.doneIds.filter(id => id !== itemId));
                if (!Store.todoIds.includes(itemId)) {
                    Store.setTodoIds([itemId, ...Store.todoIds]);
                }
            } else {
                Store.setDoneIds([...Store.doneIds, itemId]);
                Store.setTodoIds(Store.todoIds.filter(id => id !== itemId));
            }
            updateTabCounts();
            Persistence.scheduleSave();
            renderFromState();
        },
        openExternalUrl: (url) => {
            if (window.appInfo?.openExternalUrl) {
                window.appInfo.openExternalUrl(url);
            } else {
                window.open(url, '_blank');
            }
        },
        showItemInFolder: (path) => {
            if (window.beatmapApi?.showItemInFolder) {
                window.beatmapApi.showItemInFolder(path);
            }
        },
        openInTextEditor: (path) => {
            if (window.beatmapApi?.openInTextEditor) {
                window.beatmapApi.openInTextEditor(path);
            }
        },
        openMapPreview: (itemId) => {
            openMapPreview(itemId);
        }
    });

    // Initialize tabs
    initTabs();

    // Initialize sort UI and listeners
    updateSortUI(Store.sortState);
    initSortListeners();

    // Initialize star rating range UI
    const srMin = document.getElementById('srMin');
    const srMax = document.getElementById('srMax');
    if (srMin) srMin.addEventListener('input', (e) => updateSRRangeUI(Store.srFilter, e, {
        rerenderList: true,
        onFilterChange: (filter) => Store.updateState('srFilter', filter),
        renderFromState: renderFromState
    }));
    if (srMax) srMax.addEventListener('input', (e) => updateSRRangeUI(Store.srFilter, e, {
        rerenderList: true,
        onFilterChange: (filter) => Store.updateState('srFilter', filter),
        renderFromState: renderFromState
    }));
    updateSRRangeUI(Store.srFilter, null, { rerenderList: false });

    // Setup resize observer for SR range slider to fix offset issues
    setupSRRangeResizeObserver({
        onResize: () => updateSRRangeUI(Store.srFilter, null, { rerenderList: false })
    });

    // Initialize import buttons
    initImportButtons(callbacks);

    // Initialize toolbar
    initToolbar(callbacks);

    // Initialize settings panel
    initSettingsPanel(callbacks);

    // Initialize drag and drop
    initDragAndDrop();

    // Initialize virtual scroll
    initVirtualScroll(callbacks);

    // Initial render
    renderFromState();

    // Run first-run wizard if needed
    await initFirstRunWizard(callbacks);

    // Check if we need to prompt for missing settings
    if (!Store.settings.rescanMapperName || !Store.settings.songsDir) {
        if (!Store.settings.rescanMapperName && Store.settings.initialImportChoice !== 'all') {
            await promptForMapperName();
        }
        if (!Store.settings.songsDir && window.beatmapApi?.selectDirectory) {
            await promptForSongsDir();
        }

        // First-run fallback: ensure an initial scan happens once setup data is complete
        const shouldDoInitialScan =
            Store.settings.initialSetupDone &&
            Store.settings.songsDir &&
            Store.beatmapItems.length === 0 &&
            (
                Store.settings.initialImportChoice === 'all' ||
                (Store.settings.initialImportChoice === 'mapper' && !!Store.settings.rescanMapperName)
            );

        if (shouldDoInitialScan && callbacks.refreshLastDirectory) {
            await callbacks.refreshLastDirectory(callbacks);
        }
    }

    // Auto rescan if enabled
    if (Store.settings.autoRescan && Store.settings.songsDir && callbacks.refreshLastDirectory) {
        await callbacks.refreshLastDirectory(callbacks);
    }

    // Check for updates in the background
    checkForUpdatesAndUpdateIndicator();

    // Show changelog on first startup after an update
    if (window.appInfo?.getVersion) {
        try {
            const currentVersion = await window.appInfo.getVersion();
            const lastSeenVersion = localStorage.getItem('mosu_lastSeenVersion');
            if (lastSeenVersion && lastSeenVersion !== currentVersion) {
                // Version changed since last run — show changelog
                const changelogDialog = document.querySelector('#changelogDialog');
                if (changelogDialog) {
                    await updateVersionLabels();
                    changelogDialog.showModal();
                }
            }
            localStorage.setItem('mosu_lastSeenVersion', currentVersion);
        } catch (e) {
            // Non-fatal
        }
    }

    // Force-save on app close so background analysis state is never lost
    window.addEventListener('beforeunload', () => {
        if (Store.saveTimer) {
            clearTimeout(Store.saveTimer);
            Store.updateState('saveTimer', null);
        }
        Persistence.saveToStorage({ showNotification });
        Persistence.persistAudioAnalysisState();
        Persistence.persistStarRatingState();
    });
};

// ============================================
// Helper Functions
// ============================================

/**
 * Prompt user for mapper name
 */
async function promptForMapperName() {
    const dialog = document.querySelector('#mapperPrompt');
    const input = document.querySelector('#mapperNameInput');
    const label = dialog?.querySelector('.prompt-dialog-label');
    const cancelBtn = document.querySelector('#mapperPromptCancel');

    if (!dialog || !input) return;

    if (label) label.textContent = 'Enter your default mapper name:';
    input.value = '';
    dialog.showModal();
    input.focus();

    return new Promise((resolve) => {
        const cleanup = async () => {
            await closeDialogWithAnimation(dialog);
            cancelBtn?.removeEventListener('click', onCancel);
            dialog.removeEventListener('submit', onSubmit);
            dialog.removeEventListener('cancel', onCancel);
            if (label) label.textContent = 'Enter the mapper name:';
            resolve();
        };

        const onCancel = async () => { await cleanup(); };
        const onSubmit = async (event) => {
            event.preventDefault();
            const value = input.value.trim();
            if (value) {
                setLoading(true);
                const processed = await processMapperInput(value);
                setLoading(false);
                Store.updateSettings({ rescanMapperName: processed });
                Persistence.persistSettings();
                applySettings();
            }
            await cleanup();
        };

        cancelBtn?.addEventListener('click', onCancel, { once: true });
        dialog.addEventListener('submit', onSubmit, { once: true });
        dialog.addEventListener('cancel', onCancel, { once: true });
    });
}

/**
 * Prompt user for songs directory
 */
async function promptForSongsDir() {
    const dialog = document.querySelector('#songsDirPrompt');
    const cancelBtn = document.querySelector('#songsDirPromptCancel');

    if (!dialog) return;

    dialog.showModal();

    return new Promise((resolve) => {
        const cleanup = async () => {
            await closeDialogWithAnimation(dialog);
            cancelBtn?.removeEventListener('click', onCancel);
            dialog.removeEventListener('submit', onSubmit);
            dialog.removeEventListener('cancel', onCancel);
            resolve();
        };

        const onCancel = async () => { await cleanup(); };
        const onSubmit = async (event) => {
            event.preventDefault();
            await cleanup();

            // Small delay before opening native explorer for focus/animation reasons
            await new Promise(r => setTimeout(r, 400));
            const dir = await window.beatmapApi.selectDirectory();
            if (dir) {
                Store.updateSettings({ songsDir: dir });
                Persistence.persistSettings();
                applySettings();
            }
        };

        cancelBtn?.addEventListener('click', onCancel, { once: true });
        dialog.addEventListener('submit', onSubmit, { once: true });
        dialog.addEventListener('cancel', onCancel, { once: true });
    });
}
