/**
 * EventDelegation.js - Global event delegation system
 * Extracted from renderer.js (lines 4349-4385 and other event-related code)
 */

import * as Store from '../state/Store.js';
import { toggleTodo, toggleDone } from '../ui/TodoManager.js';
import { AudioController } from '../services/AudioController.js';

// ============================================
// State
// ============================================

/** @type {HTMLElement|null} List container element */
let listContainer = null;

/** @type {boolean} Whether event delegation is initialized */
let isInitialized = false;

/** @type {Function|null} Bound click handler for cleanup */
let boundClickHandler = null;

// ============================================
// Event Handlers
// ============================================

/**
 * Handle action button clicks
 * @param {string} action - Action type
 * @param {string} itemId - Item ID
 * @param {HTMLElement} target - Clicked element
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.toggleTodo - Toggle todo state
 * @param {Function} callbacks.toggleDone - Toggle done state
 * @param {Function} callbacks.openExternalUrl - Open external URL
 * @param {Function} callbacks.showItemInFolder - Show item in folder
 * @param {Function} callbacks.openInTextEditor - Open item in text editor
 * @param {Function} callbacks.openMapPreview - Open map preview popup
 */
export const handleActionClick = (action, itemId, target, callbacks) => {
    switch (action) {
        case 'toggle-pin':
            if (callbacks.toggleTodo) {
                callbacks.toggleTodo(itemId);
            }
            break;

        case 'toggle-done':
            if (callbacks.toggleDone) {
                callbacks.toggleDone(itemId);
            }
            break;

        case 'open-web': {
            const url = target.dataset.url;
            if (url && callbacks.openExternalUrl) {
                callbacks.openExternalUrl(url);
            } else if (url && window.appInfo?.openExternalUrl) {
                window.appInfo.openExternalUrl(url);
            } else if (url) {
                window.open(url, '_blank');
            }
            break;
        }

        case 'show-folder': {
            const path = target.dataset.path;
            if (path && callbacks.showItemInFolder) {
                callbacks.showItemInFolder(path);
            } else if (path && window.beatmapApi?.showItemInFolder) {
                window.beatmapApi.showItemInFolder(path);
            }
            break;
        }

        case 'open-editor': {
            const path = target.dataset.path;
            if (path && callbacks.openInTextEditor) {
                callbacks.openInTextEditor(path);
            } else if (path && window.beatmapApi?.openInTextEditor) {
                window.beatmapApi.openInTextEditor(path);
            }
            break;
        }

        case 'open-map-preview':
            if (itemId && callbacks.openMapPreview) {
                callbacks.openMapPreview(itemId);
            }
            break;
    }

    // Remove focus to prevent "stuck" hover states due to :focus-within
    if (target instanceof HTMLElement) {
        target.blur();
    }
};

/**
 * Handle clicks on list items (for expansion)
 * @param {Event} e - Click event
 * @param {Object} callbacks - Callback functions
 * @param {string} callbacks.viewMode - Current view mode
 */
export const handleListItemClick = (e, callbacks) => {
    // Only handle expansion in todo tab
    if (callbacks.viewMode !== 'todo') return;

    const listBox = e.target.closest('.list-box');
    if (!listBox) return;

    // Ignore clicks on interactive elements
    if (e.target.closest('button, a, input, .list-timeline')) return;

    // Ignore clicks inside the expansion area (deadline, target star, extra actions)
    if (e.target.closest('.deadline-container, .target-star-container, .extra-actions, .list-action-links')) return;

    // Toggle expansion
    listBox.classList.toggle('expanded');
};

/**
 * Handle timeline clicks for audio preview
 * @param {Event} e - Click event
 * @param {string} itemId - Item ID
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.playAudio - Play audio for item
 * @param {Function} callbacks.stopAudio - Stop audio playback
 */
export const handleTimelineClick = (e, itemId, callbacks) => {
    const timeline = e.target.closest('.list-timeline');
    if (!timeline) return;

    e.preventDefault();
    e.stopPropagation();

    if (callbacks.playAudio) {
        callbacks.playAudio(itemId);
    }
};

/**
 * Main click handler for list container
 * @param {Event} e - Click event
 * @param {Object} callbacks - Callback functions
 */
const createClickHandler = (callbacks) => (e) => {
    // Handle action button clicks
    const actionTarget = e.target.closest('[data-action]');
    if (actionTarget) {
        const action = actionTarget.dataset.action;
        if (action) {
            const itemId =
                actionTarget.dataset.itemId ||
                actionTarget.closest('.list-box')?.dataset.itemId ||
                '';
            const requiresItemId = action === 'toggle-pin' || action === 'toggle-done';
            if (!requiresItemId || itemId) {
                handleActionClick(action, itemId, actionTarget, callbacks);
                return;
            }
        }
    }

    // Handle timeline clicks
    const timeline = e.target.closest('.list-timeline');
    if (timeline) {
        const listBox = timeline.closest('.list-box');
        if (listBox) {
            const itemId = listBox.dataset.itemId;
            if (itemId) {
                handleTimelineClick(e, itemId, callbacks);
            }
        }
        return;
    }

    // Handle list item clicks for expansion
    handleListItemClick(e, callbacks);
};

// ============================================
// Global Events
// ============================================

/** @type {Function|null} Bound resize handler */
let boundResizeHandler = null;

/** @type {Function|null} Bound scroll handler */
let boundScrollHandler = null;

/**
 * Bind window-level events
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onResize - Resize handler
 * @param {Function} callbacks.onScroll - Scroll handler
 */
export const bindGlobalEvents = (callbacks) => {
    if (callbacks.onResize) {
        boundResizeHandler = callbacks.onResize;
        window.addEventListener('resize', boundResizeHandler);
    }

    if (callbacks.onScroll) {
        boundScrollHandler = callbacks.onScroll;
        window.addEventListener('scroll', boundScrollHandler, { passive: true });
    }
};

/**
 * Unbind window-level events
 */
export const unbindGlobalEvents = () => {
    if (boundResizeHandler) {
        window.removeEventListener('resize', boundResizeHandler);
        boundResizeHandler = null;
    }

    if (boundScrollHandler) {
        window.removeEventListener('scroll', boundScrollHandler);
        boundScrollHandler = null;
    }
};

// ============================================
// Initialization
// ============================================

/**
 * Initialize event delegation
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.toggleTodo - Toggle todo state
 * @param {Function} callbacks.toggleDone - Toggle done state
 * @param {Function} callbacks.openExternalUrl - Open external URL
 * @param {Function} callbacks.showItemInFolder - Show item in folder
 * @param {Function} callbacks.openInTextEditor - Open item in text editor
 * @param {Function} callbacks.openMapPreview - Open map preview popup
 * @param {Function} callbacks.playAudio - Play audio for item
 * @param {string} callbacks.viewMode - Current view mode
 * @returns {boolean} Whether initialization succeeded
 */
export const initEventDelegation = (callbacks = {}) => {
    if (isInitialized) {
        console.warn('[EventDelegation] Already initialized');
        return false;
    }

    // Use callbacks if provided, otherwise use Store directly
    const effectiveCallbacks = Object.keys(callbacks).length > 0 ? callbacks : {
        get viewMode() { return Store.viewMode; },
        toggleTodo: (itemId) => toggleTodo(itemId, {
            todoIds: Store.todoIds,
            doneIds: Store.doneIds,
            setTodoIds: Store.setTodoIds,
            setDoneIds: Store.setDoneIds,
            viewMode: Store.viewMode,
            updateTabCounts: () => {},
            scheduleSave: () => {},
            removeItemFromView: () => {},
            updateListItemElement: () => {},
            insertItemIntoTodoView: () => {},
            renderFromState: () => {}
        }),
        toggleDone: (itemId) => toggleDone(itemId, {
            todoIds: Store.todoIds,
            doneIds: Store.doneIds,
            setTodoIds: Store.setTodoIds,
            setDoneIds: Store.setDoneIds,
            viewMode: Store.viewMode,
            updateTabCounts: () => {},
            scheduleSave: () => {},
            removeItemFromView: () => {},
            updateListItemElement: () => {},
            insertItemIntoTodoView: () => {},
            insertItemIntoCompletedView: () => {},
            renderFromState: () => {}
        }),
        playAudio: (itemId) => AudioController.play(itemId),
        stopAudio: () => AudioController.stop(),
        openMapPreview: () => { }
    };

    listContainer = document.querySelector('#listContainer');
    if (!listContainer) {
        console.warn('[EventDelegation] List container not found');
        return false;
    }

    boundClickHandler = createClickHandler(effectiveCallbacks);
    listContainer.addEventListener('click', boundClickHandler);

    isInitialized = true;
    console.log('[EventDelegation] Initialized');
    return true;
};

/**
 * Destroy event delegation and clean up
 */
export const destroyEventDelegation = () => {
    if (!isInitialized) return;

    if (listContainer && boundClickHandler) {
        listContainer.removeEventListener('click', boundClickHandler);
    }

    unbindGlobalEvents();

    listContainer = null;
    boundClickHandler = null;
    isInitialized = false;

    console.log('[EventDelegation] Destroyed');
};

/**
 * Check if event delegation is initialized
 * @returns {boolean} Whether initialized
 */
export const isEventDelegationInitialized = () => isInitialized;
