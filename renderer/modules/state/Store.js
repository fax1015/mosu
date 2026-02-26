/**
 * Store.js - Central state management module
 * Extracted from renderer.js (lines 202-216, 479-504)
 */

// ============================================
// Core State
// ============================================

/** @type {Array<Object>} Array of all beatmap items */
export let beatmapItems = [];

/** @type {Array<string>} Array of item IDs in todo list */
export let todoIds = [];

/** @type {Array<string>} Array of item IDs in completed list */
export let doneIds = [];

/** @type {string} Current view mode: 'all' | 'todo' | 'done' */
export let viewMode = 'all';

/** @type {{mode: string, direction: string}} Sort state with mode and direction */
export let sortState = { mode: 'dateAdded', direction: 'desc' };

/** @type {string} Current search query */
export let searchQuery = '';

/** @type {{min: number, max: number}} Star rating filter range */
export let srFilter = { min: 0, max: 10 };

/** @type {'all'|'standard'|'taiko'|'catch'|'mania'} Mode filter */
export let modeFilter = 'all';

// ============================================
// UI State
// ============================================

/** @type {number} RAF id for pending tab render */
export let pendingTabRenderRaf = 0;

/** @type {number} Token for grouped render pass */
export let groupedRenderPassToken = 0;

/** @type {boolean} Whether window resize is in progress */
export let isWindowResizeInProgress = false;

// ============================================
// Drag/Scroll State
// ============================================

/** @type {number|null} Auto-scroll timer id */
export let autoScrollTimer = null;

/** @type {number} Current mouse Y position during drag */
export let currentMouseY = 0;

// ============================================
// Background Queue State
// ============================================

/** @type {Array<string>} Queue for audio analysis */
export let audioAnalysisQueue = [];

/** @type {boolean} Whether audio analysis is currently running */
export let isAnalyzingAudio = false;

/** @type {number} Total items for audio analysis progress */
export let audioAnalysisTotal = 0;

/** @type {Array<string>} Queue for star rating calculation */
export let starRatingQueue = [];

/** @type {boolean} Whether star rating calculation is currently running */
export let isCalculatingStarRating = false;

/** @type {number} Total items for star rating progress */
export let starRatingTotal = 0;

/** @type {number|null} Save timer for debounced saves */
export let saveTimer = null;

// ============================================
// Settings
// ============================================

/** @type {Object} Application settings */
export let settings = {
    autoRescan: false,
    rescanMode: 'mapper',
    rescanMapperName: '',
    mapperAliases: [],
    ignoredAliases: [],
    songsDir: null,
    ignoreStartAndBreaks: false,
    ignoreGuestDifficulties: false,
    volume: 0.5,
    listItemHeight: 170,
    // First-run setup state
    initialSetupDone: false,
    // 'all' | 'mapper' | null - remembers user's first-run import choice
    initialImportChoice: null,
    // Unique user ID for embed syncing (generated on first run)
    userId: null,
    // Embed sync settings
    embedApiKey: null,
    embedSyncUrl: 'https://mosu-embed-site.vercel.app',
    embedDisplayName: '',
    embedShowTodoList: true,
    embedShowCompletedList: true,
    embedShowProgressStats: true,
    embedLastSynced: null,
    groupMapsBySong: true
};

// ============================================
// State Accessor Functions
// ============================================

/**
 * Get the entire state object
 * @returns {Object} Complete state snapshot
 */
export function getState() {
    return {
        beatmapItems,
        todoIds,
        doneIds,
        viewMode,
        sortState,
        searchQuery,
        srFilter,
        modeFilter,
        pendingTabRenderRaf,
        groupedRenderPassToken,
        isWindowResizeInProgress,
        autoScrollTimer,
        currentMouseY,
        audioAnalysisQueue,
        isAnalyzingAudio,
        audioAnalysisTotal,
        starRatingQueue,
        isCalculatingStarRating,
        starRatingTotal,
        saveTimer,
        settings
    };
}

/**
 * Update a specific state property
 * @param {string} key - State property name
 * @param {*} value - New value
 */
export function updateState(key, value) {
    switch (key) {
        case 'beatmapItems':
            beatmapItems = value;
            break;
        case 'todoIds':
            todoIds = value;
            break;
        case 'doneIds':
            doneIds = value;
            break;
        case 'viewMode':
            viewMode = value;
            break;
        case 'sortState':
            sortState = value;
            break;
        case 'searchQuery':
            searchQuery = value;
            break;
        case 'srFilter':
            srFilter = value;
            break;
        case 'modeFilter':
            modeFilter = value;
            break;
        case 'pendingTabRenderRaf':
            pendingTabRenderRaf = value;
            break;
        case 'groupedRenderPassToken':
            groupedRenderPassToken = value;
            break;
        case 'isWindowResizeInProgress':
            isWindowResizeInProgress = value;
            break;
        case 'autoScrollTimer':
            autoScrollTimer = value;
            break;
        case 'currentMouseY':
            currentMouseY = value;
            break;
        case 'audioAnalysisQueue':
            audioAnalysisQueue = value;
            break;
        case 'isAnalyzingAudio':
            isAnalyzingAudio = value;
            break;
        case 'audioAnalysisTotal':
            audioAnalysisTotal = value;
            break;
        case 'starRatingQueue':
            starRatingQueue = value;
            break;
        case 'isCalculatingStarRating':
            isCalculatingStarRating = value;
            break;
        case 'starRatingTotal':
            starRatingTotal = value;
            break;
        case 'saveTimer':
            saveTimer = value;
            break;
        case 'settings':
            settings = value;
            break;
        default:
            console.warn(`Unknown state key: ${key}`);
    }
}

/**
 * Update settings by merging partial settings object
 * @param {Object} partialSettings - Partial settings to merge
 */
export function updateSettings(partialSettings) {
    settings = { ...settings, ...partialSettings };
}

// ============================================
// Direct State Setters (for batch updates)
// ============================================

/**
 * Set beatmap items directly
 * @param {Array<Object>} items - New beatmap items array
 */
export function setBeatmapItems(items) {
    beatmapItems = items;
}

/**
 * Set todo IDs directly
 * @param {Array<string>} ids - New todo IDs array
 */
export function setTodoIds(ids) {
    todoIds = ids;
}

/**
 * Set done IDs directly
 * @param {Array<string>} ids - New done IDs array
 */
export function setDoneIds(ids) {
    doneIds = ids;
}

/**
 * Set view mode directly
 * @param {string} mode - New view mode
 */
export function setViewMode(mode) {
    viewMode = mode;
}

/**
 * Set sort state directly
 * @param {Object} state - New sort state
 */
export function setSortState(state) {
    sortState = state;
}

/**
 * Set search query directly
 * @param {string} query - New search query
 */
export function setSearchQuery(query) {
    searchQuery = query;
}

/**
 * Set star rating filter directly
 * @param {Object} filter - New SR filter
 */
export function setSrFilter(filter) {
    srFilter = filter;
}

/**
 * Set mode filter directly
 * @param {'all'|'standard'|'taiko'|'catch'|'mania'} filter - New mode filter
 */
export function setModeFilter(filter) {
    modeFilter = filter;
}

/**
 * Set save timer directly
 * @param {number|null} timer - New save timer id
 */
export function setSaveTimer(timer) {
    saveTimer = timer;
}

/**
 * Set audio analysis queue directly
 * @param {Array<string>} queue - New audio analysis queue
 */
export function setAudioAnalysisQueue(queue) {
    audioAnalysisQueue = queue;
}

/**
 * Set audio analysis total directly
 * @param {number} total - New audio analysis total
 */
export function setAudioAnalysisTotal(total) {
    audioAnalysisTotal = total;
}

/**
 * Set star rating queue directly
 * @param {Array<string>} queue - New star rating queue
 */
export function setStarRatingQueue(queue) {
    starRatingQueue = queue;
}

/**
 * Set star rating total directly
 * @param {number} total - New star rating total
 */
export function setStarRatingTotal(total) {
    starRatingTotal = total;
}

/**
 * Set settings directly
 * @param {Object} newSettings - New settings object
 */
export function setSettings(newSettings) {
    settings = newSettings;
}
