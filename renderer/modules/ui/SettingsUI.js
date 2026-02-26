/**
 * SettingsUI.js - Settings UI update system
 * Extracted from renderer.js (lines 3654-3812, 4451-4552)
 */

import { getStarRatingColor } from '../utils/Helpers.js';
import { appInfo } from '../bridge/Tauri.js';

// ============================================
// Sort UI
// ============================================

/**
 * Update sort dropdown UI
 * @param {Object} sortState - Sort state { mode, direction }
 */
export const updateSortUI = (sortState) => {
    const dropdown = document.querySelector('#sortDropdown');
    const label = document.querySelector('#sortLabel');
    const direction = document.querySelector('#sortDirection');
    const options = dropdown ? dropdown.querySelectorAll('.sort-option') : [];
    const activeOption = Array.from(options).find((option) => option.dataset.sort === sortState.mode);

    if (label && activeOption) {
        label.textContent = activeOption.dataset.label || activeOption.textContent;
    }
    if (direction) {
        direction.dataset.direction = sortState.direction;
    }
    if (dropdown) {
        dropdown.classList.toggle('is-open', false);
        const trigger = dropdown.querySelector('.sort-trigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
    options.forEach((option) => {
        option.classList.toggle('is-active', option.dataset.sort === sortState.mode);
    });
};

// ============================================
// Star Rating Range UI
// ============================================

/**
 * Apply star rating colors to slider handles
 * @param {Object} handles - Handle elements { minHandle, maxHandle }
 * @param {number} min - Min star rating
 * @param {number} max - Max star rating
 */
export const applyStarRatingColors = (handles, min, max) => {
    if (!handles.minHandle || !handles.maxHandle) return;

    handles.minHandle.style.background = getStarRatingColor(min);
    handles.minHandle.style.color = (min > 6.5) ? 'var(--text-primary)' : 'var(--bg-tertiary)';

    const isMaxInfinity = max >= 10;
    handles.maxHandle.style.background = isMaxInfinity ? 'var(--bg-tertiary)' : getStarRatingColor(max);
    handles.maxHandle.style.color = (isMaxInfinity || max > 6.5) ? 'var(--text-primary)' : 'var(--bg-tertiary)';
};

/**
 * Update star rating range slider UI
 * @param {Object} srFilter - Star rating filter { min, max }
 * @param {Event} [event] - Change event
 * @param {Object} [options] - Options
 * @param {boolean} [options.rerenderList=true] - Whether to re-render list after update
 * @param {Function} [options.onFilterChange] - Callback when filter changes
 */
export const updateSRRangeUI = (srFilter, event, options = {}) => {
    const { rerenderList = true, onFilterChange } = options;

    const minInput = document.getElementById('srMin');
    const maxInput = document.getElementById('srMax');
    const minHandle = document.getElementById('srMinHandle');
    const maxHandle = document.getElementById('srMaxHandle');
    const track = document.querySelector('.range-track');
    const container = document.querySelector('.range-slider-container');

    if (!minInput || !maxInput || !minHandle || !maxHandle || !track || !container) return;

    // Use current input values
    let min = parseFloat(minInput.value);
    let max = parseFloat(maxInput.value);

    // Enforce min < max
    if (min > max) {
        if (event?.target === minInput) {
            max = min;
            maxInput.value = max;
        } else {
            min = max;
            minInput.value = min;
        }
    }

    // Constants must match style.css exactly for pixel-perfect alignment
    // Visual handle = 30px. Native input thumb = 38px.
    // Travel width is (Container - ThumbWidth).
    // So visual cushion on each side is (ThumbWidth - HandleWidth) / 2 = 4px.
    const containerWidth = container.clientWidth || 300; // Fallback to a more reasonable min-width
    const thumbWidth = 38;
    const handleWidth = 30;
    const sideCushion = (thumbWidth - handleWidth) / 2; // 4px
    const travelWidth = containerWidth - thumbWidth;

    // Enforce non-overlapping handles visually
    // Values are 0.0 to 10.0. 
    // Minimum gap needed between values to avoid handles touching
    // (We want at least 2px gap between the 30px visual handles)
    const minVisualGap = 2;
    const minSRGap = ((handleWidth + minVisualGap) / travelWidth) * 10;

    if (max - min < minSRGap) {
        if (event?.target === minInput) {
            min = Math.max(0, max - minSRGap);
            minInput.value = min.toFixed(1);
        } else if (event?.target === maxInput) {
            max = Math.min(10, min + minSRGap);
            maxInput.value = max.toFixed(1);
        }
    }

    const newFilter = { min, max };
    if (onFilterChange) {
        onFilterChange(newFilter);
    }

    // Update UI immediately for responsiveness
    const updateVisuals = () => {
        // Update Handles Text
        minHandle.textContent = min.toFixed(1);
        if (max >= 10) {
            maxHandle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" width="14" height="14" fill="currentColor"><path d="M0 256c0-88.4 71.6-160 160-160 50.4 0 97.8 23.7 128 64l32 42.7 32-42.7c30.2-40.3 77.6-64 128-64 88.4 0 160 71.6 160 160S568.4 416 480 416c-50.4 0-97.8-23.7-128-64l-32-42.7-32 42.7c-30.2 40.3-77.6 64-128 64-88.4 0-160-71.6-160-160zm280 0l-43.2-57.6c-18.1-24.2-46.6-38.4-76.8-38.4-53 0-96 43-96 96s43 96 96 96c30.2 0 58.7-14.2 76.8-38.4L280 256zm80 0l43.2 57.6c18.1 24.2 46.6 38.4 76.8 38.4 53 0 96-43 96-96s-43-96-96-96c-30.2 0-58.7 14.2-76.8 38.4L360 256z"/></svg>`;
        } else {
            maxHandle.textContent = max.toFixed(1);
        }

        applyStarRatingColors({ minHandle, maxHandle }, min, max);

        // Position handles
        const left1 = sideCushion + (min / 10) * travelWidth;
        const left2 = sideCushion + (max / 10) * travelWidth;

        minHandle.style.left = `${left1}px`;
        maxHandle.style.left = `${left2}px`;

        // Position track using clip-path
        const gradientGap = 4;
        const clipStart = ((left1 + handleWidth + gradientGap) / containerWidth) * 100;
        const clipEnd = ((left2 - gradientGap) / containerWidth) * 100;

        if (clipEnd > clipStart) {
            track.style.display = 'block';
            track.style.clipPath = `inset(0 ${100 - clipEnd}% 0 ${clipStart}%)`;
        } else {
            track.style.display = 'none';
        }
    };

    // Use RAF to ensure smooth positioning and avoid layout thrashing during input
    if (container._pendingRaf) cancelAnimationFrame(container._pendingRaf);
    container._pendingRaf = requestAnimationFrame(updateVisuals);

    // Debounce the potentially heavy re-render (filtering + DOM updates)
    if (rerenderList && typeof options.renderFromState === 'function') {
        if (container._renderTimer) clearTimeout(container._renderTimer);
        container._renderTimer = setTimeout(() => {
            options.renderFromState();
        }, 16); // Short 16ms delay (1 frame) to batch updates during fast dragging
    }

    // Proximity switching logic (more stable)
    if (!container._srZIndexInit) {
        container._srZIndexInit = true;
        const handleProximity = (e) => {
            // If dragging, let the active element stay on top
            if (document.activeElement === minInput || document.activeElement === maxInput) return;

            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const pct = (x / rect.width) * 10;
            if (Math.abs(pct - min) < Math.abs(pct - max)) {
                minInput.style.zIndex = '25';
                maxInput.style.zIndex = '20';
            } else {
                maxInput.style.zIndex = '25';
                minInput.style.zIndex = '20';
            }
        };
        container.addEventListener('mousemove', handleProximity);
    }

    // Always ensure the active handle stays on top during dragging
    if (document.activeElement === minInput) minInput.style.zIndex = '30';
    if (document.activeElement === maxInput) maxInput.style.zIndex = '30';
};

/**
 * Setup resize observer for SR range slider
 * @param {Object} options - Options
 * @param {Function} [options.onResize] - Callback when container resizes
 */
export const setupSRRangeResizeObserver = (options = {}) => {
    if (typeof ResizeObserver === 'undefined') return;

    const srResizeObserver = new ResizeObserver(() => {
        if (options.onResize) {
            options.onResize();
        }
    });

    const observeSRContainer = () => {
        const container = document.querySelector('.range-slider-container');
        if (container) {
            srResizeObserver.observe(container);
        } else {
            // Container not in DOM yet — wait for it
            requestAnimationFrame(observeSRContainer);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeSRContainer);
    } else {
        observeSRContainer();
    }
};

// ============================================
// Volume UI
// ============================================

/**
 * Update volume slider UI
 * @param {number} volume - Volume value (0-1)
 */
export const updateVolumeUI = (volume) => {
    const volumeSlider = document.querySelector('#previewVolume');
    const volumeValue = document.querySelector('#volumeValue');

    if (volumeSlider) {
        volumeSlider.value = volume ?? 0.5;
    }
    if (volumeValue) {
        volumeValue.textContent = `${Math.round((volume ?? 0.5) * 100)}%`;
    }
};

// ============================================
// List Height UI
// ============================================

/**
 * Update list height slider UI
 * @param {number} height - List height value
 */
export const updateListHeightUI = (height) => {
    const heightSlider = document.querySelector('#listHeight');
    const heightValue = document.querySelector('#listHeightValue');

    if (heightSlider) {
        heightSlider.value = height ?? 170;
    }
    if (heightValue) {
        heightValue.textContent = `${height ?? 170}px`;
    }
};

// ============================================
// Settings Form UI
// ============================================

/**
 * Update all settings form elements
 * @param {Object} settings - Settings object
 * @param {Object} options - Options
 * @param {Function} [options.getEmbedSyncUrl] - Function to get embed sync URL
 */
export const updateSettingsUI = (settings, options = {}) => {
    const autoRescan = document.querySelector('#autoRescan');
    const rescanModeMapper = document.querySelector('#rescanModeMapper');
    const rescanModeAll = document.querySelector('#rescanModeAll');
    const rescanName = document.querySelector('#rescanMapperName');
    const dirLabel = document.querySelector('#songsDirLabel');
    const autoRescanOptions = document.querySelector('#autoRescanOptions');
    const mapperRescanConfig = document.querySelector('#mapperRescanConfig');
    const linkedAliasesContainer = document.querySelector('#linkedAliasesContainer');
    const linkedAliasesList = document.querySelector('#linkedAliasesList');

    if (autoRescan) autoRescan.checked = !!settings.autoRescan;

    if (autoRescanOptions) {
        autoRescanOptions.style.display = settings.autoRescan ? 'block' : 'none';
    }

    if (rescanModeMapper && rescanModeAll) {
        if (settings.rescanMode === 'mapper') rescanModeMapper.checked = true;
        else rescanModeAll.checked = true;
    }

    if (mapperRescanConfig) {
        mapperRescanConfig.style.display = (settings.autoRescan && settings.rescanMode === 'mapper') ? 'block' : 'none';
    }

    if (rescanName) {
        rescanName.value = settings.rescanMapperName || '';
    }

    // Update alias tags
    if (linkedAliasesList && linkedAliasesContainer) {
        if (settings.mapperAliases && settings.mapperAliases.length > 0) {
            linkedAliasesContainer.style.display = 'block';
            linkedAliasesList.innerHTML = settings.mapperAliases.map((name, i) => {
                const isIgnored = settings.ignoredAliases?.includes(name.toLowerCase());
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

    if (dirLabel) dirLabel.textContent = settings.songsDir || 'Not selected';

    const ignoreStartAndBreaks = document.querySelector('#ignoreStartAndBreaks');
    const ignoreGuests = document.querySelector('#ignoreGuestDifficulties');
    if (ignoreStartAndBreaks) ignoreStartAndBreaks.checked = settings.ignoreStartAndBreaks;
    if (ignoreGuests) ignoreGuests.checked = settings.ignoreGuestDifficulties;

    const volumeSlider = document.querySelector('#previewVolume');
    if (volumeSlider) volumeSlider.value = settings.volume ?? 0.5;
    const volumeValue = document.querySelector('#volumeValue');
    if (volumeValue) volumeValue.textContent = `${Math.round((settings.volume ?? 0.5) * 100)}%`;

    // Update user ID display
    const userIdValue = document.querySelector('#userIdValue');
    if (userIdValue) userIdValue.textContent = settings.userId || 'Not generated';

    // Update embed settings
    const embedDisplayName = document.querySelector('#embedDisplayName');
    if (embedDisplayName) embedDisplayName.value = settings.embedDisplayName || '';

    const apiKeyValue = document.querySelector('#apiKeyValue');
    if (apiKeyValue) apiKeyValue.textContent = settings.embedApiKey || 'Not generated';

    const embedUrlValue = document.querySelector('#embedUrlValue');
    const imageApiUrlValue = document.querySelector('#imageApiUrlValue');
    const imageApiBbcodeValue = document.querySelector('#imageApiBbcodeValue');
    const embedSyncUrl = options.getEmbedSyncUrl ? options.getEmbedSyncUrl() : settings.embedSyncUrl || '';
    const imageApiUrl = settings.userId ? `${embedSyncUrl}/api/image/${settings.userId}` : '';
    if (embedUrlValue) {
        embedUrlValue.textContent = settings.userId
            ? `${embedSyncUrl}/embed/${settings.userId}`
            : 'Generate user ID first';
    }
    if (imageApiUrlValue) imageApiUrlValue.textContent = imageApiUrl || 'Generate user ID first';
    if (imageApiBbcodeValue) imageApiBbcodeValue.textContent = imageApiUrl ? `[img]${imageApiUrl}[/img]` : 'Generate user ID first';

    const embedLastSynced = document.querySelector('#embedLastSynced');
    if (embedLastSynced) {
        if (settings.embedLastSynced) {
            const date = new Date(settings.embedLastSynced);
            embedLastSynced.textContent = `Last synced: ${date.toLocaleString()}`;
        } else {
            embedLastSynced.textContent = 'Not synced yet';
        }
    }

    // Embed toggles
    const embedShowTodoList = document.querySelector('#embedShowTodoList');
    const embedShowCompletedList = document.querySelector('#embedShowCompletedList');
    const embedShowProgressStats = document.querySelector('#embedShowProgressStats');

    if (embedShowTodoList) embedShowTodoList.checked = settings.embedShowTodoList;
    if (embedShowCompletedList) embedShowCompletedList.checked = settings.embedShowCompletedList;
    if (embedShowProgressStats) embedShowProgressStats.checked = settings.embedShowProgressStats;

    const groupMapsBySongEl = document.querySelector('#groupMapsBySong');
    if (groupMapsBySongEl) groupMapsBySongEl.checked = !!settings.groupMapsBySong;
};

// ============================================
// Embed Sync UI
// ============================================

/**
 * Update embed sync settings UI
 * @param {Object} settings - Settings object
 * @param {Object} options - Options
 * @param {Function} [options.getEmbedSyncUrl] - Function to get embed sync URL
 */
export const updateEmbedSyncUI = (settings, options = {}) => {
    const userIdValue = document.querySelector('#userIdValue');
    const apiKeyValue = document.querySelector('#apiKeyValue');
    const embedUrlValue = document.querySelector('#embedUrlValue');
    const imageApiUrlValue = document.querySelector('#imageApiUrlValue');
    const imageApiBbcodeValue = document.querySelector('#imageApiBbcodeValue');
    const embedLastSynced = document.querySelector('#embedLastSynced');
    const embedDisplayName = document.querySelector('#embedDisplayName');
    const embedShowTodoList = document.querySelector('#embedShowTodoList');
    const embedShowCompletedList = document.querySelector('#embedShowCompletedList');
    const embedShowProgressStats = document.querySelector('#embedShowProgressStats');

    if (userIdValue) userIdValue.textContent = settings.userId || 'Not generated';
    if (apiKeyValue) apiKeyValue.textContent = settings.embedApiKey || 'Not generated';
    if (embedDisplayName) embedDisplayName.value = settings.embedDisplayName || '';
    const embedSyncUrl = options.getEmbedSyncUrl ? options.getEmbedSyncUrl() : settings.embedSyncUrl || '';
    const imageApiUrl = settings.userId ? `${embedSyncUrl}/api/image/${settings.userId}` : '';

    if (embedUrlValue) {
        embedUrlValue.textContent = settings.userId
            ? `${embedSyncUrl}/embed/${settings.userId}`
            : 'Generate user ID first';
    }
    if (imageApiUrlValue) imageApiUrlValue.textContent = imageApiUrl || 'Generate user ID first';
    if (imageApiBbcodeValue) imageApiBbcodeValue.textContent = imageApiUrl ? `[img]${imageApiUrl}[/img]` : 'Generate user ID first';

    if (embedLastSynced) {
        if (settings.embedLastSynced) {
            const date = new Date(settings.embedLastSynced);
            embedLastSynced.textContent = `Last synced: ${date.toLocaleString()}`;
        } else {
            embedLastSynced.textContent = 'Not synced yet';
        }
    }

    if (embedShowTodoList) embedShowTodoList.checked = settings.embedShowTodoList;
    if (embedShowCompletedList) embedShowCompletedList.checked = settings.embedShowCompletedList;
    if (embedShowProgressStats) embedShowProgressStats.checked = settings.embedShowProgressStats;
};

/**
 * Update version labels in About and Changelog dialogs
 * @returns {Promise<string|null>} Current version or null on failure
 */
export const updateVersionLabels = async () => {
    const versionGetter = appInfo?.getVersion || window.appInfo?.getVersion;
    if (!versionGetter) return null;

    try {
        const version = await versionGetter();
        const aboutVersionEl = document.querySelector('#aboutVersion');
        if (aboutVersionEl) aboutVersionEl.textContent = `v${version}`;

        const changelogVersionEl = document.querySelector('#changelogVersionTag');
        if (changelogVersionEl) changelogVersionEl.textContent = `v${version}`;

        return version;
    } catch (error) {
        console.error('Failed to fetch app version:', error);
        return null;
    }
};

// ============================================
// Event Binding
// ============================================

/**
 * Bind settings change events
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onAutoRescanChange - Auto rescan checkbox change
 * @param {Function} callbacks.onRescanModeChange - Rescan mode change
 * @param {Function} callbacks.onRescanNameChange - Rescan name input change
 * @param {Function} callbacks.onIgnoreStartAndBreaksChange - Ignore start/breaks change
 * @param {Function} callbacks.onIgnoreGuestsChange - Ignore guest difficulties change
 * @param {Function} callbacks.onVolumeChange - Volume slider change
 * @param {Function} callbacks.onListHeightChange - List height slider change
 * @param {Function} callbacks.onGroupMapsChange - Group maps by song change
 * @param {Function} callbacks.onEmbedTodoChange - Embed show todo change
 * @param {Function} callbacks.onEmbedCompletedChange - Embed show completed change
 * @param {Function} callbacks.onEmbedStatsChange - Embed show stats change
 * @returns {Function} Cleanup function to unbind events
 */
export const bindSettingsEvents = (callbacks) => {
    const handlers = [];

    const addListener = (selector, event, handler) => {
        const element = document.querySelector(selector);
        if (element) {
            element.addEventListener(event, handler);
            handlers.push({ element, event, handler });
        }
    };

    // Auto rescan
    if (callbacks.onAutoRescanChange) {
        addListener('#autoRescan', 'change', (e) => callbacks.onAutoRescanChange(e.target.checked));
    }

    // Rescan mode
    if (callbacks.onRescanModeChange) {
        addListener('#rescanModeMapper', 'change', () => callbacks.onRescanModeChange('mapper'));
        addListener('#rescanModeAll', 'change', () => callbacks.onRescanModeChange('all'));
    }

    // Rescan name
    if (callbacks.onRescanNameChange) {
        addListener('#rescanMapperName', 'input', (e) => callbacks.onRescanNameChange(e.target.value));
    }

    // Ignore start and breaks
    if (callbacks.onIgnoreStartAndBreaksChange) {
        addListener('#ignoreStartAndBreaks', 'change', (e) => callbacks.onIgnoreStartAndBreaksChange(e.target.checked));
    }

    // Ignore guest difficulties
    if (callbacks.onIgnoreGuestsChange) {
        addListener('#ignoreGuestDifficulties', 'change', (e) => callbacks.onIgnoreGuestsChange(e.target.checked));
    }

    // Volume
    if (callbacks.onVolumeChange) {
        addListener('#previewVolume', 'input', (e) => callbacks.onVolumeChange(parseFloat(e.target.value)));
    }

    // List height
    if (callbacks.onListHeightChange) {
        addListener('#listHeight', 'input', (e) => callbacks.onListHeightChange(parseInt(e.target.value, 10)));
    }

    // Group maps by song
    if (callbacks.onGroupMapsChange) {
        addListener('#groupMapsBySong', 'change', (e) => callbacks.onGroupMapsChange(e.target.checked));
    }

    // Embed toggles
    if (callbacks.onEmbedTodoChange) {
        addListener('#embedShowTodoList', 'change', (e) => callbacks.onEmbedTodoChange(e.target.checked));
    }
    if (callbacks.onEmbedCompletedChange) {
        addListener('#embedShowCompletedList', 'change', (e) => callbacks.onEmbedCompletedChange(e.target.checked));
    }
    if (callbacks.onEmbedStatsChange) {
        addListener('#embedShowProgressStats', 'change', (e) => callbacks.onEmbedStatsChange(e.target.checked));
    }

    // Return cleanup function
    return () => {
        handlers.forEach(({ element, event, handler }) => {
            element.removeEventListener(event, handler);
        });
    };
};
