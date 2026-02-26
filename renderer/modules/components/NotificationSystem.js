/**
 * Show a notification toast
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} type - Notification type: 'default', 'success', or 'error'
 * @param {number} duration - Duration in milliseconds (default: 5000)
 */
export const showNotification = (title, message, type = 'default', duration = 5000) => {
    let container = document.querySelector('.notification-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'notification-container';
        container.setAttribute('popover', 'manual');
        document.body.appendChild(container);

        // Show the popover so it enters the top layer
        try {
            if (container.showPopover) {
                container.showPopover();
            }
        } catch (e) {
            console.warn('[mosu] Popover API not available for notifications:', e);
        }
    } else {
        // Re-show to bring to top of top layer (above dialogs)
        try {
            if (container.showPopover) {
                container.showPopover();
            }
        } catch (e) {
            // Ignore if already shown
        }
    }

    const notification = document.createElement('div');
    notification.className = `notification is-${type}`;

    let icon = '';
    if (type === 'success') {
        icon = `<svg class="notification-icon" viewBox="0 0 512 512"><path fill="var(--success)" d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM369 209L241 337c-9.4 9.4-24.6 9.4-33.9 0l-64-64c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l47 47L335 175c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9z"/></svg>`;
    } else if (type === 'error') {
        icon = `<svg class="notification-icon" viewBox="0 0 512 512"><path fill="var(--error)" d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm0-384c13.3 0 24 10.7 24 24V264c0 13.3-10.7 24-24 24s-24-10.7-24-24V152c0-13.3 10.7-24 24-24zM224 352a32 32 0 1 1 64 0a32 32 0 1 1 -64 0z"/></svg>`;
    } else {
        icon = `<svg class="notification-icon" viewBox="0 0 512 512"><path fill="var(--accent-primary)" d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-144a32 32 0 1 1 0-64 32 32 0 1 1 0 64z"/></svg>`;
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'notification-close';
    closeBtn.innerHTML = `<svg viewBox="0 0 384 512"><path fill="currentColor" d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"/></svg>`;
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.addEventListener('click', () => {
        notification.classList.remove('is-visible');
        setTimeout(() => notification.remove(), 300);
    });

    notification.innerHTML = `
        ${icon}
        <div class="notification-content">
            <div class="notification-title">${title}</div>
            <div class="notification-message">${message}</div>
        </div>
    `;

    notification.appendChild(closeBtn);
    container.appendChild(notification);

    // Trigger animation
    setTimeout(() => notification.classList.add('is-visible'), 10);

    // Remove after duration
    const timeoutId = setTimeout(() => {
        notification.classList.remove('is-visible');
        setTimeout(() => notification.remove(), 300);
    }, duration);

    // Clear timeout if manually closed
    closeBtn.addEventListener('click', () => clearTimeout(timeoutId), { once: true });
};
