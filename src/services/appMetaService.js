import { get } from 'svelte/store';
import { appVersion, versionIndicatorState } from '../stores/appMeta';
import { showChangelogDialog } from './dialogService';

const parseVersion = (value) => {
  const stripped = String(value || '').replace(/^v/, '');
  const base = stripped.replace(/-.+$/, '');
  const [major, minor, patch] = base.split('.').map((part) => Number(part) || 0);
  return { stripped, parts: [major, minor, patch] };
};

const isAtLeast = (current, latest) => {
  const [cMaj, cMin, cPatch] = parseVersion(current).parts;
  const [lMaj, lMin, lPatch] = parseVersion(latest).parts;
  return cMaj > lMaj ||
    (cMaj === lMaj && cMin > lMin) ||
    (cMaj === lMaj && cMin === lMin && cPatch >= lPatch);
};

export const initializeAppMeta = async () => {
  const api = window.appInfo;
  if (!api) return;

  let currentVersion = '';
  if (typeof api.getVersion === 'function') {
    try {
      currentVersion = String(await api.getVersion() || '').replace(/^v/, '');
      if (currentVersion) {
        appVersion.set(currentVersion);

        const lastSeenVersion = localStorage.getItem('mosu_lastSeenVersion');
        if (lastSeenVersion && lastSeenVersion !== currentVersion) {
          showChangelogDialog();
        }
        localStorage.setItem('mosu_lastSeenVersion', currentVersion);
      }
    } catch {
      // Non-fatal. Version label remains default.
    }
  }

  if (typeof api.checkForUpdates !== 'function') {
    if (currentVersion) {
      versionIndicatorState.set({
        visible: true,
        text: `v${currentVersion}`,
        tooltip: `Current version: v${currentVersion}`,
        className: 'version-indicator up-to-date',
        updateUrl: null,
      });
    }
    return;
  }

  try {
    const result = await api.checkForUpdates();
    const current = (result.currentVersion || currentVersion || '').replace(/^v/, '');
    const latest = (result.latestVersion || '').replace(/^v/, '');

    if (result.error || !latest) {
      versionIndicatorState.set({
        visible: true,
        text: current ? `v${current}` : '?',
        tooltip: current ? `Current version: v${current}` : 'Could not check for updates',
        className: current ? 'version-indicator up-to-date' : 'version-indicator error',
        updateUrl: null,
      });
      return;
    }

    if (isAtLeast(current, latest)) {
      versionIndicatorState.set({
        visible: true,
        text: `v${current}`,
        tooltip: 'You are on the latest version',
        className: 'version-indicator up-to-date',
        updateUrl: null,
      });
      return;
    }

    versionIndicatorState.set({
      visible: true,
      text: `v${latest} available`,
      tooltip: `Update available! Click to open download page (current: v${current})`,
      className: 'version-indicator update-available',
      updateUrl: result.htmlUrl || null,
    });
  } catch {
    versionIndicatorState.set({
      visible: true,
      text: '?',
      tooltip: 'Could not check for updates',
      className: 'version-indicator error',
      updateUrl: null,
    });
  }
};

export const handleVersionIndicatorClick = () => {
  const { updateUrl } = get(versionIndicatorState);
  if (updateUrl && window.appInfo?.openExternalUrl) {
    window.appInfo.openExternalUrl(updateUrl);
  }
};
