/**
 * DropdownMenu.js - Reusable custom dropdown menu controller
 */

const dropdownInstances = new Set();

let globalHandlersBound = false;
let onDocumentClick = null;
let onDocumentKeydown = null;

const bindGlobalHandlers = () => {
    if (globalHandlersBound) return;

    onDocumentClick = (event) => {
        const target = event.target;
        dropdownInstances.forEach((instance) => {
            if (!instance.root.contains(target)) {
                instance.close();
            }
        });
    };

    onDocumentKeydown = (event) => {
        if (event.key !== 'Escape') return;
        dropdownInstances.forEach((instance) => instance.close());
    };

    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeydown);
    globalHandlersBound = true;
};

const unbindGlobalHandlers = () => {
    if (!globalHandlersBound || dropdownInstances.size > 0) return;
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKeydown);
    onDocumentClick = null;
    onDocumentKeydown = null;
    globalHandlersBound = false;
};

/**
 * Create a custom dropdown controller.
 * @param {Object} config
 * @param {string|HTMLElement} config.root - Root dropdown element or selector
 * @param {string} [config.triggerSelector='.sort-trigger'] - Trigger selector (inside root)
 * @param {string} [config.optionSelector='.sort-option'] - Option selector (inside root)
 * @param {string} [config.labelSelector='.sort-label'] - Label selector (inside root)
 * @param {string} [config.openClass='is-open'] - CSS class for open state
 * @param {string} [config.activeClass='is-active'] - CSS class for active option
 * @param {string} [config.valueAttribute='value'] - Option dataset key containing value
 * @param {string} [config.labelAttribute='label'] - Option dataset key containing label
 * @param {boolean} [config.closeOnSelect=true] - Close menu after selecting
 * @param {Function} [config.onChange] - Called when an option is selected
 * @returns {Object|null}
 */
export const createDropdownMenu = (config = {}) => {
    const {
        root,
        triggerSelector = '.sort-trigger',
        optionSelector = '.sort-option',
        labelSelector = '.sort-label',
        openClass = 'is-open',
        activeClass = 'is-active',
        valueAttribute = 'value',
        labelAttribute = 'label',
        closeOnSelect = true,
        onChange = null
    } = config;

    const rootEl = typeof root === 'string' ? document.querySelector(root) : root;
    if (!rootEl) return null;

    const triggerEl = rootEl.querySelector(triggerSelector);
    const labelEl = labelSelector ? rootEl.querySelector(labelSelector) : null;
    const optionElements = Array.from(rootEl.querySelectorAll(optionSelector));

    if (!triggerEl || optionElements.length === 0) return null;

    const getOptionValue = (optionEl) => optionEl.dataset?.[valueAttribute] || '';
    const getOptionLabel = (optionEl) => optionEl.dataset?.[labelAttribute] || optionEl.textContent.trim();

    let currentValue = '';

    const close = () => {
        rootEl.classList.remove(openClass);
        triggerEl.setAttribute('aria-expanded', 'false');
    };

    const open = () => {
        rootEl.classList.add(openClass);
        triggerEl.setAttribute('aria-expanded', 'true');
    };

    const toggle = () => {
        if (rootEl.classList.contains(openClass)) {
            close();
        } else {
            open();
        }
    };

    const setValue = (nextValue, options = {}) => {
        const { emit = false, event = null } = options;
        const previousValue = currentValue;
        currentValue = String(nextValue || '');

        const selectedOption = optionElements.find((optionEl) => getOptionValue(optionEl) === currentValue);

        optionElements.forEach((optionEl) => {
            const isActive = getOptionValue(optionEl) === currentValue;
            optionEl.classList.toggle(activeClass, isActive);
        });

        if (labelEl && selectedOption) {
            labelEl.textContent = getOptionLabel(selectedOption);
        }

        if (emit && typeof onChange === 'function' && selectedOption) {
            onChange({
                value: currentValue,
                previousValue,
                option: selectedOption,
                event
            });
        }
    };

    const onTriggerClickLocal = (event) => {
        event.preventDefault();
        toggle();
    };

    triggerEl.addEventListener('click', onTriggerClickLocal);

    const optionHandlers = optionElements.map((optionEl) => {
        const handler = (event) => {
            event.preventDefault();
            const value = getOptionValue(optionEl);
            setValue(value, { emit: true, event });
            if (closeOnSelect) close();
        };
        optionEl.addEventListener('click', handler);
        return { optionEl, handler };
    });

    triggerEl.setAttribute('aria-expanded', 'false');

    const instance = {
        root: rootEl,
        trigger: triggerEl,
        open,
        close,
        toggle,
        getValue: () => currentValue,
        setValue,
        destroy: () => {
            close();
            triggerEl.removeEventListener('click', onTriggerClickLocal);
            optionHandlers.forEach(({ optionEl, handler }) => optionEl.removeEventListener('click', handler));
            dropdownInstances.delete(instance);
            unbindGlobalHandlers();
        }
    };

    dropdownInstances.add(instance);
    bindGlobalHandlers();

    return instance;
};

/**
 * Close all registered dropdown menus.
 */
export const closeAllDropdownMenus = () => {
    dropdownInstances.forEach((instance) => instance.close());
};

