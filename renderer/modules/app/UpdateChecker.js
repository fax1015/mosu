/**
 * UpdateChecker Module
 * Handles checking for application updates from GitHub releases
 */

import { showNotification } from '../components/NotificationSystem.js';
import { appInfo } from '../bridge/Tauri.js';

/** @type {string} GitHub API URL for latest release */
const GITHUB_API_URL = 'https://api.github.com/repos/fax1015/mosu/releases/latest';

/** @type {string} GitHub releases page URL */
const GITHUB_RELEASES_URL = 'https://github.com/fax1015/mosu/releases/latest';

/**
 * Check GitHub for new releases
 * Compares current version with latest GitHub release and shows notification if update is available
 * @returns {Promise<{hasUpdate: boolean, currentVersion: string, latestVersion: string, downloadUrl: string}|null>}
 */
export async function checkForUpdates() {
    try {
        // Use the Tauri backend's checkForUpdates function which handles the API call
        if (!appInfo?.checkForUpdates) {
            console.warn('[UpdateChecker] appInfo.checkForUpdates not available');
            return null;
        }

        const result = await appInfo.checkForUpdates();

        const currentVersion = (result.currentVersion || '').replace(/^v/, '');
        const latestVersion = (result.latestVersion || '').replace(/^v/, '');

        // If we got an error or no latest version info, handle gracefully
        if (result.error || !latestVersion) {
            console.warn('[UpdateChecker] Could not check for updates:', result.error);
            return {
                hasUpdate: false,
                currentVersion,
                latestVersion: null,
                downloadUrl: null,
                error: result.error || 'Failed to fetch latest release'
            };
        }

        // Compare versions to check if update is available
        const comparison = compareVersions(currentVersion, latestVersion);
        const hasUpdate = comparison < 0;

        if (hasUpdate) {
            const downloadUrl = result.htmlUrl || GITHUB_RELEASES_URL;
            showUpdateNotification(latestVersion, downloadUrl, currentVersion);
        }

        return {
            hasUpdate,
            currentVersion,
            latestVersion,
            downloadUrl: result.htmlUrl || GITHUB_RELEASES_URL,
            error: null
        };
    } catch (error) {
        console.error('[UpdateChecker] Error checking for updates:', error);
        return {
            hasUpdate: false,
            currentVersion: getCurrentVersion(),
            latestVersion: null,
            downloadUrl: null,
            error: error.message
        };
    }
}

/**
 * Show update available notification
 * @param {string} version - The latest available version
 * @param {string} downloadUrl - URL to download the update
 * @param {string} [currentVersion] - Current installed version (optional)
 */
export function showUpdateNotification(version, downloadUrl, currentVersion = '') {
    const versionInfo = currentVersion
        ? `v${currentVersion} → v${version}`
        : `v${version}`;

    const message = currentVersion
        ? `Update available! You have v${currentVersion}, v${version} is now available.`
        : `Version ${version} is now available for download.`;

    // Create notification with custom click handler
    const container = document.querySelector('.notification-container');
    if (!container) {
        // Fallback to standard notification if container doesn't exist
        showNotification(
            'Update Available',
            `${message} <a href="${downloadUrl}" target="_blank" style="color: var(--accent-primary); text-decoration: underline;">Download now</a>`,
            'default',
            10000
        );
        return;
    }

    // Show the popover
    try {
        if (container.showPopover) {
            container.showPopover();
        }
    } catch (e) {
        // Ignore if already shown
    }

    const notification = document.createElement('div');
    notification.className = 'notification is-update';

    const icon = `<svg class="notification-icon" viewBox="0 0 512 512"><path fill="var(--accent-primary)" d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-144a32 32 0 1 1 0-64 32 32 0 1 1 0 64z"/></svg>`;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'notification-close';
    closeBtn.innerHTML = `<svg viewBox="0 0 384 512"><path fill="currentColor" d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"/></svg>`;
    closeBtn.setAttribute('aria-label', 'Dismiss');

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'notification-action-btn';
    downloadBtn.textContent = 'Download';
    downloadBtn.style.cssText = `
        background: var(--accent-primary);
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        margin-top: 8px;
    `;

    notification.innerHTML = `
        ${icon}
        <div class="notification-content">
            <div class="notification-title">Update Available</div>
            <div class="notification-message">${message}</div>
        </div>
    `;

    // Add download button
    const contentDiv = notification.querySelector('.notification-content');
    contentDiv.appendChild(downloadBtn);

    // Close button handler
    const closeHandler = () => {
        notification.classList.remove('is-visible');
        setTimeout(() => notification.remove(), 300);
    };

    closeBtn.addEventListener('click', closeHandler);

    // Download button handler
    downloadBtn.addEventListener('click', () => {
        if (appInfo?.openExternalUrl) {
            appInfo.openExternalUrl(downloadUrl);
        } else {
            window.open(downloadUrl, '_blank');
        }
        closeHandler();
    });

    notification.appendChild(closeBtn);
    container.appendChild(notification);

    // Trigger animation
    setTimeout(() => notification.classList.add('is-visible'), 10);

    // Auto-remove after 15 seconds
    const timeoutId = setTimeout(() => {
        notification.classList.remove('is-visible');
        setTimeout(() => notification.remove(), 300);
    }, 15000);

    // Clear timeout if manually closed
    closeBtn.addEventListener('click', () => clearTimeout(timeoutId), { once: true });
}

/**
 * Compare two semantic versions
 * @param {string} v1 - First version string (e.g., "1.2.3")
 * @param {string} v2 - Second version string (e.g., "1.2.4")
 * @returns {number} -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
 */
export function compareVersions(v1, v2) {
    // Strip pre-release suffixes (e.g., -beta, -alpha) for base version comparison
    const parseVer = (v) => {
        if (!v) return [0, 0, 0];
        const parts = v.replace(/-.+$/, '').split('.').map(Number);
        return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
    };

    const ver1 = parseVer(v1);
    const ver2 = parseVer(v2);

    for (let i = 0; i < 3; i++) {
        if (ver1[i] < ver2[i]) return -1;
        if (ver1[i] > ver2[i]) return 1;
    }

    // Handle pre-release comparison: 1.0.0-beta < 1.0.0
    const pre1 = v1?.includes('-') ? v1.split('-')[1] : null;
    const pre2 = v2?.includes('-') ? v2.split('-')[1] : null;

    if (pre1 && !pre2) return -1;  // v1 has pre-release, v2 doesn't -> v1 < v2
    if (!pre1 && pre2) return 1;   // v2 has pre-release, v1 doesn't -> v1 > v2
    if (pre1 && pre2) {
        // Both have pre-releases, compare alphabetically
        return pre1.localeCompare(pre2);
    }

    return 0;
}

/**
 * Get the current application version
 * @returns {string} Current version string or 'unknown' if not available
 */
export function getCurrentVersion() {
    // Try to get from window.appInfo first (legacy/global)
    if (typeof window !== 'undefined' && window.appInfo?.getVersion) {
        try {
            return window.appInfo.getVersion();
        } catch (e) {
            console.warn('[UpdateChecker] Error getting version from window.appInfo:', e);
        }
    }

    // Try to get from the tauri bridge
    if (appInfo?.getVersion) {
        try {
            return appInfo.getVersion();
        } catch (e) {
            console.warn('[UpdateChecker] Error getting version from tauri bridge:', e);
        }
    }

    // Fallback: try to extract from package.json or return unknown
    return 'unknown';
}

/**
 * Get the version indicator element and update its state
 * @param {Object} updateInfo - Update information object
 * @param {boolean} updateInfo.hasUpdate - Whether an update is available
 * @param {string} updateInfo.currentVersion - Current version
 * @param {string} [updateInfo.latestVersion] - Latest available version
 * @param {string} [updateInfo.downloadUrl] - URL to download the update
 */
export function updateVersionIndicator({ hasUpdate, currentVersion, latestVersion, downloadUrl }) {
    const indicator = document.getElementById('versionIndicator');
    if (!indicator) return;

    if (!currentVersion || currentVersion === 'unknown') {
        indicator.textContent = '?';
        indicator.dataset.tooltip = 'Could not determine version';
        indicator.className = 'version-indicator error';
        indicator.style.display = '';
        return;
    }

    if (hasUpdate && latestVersion) {
        indicator.textContent = `v${latestVersion} available`;
        indicator.dataset.tooltip = `Update available! Click to view changelog (current: v${currentVersion})`;
        indicator.className = 'version-indicator update-available';
    } else {
        indicator.textContent = `v${currentVersion}`;
        indicator.dataset.tooltip = 'Click to view changelog';
        indicator.className = 'version-indicator up-to-date';
    }

    indicator.style.display = 'inline-flex';
}

/**
 * Legacy checkForUpdates function that also updates the version indicator
 * This matches the behavior of the original renderer.js implementation
 * @returns {Promise<void>}
 */
export async function checkForUpdatesAndUpdateIndicator() {
    const indicator = document.getElementById('versionIndicator');
    if (!indicator) return;

    try {
        const result = await checkForUpdates();

        if (!result) {
            indicator.textContent = '?';
            indicator.dataset.tooltip = 'Could not check for updates';
            indicator.className = 'version-indicator error';
            indicator.style.display = 'inline-flex';
            return;
        }

        updateVersionIndicator({
            hasUpdate: result.hasUpdate,
            currentVersion: result.currentVersion,
            latestVersion: result.latestVersion,
            downloadUrl: result.downloadUrl
        });
    } catch (error) {
        indicator.textContent = '?';
        indicator.dataset.tooltip = 'Could not check for updates';
        indicator.className = 'version-indicator error';
        indicator.style.display = 'inline-flex';
    }
}
