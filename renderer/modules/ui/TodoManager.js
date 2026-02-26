/**
 * TodoManager.js - Todo/done management system
 * Extracted from renderer.js (lines 2513-2586)
 */

// ============================================
// Todo/Done Toggling
// ============================================

/**
 * Toggle todo (pin/unpin) state for an item
 * @param {string} itemId - Item ID
 * @param {Object} callbacks - Callback functions
 * @param {Array<string>} callbacks.todoIds - Array of todo item IDs
 * @param {Array<string>} callbacks.doneIds - Array of done item IDs
 * @param {Function} callbacks.setTodoIds - Function to set todo IDs
 * @param {Function} callbacks.updateTabCounts - Function to update tab counts
 * @param {Function} callbacks.scheduleSave - Function to schedule save
 * @param {string} callbacks.viewMode - Current view mode
 * @param {Function} callbacks.removeItemFromView - Function to remove item from view
 * @param {Function} callbacks.updateListItemElement - Function to update list item element
 * @param {Function} callbacks.insertItemIntoTodoView - Function to insert item into todo view
 */
export const toggleTodo = (itemId, callbacks) => {
    const wasPinned = callbacks.todoIds.includes(itemId);
    if (wasPinned) {
        // Remove from todo list
        const newTodoIds = callbacks.todoIds.filter(id => id !== itemId);
        callbacks.setTodoIds(newTodoIds);
        callbacks.updateTabCounts();
        callbacks.scheduleSave();

        if (callbacks.viewMode === 'todo') {
            // Remove the element from the current view with an animation
            callbacks.removeItemFromView(itemId);
        } else {
            // Just update the existing element appearance
            callbacks.updateListItemElement(itemId);
        }
    } else {
        // Add to todo list (at end)
        const newTodoIds = [...callbacks.todoIds, itemId];
        callbacks.setTodoIds(newTodoIds);
        callbacks.updateTabCounts();
        callbacks.scheduleSave();

        if (callbacks.viewMode === 'todo') {
            callbacks.insertItemIntoTodoView(itemId);
        } else {
            callbacks.updateListItemElement(itemId);
        }
    }
};

/**
 * Toggle done state for an item
 * @param {string} itemId - Item ID
 * @param {Object} callbacks - Callback functions
 * @param {Array<string>} callbacks.todoIds - Array of todo item IDs
 * @param {Array<string>} callbacks.doneIds - Array of done item IDs
 * @param {Function} callbacks.setTodoIds - Function to set todo IDs
 * @param {Function} callbacks.setDoneIds - Function to set done IDs
 * @param {Function} callbacks.updateTabCounts - Function to update tab counts
 * @param {Function} callbacks.scheduleSave - Function to schedule save
 * @param {string} callbacks.viewMode - Current view mode
 * @param {Function} callbacks.removeItemFromView - Function to remove item from view
 * @param {Function} callbacks.insertItemIntoTodoView - Function to insert item into todo view
 * @param {Function} callbacks.insertItemIntoCompletedView - Function to insert item into completed view
 * @param {Function} callbacks.updateListItemElement - Function to update list item element
 */
export const toggleDone = (itemId, callbacks) => {
    const wasDone = callbacks.doneIds.includes(itemId);
    if (wasDone) {
        // Unmarking as done: remove from done list and return to Todo
        const newDoneIds = callbacks.doneIds.filter(id => id !== itemId);
        callbacks.setDoneIds(newDoneIds);
        
        let newTodoIds = [...callbacks.todoIds];
        if (!newTodoIds.includes(itemId)) {
            // Add to front of the todo list
            newTodoIds.unshift(itemId);
        }
        callbacks.setTodoIds(newTodoIds);

        callbacks.updateTabCounts();
        callbacks.scheduleSave();

        if (callbacks.viewMode === 'completed') {
            callbacks.removeItemFromView(itemId);
        } else if (callbacks.viewMode === 'todo') {
            callbacks.insertItemIntoTodoView(itemId);
        } else {
            callbacks.updateListItemElement(itemId);
        }
    } else {
        // Marking as done: add and remove from todo
        const newDoneIds = [...callbacks.doneIds, itemId];
        callbacks.setDoneIds(newDoneIds);
        const newTodoIds = callbacks.todoIds.filter(id => id !== itemId);
        callbacks.setTodoIds(newTodoIds);

        callbacks.updateTabCounts();
        callbacks.scheduleSave();

        if (callbacks.viewMode === 'todo') {
            callbacks.removeItemFromView(itemId);
        } else if (callbacks.viewMode === 'completed') {
            callbacks.insertItemIntoCompletedView(itemId);
        } else {
            callbacks.updateListItemElement(itemId);
        }
    }
};

// ============================================
// View Insertion/Removal
// ============================================

/**
 * Insert item into todo view
 * @param {string} itemId - Item ID
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.renderFromState - Function to re-render from state
 */
export const insertItemIntoTodoView = (itemId, callbacks) => {
    callbacks.renderFromState();
};

/**
 * Insert item into completed view
 * @param {string} itemId - Item ID
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.renderFromState - Function to re-render from state
 */
export const insertItemIntoCompletedView = (itemId, callbacks) => {
    callbacks.renderFromState();
};

/**
 * Remove item from view with animation
 * @param {string} itemId - Item ID
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.renderFromState - Function to re-render from state
 * @param {Function} callbacks.animateRemoveElement - Function to animate element removal
 * @param {Array<Object>} callbacks.itemsToRender - Items currently being rendered
 */
export const removeItemFromView = (itemId, callbacks) => {
    const listContainer = document.querySelector('#listContainer');
    const existingEl = listContainer?.querySelector(`[data-item-id="${itemId}"]`);

    // If it's the last item, we want an immediate collapse of the container
    const isLastItem = callbacks.itemsToRender.length <= 1;

    if (existingEl) {
        callbacks.animateRemoveElement(existingEl);

        // Delay full re-render so following items don't snap instantly,
        // but if it's the last item, collapse immediately.
        setTimeout(() => {
            callbacks.renderFromState();
        }, isLastItem ? 0 : 300);
    } else {
        callbacks.renderFromState();
    }
};

/**
 * Animate element removal with CSS transition
 * @param {HTMLElement} element - Element to remove
 * @param {Function} onComplete - Callback when animation completes
 */
export const animateRemoveElement = (element, onComplete) => {
    if (!element) return;
    element.style.height = `${element.offsetHeight}px`;
    void element.offsetHeight;
    element.classList.add('removing');

    const onDone = () => {
        if (element.parentElement) element.remove();
        if (onComplete) onComplete();
    };

    element.addEventListener('transitionend', (event) => {
        if (event.target === element && event.propertyName === 'height') {
            onDone();
        }
    }, { once: true });

    // Safety fallback
    setTimeout(onDone, 600);
};

// ============================================
// Todo Reordering
// ============================================

/**
 * Reorder todos based on new order
 * @param {Array<string>} newOrder - New order of todo IDs
 * @param {Object} callbacks - Callback functions
 * @param {Function} callbacks.setTodoIds - Function to set todo IDs
 * @param {Function} callbacks.scheduleSave - Function to schedule save
 * @param {Function} callbacks.renderFromState - Function to re-render from state
 */
export const reorderTodos = (newOrder, callbacks) => {
    callbacks.setTodoIds(newOrder);
    callbacks.scheduleSave();
    callbacks.renderFromState();
};

// ============================================
// Index Getters
// ============================================

/**
 * Get todo index for an item
 * @param {string} itemId - Item ID
 * @param {Array<string>} todoIds - Array of todo item IDs
 * @returns {number} Index in todo list (-1 if not found)
 */
export const getTodoIndex = (itemId, todoIds) => {
    return todoIds.indexOf(itemId);
};

/**
 * Get done index for an item
 * @param {string} itemId - Item ID
 * @param {Array<string>} doneIds - Array of done item IDs
 * @returns {number} Index in done list (-1 if not found)
 */
export const getDoneIndex = (itemId, doneIds) => {
    return doneIds.indexOf(itemId);
};

/**
 * Check if item is in todo list
 * @param {string} itemId - Item ID
 * @param {Array<string>} todoIds - Array of todo item IDs
 * @returns {boolean} Whether item is in todo list
 */
export const isInTodo = (itemId, todoIds) => {
    return todoIds.includes(itemId);
};

/**
 * Check if item is in done list
 * @param {string} itemId - Item ID
 * @param {Array<string>} doneIds - Array of done item IDs
 * @returns {boolean} Whether item is in done list
 */
export const isInDone = (itemId, doneIds) => {
    return doneIds.includes(itemId);
};
