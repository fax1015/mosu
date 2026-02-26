/**
 * SearchHandler.js - Search functionality module
 * Extracted from renderer.js (lines 4993-4999 and related)
 */

import { searchQuery, setSearchQuery } from '../state/Store.js';

// ============================================
// Constants
// ============================================

/** @type {number} Debounce delay for search input in ms */
export const SEARCH_DEBOUNCE_MS = 150;

// ============================================
// State
// ============================================

/** @type {HTMLElement|null} Search input element */
let searchInput = null;

/** @type {boolean} Whether search is initialized */
let isInitialized = false;

/** @type {number|null} Debounce timer ID */
let debounceTimer = null;

/** @type {string} Current search query */
let currentQuery = '';

/** @type {Function|null} Input event handler */
let boundInputHandler = null;

/** @type {Function|null} Callback for search changes */
let onSearchChange = null;

// ============================================
// Core Functions
// ============================================

/**
 * Handle search input changes
 * @param {string} query - Search query
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onSearch - Called when search changes
 * @param {Function} callbacks.renderFromState - Re-render function
 * @param {boolean} [immediate=false] - Whether to apply immediately
 */
export const handleSearchInput = (query, callbacks, immediate = false) => {
    currentQuery = query.trim();

    // Update store state
    setSearchQuery(currentQuery);

    if (immediate) {
        executeSearch(callbacks);
    } else {
        debouncedSearch(callbacks);
    }
};

/**
 * Debounced search execution
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onSearch - Called when search changes
 * @param {Function} callbacks.renderFromState - Re-render function
 */
export const debouncedSearch = (callbacks) => {
    // Clear existing timer
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }

    // Set new timer
    debounceTimer = setTimeout(() => {
        executeSearch(callbacks);
    }, SEARCH_DEBOUNCE_MS);
};

/**
 * Execute search immediately
 * @param {Object} callbacks - Callback functions
 */
const executeSearch = (callbacks) => {
    debounceTimer = null;

    // Call custom handler if provided
    if (callbacks.onSearch) {
        callbacks.onSearch(currentQuery);
    }

    // Re-render to apply search filter
    if (callbacks.renderFromState) {
        callbacks.renderFromState();
    }

    // Dispatch custom event for other components
    const event = new CustomEvent('searchchange', {
        detail: { query: currentQuery }
    });
    document.dispatchEvent(event);
};

/**
 * Clear search query
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onSearch - Called when search changes
 * @param {Function} callbacks.renderFromState - Re-render function
 * @returns {boolean} Whether search was cleared
 */
export const clearSearch = (callbacks) => {
    if (!currentQuery) return false;

    currentQuery = '';
    setSearchQuery('');

    // Clear input element
    if (searchInput) {
        searchInput.value = '';
    }

    // Cancel any pending debounce
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }

    // Execute immediately
    executeSearch(callbacks);

    return true;
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
        // Select all text for easy replacement
        searchInput.select();
        return true;
    }

    return false;
};

/**
 * Get current search query
 * @returns {string} Current search query
 */
export const getSearchQuery = () => currentQuery;

/**
 * Set search query programmatically
 * @param {string} query - New search query
 * @param {Object} callbacks - Callback functions
 * @returns {boolean} Whether query was set
 */
export const setQuery = (query, callbacks) => {
    const trimmedQuery = query.trim();

    if (searchInput) {
        searchInput.value = trimmedQuery;
    }

    handleSearchInput(trimmedQuery, callbacks, true);
    return true;
};

// ============================================
// Filter Logic
// ============================================

/**
 * Check if an item matches the search query
 * @param {Object} item - Beatmap item
 * @param {string} query - Search query
 * @returns {boolean} Whether item matches
 */
export const itemMatchesSearch = (item, query) => {
    if (!query) return true;

    const lowerQuery = query.toLowerCase();

    // Search in various fields
    const searchableFields = [
        item.title,
        item.artist,
        item.creator,
        item.difficultyName,
        item.source,
        item.tags
    ];

    return searchableFields.some(field => {
        if (!field) return false;
        return String(field).toLowerCase().includes(lowerQuery);
    });
};

/**
 * Filter an array of items based on search query
 * @param {Array<Object>} items - Array of items
 * @param {string} [query] - Search query (defaults to current)
 * @returns {Array<Object>} Filtered items
 */
export const filterItemsBySearch = (items, query = currentQuery) => {
    if (!query) return items;
    return items.filter(item => itemMatchesSearch(item, query));
};

// ============================================
// Event Handlers
// ============================================

/**
 * Create input handler for search
 * @param {Object} callbacks - Callback functions
 * @returns {Function} Event handler
 */
const createInputHandler = (callbacks) => (event) => {
    const query = event.target.value;
    handleSearchInput(query, callbacks);
};

// ============================================
// Initialization
// ============================================

/**
 * Initialize search functionality
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.onSearch - Called when search changes
 * @param {Function} callbacks.renderFromState - Re-render function
 * @returns {boolean} Whether initialization succeeded
 */
export const initSearch = (callbacks) => {
    if (isInitialized) {
        console.warn('[SearchHandler] Already initialized');
        return false;
    }

    searchInput = document.querySelector('#searchInput');
    if (!searchInput) {
        console.warn('[SearchHandler] Search input not found');
        return false;
    }

    // Store callbacks
    onSearchChange = callbacks.onSearch;

    // Set initial value from store
    currentQuery = searchQuery || '';
    if (currentQuery && searchInput.value !== currentQuery) {
        searchInput.value = currentQuery;
    }

    // Bind input handler
    boundInputHandler = createInputHandler(callbacks);
    searchInput.addEventListener('input', boundInputHandler);

    isInitialized = true;
    console.log('[SearchHandler] Initialized');
    return true;
};

/**
 * Update search callbacks
 * @param {Object} callbacks - New callbacks
 */
export const updateCallbacks = (callbacks) => {
    if (callbacks.onSearch) {
        onSearchChange = callbacks.onSearch;
    }
};

/**
 * Destroy search handler and clean up
 */
export const destroySearch = () => {
    if (!isInitialized) return;

    // Cancel any pending debounce
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }

    // Remove event listener
    if (searchInput && boundInputHandler) {
        searchInput.removeEventListener('input', boundInputHandler);
    }

    searchInput = null;
    boundInputHandler = null;
    onSearchChange = null;
    isInitialized = false;

    console.log('[SearchHandler] Destroyed');
};

/**
 * Check if search is initialized
 * @returns {boolean} Whether initialized
 */
export const isSearchInitialized = () => isInitialized;

/**
 * Get search input element
 * @returns {HTMLElement|null} Search input element
 */
export const getSearchInput = () => searchInput;

// ============================================
// Utility Exports
// ============================================

/**
 * Check if search is active (has query)
 * @returns {boolean} Whether search is active
 */
export const isSearchActive = () => currentQuery.length > 0;

/**
 * Get search statistics
 * @param {number} totalItems - Total number of items
 * @param {number} filteredItems - Number of filtered items
 * @returns {Object} Search statistics
 */
export const getSearchStats = (totalItems, filteredItems) => ({
    query: currentQuery,
    isActive: isSearchActive(),
    totalItems,
    filteredItems,
    hiddenItems: totalItems - filteredItems
});
