import { beatmapApi } from '../bridge/Tauri.js';
import * as Store from '../state/Store.js';
import * as Persistence from '../state/Persistence.js';
import { showNotification } from '../components/NotificationSystem.js';
import { createDropdownMenu } from '../ui/DropdownMenu.js';

const CLIENT_STABLE = 'stable';
const CLIENT_LAZER = 'lazer';

const collectionCache = {
    stable: [],
    lazer: [],
};

const COLLECTION_MODE_REFRESH_INTERVAL_MS = 4000;

let targetCollectionDropdownMenu = null;
let targetCollectionCallbacks = {};
let collectionModeAutoRefreshCallbacks = {};
let collectionModeAutoRefreshTimer = null;
let collectionModeAutoRefreshBound = false;
let collectionModeAutoRefreshInFlight = false;

const getActiveOsuClient = () => Store.settings.osuClient === CLIENT_LAZER ? CLIENT_LAZER : CLIENT_STABLE;

const getImportNameKey = (client = getActiveOsuClient()) => (
    client === CLIENT_LAZER ? 'lazerImportedCollectionName' : 'stableImportedCollectionName'
);

const getImportSignatureKey = (client = getActiveOsuClient()) => (
    client === CLIENT_LAZER ? 'lazerImportedCollectionSignature' : 'stableImportedCollectionSignature'
);

const normalizeHash = (value) => String(value || '').trim().toLowerCase();

const deriveLazerBeatmapHash = (filePath) => {
    const normalized = String(filePath || '').trim().replace(/\\/g, '/');
    const fileName = normalized.split('/').pop() || '';
    return normalizeHash(fileName);
};

const joinPath = (basePath, fileName) => {
    if (!basePath) return fileName;
    const separator = basePath.includes('\\') ? '\\' : '/';
    return `${basePath.replace(/[\\/]+$/, '')}${separator}${fileName}`;
};

const getParentPath = (filePath) => {
    const normalized = String(filePath || '').trim().replace(/[\\/]+$/, '');
    const lastSlash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
    return lastSlash === -1 ? '' : normalized.slice(0, lastSlash);
};

const getStableCollectionDbPath = () => {
    const songsDir = Store.settings.stableSongsDir || Store.settings.songsDir || '';
    const parentDir = getParentPath(songsDir);
    return parentDir ? joinPath(parentDir, 'collection.db') : '';
};

const createCollectionSignature = (collection) => {
    const hashes = Array.from(new Set((collection?.beatmapHashes || []).map(normalizeHash).filter(Boolean))).sort();
    let hash = 2166136261;
    const source = `${collection?.name || ''}\n${hashes.join('\n')}`;

    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return `${hashes.length}:${(hash >>> 0).toString(16)}`;
};

const getTargetCollectionDropdown = () => document.getElementById('collectionsTargetDropdown');
const getTargetCollectionTrigger = () => document.getElementById('collectionsTargetTrigger');
const getTargetCollectionLabel = () => document.getElementById('collectionsTargetLabel');
const getTargetCollectionMenu = () => document.getElementById('collectionsTargetMenu');

const resolveStoredCollectionName = (client = getActiveOsuClient()) => (
    String(Store.settings[getImportNameKey(client)] || '').trim()
);

const persistSelectedCollectionName = (collectionName, client = getActiveOsuClient()) => {
    Store.updateSettings({
        [getImportNameKey(client)]: collectionName || null,
        [getImportSignatureKey(client)]: null,
    });
    Persistence.persistSettings();
};

const persistCollectionSelection = (collection, client = getActiveOsuClient()) => {
    Store.updateSettings({
        [getImportNameKey(client)]: collection?.name || null,
        [getImportSignatureKey(client)]: collection ? createCollectionSignature(collection) : null,
    });
    Persistence.persistSettings();
};

const resolveItemBeatmapHash = (item, client = getActiveOsuClient()) => {
    const existing = normalizeHash(item?.beatmapHash);
    if (existing) return existing;

    if (client === CLIENT_LAZER) {
        const derived = deriveLazerBeatmapHash(item?.filePath);
        if (derived) {
            item.beatmapHash = derived;
        }
        return derived;
    }

    return '';
};

const normalizeLazerHashesInMemory = () => {
    if (getActiveOsuClient() !== CLIENT_LAZER) {
        return false;
    }

    let changed = false;
    Store.beatmapItems.forEach((item) => {
        if (!normalizeHash(item.beatmapHash)) {
            const derived = deriveLazerBeatmapHash(item.filePath);
            if (derived) {
                item.beatmapHash = derived;
                changed = true;
            }
        }
    });

    if (changed) {
        Persistence.scheduleSave();
    }

    return changed;
};

const findCollectionByName = (collections, collectionName) => (
    collections.find((entry) => entry.name?.toLowerCase() === String(collectionName || '').trim().toLowerCase())
);

const destroyTargetCollectionDropdownMenu = () => {
    if (!targetCollectionDropdownMenu) {
        return;
    }

    targetCollectionDropdownMenu.destroy();
    targetCollectionDropdownMenu = null;
};

const setTargetCollectionDropdownDisabled = (disabled) => {
    const dropdown = getTargetCollectionDropdown();
    const trigger = getTargetCollectionTrigger();

    dropdown?.classList.toggle('is-disabled', !!disabled);
    if (trigger) {
        trigger.disabled = !!disabled;
    }
};

const renderCollectionSelect = (collections, options = {}) => {
    const dropdown = getTargetCollectionDropdown();
    const label = getTargetCollectionLabel();
    const menu = getTargetCollectionMenu();
    if (!dropdown || !label || !menu) return;

    const client = options.client || getActiveOsuClient();
    const storedName = options.selectedName ?? resolveStoredCollectionName(client);
    const hasStoredOption = collections.some((collection) => collection.name === storedName);
    const selectedValue = hasStoredOption ? storedName : '';
    const optionDefinitions = [
        {
            value: '',
            label: options.emptyLabel || 'No collection selected',
            disabled: !!options.disableEmptyOption,
        },
        ...collections.map((collection) => ({
            value: collection.name,
            label: collection.name,
            disabled: false,
        })),
    ];

    destroyTargetCollectionDropdownMenu();
    menu.replaceChildren(...optionDefinitions.map((entry) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sort-option';
        button.dataset.value = entry.value;
        button.dataset.label = entry.label;
        button.textContent = entry.label;
        button.disabled = !!entry.disabled;
        return button;
    }));

    targetCollectionDropdownMenu = createDropdownMenu({
        root: dropdown,
        valueAttribute: 'value',
        onChange: async ({ value }) => {
            persistSelectedCollectionName(value || '', client);
            await refreshCollectionModeList(targetCollectionCallbacks, {
                forceCollectionsRefresh: true,
                silent: true,
            });
        }
    });

    if (targetCollectionDropdownMenu) {
        targetCollectionDropdownMenu.setValue(selectedValue);
    } else {
        label.textContent = selectedValue || optionDefinitions[0]?.label || 'No collection selected';
    }

    setTargetCollectionDropdownDisabled(
        options.disabled ?? (!Store.settings.collectionsImportEnabled || collections.length === 0)
    );
};

const fetchCollectionsForClient = async (client = getActiveOsuClient()) => {
    if (client === CLIENT_LAZER) {
        const dataRoot = Store.settings.lazerDataDir || Store.settings.songsDir || null;
        return beatmapApi.getLazerCollections(dataRoot);
    }

    const collectionDbPath = getStableCollectionDbPath();
    if (!collectionDbPath) {
        throw new Error('Set your osu! Songs folder first.');
    }

    return beatmapApi.parseStableCollections(collectionDbPath);
};

const getCollectionsForActiveClient = async ({ force = false } = {}) => {
    const client = getActiveOsuClient();
    if (!force && collectionCache[client]?.length) {
        return collectionCache[client];
    }

    const collections = await fetchCollectionsForClient(client);
    collectionCache[client] = Array.isArray(collections) ? collections : [];
    return collectionCache[client];
};

export const loadCollectionsForClient = async (options = {}) => {
    const client = options.client || getActiveOsuClient();
    if (!options.force && collectionCache[client]?.length) {
        return collectionCache[client];
    }

    const collections = await fetchCollectionsForClient(client);
    collectionCache[client] = Array.isArray(collections) ? collections : [];
    return collectionCache[client];
};

export const updateCollectionSyncConfiguration = (options = {}) => {
    const client = options.client || getActiveOsuClient();
    const enabled = !!options.enabled;
    const collectionName = enabled ? String(options.collectionName || '').trim() : '';

    Store.updateSettings({
        collectionsImportEnabled: enabled,
        collectionsWriteEnabled: enabled,
        [getImportNameKey(client)]: collectionName || null,
        [getImportSignatureKey(client)]: null,
    });
    Persistence.persistSettings();
};

const applyCollectionToTodo = (collection, callbacks = {}, options = {}) => {
    const client = getActiveOsuClient();
    const hashToItem = new Map();

    Store.beatmapItems.forEach((item) => {
        const hash = resolveItemBeatmapHash(item, client);
        if (hash && !hashToItem.has(hash)) {
            hashToItem.set(hash, item);
        }
    });

    const todoSet = new Set(Store.todoIds);
    const doneSet = new Set(Store.doneIds);
    const idsToAppend = [];
    let addedCount = 0;
    let notFoundCount = 0;

    for (const rawHash of collection.beatmapHashes || []) {
        const hash = normalizeHash(rawHash);
        if (!hash) continue;

        const item = hashToItem.get(hash);
        if (!item) {
            notFoundCount += 1;
            continue;
        }

        const wasTodo = todoSet.has(item.id);
        const wasDone = doneSet.has(item.id);
        if (!wasTodo) {
            todoSet.add(item.id);
            idsToAppend.push(item.id);
            addedCount += 1;
        } else if (wasDone) {
            addedCount += 1;
        }

        if (wasDone) {
            doneSet.delete(item.id);
        }
    }

    const didChange = idsToAppend.length > 0 || doneSet.size !== Store.doneIds.length;
    if (didChange) {
        Store.setTodoIds([...Store.todoIds, ...idsToAppend]);
        Store.setDoneIds(Store.doneIds.filter((id) => doneSet.has(id)));
        callbacks.updateTabCounts?.();
        callbacks.renderFromState?.();
        Persistence.scheduleSave();
    }

    if (options.persistSelection !== false) {
        persistCollectionSelection(collection, client);
    }

    return {
        addedCount,
        notFoundCount,
        didChange,
    };
};

const clearCollectionBackedList = (callbacks = {}) => {
    const hadItems = Store.todoIds.length > 0 || Store.doneIds.length > 0;
    Store.setTodoIds([]);
    Store.setDoneIds([]);

    if (hadItems) {
        Persistence.scheduleSave();
    }

    callbacks.updateTabCounts?.();
    callbacks.renderFromState?.();

    return hadItems;
};

export const ensureBeatmapHashesReady = async (callbacks = {}) => {
    const client = getActiveOsuClient();

    if (client === CLIENT_LAZER) {
        normalizeLazerHashesInMemory();
        return true;
    }

    const hasMissingHashes = Store.beatmapItems.some((item) => !normalizeHash(item.beatmapHash));
    if (!hasMissingHashes) {
        return true;
    }

    if (typeof callbacks.refreshLastDirectory === 'function' && Store.settings.songsDir) {
        await callbacks.refreshLastDirectory(callbacks);
        return true;
    }

    return false;
};

export const refreshTargetCollectionOptions = async (options = {}) => {
    const client = options.client || getActiveOsuClient();
    if (!getTargetCollectionDropdown()) return [];

    if (!Store.settings.collectionsImportEnabled) {
        renderCollectionSelect(collectionCache[client] || [], { client, disabled: true });
        return collectionCache[client] || [];
    }

    try {
        renderCollectionSelect([], {
            client,
            emptyLabel: 'Loading collections...',
            disabled: true,
            disableEmptyOption: true,
        });

        const collections = await fetchCollectionsForClient(client);
        collectionCache[client] = Array.isArray(collections) ? collections : [];
        renderCollectionSelect(collectionCache[client], { client });

        if (!collectionCache[client].some((collection) => collection.name === resolveStoredCollectionName(client))) {
            persistSelectedCollectionName('', client);
        }

        return collectionCache[client];
    } catch (error) {
        console.error('Failed to refresh collections:', error);
        renderCollectionSelect([], {
            client,
            emptyLabel: 'No collections available',
            disabled: true,
            disableEmptyOption: true,
        });
        if (!options.silent) {
            showNotification('Collections unavailable', error?.message || 'Unable to read your osu! collections.', 'error');
        }
        return [];
    }
};

export const bindTargetCollectionSelect = () => {
    const client = getActiveOsuClient();
    renderCollectionSelect(collectionCache[client] || [], {
        client,
        disabled: !Store.settings.collectionsImportEnabled || (collectionCache[client] || []).length === 0,
    });
};

export const configureTargetCollectionSelect = (callbacks = {}) => {
    targetCollectionCallbacks = callbacks;
    bindTargetCollectionSelect();
};

export const syncCollectionImportOption = (callbacks = {}) => {
    const uploadMenu = document.getElementById('uploadMenu');
    const uploadDropdown = document.getElementById('uploadDropdown');
    if (!uploadMenu) return;

    const existing = uploadMenu.querySelector('[data-upload="collection"]');
    if (!Store.settings.collectionsImportEnabled) {
        existing?.remove();
        return;
    }

    if (existing) {
        existing.textContent = 'Sync selected collection';
        return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'upload-option';
    button.dataset.upload = 'collection';
    button.textContent = 'Sync selected collection';
    button.addEventListener('click', async () => {
        uploadDropdown?.classList.remove('is-open');
        const toggle = uploadDropdown?.querySelector('#uploadMenuToggle');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        await syncImportedCollection(callbacks, {
            force: true,
            forceCollectionsRefresh: true,
            silent: false,
        });
    });

    uploadMenu.appendChild(button);
};

export const syncImportedCollection = async (callbacks = {}, options = {}) => {
    if (!Store.settings.collectionsImportEnabled) {
        return;
    }

    const client = getActiveOsuClient();
    const selectedName = resolveStoredCollectionName(client);
    if (!selectedName) {
        return;
    }

    try {
        await ensureBeatmapHashesReady(callbacks);

        const collections = await getCollectionsForActiveClient({ force: !!options.forceCollectionsRefresh });
        renderCollectionSelect(collections, { client, selectedName });

        const collection = findCollectionByName(collections, selectedName);
        if (!collection) {
            if (!options.silent) {
                showNotification('Collection not found', `The collection '${selectedName}' was not found in osu!.`, 'error');
            }
            return;
        }

        const signature = createCollectionSignature(collection);
        const previousSignature = Store.settings[getImportSignatureKey(client)] || null;
        const shouldApply = options.force || options.reapply || signature !== previousSignature;
        if (!shouldApply) {
            return;
        }

        const summary = applyCollectionToTodo(collection, callbacks, { persistSelection: true });
        if (!options.silent && (summary.addedCount > 0 || summary.notFoundCount > 0 || options.force)) {
            showNotification(
                'Collection synced',
                `Added ${summary.addedCount} maps from '${collection.name}', ${summary.notFoundCount} not found locally.`,
                summary.addedCount > 0 ? 'success' : 'default'
            );
        }
    } catch (error) {
        console.error('Collection sync failed:', error);
        if (!options.silent) {
            showNotification('Collection sync failed', error?.message || 'Unable to sync the selected collection.', 'error');
        }
    }
};

export const refreshCollectionModeList = async (callbacks = {}, options = {}) => {
    clearCollectionBackedList(callbacks);

    if (options.skipSync) {
        return;
    }

    if (!Store.settings.collectionsImportEnabled) {
        return;
    }

    const selectedName = resolveStoredCollectionName(options.client || getActiveOsuClient());
    if (!selectedName) {
        return;
    }

    await syncImportedCollection(callbacks, {
        force: true,
        reapply: true,
        forceCollectionsRefresh: options.forceCollectionsRefresh !== false,
        silent: options.silent ?? true,
    });
};

export const checkForCollectionModeUpdates = async (callbacks = {}, options = {}) => {
    if (!Store.settings.collectionsImportEnabled) {
        return false;
    }

    if (!options.includeHidden && document.hidden) {
        return false;
    }

    const client = options.client || getActiveOsuClient();
    const selectedName = resolveStoredCollectionName(client);
    if (!selectedName || collectionModeAutoRefreshInFlight) {
        return false;
    }

    collectionModeAutoRefreshInFlight = true;

    try {
        const collections = await getCollectionsForActiveClient({ force: options.forceCollectionsRefresh !== false });
        renderCollectionSelect(collections, { client, selectedName });

        const collection = findCollectionByName(collections, selectedName);
        const previousSignature = Store.settings[getImportSignatureKey(client)] || null;
        const nextSignature = collection ? createCollectionSignature(collection) : null;

        if (!collection) {
            if (previousSignature === null && !options.force) {
                return false;
            }

            persistSelectedCollectionName(selectedName, client);
            await refreshCollectionModeList(callbacks, {
                forceCollectionsRefresh: false,
                silent: options.silent ?? true,
            });
            return true;
        }

        if (!options.force && nextSignature === previousSignature) {
            return false;
        }

        await refreshCollectionModeList(callbacks, {
            forceCollectionsRefresh: false,
            silent: options.silent ?? true,
        });
        return true;
    } catch (error) {
        console.error('Collection auto-refresh failed:', error);
        if (!options.silent) {
            showNotification('Collection refresh failed', error?.message || 'Unable to refresh the selected collection.', 'error');
        }
        return false;
    } finally {
        collectionModeAutoRefreshInFlight = false;
    }
};

export const initCollectionModeAutoRefresh = (callbacks = {}) => {
    collectionModeAutoRefreshCallbacks = callbacks;

    if (!collectionModeAutoRefreshBound) {
        const refreshOnResume = () => {
            void checkForCollectionModeUpdates(collectionModeAutoRefreshCallbacks, {
                silent: true,
            });
        };

        window.addEventListener('focus', refreshOnResume, { passive: true });
        window.addEventListener('pageshow', refreshOnResume, { passive: true });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                refreshOnResume();
            }
        });

        collectionModeAutoRefreshBound = true;
    }

    if (collectionModeAutoRefreshTimer) {
        return;
    }

    collectionModeAutoRefreshTimer = window.setInterval(() => {
        void checkForCollectionModeUpdates(collectionModeAutoRefreshCallbacks, {
            silent: true,
        });
    }, COLLECTION_MODE_REFRESH_INTERVAL_MS);
};

export const promptAddBeatmapToCollection = async (itemId, callbacks = {}) => {
    if (!Store.settings.collectionsImportEnabled) {
        return;
    }

    try {
        await ensureBeatmapHashesReady(callbacks);

        const client = getActiveOsuClient();
        const selectedName = resolveStoredCollectionName(client);
        if (!selectedName) {
            showNotification('Select a collection', 'Choose a target collection in Settings first.', 'info');
            return;
        }

        const collections = await getCollectionsForActiveClient();
        const selectedCollection = findCollectionByName(collections, selectedName);
        if (!selectedCollection) {
            showNotification('Collection not found', `The collection '${selectedName}' was not found in osu!.`, 'error');
            return;
        }

        const item = Store.beatmapItems.find((entry) => entry.id === itemId);
        if (!item) {
            throw new Error('Beatmap not found.');
        }

        const beatmapHash = resolveItemBeatmapHash(item);
        if (!beatmapHash) {
            throw new Error('Beatmap hash is unavailable for this map.');
        }

        let result;
        if (client === CLIENT_LAZER) {
            result = await beatmapApi.addToLazerCollection(Store.settings.lazerDataDir || Store.settings.songsDir || null, selectedName, beatmapHash);
        } else {
            const collectionDbPath = getStableCollectionDbPath();
            if (!collectionDbPath) {
                throw new Error('Set your osu! Songs folder first.');
            }
            result = await beatmapApi.addToStableCollection(collectionDbPath, selectedName, beatmapHash);
        }

        if (result?.success) {
            Store.updateSettings({ [getImportSignatureKey(client)]: null });
            Persistence.persistSettings();
            showNotification('Collection updated', `Added this map to '${selectedName}'.`, 'success');
            return;
        }

        const errorCode = String(result?.error || '').trim();
        if (errorCode === 'file_locked' || errorCode === 'realm_locked') {
            showNotification('Collection update failed', 'Close osu! before adding to the selected collection.', 'error');
            return;
        }
        if (errorCode === 'collection not found') {
            showNotification('Collection update failed', 'Selected collection not found.', 'error');
            return;
        }

        throw new Error(errorCode || 'Unable to update the collection.');
    } catch (error) {
        console.error('Add to collection failed:', error);
        showNotification('Collection update failed', error?.message || 'Unable to add this map to the selected collection.', 'error');
    }
};
