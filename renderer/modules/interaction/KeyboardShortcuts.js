/**
 * KeyboardShortcuts.js - Keyboard shortcut handling system
 * Extracted from various parts of renderer.js
 */

import { AudioController } from '../services/AudioController.js';

// ============================================
// State
// ============================================

/** @type {boolean} Whether keyboard shortcuts are initialized */
let isInitialized = false;

/** @type {boolean} Whether shortcuts are currently enabled */
let shortcutsEnabled = true;

/** @type {HTMLElement|null} Search input element */
let searchInput = null;

/** @type {Function|null} Escape key handler */
let escapeHandler = null;

/** @type {Function|null} Search shortcut handler */
let searchShortcutHandler = null;

/** @type {Function|null} Audio shortcut handler */
let audioShortcutHandler = null;

// ============================================
// Utility Functions
// ============================================

/**
 * Check if shortcuts should be processed
 * @returns {boolean} Whether shortcuts are allowed
 */
export const isShortcutAllowed = () => {
    if (!shortcutsEnabled) return false;

    // Don't process shortcuts if user is typing in an input
    const activeElement = document.activeElement;
    if (activeElement) {
        const tagName = activeElement.tagName.toLowerCase();
        const isInputElement = ['input', 'textarea', 'select'].includes(tagName);
        const isEditable = activeElement.isContentEditable;

        if (isInputElement || isEditable) {
            return false;
        }
    }

    // Don't process if a modal/dialog is open
    const openDialogs = document.querySelectorAll('dialog[open]');
    if (openDialogs.length > 0) {
        // Still allow Escape to close dialogs
        return true;
    }

    return true;
};

/**
 * Check if an input element is focused
 * @returns {boolean} Whether input is focused
 */
const isInputFocused = () => {
    const activeElement = document.activeElement;
    if (!activeElement) return false;

    const tagName = activeElement.tagName.toLowerCase();
    return ['input', 'textarea', 'select'].includes(tagName) || activeElement.isContentEditable;
};

// ============================================
// Shortcut Handlers
// ============================================

/**
 * Handle keydown events
 * @param {KeyboardEvent} e - Keyboard event
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onEscape - Escape key handler
 * @param {Function} callbacks.onSearchFocus - Search focus handler
 * @param {Function} callbacks.onAudioToggle - Audio play/pause toggle
 * @param {Function} callbacks.isDialogOpen - Check if dialog is open
 * @param {Function} callbacks.closeDialog - Close dialog function
 */
export const handleKeyDown = (e, callbacks) => {
    // Always allow Escape key
    if (e.key === 'Escape') {
        handleEscape(e, callbacks);
        return;
    }

    // Check if shortcuts are allowed
    if (!isShortcutAllowed()) return;

    // Ctrl+F / Cmd+F - Focus search
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (callbacks.onSearchFocus) {
            callbacks.onSearchFocus();
        } else {
            focusSearch();
        }
        return;
    }

    // Space - Toggle audio playback (only if not in input)
    if (e.key === ' ' && !isInputFocused()) {
        if (callbacks.onAudioToggle) {
            e.preventDefault();
            callbacks.onAudioToggle();
        }
        return;
    }

    // Custom shortcuts can be added here
    if (callbacks.onKeyDown) {
        callbacks.onKeyDown(e);
    }
};

/**
 * Handle keyup events
 * @param {KeyboardEvent} e - Keyboard event
 * @param {Object} callbacks - Callback functions
 */
export const handleKeyUp = (e, callbacks) => {
    if (callbacks.onKeyUp) {
        callbacks.onKeyUp(e);
    }
};

/**
 * Handle Escape key
 * @param {KeyboardEvent} e - Keyboard event
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onEscape - Custom escape handler
 * @param {Function} callbacks.isDialogOpen - Check if dialog is open
 * @param {Function} callbacks.closeDialog - Close dialog function
 * @param {Function} callbacks.onAudioStop - Stop audio handler
 */
const handleEscape = (e, callbacks) => {
    // Priority 1: Close open dialogs
    const openDialogs = document.querySelectorAll('dialog[open]');
    if (openDialogs.length > 0) {
        const topDialog = openDialogs[openDialogs.length - 1];

        // Check if custom close handler is provided
        if (callbacks.closeDialog) {
            callbacks.closeDialog(topDialog);
        } else {
            // Default: try to close with animation or directly
            if (topDialog.close) {
                topDialog.close();
            }
        }

        // Also call custom escape handler if provided
        if (callbacks.onEscape) {
            callbacks.onEscape(e);
        }
        return;
    }

    // Priority 2: Stop audio playback
    if (AudioController.currentId) {
        if (callbacks.onAudioStop) {
            callbacks.onAudioStop();
        } else {
            AudioController.stop();
        }

        if (callbacks.onEscape) {
            callbacks.onEscape(e);
        }
        return;
    }

    // Priority 3: Custom escape handler
    if (callbacks.onEscape) {
        callbacks.onEscape(e);
    }
};

// ============================================
// Search Shortcut
// ============================================

/**
 * Bind Ctrl+F / Cmd+F for search focus
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onSearchFocus - Called when search shortcut is triggered
 */
export const bindSearchShortcut = (callbacks) => {
    searchInput = document.querySelector('#searchInput');

    const handler = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
            e.preventDefault();

            if (callbacks.onSearchFocus) {
                callbacks.onSearchFocus();
            } else {
                focusSearch();
            }
        }
    };

    searchShortcutHandler = handler;
    document.addEventListener('keydown', handler);
};

/**
 * Focus search input
 * @returns {boolean} Whether focus succeeded
 */
export const focusSearch = () => {
    if (!searchInput) {
        searchInput = document.querySelector('#searchInput');
    }

    if (searchInput) {
        searchInput.focus();
        searchInput.select();
        return true;
    }

    return false;
};

// ============================================
// Escape Handler
// ============================================

/**
 * Bind Escape key handler
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onEscape - Escape key handler
 * @param {Function} callbacks.isDialogOpen - Check if dialog is open
 * @param {Function} callbacks.closeDialog - Close dialog function
 * @param {Function} callbacks.onAudioStop - Stop audio handler
 */
export const bindEscapeHandler = (callbacks) => {
    const handler = (e) => {
        if (e.key === 'Escape') {
            handleEscape(e, callbacks);
        }
    };

    escapeHandler = handler;
    document.addEventListener('keydown', handler);
};

// ============================================
// Audio Shortcuts
// ============================================

/**
 * Bind audio playback shortcuts
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onAudioToggle - Toggle audio playback
 * @param {Function} callbacks.onAudioStop - Stop audio playback
 */
export const bindAudioShortcuts = (callbacks) => {
    const handler = (e) => {
        // Space to toggle play/pause (when not in input)
        if (e.key === ' ' && !isInputFocused()) {
            e.preventDefault();

            if (callbacks.onAudioToggle) {
                callbacks.onAudioToggle();
            } else {
                // Default: toggle audio
                if (AudioController.currentId) {
                    AudioController.stop();
                } else {
                    // Try to play currently selected or first item
                    // This would need to be implemented based on app logic
                }
            }
            return;
        }

        // Additional audio shortcuts can be added here
        // e.g., Arrow keys for seeking, etc.
    };

    audioShortcutHandler = handler;
    document.addEventListener('keydown', handler);
};

// ============================================
// State Management
// ============================================

/**
 * Enable keyboard shortcuts
 */
export const enableShortcuts = () => {
    shortcutsEnabled = true;
};

/**
 * Disable keyboard shortcuts
 */
export const disableShortcuts = () => {
    shortcutsEnabled = false;
};

/**
 * Check if shortcuts are enabled
 * @returns {boolean} Whether shortcuts are enabled
 */
export const areShortcutsEnabled = () => shortcutsEnabled;

// ============================================
// Initialization
// ============================================

/** @type {Function|null} Bound keydown handler */
let boundKeyDown = null;

/** @type {Function|null} Bound keyup handler */
let boundKeyUp = null;

/**
 * Initialize keyboard shortcuts
 * @param {Object} callbacks - Callback functions
 * @param {Function} [callbacks.onEscape] - Escape key handler
 * @param {Function} [callbacks.onSearchFocus] - Search focus handler
 * @param {Function} [callbacks.onAudioToggle] - Audio toggle handler
 * @param {Function} [callbacks.onAudioStop] - Audio stop handler
 * @param {Function} [callbacks.isDialogOpen] - Check if dialog is open
 * @param {Function} [callbacks.closeDialog] - Close dialog function
 * @param {Function} [callbacks.onKeyDown] - Generic keydown handler
 * @param {Function} [callbacks.onKeyUp] - Generic keyup handler
 * @returns {boolean} Whether initialization succeeded
 */
export const initKeyboardShortcuts = (callbacks = {}) => {
    if (isInitialized) {
        console.warn('[KeyboardShortcuts] Already initialized');
        return false;
    }

    searchInput = document.querySelector('#searchInput');

    // Bind main keyboard handlers
    boundKeyDown = (e) => handleKeyDown(e, callbacks);
    boundKeyUp = (e) => handleKeyUp(e, callbacks);

    document.addEventListener('keydown', boundKeyDown);
    document.addEventListener('keyup', boundKeyUp);

    isInitialized = true;
    console.log('[KeyboardShortcuts] Initialized');
    return true;
};

/**
 * Destroy keyboard shortcuts and clean up
 */
export const destroyKeyboardShortcuts = () => {
    if (!isInitialized) return;

    if (boundKeyDown) {
        document.removeEventListener('keydown', boundKeyDown);
    }

    if (boundKeyUp) {
        document.removeEventListener('keyup', boundKeyUp);
    }

    if (searchShortcutHandler) {
        document.removeEventListener('keydown', searchShortcutHandler);
    }

    if (escapeHandler) {
        document.removeEventListener('keydown', escapeHandler);
    }

    if (audioShortcutHandler) {
        document.removeEventListener('keydown', audioShortcutHandler);
    }

    boundKeyDown = null;
    boundKeyUp = null;
    searchShortcutHandler = null;
    escapeHandler = null;
    audioShortcutHandler = null;
    isInitialized = false;

    console.log('[KeyboardShortcuts] Destroyed');
};

/**
 * Check if keyboard shortcuts are initialized
 * @returns {boolean} Whether initialized
 */
export const isKeyboardShortcutsInitialized = () => isInitialized;
