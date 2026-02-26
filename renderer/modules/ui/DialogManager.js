/**
 * DialogManager.js - Dialog management system
 * Extracted from renderer.js (lines 2589-2617)
 */

// ============================================
// Dialog Animation
// ============================================

/**
 * Close dialog with animation
 * @param {HTMLDialogElement} dialog - Dialog element to close
 * @returns {Promise<void>} Promise that resolves when dialog is closed
 */
export const closeDialogWithAnimation = (dialog) => {
    return new Promise((resolve) => {
        if (!dialog || !dialog.open) {
            resolve();
            return;
        }

        let resolved = false;
        const doResolve = () => {
            if (resolved) return;
            resolved = true;
            dialog.classList.remove('is-closing');
            dialog.close();
            dialog.removeEventListener('animationend', onAnimationEnd);
            resolve();
        };

        const onAnimationEnd = (event) => {
            if (event.target !== dialog) return;
            doResolve();
        };

        dialog.classList.add('is-closing');
        dialog.addEventListener('animationend', onAnimationEnd);

        // Safety fallback: if animation fails to fire or takes too long, close anyway
        setTimeout(doResolve, 500);
    });
};

// ============================================
// Dialog Opening
// ============================================

/**
 * Open dialog by ID
 * @param {string} dialogId - Dialog element ID
 * @returns {HTMLDialogElement|null} The opened dialog element or null
 */
export const openDialog = (dialogId) => {
    const dialog = document.querySelector(`#${dialogId}`);
    if (!dialog) return null;

    dialog.showModal();
    dialog.classList.remove('is-closing');
    return dialog;
};

// ============================================
// Custom Dialog Creation
// ============================================

/**
 * Create a custom dialog
 * @param {Object} options - Dialog options
 * @param {string} options.title - Dialog title
 * @param {string} options.content - Dialog content (HTML string)
 * @param {Array<{text: string, action: string, primary?: boolean}>} options.buttons - Dialog buttons
 * @param {Function} options.onAction - Callback when action is triggered (action: string) => void
 * @returns {HTMLDialogElement} Created dialog element
 */
export const createDialog = (options) => {
    const dialog = document.createElement('dialog');
    dialog.classList.add('custom-dialog');

    const content = document.createElement('div');
    content.classList.add('dialog-content');

    if (options.title) {
        const title = document.createElement('h3');
        title.classList.add('dialog-title');
        title.textContent = options.title;
        content.appendChild(title);
    }

    if (options.content) {
        const body = document.createElement('div');
        body.classList.add('dialog-body');
        body.innerHTML = options.content;
        content.appendChild(body);
    }

    const buttonsContainer = document.createElement('div');
    buttonsContainer.classList.add('dialog-buttons');

    if (options.buttons) {
        options.buttons.forEach(btn => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = btn.text;
            button.classList.add('dialog-button');
            if (btn.primary) {
                button.classList.add('is-primary');
            }
            button.addEventListener('click', () => {
                if (options.onAction) {
                    options.onAction(btn.action);
                }
                if (btn.action !== 'cancel') {
                    closeDialogWithAnimation(dialog);
                }
            });
            buttonsContainer.appendChild(button);
        });
    }

    content.appendChild(buttonsContainer);
    dialog.appendChild(content);
    document.body.appendChild(dialog);

    return dialog;
};

// ============================================
// Pre-built Dialogs
// ============================================

/**
 * Show confirmation dialog
 * @param {Object} options - Dialog options
 * @param {string} options.title - Dialog title
 * @param {string} options.message - Dialog message
 * @param {string} [options.confirmText='Confirm'] - Confirm button text
 * @param {string} [options.cancelText='Cancel'] - Cancel button text
 * @returns {Promise<boolean>} Promise resolving to true if confirmed, false if cancelled
 */
export const showConfirmDialog = (options) => {
    return new Promise((resolve) => {
        const dialog = createDialog({
            title: options.title,
            content: `<p>${options.message}</p>`,
            buttons: [
                { text: options.cancelText || 'Cancel', action: 'cancel' },
                { text: options.confirmText || 'Confirm', action: 'confirm', primary: true }
            ],
            onAction: (action) => {
                resolve(action === 'confirm');
                dialog.remove();
            }
        });
        dialog.showModal();
    });
};

/**
 * Show alert dialog
 * @param {Object} options - Dialog options
 * @param {string} options.title - Dialog title
 * @param {string} options.message - Dialog message
 * @param {string} [options.okText='OK'] - OK button text
 * @returns {Promise<void>} Promise that resolves when dialog is closed
 */
export const showAlertDialog = (options) => {
    return new Promise((resolve) => {
        const dialog = createDialog({
            title: options.title,
            content: `<p>${options.message}</p>`,
            buttons: [
                { text: options.okText || 'OK', action: 'ok', primary: true }
            ],
            onAction: () => {
                resolve();
                dialog.remove();
            }
        });
        dialog.showModal();
    });
};

/**
 * Show prompt dialog
 * @param {Object} options - Dialog options
 * @param {string} options.title - Dialog title
 * @param {string} options.message - Dialog message
 * @param {string} [options.defaultValue=''] - Default input value
 * @param {string} [options.confirmText='OK'] - Confirm button text
 * @param {string} [options.cancelText='Cancel'] - Cancel button text
 * @returns {Promise<string|null>} Promise resolving to input value, or null if cancelled
 */
export const showPromptDialog = (options) => {
    return new Promise((resolve) => {
        const inputId = 'dialog-prompt-input-' + Date.now();
        const dialog = createDialog({
            title: options.title,
            content: `
                <p>${options.message}</p>
                <input type="text" id="${inputId}" class="dialog-input" value="${options.defaultValue || ''}">
            `,
            buttons: [
                { text: options.cancelText || 'Cancel', action: 'cancel' },
                { text: options.confirmText || 'OK', action: 'confirm', primary: true }
            ],
            onAction: (action) => {
                if (action === 'confirm') {
                    const input = dialog.querySelector(`#${inputId}`);
                    resolve(input ? input.value : null);
                } else {
                    resolve(null);
                }
                dialog.remove();
            }
        });
        dialog.showModal();
        // Focus input after dialog opens
        requestAnimationFrame(() => {
            const input = dialog.querySelector(`#${inputId}`);
            if (input) input.focus();
        });
    });
};

// ============================================
// Dialog Helpers
// ============================================

/**
 * Close all open dialogs
 * @returns {Promise<void>}
 */
export const closeAllDialogs = async () => {
    const dialogs = document.querySelectorAll('dialog[open]');
    const promises = Array.from(dialogs).map(dialog => closeDialogWithAnimation(dialog));
    await Promise.all(promises);
};

/**
 * Check if any dialog is open
 * @returns {boolean} Whether any dialog is open
 */
export const isDialogOpen = () => {
    return document.querySelectorAll('dialog[open]').length > 0;
};

/**
 * Get the topmost open dialog
 * @returns {HTMLDialogElement|null} The topmost open dialog or null
 */
export const getOpenDialog = () => {
    const dialogs = document.querySelectorAll('dialog[open]');
    return dialogs.length > 0 ? dialogs[dialogs.length - 1] : null;
};
