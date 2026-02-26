/**
 * DragAndDrop.js - Drag and drop reordering system for todo list
 * Extracted from renderer.js (lines 5127-5286)
 */

import {
    autoScrollTimer as storeAutoScrollTimer,
    currentMouseY as storeCurrentMouseY
} from '../state/Store.js';

// ============================================
// Constants
// ============================================

/** @type {number} Auto-scroll threshold in pixels from edge */
export const AUTO_SCROLL_THRESHOLD = 120;

/** @type {number} Maximum auto-scroll speed */
export const AUTO_SCROLL_MAX_SPEED = 20;

/** @type {number} Minimum auto-scroll speed */
export const AUTO_SCROLL_MIN_SPEED = 2;

/** @type {number} Drag start threshold (pixels) */
export const DRAG_START_THRESHOLD = 6;

// ============================================
// State
// ============================================

/**
 * @typedef {Object} PointerDragState
 * @property {number|null} pointerId - Active pointer ID
 * @property {boolean} isPointerDown - Whether pointer is down
 * @property {boolean} isDragging - Whether currently dragging
 * @property {HTMLElement|null} draggedElement - Element being dragged
 * @property {string|null} draggedId - ID of dragged item
 * @property {HTMLElement|null} dropTarget - Current drop target
 * @property {number} startX - Starting X position
 * @property {number} startY - Starting Y position
 */

/** @type {PointerDragState} */
export const pointerDragState = {
    pointerId: null,
    isPointerDown: false,
    isDragging: false,
    draggedElement: null,
    draggedId: null,
    dropTarget: null,
    startX: 0,
    startY: 0,
};

/** @type {number|null} Auto-scroll timer ID */
let autoScrollTimer = null;

/** @type {number} Current mouse Y position */
let currentMouseY = 0;

/** @type {boolean} Whether drag and drop is initialized */
let isInitialized = false;

/** @type {HTMLElement|null} List container */
let listContainer = null;

/** @type {string} Current view mode */
let viewMode = 'all';

/** @type {Function|null} Callback for committing reorder */
let onCommitReorder = null;

// ============================================
// Utility Functions
// ============================================

/**
 * Check if drag should be ignored based on target
 * @param {HTMLElement} target - Event target
 * @returns {boolean} Whether to ignore drag
 */
const shouldIgnoreDragStart = (target) => {
    if (!target) return false;
    return Boolean(target.closest(
        'button, a, input, textarea, select, .list-timeline, .deadline-container, .target-star-container, .extra-actions, .list-action-links'
    ));
};

/**
 * Clear current drop target
 */
const clearDropTarget = () => {
    if (pointerDragState.dropTarget) {
        pointerDragState.dropTarget.classList.remove('drop-target');
        pointerDragState.dropTarget = null;
    }
};

/**
 * Reset pointer drag state
 */
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

/**
 * Update drop target based on mouse position
 * @param {number} clientX - Mouse X position
 * @param {number} clientY - Mouse Y position
 */
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

// ============================================
// Auto-Scroll
// ============================================

/**
 * Stop auto-scrolling
 */
export const stopAutoScroll = () => {
    if (autoScrollTimer) {
        clearInterval(autoScrollTimer);
        autoScrollTimer = null;
    }
};

/**
 * Start auto-scrolling
 */
export const startAutoScroll = () => {
    if (autoScrollTimer) return;

    autoScrollTimer = setInterval(() => {
        const h = window.innerHeight;
        let speed = 0;

        if (currentMouseY < AUTO_SCROLL_THRESHOLD) {
            // Scroll up
            speed = -Math.max(
                AUTO_SCROLL_MIN_SPEED,
                (1 - (currentMouseY / AUTO_SCROLL_THRESHOLD)) * AUTO_SCROLL_MAX_SPEED
            );
        } else if (currentMouseY > h - AUTO_SCROLL_THRESHOLD) {
            // Scroll down
            speed = Math.max(
                AUTO_SCROLL_MIN_SPEED,
                (1 - ((h - currentMouseY) / AUTO_SCROLL_THRESHOLD)) * AUTO_SCROLL_MAX_SPEED
            );
        }

        if (speed !== 0) {
            window.scrollBy(0, speed);
        }
    }, 16);
};

/**
 * Update auto-scroll direction based on mouse Y position
 * @param {number} y - Mouse Y position
 */
export const updateAutoScroll = (y) => {
    currentMouseY = y;
};

// ============================================
// Drag Operations
// ============================================

/**
 * Start dragging
 */
const maybeStartDragging = () => {
    if (pointerDragState.isDragging || !pointerDragState.draggedElement) return;

    pointerDragState.isDragging = true;
    pointerDragState.draggedElement.classList.add('is-dragging');
    document.body?.classList.add('is-dragging-any');
    startAutoScroll();
};

/**
 * Commit reorder after drop
 * @param {Array<string>} todoIds - Current todo IDs array
 * @param {Function} setTodoIds - Function to update todo IDs
 * @param {Function} scheduleSave - Function to schedule save
 * @param {Function} renderFromState - Function to re-render
 * @returns {boolean} Whether reorder was committed
 */
export const commitReorder = (todoIds, setTodoIds, scheduleSave, renderFromState) => {
    if (!pointerDragState.draggedId || !pointerDragState.dropTarget) {
        return false;
    }

    const draggedId = pointerDragState.draggedId;
    const dropId = pointerDragState.dropTarget.dataset.itemId;

    if (!dropId || dropId === draggedId) {
        return false;
    }

    const fromIndex = todoIds.indexOf(draggedId);
    const toIndex = todoIds.indexOf(dropId);

    if (fromIndex === -1 || toIndex === -1) {
        return false;
    }

    // Perform the reorder
    const newTodoIds = [...todoIds];
    const [movedItem] = newTodoIds.splice(fromIndex, 1);
    newTodoIds.splice(toIndex, 0, movedItem);

    // Update state
    setTodoIds(newTodoIds);
    scheduleSave();
    renderFromState();

    return true;
};

/**
 * Cancel current drag operation
 */
export const cancelDrag = () => {
    resetPointerDragState();
};

// ============================================
// Event Handlers
// ============================================

/**
 * Handle pointer down on draggable items
 * @param {PointerEvent} e - Pointer event
 */
export const onPointerDown = (e) => {
    // Only allow drag in todo view
    if (viewMode !== 'todo') return;

    // Only left mouse button
    if (e.button !== 0) return;

    const listBox = e.target.closest('.list-box');
    if (!listBox || shouldIgnoreDragStart(e.target)) return;

    pointerDragState.isPointerDown = true;
    pointerDragState.pointerId = e.pointerId;
    pointerDragState.draggedElement = listBox;
    pointerDragState.draggedId = listBox.dataset.itemId;
    pointerDragState.startX = e.clientX;
    pointerDragState.startY = e.clientY;
    currentMouseY = e.clientY;
};

/**
 * Handle pointer move during drag
 * @param {PointerEvent} e - Pointer event
 */
export const onPointerMove = (e) => {
    if (!pointerDragState.isPointerDown || e.pointerId !== pointerDragState.pointerId) {
        return;
    }

    const deltaX = Math.abs(e.clientX - pointerDragState.startX);
    const deltaY = Math.abs(e.clientY - pointerDragState.startY);

    // Check if we've moved enough to start dragging
    if (!pointerDragState.isDragging && deltaX + deltaY > DRAG_START_THRESHOLD) {
        maybeStartDragging();
    }

    if (!pointerDragState.isDragging) return;

    e.preventDefault();
    currentMouseY = e.clientY;
    updateDropTarget(e.clientX, e.clientY);
};

/**
 * Handle pointer up / drop
 * @param {PointerEvent} e - Pointer event
 * @param {Object} callbacks - Callback functions
 * @param {Array<string>} callbacks.todoIds - Current todo IDs
 * @param {Function} callbacks.setTodoIds - Set todo IDs function
 * @param {Function} callbacks.scheduleSave - Schedule save function
 * @param {Function} callbacks.renderFromState - Render function
 */
export const onPointerUp = (e, callbacks) => {
    if (!pointerDragState.isPointerDown || e.pointerId !== pointerDragState.pointerId) {
        return;
    }

    if (pointerDragState.isDragging && callbacks) {
        commitReorder(
            callbacks.todoIds,
            callbacks.setTodoIds,
            callbacks.scheduleSave,
            callbacks.renderFromState
        );
    }

    resetPointerDragState();
};

// ============================================
// State Getters
// ============================================

/**
 * Get current drag state
 * @returns {PointerDragState} Current drag state
 */
export const getDragState = () => ({ ...pointerDragState });

/**
 * Check if currently dragging
 * @returns {boolean} Whether dragging
 */
export const isDragging = () => pointerDragState.isDragging;

/**
 * Get current auto-scroll timer
 * @returns {number|null} Timer ID
 */
export const getAutoScrollTimer = () => autoScrollTimer;

/**
 * Get current mouse Y position
 * @returns {number} Mouse Y position
 */
export const getCurrentMouseY = () => currentMouseY;

// ============================================
// Initialization
// ============================================

/** @type {Function|null} Bound pointer handlers */
let boundPointerDown = null;
let boundPointerMove = null;
let boundPointerUp = null;
let boundPointerCancel = null;

/**
 * Initialize drag and drop
 * @param {Object} callbacks - Callback functions
 * @param {string} callbacks.viewMode - Current view mode
 * @param {Array<string>} callbacks.todoIds - Todo IDs array
 * @param {Function} callbacks.setTodoIds - Set todo IDs function
 * @param {Function} callbacks.scheduleSave - Schedule save function
 * @param {Function} callbacks.renderFromState - Render function
 * @returns {boolean} Whether initialization succeeded
 */
export const initDragAndDrop = (callbacks) => {
    if (isInitialized) {
        console.warn('[DragAndDrop] Already initialized');
        return false;
    }

    listContainer = document.querySelector('#listContainer');
    if (!listContainer) {
        console.warn('[DragAndDrop] List container not found');
        return false;
    }

    viewMode = callbacks.viewMode || 'all';

    // Bind handlers with callbacks
    boundPointerDown = onPointerDown;
    boundPointerMove = (e) => onPointerMove(e);
    boundPointerUp = (e) => onPointerUp(e, callbacks);
    boundPointerCancel = (e) => onPointerUp(e, callbacks);

    // Add event listeners
    listContainer.addEventListener('pointerdown', boundPointerDown);
    window.addEventListener('pointermove', boundPointerMove, { passive: false });
    window.addEventListener('pointerup', boundPointerUp);
    window.addEventListener('pointercancel', boundPointerCancel);

    isInitialized = true;
    console.log('[DragAndDrop] Initialized');
    return true;
};

/**
 * Update view mode for drag and drop
 * @param {string} newViewMode - New view mode
 */
export const updateViewMode = (newViewMode) => {
    viewMode = newViewMode;
};

/**
 * Destroy drag and drop and clean up
 */
export const destroyDragAndDrop = () => {
    if (!isInitialized) return;

    // Cancel any active drag
    cancelDrag();

    // Remove event listeners
    if (listContainer && boundPointerDown) {
        listContainer.removeEventListener('pointerdown', boundPointerDown);
    }

    if (boundPointerMove) {
        window.removeEventListener('pointermove', boundPointerMove);
    }

    if (boundPointerUp) {
        window.removeEventListener('pointerup', boundPointerUp);
    }

    if (boundPointerCancel) {
        window.removeEventListener('pointercancel', boundPointerCancel);
    }

    listContainer = null;
    boundPointerDown = null;
    boundPointerMove = null;
    boundPointerUp = null;
    boundPointerCancel = null;
    isInitialized = false;

    console.log('[DragAndDrop] Destroyed');
};

/**
 * Check if drag and drop is initialized
 * @returns {boolean} Whether initialized
 */
export const isDragAndDropInitialized = () => isInitialized;
