const STORAGE_KEY = 'beatmapItemsV1';
const SETTINGS_STORAGE_KEY = 'mapTrackerSettingsV1';
const AUDIO_ANALYSIS_STATE_KEY = 'audioAnalysisStateV1';
const STAR_RATING_STATE_KEY = 'starRatingStateV1';
const STORAGE_VERSION = 1;

const getStarRatingColor = (rating) => {
    const r = Math.max(0, Math.min(15, rating));

    // Define color stops: [starRating, r, g, b]
    // Offset by 0.3 larger than original thresholds
    const colorStops = [
        [0.3, 79, 192, 255],    // #4fc0ff - light blue
        [2.3, 124, 255, 79],    // #7cff4f - green
        [3.0, 246, 240, 92],    // #f6f05c - yellow
        [4.3, 255, 78, 111],    // #ff4e6f - red/pink
        [5.6, 198, 69, 184],    // #c645b8 - purple
        [6.8, 101, 99, 222],    // #6563de - blue/purple
        [10.3, 0, 0, 0],        // black
    ];

    // Find the two stops to interpolate between
    let lower = colorStops[0];
    let upper = colorStops[colorStops.length - 1];

    for (let i = 0; i < colorStops.length - 1; i++) {
        if (r >= colorStops[i][0] && r <= colorStops[i + 1][0]) {
            lower = colorStops[i];
            upper = colorStops[i + 1];
            break;
        }
    }

    // Calculate interpolation factor
    const range = upper[0] - lower[0];
    const t = range === 0 ? 0 : (r - lower[0]) / range;

    // Interpolate RGB values
    const finalR = Math.round(lower[1] + (upper[1] - lower[1]) * t);
    const finalG = Math.round(lower[2] + (upper[2] - lower[2]) * t);
    const finalB = Math.round(lower[3] + (upper[3] - lower[3]) * t);

    return `rgb(${finalR}, ${finalG}, ${finalB})`;
};

let beatmapItems = [];
let todoIds = [];
let doneIds = [];
let viewMode = 'all';
let sortState = { mode: 'dateAdded', direction: 'desc' };
let searchQuery = '';
let srFilter = { min: 0, max: 10 };
let pendingTabRenderRaf = 0;
let groupedRenderPassToken = 0;
let isWindowResizeInProgress = false;
let emitFilterStateToUI = () => { };
let emitSettingsStateToUI = () => { };
let emitSettingsControlsState = () => { };
let emitCoreStateToUI = () => { };
let emitTodoOrderStateToUI = () => { };
let emitGroupViewStateToUI = () => { };
let emitItemDetailsStateToUI = () => { };
let emitViewModelStateToUI = () => { };
let notifyListUiToUI = () => { };
let notifyRefreshUiToUI = () => { };
let listUiState = {
    isLoading: false,
    progressVisible: false,
    progressPct: 0,
    progressLabel: 'Processing files...',
    isEmpty: true,
    showClearAll: false
};
let refreshUiState = {
    isRefreshing: false,
    isAnalyzing: false,
    progressPct: 0,
    tooltip: 'Refresh last directory',
    isPulsing: false
};

// Auto-scroll state for dragging
let autoScrollTimer = null;
let currentMouseY = 0;

const getFilterStateSnapshot = () => ({
    viewMode,
    sortState: { ...sortState },
    searchQuery,
    srFilter: { ...srFilter }
});

// Reusable stable snapshot of the beatmapItems array — only rebuilt when items change.
let _cachedBeatmapItemsSnapshot = [];
let _cachedBeatmapItemsSource = null; // reference to last beatmapItems

const getBeatmapItemsSnapshot = () => {
    if (beatmapItems === _cachedBeatmapItemsSource) {
        return _cachedBeatmapItemsSnapshot;
    }
    _cachedBeatmapItemsSource = beatmapItems;
    _cachedBeatmapItemsSnapshot = beatmapItems.map((item) => ({
        id: item.id,
        title: item.title || '',
        titleUnicode: item.titleUnicode || '',
        artist: item.artist || '',
        artistUnicode: item.artistUnicode || '',
        creator: item.creator || '',
        version: item.version || '',
        beatmapSetID: item.beatmapSetID || '',
        coverUrl: item.coverUrl || '',
        coverPath: item.coverPath || '',
        durationMs: Number(item.durationMs || 0),
        deadline: (typeof item.deadline === 'number' || item.deadline === null) ? item.deadline : null,
        targetStarRating: (typeof item.targetStarRating === 'number' || item.targetStarRating === null) ? item.targetStarRating : null,
        notes: item.notes || '',
        progress: Number(item.progress || 0),
        starRating: Number(item.starRating || 0),
        dateAdded: Number(item.dateAdded || 0),
        dateModified: Number(item.dateModified || 0),
    }));
    return _cachedBeatmapItemsSnapshot;
};

// Track whether items have actually changed since the last full snapshot was emitted
let _lastEmittedBeatmapItemsSource = null;
let _lastEmittedTodoLen = -1;
let _lastEmittedDoneLen = -1;

const getCoreStateSnapshot = (forceItems = false) => {
    const itemsChanged =
        forceItems ||
        beatmapItems !== _lastEmittedBeatmapItemsSource ||
        todoIds.length !== _lastEmittedTodoLen ||
        doneIds.length !== _lastEmittedDoneLen;

    if (itemsChanged) {
        _lastEmittedBeatmapItemsSource = beatmapItems;
        _lastEmittedTodoLen = todoIds.length;
        _lastEmittedDoneLen = doneIds.length;
    }

    return {
        // Only include the (expensive) items snapshot when something actually changed.
        // coreStateService on the Svelte side will skip _beatmapData update if reference is same.
        beatmapItems: itemsChanged ? getBeatmapItemsSnapshot() : _cachedBeatmapItemsSnapshot,
        todoIds: itemsChanged ? [...todoIds] : undefined,
        doneIds: itemsChanged ? [...doneIds] : undefined,
        _itemsChanged: itemsChanged, // hint for service-side guard
        viewMode,
        sortState: { ...sortState },
        searchQuery,
        srFilter: { ...srFilter },
        settings: {
            ignoreGuestDifficulties: !!settings.ignoreGuestDifficulties,
            groupMapsBySong: !!settings.groupMapsBySong,
        },
        effectiveMapperName: getEffectiveMapperName() || '',
        itemsToRenderIds: itemsToRender.map((item) => item.id),
    };
};

const getTodoOrderSnapshot = () => ({
    todoIds: [...todoIds],
    doneIds: [...doneIds]
});

const getGroupViewSnapshot = () => ({
    expandedKeys: Array.from(groupedExpandedKeys)
});

const toItemDetailsSnapshot = (item) => ({
    id: item?.id || '',
    deadline: (typeof item?.deadline === 'number' || item?.deadline === null) ? item.deadline : null,
    targetStarRating: (typeof item?.targetStarRating === 'number' || item?.targetStarRating === null) ? item.targetStarRating : null,
    notes: item?.notes || ''
});

let _cachedItemDetailsSnapshot = [];
let _cachedItemDetailsSource = null;
const getItemDetailsSnapshot = () => {
    if (beatmapItems === _cachedItemDetailsSource) return _cachedItemDetailsSnapshot;
    _cachedItemDetailsSource = beatmapItems;
    _cachedItemDetailsSnapshot = beatmapItems.map((item) => toItemDetailsSnapshot(item));
    return _cachedItemDetailsSnapshot;
};

const getItemDetailsByIdSnapshot = (itemId) => {
    if (!itemId) return null;
    const item = beatmapItems.find((entry) => entry.id === itemId);
    if (!item) return null;
    return toItemDetailsSnapshot(item);
};

let _cachedVmSnapshot = null;
let _cachedVmItemsRef = null;
let _cachedVmViewMode = null;
let _cachedVmGrouped = null;
let _cachedVmExpandedSize = -1;

const getViewModelSnapshot = () => {
    const groupedMode = !!settings.groupMapsBySong && viewMode === 'all';
    const expandedSize = groupedExpandedKeys.size;

    // Return cached snapshot when nothing relevant has changed
    if (
        _cachedVmSnapshot !== null &&
        itemsToRender === _cachedVmItemsRef &&
        viewMode === _cachedVmViewMode &&
        groupedMode === _cachedVmGrouped &&
        expandedSize === _cachedVmExpandedSize
    ) {
        return _cachedVmSnapshot;
    }

    _cachedVmItemsRef = itemsToRender;
    _cachedVmViewMode = viewMode;
    _cachedVmGrouped = groupedMode;
    _cachedVmExpandedSize = expandedSize;

    const itemIds = itemsToRender.map((item) => item.id);

    if (!groupedMode) {
        _cachedVmSnapshot = {
            viewMode,
            grouped: false,
            itemIds,
            groups: [],
            expandedKeys: []
        };
        return _cachedVmSnapshot;
    }

    const groups = groupItemsBySong(itemsToRender).map((group) => {
        const representative = group.items[0] || {};
        return {
            key: group.key,
            representativeId: representative.id || '',
            itemIds: group.items.map((item) => item.id),
            count: group.items.length
        };
    });

    _cachedVmSnapshot = {
        viewMode,
        grouped: true,
        itemIds,
        groups,
        expandedKeys: Array.from(groupedExpandedKeys)
    };
    return _cachedVmSnapshot;
};

const shouldUseSvelteGroupedView = () => {
    const surface = window.mosuRenderSurface;
    if (!surface) return false;
    if (surface.useSvelteGroupedView === true) return true;
    if (typeof surface.shouldUseSvelteGroupedView === 'function') {
        try {
            return !!surface.shouldUseSvelteGroupedView();
        } catch (error) {
            return false;
        }
    }
    return false;
};

const shouldUseSvelteCompletedView = () => {
    const surface = window.mosuRenderSurface;
    if (!surface) return false;
    if (surface.useSvelteCompletedView === true) return true;
    if (typeof surface.shouldUseSvelteCompletedView === 'function') {
        try {
            return !!surface.shouldUseSvelteCompletedView();
        } catch (error) {
            return false;
        }
    }
    return false;
};

const shouldUseSvelteTodoView = () => {
    const surface = window.mosuRenderSurface;
    if (!surface) return false;
    if (surface.useSvelteTodoView === true) return true;
    if (typeof surface.shouldUseSvelteTodoView === 'function') {
        try {
            return !!surface.shouldUseSvelteTodoView();
        } catch (error) {
            return false;
        }
    }
    return false;
};

const shouldUseSvelteAllView = () => {
    const surface = window.mosuRenderSurface;
    if (!surface) return false;
    if (surface.useSvelteAllView === true) return true;
    if (typeof surface.shouldUseSvelteAllView === 'function') {
        try {
            return !!surface.shouldUseSvelteAllView();
        } catch (error) {
            return false;
        }
    }
    return false;
};

const getListUiSnapshot = () => ({
    isLoading: !!listUiState.isLoading,
    progressVisible: !!listUiState.progressVisible,
    progressPct: Number(listUiState.progressPct || 0),
    progressLabel: listUiState.progressLabel || 'Processing files...',
    isEmpty: !!listUiState.isEmpty,
    showClearAll: !!listUiState.showClearAll
});

const getRefreshUiSnapshot = () => ({
    isRefreshing: !!refreshUiState.isRefreshing,
    isAnalyzing: !!refreshUiState.isAnalyzing,
    progressPct: Number(refreshUiState.progressPct || 0),
    tooltip: refreshUiState.tooltip || 'Refresh last directory',
    isPulsing: !!refreshUiState.isPulsing
});

// Global Date Picker Instance
const GlobalDatePicker = {
    popover: null,
    trigger: null,
    viewDate: new Date(),
    currentValue: null,
    onChange: null,
    _justClosedViaTrigger: false,

    init() {
        if (this.popover) return;
        this.popover = document.createElement('div');
        this.popover.classList.add('date-picker-popover');
        document.body.appendChild(this.popover);

        // Close on outside click, or toggle close when clicking trigger
        document.addEventListener('mousedown', (e) => {
            if (this.popover.classList.contains('is-open')) {
                const isTrigger = this.trigger && this.trigger.contains(e.target);
                const isPopover = this.popover.contains(e.target);
                if (isTrigger) {
                    // Clicking trigger while open closes it
                    this._justClosedViaTrigger = true;
                    this.close();
                } else if (!isPopover) {
                    // Clicking outside both closes it
                    this.close();
                }
            }
        });
    },

    open(trigger, value, onChange) {
        this.init();
        this.trigger = trigger;
        this.currentValue = value;
        this.onChange = onChange;
        this.viewDate = value ? new Date(value) : new Date();

        this.render();
        this.updatePosition();

        this.popover.classList.add('is-open');
        this.trigger.classList.add('is-active');

        window.addEventListener('resize', this._updatePosBound);
        window.addEventListener('scroll', this._updatePosBound, true);
    },

    close() {
        if (!this.popover) return;
        this.popover.classList.remove('is-open');
        if (this.trigger) this.trigger.classList.remove('is-active');

        window.removeEventListener('resize', this._updatePosBound);
        window.removeEventListener('scroll', this._updatePosBound, true);
    },

    _updatePosBound: () => GlobalDatePicker.updatePosition(),

    updatePosition() {
        if (!this.trigger || !this.popover) return;
        const rect = this.trigger.getBoundingClientRect();
        const popoverHeight = 360;
        const spaceAbove = rect.top;
        const showBelow = spaceAbove < popoverHeight;

        this.popover.classList.toggle('show-below', showBelow);
        this.popover.style.left = `${rect.left}px`;

        if (showBelow) {
            this.popover.style.top = `${rect.bottom + 8}px`;
            this.popover.style.bottom = 'auto';
        } else {
            this.popover.style.bottom = `${window.innerHeight - rect.top + 8}px`;
            this.popover.style.top = 'auto';
        }
    },

    render() {
        this.popover.innerHTML = '';
        const header = document.createElement('div');
        header.classList.add('date-picker-calendar-header');

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.classList.add('calendar-nav-btn');
        prevBtn.innerHTML = '<svg viewBox="0 0 320 512"><path d="M41.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L109.3 256 246.6 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160z"/></svg>';
        prevBtn.onclick = (e) => {
            e.stopPropagation();
            this.viewDate.setMonth(this.viewDate.getMonth() - 1);
            this.render();
        };

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.classList.add('calendar-nav-btn');
        nextBtn.innerHTML = '<svg viewBox="0 0 320 512"><path d="M278.6 233.4c12.5 12.5 12.5 32.8 0 45.3l-160 160c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L210.7 256 73.4 118.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l160 160z"/></svg>';
        nextBtn.onclick = (e) => {
            e.stopPropagation();
            this.viewDate.setMonth(this.viewDate.getMonth() + 1);
            this.render();
        };

        const monthYear = document.createElement('div');
        monthYear.classList.add('calendar-month-year');
        monthYear.textContent = this.viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

        header.appendChild(prevBtn);
        header.appendChild(monthYear);
        header.appendChild(nextBtn);
        this.popover.appendChild(header);

        const grid = document.createElement('div');
        grid.classList.add('date-picker-grid');

        ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(day => {
            const el = document.createElement('div');
            el.classList.add('calendar-weekday');
            el.textContent = day;
            grid.appendChild(el);
        });

        const firstDay = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth(), 1).getDay();
        const lastDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() + 1, 0).getDate();

        for (let i = 0; i < firstDay; i++) {
            const el = document.createElement('div');
            el.classList.add('calendar-day', 'empty');
            grid.appendChild(el);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const selectedDate = this.currentValue ? new Date(this.currentValue) : null;
        if (selectedDate) selectedDate.setHours(0, 0, 0, 0);

        for (let i = 1; i <= lastDate; i++) {
            const el = document.createElement('div');
            el.classList.add('calendar-day');
            el.textContent = i;
            const d = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth(), i);
            if (d.getTime() === today.getTime()) el.classList.add('is-today');
            if (selectedDate && d.getTime() === selectedDate.getTime()) el.classList.add('is-selected');

            el.onclick = (e) => {
                e.stopPropagation();
                d.setHours(23, 59, 59, 999);
                this.onChange(d.getTime());
                this.close();
            };
            grid.appendChild(el);
        }
        this.popover.appendChild(grid);

        const footer = document.createElement('div');
        footer.classList.add('date-picker-footer');

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.classList.add('date-picker-btn', 'date-picker-btn--clear');
        clearBtn.textContent = 'Clear';
        clearBtn.onclick = (e) => {
            e.stopPropagation();
            this.onChange(null);
            this.close();
        };

        const todayBtn = document.createElement('button');
        todayBtn.type = 'button';
        todayBtn.classList.add('date-picker-btn', 'date-picker-btn--today');
        todayBtn.textContent = 'Today';
        todayBtn.onclick = (e) => {
            e.stopPropagation();
            const now = new Date();
            now.setHours(23, 59, 59, 999);
            this.onChange(now.getTime());
            this.close();
        };

        footer.appendChild(clearBtn);
        footer.appendChild(todayBtn);
        this.popover.appendChild(footer);
    }
};
// Generate a unique user ID for embed syncing
const generateUserId = () => {
    return Math.floor(Math.random() * 90000000 + 10000000).toString();
};

const showNotification = (title, message, type = 'default', duration = 5000) => {
    if (window.mosuNotifications?.show) {
        window.mosuNotifications.show(title, message, type, duration);
        return;
    }

    const logType = type === 'error' ? 'error' : 'log';
    console[logType](`[mosu] ${title}: ${message}`);
};

let settings = {
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
    embedShowTodoList: true,
    embedShowCompletedList: true,
    embedShowProgressStats: true,
    embedLastSynced: null,
    groupMapsBySong: true
};

const getSettingsStateSnapshot = () => {
    const volume = typeof settings.volume === 'number' ? settings.volume : 0.5;
    const linkedAliases = (settings.mapperAliases || []).map((name, index) => ({
        name,
        isPrimary: index === 0,
        isIgnored: (settings.ignoredAliases || []).includes(String(name).toLowerCase())
    }));

    return {
        autoRescan: !!settings.autoRescan,
        rescanMode: settings.rescanMode || 'mapper',
        rescanMapperName: settings.rescanMapperName || '',
        songsDir: settings.songsDir || '',
        songsDirLabel: settings.songsDir || 'Not selected',
        ignoreStartAndBreaks: !!settings.ignoreStartAndBreaks,
        ignoreGuestDifficulties: !!settings.ignoreGuestDifficulties,
        volume,
        volumePercent: `${Math.round(volume * 100)}%`,
        groupMapsBySong: !!settings.groupMapsBySong,
        userId: settings.userId || '',
        userIdLabel: settings.userId || 'Not generated',
        embedApiKey: settings.embedApiKey || '',
        apiKeyLabel: settings.embedApiKey || 'Not generated',
        embedUrlLabel: settings.userId
            ? `${settings.embedSyncUrl}/embed/${settings.userId}`
            : 'Generate user ID first',
        embedLastSyncedLabel: settings.embedLastSynced
            ? `Last synced: ${new Date(settings.embedLastSynced).toLocaleString()}`
            : 'Not synced yet',
        embedSyncStatus: embedSyncUiState.status,
        embedSyncButtonLabel: embedSyncUiState.buttonLabel,
        embedSyncButtonTooltip: embedSyncUiState.buttonTooltip,
        embedSyncButtonDisabled: !!embedSyncUiState.buttonDisabled,
        embedShowTodoList: !!settings.embedShowTodoList,
        embedShowCompletedList: !!settings.embedShowCompletedList,
        embedShowProgressStats: !!settings.embedShowProgressStats,
        linkedAliases,
        hasLinkedAliases: linkedAliases.length > 0
    };
};

const processMapperInput = async (value) => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    console.log('[mosu] Processing mapper input:', trimmed);

    // Check if it's an osu! user URL or a numeric ID
    const isUrl = trimmed.includes('osu.ppy.sh/users/') || trimmed.includes('osu.ppy.sh/u/');
    const isNumericId = /^\d+$/.test(trimmed);

    if (isUrl || isNumericId) {
        try {
            if (window.appInfo?.getOsuUserData) {
                console.log('[mosu] Fetching user data for profile link/ID...');
                const userData = await window.appInfo.getOsuUserData(trimmed);
                console.log('[mosu] Received user data:', userData);

                if (userData && userData.names && userData.names.length > 0) {
                    // Update user ID to be the osu! user ID
                    const oldUserId = settings.userId;
                    settings.userId = userData.id;
                    settings.mapperAliases = userData.names;

                    // If the User ID changed, reset the API key to force re-registration on next sync
                    if (oldUserId !== settings.userId) {
                        console.log('[mosu] User ID changed, resetting embed API key...');
                        settings.embedApiKey = null;
                        settings.embedLastSynced = null;
                    }

                    if (typeof persistSettings === 'function') {
                        persistSettings();
                    }
                    if (typeof updateSettingsUI === 'function') {
                        updateSettingsUI();
                    }

                    const mainName = userData.names[0];
                    const formerNames = userData.names.slice(1);
                    const feedback = formerNames.length > 0
                        ? `Linked profile: ${mainName} (formerly: ${formerNames.join(', ')})`
                        : `Linked profile: ${mainName}`;

                    showNotification('osu! Profile Linked', feedback, 'success');

                    // Return the ID for display in the input
                    return userData.id.toString();
                } else {
                    console.warn('[mosu] User data returned but names are empty');
                    settings.mapperAliases = [];
                }
            } else {
                console.error('[mosu] getOsuUserData command is not available in window.appInfo');
            }
        } catch (err) {
            console.error('[mosu] Failed to fetch osu! user data:', err);
            showNotification('Fetch Failed', err.message || err.toString() || 'Unknown error', 'error');
        }
    }

    return trimmed;
};

// Returns the mapper name that should be used for backend operations.
const getEffectiveMapperName = () => {
    // If autoRescan is off, we return specifically the current rescanMapperName 
    // BUT only if we are manually refreshing. 
    // For the startup auto-rescan logic, we should check settings.autoRescan.

    // In refreshLastDirectory, we call this function.
    if (settings.rescanMode === 'all') return '';

    if (settings.mapperAliases && settings.mapperAliases.length > 0) {
        const ignoredSet = new Set((settings.ignoredAliases || []).map(a => a.toLowerCase()));
        const activeAliases = settings.mapperAliases.filter(name => !ignoredSet.has(name.toLowerCase()));

        if (activeAliases.length > 0) {
            return activeAliases.join(', ');
        }
    }
    return (settings.rescanMapperName || '').trim();
};

const formatDuration = (ms) => {
    if (typeof ms !== 'number' || isNaN(ms)) return '--:--';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

let lastScannedDirectory = localStorage.getItem('lastScannedDirectory') || null;

const parseHighlights = (raw) => {
    if (!raw) {
        return [];
    }

    return raw
        .split(',')
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => {
            const [start, end] = chunk.split('-').map((value) => Number.parseFloat(value));
            if (Number.isNaN(start) || Number.isNaN(end)) {
                return null;
            }
            return {
                start: Math.min(Math.max(start, 0), 1),
                end: Math.min(Math.max(end, 0), 1),
            };
        })
        .filter((range) => range && range.end > range.start);
};

const renderTimeline = (timeline, ranges) => {
    if (!(timeline instanceof HTMLCanvasElement)) return false;

    const ctx = timeline.getContext('2d');
    if (!ctx) return false;
    const dpr = window.devicePixelRatio || 1;
    const width = timeline.clientWidth;
    const height = timeline.clientHeight;

    // Timeline can briefly report 0x0 while layout is settling (or tab regains focus).
    // Defer the draw in that case and retry on the next frame.
    if (width <= 0 || height <= 0) {
        return false;
    }

    // Set internal resolution for crispness
    if (timeline.width !== width * dpr || timeline.height !== height * dpr) {
        timeline.width = width * dpr;
        timeline.height = height * dpr;
    }

    // Use setTransform to avoid cumulative scaling if render is called multiple times
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Sort to draw bookmarks on top
    const sorted = [...ranges].sort((a, b) => {
        if (a.type === b.type) return 0;
        if (a.type === 'bookmark') return 1;
        if (b.type === 'bookmark') return -1;
        return 0;
    });

    sorted.forEach((range) => {
        const x = range.start * width;
        const w = (range.end - range.start) * width;

        if (range.type === 'break') {
            ctx.fillStyle = 'rgba(73, 159, 113, 0.6)';
            ctx.fillRect(x, 0, w, height);
        } else if (range.type === 'bookmark') {
            ctx.fillStyle = 'rgba(67, 145, 255, 0.8)';
            ctx.fillRect(x, 0, Math.max(2, w), height);
        } else {
            ctx.fillStyle = 'rgb(63, 155, 106)';
            ctx.fillRect(x, 0, w, height);
        }
    });

    return true;
};


// Apply timeline segments for a single list box (avoids re-rendering all items)

const animateRemoveElement = (element) => {
    if (!element) return;
    element.style.height = `${element.offsetHeight}px`;
    void element.offsetHeight;
    element.classList.add('removing');

    const onDone = () => {
        if (element.parentElement) element.remove();
        updateEmptyState(document.querySelector('#listContainer'));
    };

    element.addEventListener('transitionend', (event) => {
        if (event.target === element && event.propertyName === 'height') {
            onDone();
        }
    }, { once: true });

    // Safety fallback
    setTimeout(onDone, 600);
};

let VIRTUAL_ITEM_HEIGHT = 182; // 170px + 12px gap
let itemsToRender = [];
let cachedContainerTop = 0; // Cached once per full render; avoids BoundingClientRect on every scroll/sync
const MAX_TIMELINE_RENDER_RETRIES = 8;

const applyTimelineToBox = (box, itemOrIndex) => {
    const timeline = box.querySelector('.list-timeline');
    if (!timeline) return;

    const itemId = box.dataset.itemId;
    const isDone = doneIds.includes(itemId);
    let ranges = [];

    if (isDone) {
        ranges = [{ start: 0, end: 1, type: 'object' }];
    } else {
        // Find the item properly. If itemOrIndex is already an object, use it.
        // Otherwise, try to find it in itemsToRender via index, or fallback to searching by ID.
        let item = (typeof itemOrIndex === 'object') ? itemOrIndex : null;

        if (!item) {
            const index = Number(itemOrIndex);
            // Verify if the item at itemsToRender[index] matches the box we're updating
            if (!isNaN(index) && itemsToRender[index]?.id === itemId) {
                item = itemsToRender[index];
            } else {
                // If index is wrong (common in grouped mode) or missing, find by ID
                item = itemsToRender.find(i => i.id === itemId) ||
                    beatmapItems.find(i => i.id === itemId);
            }
        }

        ranges = item?.highlights || [];

        const hasProgress = Number(item?.progress || box.dataset.progress || 0) > 0;
        if (!ranges.length && hasProgress) {
            // Use a stable index for fallback visual variety (the box's render index)
            const fallbackIndex = Number(box.dataset.renderIndex || 0);
            const fallback = fallbackIndex % 2 === 0 ? '0.1-0.18,0.42-0.52,0.76-0.96' : '0.15-0.22,0.58-0.72';
            ranges = parseHighlights(fallback);
        } else if (!hasProgress) {
            ranges = [];
        }
    }

    const didRender = renderTimeline(timeline, ranges);
    if (didRender) {
        timeline.dataset.renderRetryCount = '0';
        return;
    }

    const retryCount = Number(timeline.dataset.renderRetryCount || 0);
    if (retryCount >= MAX_TIMELINE_RENDER_RETRIES) return;

    timeline.dataset.renderRetryCount = String(retryCount + 1);
    requestAnimationFrame(() => {
        if (!box.isConnected) return;
        applyTimelineToBox(box, itemOrIndex);
    });
};


const parseMetadata = (content) => {
    const data = {};
    let section = '';

    content.split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) {
            return;
        }

        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            section = trimmed.slice(1, -1).toLowerCase();
            return;
        }

        const separatorIndex = trimmed.indexOf(':');
        if (separatorIndex === -1) {
            return;
        }

        const key = trimmed.slice(0, separatorIndex).trim().toLowerCase();
        const value = trimmed.slice(separatorIndex + 1).trim();

        if (section === 'metadata') {
            if (key === 'title') data.Title = value;
            else if (key === 'titleunicode') data.TitleUnicode = value;
            else if (key === 'artist') data.Artist = value;
            else if (key === 'artistunicode') data.ArtistUnicode = value;
            else if (key === 'creator') data.Creator = value;
            else if (key === 'version') data.Version = value;
            else if (key === 'beatmapsetid') data.BeatmapSetID = value;
        } else if (section === 'general') {
            if (key === 'audiofilename') data.Audio = value;
        }
    });

    const title = data.Title || 'Unknown Title';
    const titleUnicode = data.TitleUnicode || data.Title || 'Unknown Title';
    const artist = data.Artist || 'Unknown Artist';
    const artistUnicode = data.ArtistUnicode || data.Artist || 'Unknown Artist';
    const creator = data.Creator || 'Unknown Creator';
    const version = data.Version || 'Unknown Version';
    let beatmapSetID = data.BeatmapSetID || 'Unknown';
    const idNum = parseInt(beatmapSetID);
    if (!isNaN(idNum) && idNum > 0) {
        beatmapSetID = `https://osu.ppy.sh/beatmapsets/${beatmapSetID}`;
    }

    return {
        title,
        titleUnicode,
        artist,
        artistUnicode,
        creator,
        version,
        beatmapSetID,
        audio: data.Audio || '',
    };
};

const shouldIgnoreGuestDifficulty = (content) => {
    if (!settings.ignoreGuestDifficulties) return false;
    const mapperList = (getEffectiveMapperName() || '').split(',').map(m => m.trim().toLowerCase()).filter(Boolean);
    if (mapperList.length === 0) return false;
    try {
        const meta = parseMetadata(content || '');
        if (!meta) return false;
        const creator = String(meta.creator || '').toLowerCase();
        const version = String(meta.version || '').toLowerCase();

        return mapperList.some(mapper => {
            if (!creator.includes(mapper)) return false;
            // If it includes the mapper's name followed by 's, it's likely not a GUEST difficulty but their own
            if (version.includes(mapper + "'s") || version.includes(mapper + "s'")) return false;
            return version.includes("'s") || version.includes("s'");
        });
    } catch (e) {
        return false;
    }
};

// Cached mapper names for guest difficulty filtering (set before each render pass)
let _cachedMapperNeedles = [];

const isGuestDifficultyItem = (item) => {
    if (!settings.ignoreGuestDifficulties) return false;
    const mapperList = _cachedMapperNeedles;
    if (mapperList.length === 0) return false;
    const creator = String(item.creator || '').toLowerCase();
    const version = String(item.version || '').toLowerCase();

    return mapperList.some(mapper => {
        if (!creator.includes(mapper)) return false;
        // If it includes the mapper's name followed by 's, it's likely not a GUEST difficulty but their own
        if (version.includes(mapper + "'s") || version.includes(mapper + "s'")) return false;
        return version.includes("'s") || version.includes("s'");
    });
};

const parseAudioFilename = (content) => {
    let inGeneral = false;
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            inGeneral = trimmed === '[General]';
            continue;
        }

        if (!inGeneral) {
            continue;
        }

        if (trimmed.startsWith('AudioFilename:')) {
            return trimmed.slice('AudioFilename:'.length).trim();
        }
    }

    return '';
};

const parseBackgroundFilename = (content) => {
    let inEvents = false;
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            inEvents = trimmed === '[Events]';
            continue;
        }

        if (!inEvents || trimmed.startsWith('//')) {
            continue;
        }

        let candidate = '';
        const quotedMatch = trimmed.match(/"([^"]+)"/);
        if (quotedMatch) {
            candidate = quotedMatch[1];
        } else {
            const parts = trimmed.split(',').map((part) => part.trim());
            if (parts.length >= 3) {
                candidate = parts[2].replace(/^"|"$/g, '');
            }
        }

        if (candidate && /\.(jpe?g|png|gif|bmp)$/i.test(candidate)) {
            return candidate;
        }
    }

    return '';
};

const parseBreakPeriods = (content) => {
    let inEvents = false;
    const breaks = [];
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            inEvents = trimmed === '[Events]';
            continue;
        }

        if (!inEvents || trimmed.startsWith('//')) {
            continue;
        }

        const parts = trimmed.split(',').map((part) => part.trim());
        if (parts.length < 3) {
            continue;
        }

        const typeToken = parts[0];
        if (typeToken !== '2' && typeToken.toLowerCase() !== 'break') {
            continue;
        }

        const startTime = Number.parseInt(parts[1], 10);
        const endTime = Number.parseInt(parts[2], 10);
        if (Number.isFinite(startTime) && Number.isFinite(endTime) && endTime > startTime) {
            breaks.push({ start: startTime, end: endTime });
        }
    }

    return breaks;
};

const parseHitObjects = (content) => {
    let inHitObjects = false;
    let sliderMultiplier = 1.0;
    const timingPoints = [];
    const hitStarts = [];
    const hitEnds = [];
    const hitTypes = [];

    const lines = content.split(/\r?\n/);

    const getTiming = (time) => {
        let activeBPM = 60000 / 120;
        let activeSV = 1.0;
        for (const tp of timingPoints) {
            if (tp.time > time) break;
            if (tp.uninherited) {
                activeBPM = tp.beatLength;
                activeSV = 1.0;
            } else if (tp.beatLength < 0) {
                activeSV = -100 / tp.beatLength;
            }
        }
        return { beatLength: activeBPM, sv: activeSV };
    };

    let section = '';
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;

        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            section = trimmed.slice(1, -1).toLowerCase();
            inHitObjects = section === 'hitobjects';
            continue;
        }

        if (section === 'difficulty') {
            const sep = trimmed.indexOf(':');
            if (sep !== -1) {
                const key = trimmed.slice(0, sep).trim().toLowerCase();
                if (key === 'slidermultiplier') {
                    sliderMultiplier = parseFloat(trimmed.slice(sep + 1)) || 1.0;
                }
            }
        } else if (section === 'timingpoints') {
            const parts = trimmed.split(',');
            if (parts.length >= 2) {
                timingPoints.push({
                    time: parseInt(parts[0]),
                    beatLength: parseFloat(parts[1]),
                    uninherited: parts.length > 6 ? parts[6] === '1' : true
                });
            }
        } else if (inHitObjects) {
            const parts = trimmed.split(',');
            if (parts.length < 4) continue;

            const time = parseInt(parts[2]);
            const type = parseInt(parts[3]);
            let endTime = time;

            if (type & 2) {
                if (parts.length >= 8) {
                    const slides = parseInt(parts[6]) || 1;
                    const length = parseFloat(parts[7]) || 0;
                    const timing = getTiming(time);
                    const duration = (length / (sliderMultiplier * 100 * timing.sv)) * timing.beatLength * slides;
                    endTime = time + Math.max(0, Math.floor(duration));
                }
            } else if (type & 8) {
                if (parts.length >= 6) endTime = parseInt(parts[5]) || time;
            } else if (type & 128) {
                if (parts.length >= 6) endTime = parseInt(parts[5].split(':')[0]) || time;
            }

            // Fill gap if previous was a slider
            if (hitEnds.length > 0) {
                const prevType = hitTypes[hitTypes.length - 1];
                if (prevType & 2) {
                    hitEnds[hitEnds.length - 1] = Math.max(hitEnds[hitEnds.length - 1], time);
                }
            }

            hitStarts.push(time);
            hitEnds.push(Math.max(time, endTime));
            hitTypes.push(type);
        }
    }

    return { hitStarts, hitEnds };
};

const parseBookmarks = (content) => {
    let inEditor = false;
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            inEditor = trimmed === '[Editor]';
            continue;
        }

        if (!inEditor) {
            continue;
        }

        if (trimmed.startsWith('Bookmarks:')) {
            const raw = trimmed.slice('Bookmarks:'.length).trim();
            if (!raw) return [];
            return raw
                .split(',')
                .map((val) => Number.parseInt(val.trim(), 10))
                .filter((val) => Number.isFinite(val));
        }
    }

    return [];
};

const buildHighlightRanges = (starts, ends, durationMs) => {
    if (!starts || !starts.length || !durationMs) {
        return [];
    }

    const bins = 120;
    const flags = new Array(bins).fill(false);
    const maxTime = durationMs;

    for (let i = 0; i < starts.length; i++) {
        const start = starts[i];
        const end = (ends && ends.length > i) ? ends[i] : start;

        if (start < 0 || start > maxTime) continue;

        const startIdx = Math.min(bins - 1, Math.floor((start / maxTime) * bins));
        const endIdx = Math.min(bins - 1, Math.floor((Math.max(start, end) / maxTime) * bins));

        for (let j = startIdx; j <= endIdx; j++) {
            flags[j] = true;
        }
    }

    const ranges = [];
    let start = null;
    for (let i = 0; i < bins; i += 1) {
        if (flags[i]) {
            if (start === null) {
                start = i;
            }
        } else if (start !== null) {
            ranges.push({ start: start / bins, end: i / bins, type: 'object' });
            start = null;
        }
    }
    if (start !== null) {
        ranges.push({ start: start / bins, end: 1, type: 'object' });
    }

    return ranges;
};

const buildBreakRanges = (breaks, durationMs) => {
    if (!breaks.length || !durationMs) {
        return [];
    }

    return breaks
        .map((range) => ({
            start: Math.min(Math.max(range.start / durationMs, 0), 1),
            end: Math.min(Math.max(range.end / durationMs, 0), 1),
            type: 'break',
        }))
        .filter((range) => range.end > range.start);
};

const buildBookmarkRanges = (bookmarks, durationMs) => {
    if (!bookmarks.length || !durationMs) {
        return [];
    }

    const bins = 200;
    const flags = new Array(bins).fill(false);
    bookmarks.forEach((time) => {
        const idx = Math.min(bins - 1, Math.floor((time / durationMs) * bins));
        if (idx >= 0) flags[idx] = true;
    });

    const ranges = [];
    for (let i = 0; i < bins; i++) {
        if (flags[i]) {
            ranges.push({
                start: i / bins,
                end: (i + 1.2) / bins, // Slightly wider to ensure visibility
                type: 'bookmark',
            });
        }
    }
    return ranges;
};

const normalizeMetadata = (metadata) => ({
    title: metadata?.title || 'Unknown Title',
    titleUnicode: metadata?.titleUnicode || metadata?.title || 'Unknown Title',
    artist: metadata?.artist || 'Unknown Artist',
    artistUnicode: metadata?.artistUnicode || metadata?.artist || 'Unknown Artist',
    creator: metadata?.creator || 'Unknown Creator',
    version: metadata?.version || 'Unknown Version',
    beatmapSetID: metadata?.beatmapSetID ?? 'Unknown',
    coverUrl: metadata?.coverUrl || '',
    coverPath: metadata?.coverPath || '',
    highlights: metadata?.highlights || [],
    progress: metadata?.progress ?? 0,
    durationMs: metadata?.durationMs ?? null,
    previewTime: metadata?.previewTime ?? -1,
    dateAdded: metadata?.dateAdded ?? 0,
    dateModified: metadata?.dateModified ?? 0,
    filePath: metadata?.filePath || '',
    id: metadata?.id ?? '',
    deadline: metadata?.deadline ?? null,
    targetStarRating: metadata?.targetStarRating ?? null,
    starRating: (typeof metadata?.starRating === 'number' && Number.isFinite(metadata.starRating) && metadata.starRating > 0)
        ? metadata.starRating
        : null,
    notes: metadata?.notes || '',
});

const isValidStarRating = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

const isStarRatingMissing = (value) => !isValidStarRating(value);

const applyCalculatedStarTagState = (tagElement, rating) => {
    if (!tagElement) return;

    const ring = tagElement.querySelector('.meta-tag-star-ring') || tagElement.querySelector('path');
    const core = tagElement.querySelector('.meta-tag-star-core') || tagElement.querySelector('circle');
    const valueEl = tagElement.querySelector('.meta-tag-star-value') || tagElement.querySelector('span');

    if (isValidStarRating(rating)) {
        const srColor = getStarRatingColor(rating);
        const srRgb = srColor.startsWith('rgb(') ? srColor.slice(4, -1) : '255, 255, 255';

        if (ring) ring.style.fill = srColor;
        if (core) core.style.fill = srColor;
        if (valueEl) valueEl.textContent = rating.toFixed(2);

        tagElement.style.setProperty('border-color', `rgba(${srRgb}, 0.3)`, 'important');
        tagElement.style.backgroundColor = `rgba(${srRgb}, 0.3)`;
        tagElement.dataset.tooltip = 'Calculated Star Rating';
        tagElement.classList.remove('is-pending');
        return;
    }

    if (ring) ring.style.fill = 'rgb(148, 143, 163)';
    if (core) core.style.fill = 'rgb(148, 143, 163)';
    if (valueEl) valueEl.textContent = '--';

    tagElement.style.setProperty('border-color', 'rgba(148, 143, 163, 0.35)', 'important');
    tagElement.style.backgroundColor = 'rgba(148, 143, 163, 0.08)';
    tagElement.dataset.tooltip = 'Calculated Star Rating (pending)';
    tagElement.classList.add('is-pending');
};

const coverLoadQueue = [];
const queuedCoverPaths = new Set();
let isProcessingCoverQueue = false;

const processCoverLoadQueue = async () => {
    if (isProcessingCoverQueue) return;
    isProcessingCoverQueue = true;

    try {
        const CONCURRENCY = 30;
        while (coverLoadQueue.length > 0) {
            const batch = coverLoadQueue.splice(0, CONCURRENCY);

            await Promise.all(batch.map(async ({ itemId, coverPath }) => {
                const queueKey = `${itemId}::${coverPath}`;
                try {
                    // Handle group header covers (itemId starts with 'group||')
                    if (itemId && itemId.startsWith('group||')) {
                        let coverUrl = '';
                        if (window.beatmapApi?.convertFileSrc) {
                            coverUrl = window.beatmapApi.convertFileSrc(coverPath);
                        } else if (window.beatmapApi?.readImage) {
                            coverUrl = await window.beatmapApi.readImage(coverPath);
                        }
                        if (coverUrl) {
                            // Find the group row and update its cover img
                            const groupKey = itemId.slice('group||'.length);
                            const groupEl = document.querySelector(`[data-group-key="${CSS.escape(groupKey)}"]`);
                            if (groupEl) {
                                const img = groupEl.querySelector('.group-row-cover img');
                                if (img) {
                                    img.src = coverUrl;
                                    img.classList.remove('list-img--placeholder');
                                }
                            }
                            // Also update representative beatmap item
                            const repItem = beatmapItems.find(i => i.coverPath === coverPath);
                            if (repItem) repItem.coverUrl = coverUrl;
                        }
                        return;
                    }

                    const item = beatmapItems.find(i => i.id === itemId);
                    if (!item || item.coverPath !== coverPath) {
                        return;
                    }

                    // Use convertFileSrc for direct asset protocol URL (no IPC round-trip)
                    let coverUrl = '';
                    if (window.beatmapApi?.convertFileSrc) {
                        coverUrl = window.beatmapApi.convertFileSrc(coverPath);
                    } else if (window.beatmapApi?.readImage) {
                        coverUrl = await window.beatmapApi.readImage(coverPath);
                    }
                    if (!coverUrl) {
                        return;
                    }

                    item.coverUrl = coverUrl;

                    const img = document.querySelector(`[data-item-id="${itemId}"] .list-img img`);
                    if (img) {
                        img.src = coverUrl;
                        img.classList.remove('list-img--placeholder');
                    }
                } catch (err) {
                    // Non-fatal: keep placeholder for failed covers.
                } finally {
                    queuedCoverPaths.delete(queueKey);
                }
            }));

            // Yield briefly to keep UI responsive
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    } finally {
        isProcessingCoverQueue = false;
    }
};


const scheduleCoverLoad = (itemId, coverPath) => {
    if (!itemId || !coverPath) return;
    const queueKey = `${itemId}::${coverPath}`;
    if (queuedCoverPaths.has(queueKey)) return;

    queuedCoverPaths.add(queueKey);
    coverLoadQueue.push({ itemId, coverPath });
    processCoverLoadQueue();
};

const buildListItem = (metadata, index) => {
    const normalized = normalizeMetadata(metadata);
    const isDone = doneIds.includes(normalized.id);
    const isTodoTab = viewMode === 'todo';
    const isCompletedTab = viewMode === 'completed';
    const isAllTab = viewMode === 'all';
    const listBox = document.createElement('div');
    listBox.classList.add('list-box');
    listBox.style.setProperty('--i', index);
    // Expose progress so we can decide whether to render placeholder highlights
    listBox.dataset.progress = String(normalized.progress || 0);
    listBox.dataset.renderIndex = String(index);

    if (normalized.highlights.length) {
        listBox.__highlights = normalized.highlights;
    } else if (normalized.progress > 0) {
        // Only show placeholder highlights if the item has non-zero progress
        listBox.dataset.highlights = index % 2 === 0 ? '0.06-0.14,0.34-0.38,0.72-0.98' : '0.12-0.2,0.48-0.62';
    } else {
        // Ensure no placeholder is present when progress is zero
        delete listBox.dataset.highlights;
    }

    listBox.dataset.itemId = normalized.id;

    const details = document.createElement('div');
    details.classList.add('list-details');

    const image = document.createElement('div');
    image.classList.add('list-img');

    const img = document.createElement('img');
    img.alt = `${normalized.artistUnicode} - ${normalized.titleUnicode}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    if (normalized.coverUrl) {
        img.src = normalized.coverUrl;
        // Fallback to placeholder if the asset URL fails (e.g., file missing)
        img.onerror = () => {
            img.onerror = null;
            img.src = './assets/placeholder.png';
            img.classList.add('list-img--placeholder');
        };
    } else {
        img.src = './assets/placeholder.png';
        img.classList.add('list-img--placeholder');
        if (normalized.coverPath) {
            scheduleCoverLoad(normalized.id, normalized.coverPath);
        }
    }
    image.appendChild(img);

    const title = document.createElement('h3');
    title.classList.add('list-title');
    title.textContent = `${normalized.artistUnicode} - ${normalized.titleUnicode}`;

    const meta = document.createElement('div');
    meta.classList.add('list-meta');

    const creatorTag = document.createElement('span');
    creatorTag.classList.add('meta-tag');
    creatorTag.textContent = normalized.creator;
    creatorTag.dataset.tooltip = 'Mapper';

    const versionTag = document.createElement('span');
    versionTag.classList.add('meta-tag');
    versionTag.textContent = normalized.version;
    versionTag.dataset.tooltip = 'Difficulty Name';

    const calculatedSrTag = document.createElement('span');
    calculatedSrTag.classList.add('meta-tag', 'meta-tag--star-rating', 'meta-tag--calculated-sr', 'meta-tag--cover-star');
    if (isTodoTab) {
        calculatedSrTag.classList.add('meta-tag--cover-star-offset');
    }
    const srVal = normalized.starRating;

    const calcStarIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    calcStarIcon.setAttribute('viewBox', '0 0 574 574');
    calcStarIcon.classList.add('meta-tag-icon');
    const calcStarPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    calcStarPath.classList.add('meta-tag-star-ring');
    calcStarPath.setAttribute('d', 'M287,0C445.218,0 574,128.782 574,287C574,445.218 445.218,574 287,574C128.782,574 0,445.218 0,287C0,128.782 128.782,0 287,0ZM287,63C164.282,63 63,164.282 63,287C63,409.718 164.282,511 287,511C409.718,511 511,409.718 511,287C511,164.282 409.718,63 287,63Z');
    calcStarIcon.appendChild(calcStarPath);
    const calcInnerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    calcInnerCircle.classList.add('meta-tag-star-core');
    calcInnerCircle.setAttribute('cx', '287');
    calcInnerCircle.setAttribute('cy', '287');
    calcInnerCircle.setAttribute('r', '121');
    calcStarIcon.appendChild(calcInnerCircle);

    const calcStarValue = document.createElement('span');
    calcStarValue.classList.add('meta-tag-star-value');
    calculatedSrTag.appendChild(calcStarIcon);
    calculatedSrTag.appendChild(calcStarValue);
    applyCalculatedStarTagState(calculatedSrTag, srVal);

    const beatmapLink = document.createElement('button');
    beatmapLink.type = 'button';
    beatmapLink.classList.add('beatmap-link');
    const bID = normalized.beatmapSetID;
    const isUrl = typeof bID === 'string' && bID.startsWith('http');
    const idNum = Number(bID);
    const isUploaded = isUrl || (Number.isFinite(idNum) && idNum > 0);

    const websiteIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    websiteIcon.setAttribute('viewBox', '0 0 512 512');
    websiteIcon.classList.add('beatmap-link-icon');
    const websitePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    websitePath.setAttribute('d', 'M320 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l82.7 0-201.4 201.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L448 109.3 448 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-160c0-17.7-14.3-32-32-32L320 0zM80 96C35.8 96 0 131.8 0 176L0 432c0 44.2 35.8 80 80 80l256 0c44.2 0 80-35.8 80-80l0-80c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 80c0 8.8-7.2 16-16 16L80 448c-8.8 0-16-7.2-16-16l0-256c0-8.8 7.2-16 16-16l80 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L80 96z');
    websiteIcon.appendChild(websitePath);
    beatmapLink.appendChild(websiteIcon);

    if (isUploaded) {
        beatmapLink.dataset.tooltip = 'Open in browser';
        beatmapLink.dataset.action = 'open-web';
        beatmapLink.dataset.url = isUrl ? bID : `https://osu.ppy.sh/beatmapsets/${bID}`;
        beatmapLink.style.cursor = 'pointer';
    } else {
        beatmapLink.dataset.tooltip = 'Not uploaded';
        beatmapLink.classList.add('beatmap-link--disabled');
    }

    meta.appendChild(creatorTag);
    meta.appendChild(versionTag);

    // Target star rating tag (always create, but hide if no value)

    const starTag = document.createElement('span');
    starTag.classList.add('meta-tag', 'meta-tag--star-rating', 'meta-tag--target-sr', 'meta-tag--target-sr-cover');
    if (isTodoTab) {
        starTag.classList.add('meta-tag--target-sr-cover-offset');
    }
    // Hide target star rating chip in completed tab
    if (isCompletedTab) {
        starTag.style.display = 'none';
    }

    const starIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    starIcon.setAttribute('viewBox', '0 0 574 574');
    starIcon.classList.add('meta-tag-icon');

    // Outer ring path
    const starPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    starPath.setAttribute('d', 'M287,0C445.218,0 574,128.782 574,287C574,445.218 445.218,574 287,574C128.782,574 0,445.218 0,287C0,128.782 128.782,0 287,0ZM287,63C164.282,63 63,164.282 63,287C63,409.718 164.282,511 287,511C409.718,511 511,409.718 511,287C511,164.282 409.718,63 287,63Z');
    starIcon.appendChild(starPath);

    // Inner circle
    const innerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    innerCircle.setAttribute('cx', '287');
    innerCircle.setAttribute('cy', '287');
    innerCircle.setAttribute('r', '121');
    starIcon.appendChild(innerCircle);

    const starValue = document.createElement('span');
    starTag.appendChild(starIcon);
    starTag.appendChild(starValue);

    // Helper to update star tag visibility and content
    const updateStarTag = (rating) => {
        if (rating !== null && rating !== undefined && !isNaN(rating)) {
            const color = getStarRatingColor(rating);
            starPath.style.fill = color;
            innerCircle.style.fill = color;
            starValue.textContent = rating.toFixed(1);
            // Border color tied to star rating value
            starTag.style.borderColor = `rgba(${color.slice(4, -1)}, 0.4)`;
            starTag.style.backgroundColor = `rgba(${color.slice(4, -1)}, 0.3)`;
            starTag.style.display = '';
        } else {
            starTag.style.display = 'none';
        }
    };

    // Initial state
    updateStarTag(normalized.targetStarRating);
    starTag.dataset.tooltip = 'Target Star Rating';
    details.appendChild(starTag);

    // Store reference for dynamic updates
    listBox._updateStarTag = updateStarTag;

    const folderLink = document.createElement('button');
    folderLink.type = 'button';
    folderLink.classList.add('beatmap-link');
    folderLink.dataset.tooltip = 'Show in folder';
    folderLink.dataset.action = 'show-folder';
    folderLink.dataset.path = normalized.filePath;

    const folderIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    folderIcon.setAttribute('viewBox', '0 0 512 512');
    folderIcon.classList.add('beatmap-link-icon');
    const folderPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    folderPath.setAttribute('d', 'M64 448l384 0c35.3 0 64-28.7 64-64l0-240c0-35.3-28.7-64-64-64L298.7 80c-6.9 0-13.7-2.2-19.2-6.4L241.1 44.8C230 36.5 216.5 32 202.7 32L64 32C28.7 32 0 60.7 0 96L0 384c0 35.3 28.7 64 64 64z');
    folderIcon.appendChild(folderPath);
    folderLink.appendChild(folderIcon);

    const actionLinks = document.createElement('div');
    actionLinks.classList.add('list-action-links');
    actionLinks.appendChild(beatmapLink);
    actionLinks.appendChild(folderLink);

    details.appendChild(image);
    details.appendChild(actionLinks);
    details.appendChild(calculatedSrTag);
    details.appendChild(title);
    details.appendChild(meta);



    const timeline = document.createElement('canvas');
    timeline.classList.add('list-timeline');
    timeline.setAttribute('aria-hidden', 'true');
    // Set a small default to avoid layout thrashing
    timeline.width = 400;
    timeline.height = 40;

    const expansionArea = document.createElement('div');
    expansionArea.classList.add('extra-info-pane');
    expansionArea.dataset.tab = viewMode; // Add tab context for CSS styling

    // Audio Preview Logic for Timeline
    const handleTimelineSeek = (e) => {
        const rect = timeline.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = Math.min(Math.max(x / rect.width, 0), 1);

        AudioController.play(normalized.id, percentage);
    };

    timeline.style.cursor = 'pointer';
    timeline.addEventListener('mousedown', (e) => {
        handleTimelineSeek(e);

        const onMouseMove = (moveEvent) => {
            handleTimelineSeek(moveEvent);
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });

    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.classList.add('pin-btn');
    const isPinned = todoIds.includes(normalized.id);
    pinBtn.dataset.tooltip = isPinned ? 'Unpin from Todo' : 'Pin to Todo';
    if (isPinned) pinBtn.classList.add('is-active');

    const pinSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pinSvg.setAttribute('viewBox', '0 0 384 512');
    pinSvg.setAttribute('aria-hidden', 'true');
    pinSvg.classList.add('pin-btn-icon');
    const pinPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pinPath.setAttribute('d', 'M32 32C32 14.3 46.3 0 64 0L320 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-29 0 0 160c0 17.1 6.8 33.5 19 45.7l44.3 44.3c14.1 14.1 21.4 33.1 20.3 52.8s-12.7 37.7-30.8 45.6c-10.3 4.5-21.5 6.8-32.8 6.8l-85 0 0 128c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-128-85 0c-11.3 0-22.5-2.3-32.8-6.8c-18.1-7.9-29.7-25.9-30.8-45.6s6.3-38.7 20.3-52.8L93 271.7c12.2-12.2 19-28.6 19-45.7l0-160-29 0c-17.7 0-32-14.3-32-32z');
    pinSvg.appendChild(pinPath);
    pinBtn.appendChild(pinSvg);

    if (isTodoTab) {
        pinBtn.classList.add('is-todo-tab');
        pinBtn.dataset.tooltip = 'Remove from Todo';
    }

    pinBtn.dataset.action = 'toggle-pin';
    pinBtn.dataset.itemId = normalized.id;

    let doneBtn = null;
    // Only show done button for todo and completed tabs
    if (isTodoTab || isCompletedTab) {
        doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.classList.add('done-btn');
        if (isDone) {
            doneBtn.classList.add('is-active');
            listBox.classList.add('is-done');
        }

        const doneSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        doneSvg.setAttribute('viewBox', '0 0 448 512');
        doneSvg.classList.add('done-btn-icon');
        const donePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        donePath.setAttribute('d', 'M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z');
        doneSvg.appendChild(donePath);
        doneBtn.appendChild(doneSvg);

        const doneLabel = document.createElement('span');
        doneLabel.textContent = isDone ? 'Mark as Not Done' : 'Mark as Done';
        doneBtn.appendChild(doneLabel);

        doneBtn.dataset.action = 'toggle-done';
        doneBtn.dataset.itemId = normalized.id;
    }

    let expandIcon = null;
    // Only show expand icon for todo tab
    if (isTodoTab) {
        expandIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        expandIcon.setAttribute('viewBox', '0 0 448 512');
        expandIcon.classList.add('expand-icon');
        const expandPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        expandPath.setAttribute('d', 'M201.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 338.7 54.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z');
        expandIcon.appendChild(expandPath);
    }

    // Build info header based on tab
    const infoHeader = document.createElement('div');
    infoHeader.classList.add('info-header');

    const itemStats = document.createElement('div');
    itemStats.classList.add('item-stats');

    // Calculate progress
    const displayProgress = isDone ? 1 : normalized.progress;
    const progress = Math.round((displayProgress || 0) * 100);

    // ALL TAB: Only duration and progress, right-aligned
    if (isAllTab) {
        const durationSpan = document.createElement('span');
        durationSpan.classList.add('duration-stat');
        durationSpan.innerHTML = `<strong>Duration:</strong> ${formatDuration(normalized.durationMs)}`;
        itemStats.appendChild(durationSpan);

        const progressSpan = document.createElement('span');
        progressSpan.classList.add('progress-stat');
        progressSpan.innerHTML = `<strong>Progress:</strong> ${progress}%`;
        itemStats.appendChild(progressSpan);

        infoHeader.appendChild(itemStats);
        expansionArea.appendChild(infoHeader);
    }
    // COMPLETED TAB: Full info - duration, progress, mark as not done button
    else if (isCompletedTab) {
        const durationSpan = document.createElement('span');
        durationSpan.classList.add('duration-stat');
        durationSpan.innerHTML = `<strong>Duration:</strong> ${formatDuration(normalized.durationMs)}`;
        itemStats.appendChild(durationSpan);

        const progressSpan = document.createElement('span');
        progressSpan.classList.add('progress-stat');
        progressSpan.innerHTML = `<strong>Progress:</strong> ${progress}%`;
        itemStats.appendChild(progressSpan);

        infoHeader.appendChild(itemStats);

        if (doneBtn) {
            infoHeader.appendChild(doneBtn);
        }

        expansionArea.appendChild(infoHeader);
    }
    // TODO TAB: Full info - duration, progress, mark as done, deadline, extra actions
    else if (isTodoTab) {
        const durationSpan = document.createElement('span');
        durationSpan.classList.add('duration-stat');
        durationSpan.innerHTML = `<strong>Duration:</strong> ${formatDuration(normalized.durationMs)}`;
        itemStats.appendChild(durationSpan);

        const progressSpan = document.createElement('span');
        progressSpan.classList.add('progress-stat');
        progressSpan.innerHTML = `<strong>Progress:</strong> ${progress}%`;
        itemStats.appendChild(progressSpan);

        if (expandIcon) {
            infoHeader.appendChild(expandIcon);
        }

        infoHeader.appendChild(itemStats);

        if (doneBtn) {
            infoHeader.appendChild(doneBtn);
        }

        expansionArea.appendChild(infoHeader);
    }

    if (viewMode === 'all' && todoIds.includes(normalized.id)) {
        listBox.classList.add('is-pinned');
    }

    // Deadline Logic
    const deadlineContainer = document.createElement('div');
    deadlineContainer.classList.add('deadline-container');

    // Status visual
    const now = Date.now();
    let statusClass = '';
    if (normalized.deadline && !isDone) {
        const diffDays = (normalized.deadline - now) / (1000 * 60 * 60 * 24);
        if (diffDays < 0) {
            statusClass = 'list-box--overdue';
        } else if (diffDays <= 3) {
            statusClass = 'list-box--due-soon';
        }
    }
    if (statusClass) listBox.classList.add(statusClass);

    // Only show Deadline and Extra Actions in Todo Tab
    if (isTodoTab) {
        const deadlineLabel = document.createElement('label');
        deadlineLabel.textContent = 'Deadline:';
        deadlineLabel.classList.add('deadline-label');

        const createCustomDatePicker = (currentValue, onChange) => {
            const container = document.createElement('div');
            container.classList.add('date-picker-wrapper');

            const trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.classList.add('date-picker-trigger');

            const updateTriggerText = (val) => {
                if (val) {
                    const d = new Date(val);
                    trigger.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                    trigger.classList.add('has-value');
                } else {
                    trigger.textContent = 'Set Deadline';
                    trigger.classList.remove('has-value');
                }
            };
            updateTriggerText(currentValue);

            trigger.onclick = (e) => {
                e.stopPropagation();
                // If just closed via trigger click, don't re-open
                if (GlobalDatePicker._justClosedViaTrigger) {
                    GlobalDatePicker._justClosedViaTrigger = false;
                    return;
                }
                GlobalDatePicker.open(trigger, currentValue, (newVal) => {
                    currentValue = newVal;
                    updateTriggerText(newVal);
                    onChange(newVal);
                });
            };

            container.appendChild(trigger);
            return container;
        };

        const deadlinePicker = createCustomDatePicker(normalized.deadline, (newDeadline) => {
            setItemDeadline(normalized.id, newDeadline);
        });

        const expansionContent = document.createElement('div');
        expansionContent.classList.add('expansion-content');

        const notesContainer = document.createElement('div');
        notesContainer.classList.add('notes-container');
        const notesTextarea = document.createElement('textarea');
        notesTextarea.classList.add('notes-textarea');
        notesTextarea.placeholder = 'Add notes...';
        notesTextarea.value = normalized.notes || '';
        notesTextarea.onclick = (e) => e.stopPropagation();
        notesTextarea.oninput = (e) => {
            setItemNotes(normalized.id, e.target.value);
        };
        notesContainer.appendChild(notesTextarea);
        expansionContent.appendChild(notesContainer);

        const controlsContainer = document.createElement('div');
        controlsContainer.classList.add('expansion-controls');

        deadlineContainer.appendChild(deadlineLabel);
        deadlineContainer.appendChild(deadlinePicker);
        controlsContainer.appendChild(deadlineContainer);

        // Target Star Rating Row
        const targetStarContainer = document.createElement('div');
        targetStarContainer.classList.add('target-star-container');

        const targetStarLabel = document.createElement('label');
        targetStarLabel.textContent = 'Target star rating:';
        targetStarLabel.classList.add('target-star-label');

        const targetStarInput = document.createElement('input');
        targetStarInput.type = 'number';
        targetStarInput.step = '0.1';
        targetStarInput.min = '0';
        targetStarInput.max = '15';
        targetStarInput.classList.add('target-star-input');
        targetStarInput.value = metadata?.targetStarRating ?? '';

        targetStarInput.onclick = (e) => e.stopPropagation();
        targetStarInput.oninput = (e) => {
            const val = e.target.value;
            const rating = val === '' ? null : parseFloat(val);
            setItemTargetStarRating(normalized.id, rating);
        };

        targetStarContainer.appendChild(targetStarLabel);
        targetStarContainer.appendChild(targetStarInput);
        controlsContainer.appendChild(targetStarContainer);

        expansionContent.appendChild(controlsContainer);
        expansionArea.appendChild(expansionContent);




    }

    const timelineContainer = document.createElement('div');
    timelineContainer.classList.add('timeline-container');
    timelineContainer.appendChild(timeline);
    timelineContainer.appendChild(expansionArea);

    const rightPane = document.createElement('div');
    rightPane.classList.add('list-right');
    rightPane.appendChild(timelineContainer);
    if (!isDone) {
        rightPane.appendChild(pinBtn);
    }

    const listMain = document.createElement('div');
    listMain.classList.add('list-main');

    // Click handler for expansion (Only for Todo Tab)
    if (isTodoTab) {
        const toggleExpansion = (e) => {
            // Ignore clicks on interactive elements
            if (e.target.closest('button, a, input, .list-timeline')) return;
            // Ignore clicks inside the expansion area (deadline, target star, extra actions)
            if (e.target.closest('.deadline-container, .target-star-container, .extra-actions')) return;

            listBox.classList.toggle('expanded');
        };
        listBox.addEventListener('click', toggleExpansion);
    }



    if (viewMode === 'todo') {
        const num = document.createElement('span');
        num.classList.add('todo-number');
        num.textContent = `${index + 1}.`;
        details.appendChild(num);
    }

    listMain.appendChild(details);
    listMain.appendChild(rightPane);

    listBox.appendChild(listMain);

    return listBox;
};

const batchRenderTimelines = [];
let batchRenderTimelinesRAF = 0;
const TIMELINE_BATCH_RENDER_SIZE = 5;

const flushTimelineBatchRender = () => {
    batchRenderTimelinesRAF = 0;
    if (isWindowResizeInProgress) return;

    let processed = 0;
    while (batchRenderTimelines.length > 0 && processed < TIMELINE_BATCH_RENDER_SIZE) {
        const job = batchRenderTimelines.shift();
        if (!job?.el || !job.el.isConnected) continue;
        applyTimelineToBox(job.el, job.index);
        processed += 1;
    }

    if (batchRenderTimelines.length > 0) {
        batchRenderTimelinesRAF = requestAnimationFrame(flushTimelineBatchRender);
    }
};

const scheduleTimelineBatchRender = () => {
    if (batchRenderTimelinesRAF || isWindowResizeInProgress) return;
    batchRenderTimelinesRAF = requestAnimationFrame(flushTimelineBatchRender);
};

const cancelTimelineBatchRender = () => {
    batchRenderTimelines.length = 0;
    if (!batchRenderTimelinesRAF) return;
    cancelAnimationFrame(batchRenderTimelinesRAF);
    batchRenderTimelinesRAF = 0;
};

const syncVirtualList = () => {
    const container = document.querySelector('#listContainer');
    if (!container) return;

    // Don't run the virtual list logic in grouped mode — groups use flow layout
    if (container.classList.contains('view-grouped')) return;
    if (viewMode === 'all' && shouldUseSvelteAllView()) return;
    if (viewMode === 'todo' && shouldUseSvelteTodoView()) return;
    if (viewMode === 'completed' && shouldUseSvelteCompletedView()) return;
    const scrollTop = window.scrollY;
    const windowHeight = window.innerHeight;
    // Use cached containerTop — recomputed only on full re-renders (renderBeatmapList).
    // Avoids header-wrap at narrow widths causing churn on every resize/scroll tick.
    const containerTop = cachedContainerTop;

    // Calculate which items are in view
    const startIndex = Math.max(0, Math.floor((scrollTop - containerTop) / VIRTUAL_ITEM_HEIGHT) - 5);
    const endIndex = Math.min(itemsToRender.length, Math.ceil((scrollTop - containerTop + windowHeight) / VIRTUAL_ITEM_HEIGHT) + 5);

    // Filter out items that are already in DOM and are still in view
    const currentElements = Array.from(container.querySelectorAll('.list-box'));
    const currentIds = new Set(currentElements.map(el => el.dataset.itemId));
    const targetIndices = new Set();
    for (let i = startIndex; i < endIndex; i++) targetIndices.add(i);

    // Remove elements that are out of view
    currentElements.forEach(el => {
        const idx = Number(el.dataset.renderIndex);
        if (!targetIndices.has(idx)) {
            el.remove();
            currentIds.delete(el.dataset.itemId);
        }
    });

    // Add elements that just came into view
    const fragment = document.createDocumentFragment();
    for (let i = startIndex; i < endIndex; i++) {
        const item = itemsToRender[i];
        if (!currentIds.has(item.id)) {
            const el = buildListItem(item, i);
            el.dataset.renderIndex = i;
            el.style.top = `${i * VIRTUAL_ITEM_HEIGHT}px`;
            fragment.appendChild(el);

            // Render timeline after adding to DOM fragment
            batchRenderTimelines.push({ el, index: i });
        }
    }
    container.appendChild(fragment);

    // Process timeline rendering in small RAF batches for smoother scrolling/resizing.
    scheduleTimelineBatchRender();

    updateEmptyState(container);
};

const renderBeatmapList = (listContainer, items) => {
    // Cancel any in-flight incremental grouped render when switching modes.
    groupedRenderPassToken += 1;
    cancelTimelineBatchRender();
    itemsToRender = items;
    const totalHeight = items.length > 0 ? (items.length * VIRTUAL_ITEM_HEIGHT - 12) : 0;
    listContainer.style.height = `${totalHeight}px`;
    listContainer.innerHTML = ''; // Fresh state
    // Measure containerTop now while layout is stable, before any scroll/resize can shift it.
    const rect = listContainer.getBoundingClientRect();
    cachedContainerTop = rect.top + window.scrollY;
    syncVirtualList();
};

const rerenderVisibleTimelines = () => {
    const containers = [
        document.querySelector('#listContainer'),
        document.querySelector('#svelteAllListContainer'),
        document.querySelector('#svelteTodoListContainer'),
        document.querySelector('#svelteCompletedListContainer'),
        document.querySelector('#svelteGroupedListContainer')
    ].filter(Boolean);
    if (!containers.length) return;

    const viewportTop = -120;
    const viewportBottom = window.innerHeight + 120;
    const visibleBoxes = containers.flatMap((container) => Array.from(container.querySelectorAll('.list-box'))).filter((box) => {
        if (isInHiddenTree(box) || box.getClientRects().length === 0) {
            return false;
        }
        const rect = box.getBoundingClientRect();
        return rect.bottom >= viewportTop && rect.top <= viewportBottom;
    });

    if (!visibleBoxes.length) return;

    const BATCH_SIZE = 6;
    let cursor = 0;

    const processBatch = () => {
        const end = Math.min(cursor + BATCH_SIZE, visibleBoxes.length);
        for (let i = cursor; i < end; i++) {
            const box = visibleBoxes[i];
            const index = Number(box.dataset.renderIndex);
            applyTimelineToBox(box, Number.isNaN(index) ? undefined : index);
        }
        cursor = end;

        if (cursor < visibleBoxes.length) {
            requestAnimationFrame(processBatch);
        }
    };

    requestAnimationFrame(processBatch);
};

// ============================================================
// Grouped-by-song rendering
// ============================================================

// Persists which groups are expanded (keyed by song title+artist+creator)
const groupedExpandedKeys = new Set();

/**
 * Returns a stable key for a song group.
 * Group by song + mapper so same-title mapsets by different creators stay separated.
 */
const getGroupKey = (item) => `${(item.artistUnicode || item.artist || '').toLowerCase()}||${(item.titleUnicode || item.title || '').toLowerCase()}||${(item.creator || '').toLowerCase()}`;

/**
 * Groups an array of beatmap items by song (artist + title).
 * Returns an ordered array of { key, items[] }.
 */
const groupItemsBySong = (items) => {
    const map = new Map();
    const order = [];
    for (const item of items) {
        const key = getGroupKey(item);
        if (!map.has(key)) {
            map.set(key, []);
            order.push(key);
        }
        map.get(key).push(item);
    }
    return order.map(key => ({ key, items: map.get(key) }));
};

const setGroupExpanded = (key, expanded) => {
    if (!key) return false;

    const isExpanded = groupedExpandedKeys.has(key);
    if (expanded) {
        if (isExpanded) return false;
        groupedExpandedKeys.add(key);
    } else {
        if (!isExpanded) return false;
        groupedExpandedKeys.delete(key);
    }

    emitGroupViewStateToUI(getGroupViewSnapshot());
    emitViewModelStateToUI(getViewModelSnapshot());
    return true;
};

const toggleGroupExpanded = (key) => {
    if (!key) return false;
    return setGroupExpanded(key, !groupedExpandedKeys.has(key));
};

const replaceExpandedGroups = (keys) => {
    groupedExpandedKeys.clear();
    if (Array.isArray(keys)) {
        for (const key of keys) {
            if (!key) continue;
            groupedExpandedKeys.add(String(key));
        }
    }
    emitGroupViewStateToUI(getGroupViewSnapshot());
    emitViewModelStateToUI(getViewModelSnapshot());
    return getGroupViewSnapshot();
};

/**
 * Builds an individual "child" row for an expanded group.
 * It reuses buildListItem but wraps it with a hierarchy indicator.
 */
const buildGroupChildRow = (item, index) => {
    const wrapper = document.createElement('div');
    wrapper.classList.add('group-child-row');

    const indicator = document.createElement('div');
    indicator.classList.add('group-child-indicator');

    const inner = buildListItem(item, index);
    inner.classList.add('list-box--group-child');

    wrapper.appendChild(indicator);
    wrapper.appendChild(inner);

    return wrapper;
};

const mountLegacyListBox = (container, itemId, index = 0, options = {}) => {
    if (!(container instanceof Element)) return false;
    if (!itemId) return false;

    const item = beatmapItems.find((entry) => entry.id === itemId);
    if (!item) return false;

    const box = buildListItem(item, index);
    box.dataset.renderIndex = String(index);
    if (options?.groupChild) {
        box.classList.add('list-box--group-child');
    }
    if (options?.flow) {
        box.classList.add('list-box--flow');
    }

    container.replaceChildren(box);
    batchRenderTimelines.push({ el: box, index: item });
    scheduleTimelineBatchRender();
    return true;
};

const clearLegacyListBox = (container) => {
    if (!(container instanceof Element)) return false;
    container.replaceChildren();
    return true;
};

/**
 * Builds the collapsed group header row shown when groupMapsBySong is enabled.
 * Uses CSS Grid (grid-template-rows: 0fr → 1fr) for the expand animation —
 * no JS height measurements, no race conditions.
 */
const buildGroupHeaderRow = (group, groupIndex) => {
    const { key, items } = group;
    const rep = items[0];
    const isExpanded = groupedExpandedKeys.has(key);
    const normalized = normalizeMetadata(rep);

    const groupEl = document.createElement('div');
    groupEl.classList.add('group-row');
    groupEl.dataset.groupKey = key;
    if (isExpanded) groupEl.classList.add('is-expanded');

    // ---- Header (always visible, clickable to toggle) ----
    const header = document.createElement('div');
    header.classList.add('group-row-header');

    // Cover image (left)
    const imgWrap = document.createElement('div');
    imgWrap.classList.add('group-row-cover');
    const img = document.createElement('img');
    img.alt = `${normalized.artistUnicode} - ${normalized.titleUnicode}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    if (normalized.coverUrl) {
        img.src = normalized.coverUrl;
        img.onerror = () => { img.onerror = null; img.src = './assets/placeholder.png'; img.classList.add('list-img--placeholder'); };
    } else {
        img.src = './assets/placeholder.png';
        img.classList.add('list-img--placeholder');
        if (normalized.coverPath) {
            const queueKey = `group||${key}::${normalized.coverPath}`;
            if (!queuedCoverPaths.has(queueKey)) {
                queuedCoverPaths.add(queueKey);
                coverLoadQueue.push({ itemId: `group||${key}`, coverPath: normalized.coverPath });
                processCoverLoadQueue();
            }
            groupEl._coverImg = img;
        }
    }
    imgWrap.appendChild(img);
    const overlay = document.createElement('div');
    overlay.classList.add('group-row-cover-overlay');
    imgWrap.appendChild(overlay);

    // Center: song info
    const info = document.createElement('div');
    info.classList.add('group-row-info');

    const titleEl = document.createElement('h3');
    titleEl.classList.add('group-row-title');
    titleEl.textContent = `${normalized.artistUnicode} - ${normalized.titleUnicode}`;
    info.appendChild(titleEl);

    const countEl = document.createElement('span');
    countEl.classList.add('group-row-count');
    countEl.textContent = `${items.length} difficult${items.length === 1 ? 'y' : 'ies'}`;
    info.appendChild(countEl);

    const creatorTag = document.createElement('span');
    creatorTag.classList.add('meta-tag', 'group-row-creator-tag');
    creatorTag.textContent = normalized.creator;
    creatorTag.dataset.tooltip = 'Mapper';
    info.appendChild(creatorTag);

    // Right: version carousel
    const carousel = document.createElement('div');
    carousel.classList.add('group-row-carousel');
    // Chips are built later to handle circular references if needed, 
    // but here we just need to ensure the click handler can find the container.

    // Expand/collapse chevron
    const chevronWrap = document.createElement('div');
    chevronWrap.classList.add('group-row-chevron');
    const chevronSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevronSvg.setAttribute('viewBox', '0 0 448 512');
    const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    chevronPath.setAttribute('d', 'M201.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 338.7 54.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z');
    chevronSvg.appendChild(chevronPath);
    chevronWrap.appendChild(chevronSvg);

    // Wrap cover + info so text can overlay the image
    const coverSection = document.createElement('div');
    coverSection.classList.add('group-row-cover-section');
    coverSection.appendChild(imgWrap);
    coverSection.appendChild(info);

    header.appendChild(coverSection);
    header.appendChild(carousel);
    header.appendChild(chevronWrap);

    // ---- Children (CSS Grid animated: 0fr → 1fr, zero JS measurements needed) ----
    const childrenContainer = document.createElement('div');
    childrenContainer.classList.add('group-row-children');
    if (isExpanded) childrenContainer.classList.add('is-open');

    // Inner wrapper: overflow:hidden + min-height:0 enables the grid trick
    const childrenInner = document.createElement('div');
    childrenInner.classList.add('group-row-children-inner');
    childrenContainer.appendChild(childrenInner);

    // Helper: build child items once and cache them in childrenInner
    const ensureChildrenBuilt = () => {
        if (childrenInner.children.length > 0) return; // already built
        items.forEach((item, i) => {
            const row = buildGroupChildRow(item, i);
            childrenInner.appendChild(row);
            const box = row.querySelector('.list-box');
            if (box) {
                batchRenderTimelines.push({ el: box, index: item });
            }
        });
        scheduleTimelineBatchRender();
    };

    // If starting expanded, build immediately
    if (isExpanded) ensureChildrenBuilt();

    // ---- Toggle logic (race-condition-free) ----
    let isAnimating = false;
    let animSafetyTimer = null;

    header.addEventListener('click', () => {
        if (isAnimating) return;

        const wasExpanded = groupedExpandedKeys.has(key);
        isAnimating = true;

        // Release the lock once the CSS transition ends (or after a safety timeout)
        const release = () => {
            isAnimating = false;
            if (animSafetyTimer) { clearTimeout(animSafetyTimer); animSafetyTimer = null; }
        };
        childrenContainer.addEventListener('transitionend', release, { once: true });
        animSafetyTimer = setTimeout(release, 600); // fallback if transitionend doesn't fire

        if (wasExpanded) {
            setGroupExpanded(key, false);
            groupEl.classList.remove('is-expanded');
            childrenContainer.classList.remove('is-open');
            // Children stay in DOM (hidden by 0fr grid row) — re-opening is instant
        } else {
            setGroupExpanded(key, true);
            groupEl.classList.add('is-expanded');
            ensureChildrenBuilt(); // lazy build on first expand

            // Wait for DOM to settle before animating to avoid layout thrash
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    childrenContainer.classList.add('is-open');
                });
            });
        }
    });

    // ---- Build Chips (placed here to safely reference childrenInner in closure) ----
    items.forEach(item => {
        const chip = document.createElement('span');
        chip.classList.add('group-row-version-chip');
        chip.textContent = item.version || 'Unknown';
        chip.title = item.version || 'Unknown';
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasExpanded = groupedExpandedKeys.has(key);
            if (!wasExpanded) {
                header.click();
            }

            // Scroll to the item with a slight delay to allow expansion logic/DOM to catch up
            setTimeout(() => {
                const target = childrenInner.querySelector(`[data-item-id="${item.id}"]`);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

                    // Simple distance-based delay calculation
                    const rect = target.getBoundingClientRect();
                    const distance = Math.abs(rect.top - (window.innerHeight / 2));
                    // Base 350ms + roughly 0.2ms per pixel, capped at 1.2s
                    const highlightDelay = Math.min(1200, 350 + (distance / 5));

                    setTimeout(() => {
                        target.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), outline 0.3s ease';
                        target.style.transform = 'scale(1.01)';
                        target.style.outline = '2px solid var(--accent-primary)';
                        target.style.outlineOffset = '0px';
                        target.style.zIndex = '100';

                        setTimeout(() => {
                            target.style.transform = '';
                            target.style.outline = '';
                            target.style.outlineOffset = '';
                            target.style.zIndex = '';
                        }, 1200);
                    }, highlightDelay);
                }
            }, wasExpanded ? 50 : 500);
        });
        carousel.appendChild(chip);
    });

    groupEl.appendChild(header);
    groupEl.appendChild(childrenContainer);

    return groupEl;
};

/**
 * Renders the grouped layout (non-virtual, flow layout).
 */
const renderGroupedView = (listContainer, groups) => {
    const passToken = ++groupedRenderPassToken;
    const BATCH_SIZE = 12;

    cancelTimelineBatchRender();
    listContainer.style.height = ''; // Let content determine height for grouped mode
    listContainer.innerHTML = '';

    if (!groups.length) {
        updateEmptyState(listContainer);
        return;
    }

    let cursor = 0;
    const processBatch = () => {
        // Stop stale jobs (e.g. user switched tabs while batches were pending).
        if (passToken !== groupedRenderPassToken) return;
        if (!listContainer.isConnected || !listContainer.classList.contains('view-grouped')) return;

        const fragment = document.createDocumentFragment();
        const end = Math.min(cursor + BATCH_SIZE, groups.length);
        for (let i = cursor; i < end; i++) {
            fragment.appendChild(buildGroupHeaderRow(groups[i], i));
        }
        listContainer.appendChild(fragment);
        cursor = end;

        if (cursor < groups.length) {
            requestAnimationFrame(processBatch);
            return;
        }

        updateEmptyState(listContainer);
    };

    requestAnimationFrame(processBatch);
};

const setLoading = (isLoading) => {
    const loading = !!isLoading;
    listUiState = {
        ...listUiState,
        isLoading: loading,
        progressVisible: loading ? listUiState.progressVisible : false
    };
    notifyListUiToUI(getListUiSnapshot());
};

const updateProgress = (current, total) => {
    const pct = total > 0 ? (current / total) * 100 : 0;
    listUiState = {
        ...listUiState,
        progressVisible: true,
        progressPct: pct,
        progressLabel: `Processing ${current} / ${total} files...`
    };
    notifyListUiToUI(getListUiSnapshot());
};

const updateEmptyState = (listContainer) => {
    if (!listContainer) {
        return;
    }
    const hasItems = itemsToRender.length > 0;
    listUiState = {
        ...listUiState,
        isEmpty: !hasItems,
        showClearAll: hasItems
    };
    notifyListUiToUI(getListUiSnapshot());
};

const getDirectoryPath = (filePath) => {
    const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    if (lastSlash === -1) {
        return '';
    }
    return filePath.slice(0, lastSlash + 1);
};

const computeProgress = (ranges) => {
    if (!ranges.length) {
        return 0;
    }

    const objectRanges = ranges.filter((r) => r.type === 'object' || !r.type);
    const breakRanges = ranges.filter((r) => r.type === 'break');

    let populated = objectRanges.reduce((sum, r) => sum + (r.end - r.start), 0);
    let total = 1.0;

    if (settings.ignoreStartAndBreaks) {
        const firstStart = objectRanges.length ? Math.min(...objectRanges.map(r => r.start)) : 0;
        const breakSum = breakRanges.reduce((sum, r) => sum + (r.end - r.start), 0);

        populated += breakSum; // Count breaks into progress
        total = Math.max(0.001, 1.0 - firstStart); // Ignore start

        return Math.min(1.0, populated / total);
    }

    return Math.min(1.0, populated);
};

const createItemId = (seed) => {
    if (!seed) return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        const char = seed.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return 'id-' + Math.abs(hash).toString(36) + seed.length.toString(36);
};

const updateTabCounts = () => {
    emitCoreStateToUI(getCoreStateSnapshot());
};

const isInHiddenTree = (element) => {
    let node = element;
    while (node) {
        if (node instanceof HTMLElement && node.hidden) {
            return true;
        }
        node = node.parentElement;
    }
    return false;
};

const getVisibleListBoxByItemId = (itemId) => {
    if (!itemId) return null;
    const matches = Array.from(document.querySelectorAll(`[data-item-id="${itemId}"].list-box`));
    if (!matches.length) return null;

    const visible = matches.find((el) => !isInHiddenTree(el) && el.getClientRects().length > 0);
    if (visible) return visible;

    const notHidden = matches.find((el) => !isInHiddenTree(el));
    return notHidden || matches[0] || null;
};

const updateListItemElement = (itemId) => {
    const roots = [
        document.querySelector('#listContainer'),
        document.querySelector('#svelteAllListContainer'),
        document.querySelector('#svelteTodoListContainer'),
        document.querySelector('#svelteGroupedListContainer'),
        document.querySelector('#svelteCompletedListContainer')
    ].filter(Boolean);
    if (!roots.length) return;

    const elements = [];
    roots.forEach((root) => {
        root.querySelectorAll(`[data-item-id="${itemId}"]`).forEach((candidate) => {
            if (candidate.classList?.contains('list-box')) {
                elements.push(candidate);
            }
        });
    });
    if (!elements.length) return;

    const isPinned = todoIds.includes(itemId);
    const isDone = doneIds.includes(itemId);

    // 4. Update Stats (look up latest state from model if possible)
    const item = beatmapItems.find(i => i.id === itemId);

    elements.forEach((el) => {
        // 1. Update list-box state classes
        el.classList.toggle('is-pinned', isPinned && viewMode === 'all');
        el.classList.toggle('is-done', isDone);

        // 2. Update Pin Button state
        const pinBtn = el.querySelector('.pin-btn');
        if (pinBtn) {
            pinBtn.classList.toggle('is-active', isPinned);
            if (viewMode === 'todo') {
                pinBtn.dataset.tooltip = 'Remove from Todo';
            } else {
                pinBtn.dataset.tooltip = isPinned ? 'Unpin from Todo' : 'Pin to Todo';
            }
        }

        // 3. Update Done Button (if exists in this view)
        const doneBtn = el.querySelector('.done-btn');
        if (doneBtn) {
            doneBtn.classList.toggle('is-active', isDone);
            const label = doneBtn.querySelector('span');
            if (label) {
                label.textContent = isDone ? 'Mark as Not Done' : 'Mark as Done';
            }
        }

        if (item) {
            el.dataset.progress = String(item.progress || 0);
        }

        const durationStat = el.querySelector('.duration-stat');
        if (durationStat && item) {
            durationStat.innerHTML = `<strong>Duration:</strong> ${formatDuration(item.durationMs)}`;
        }

        const calculatedSrTag = el.querySelector('.meta-tag--calculated-sr');
        if (calculatedSrTag) {
            applyCalculatedStarTagState(calculatedSrTag, item?.starRating);
        }

        const progressStat = el.querySelector('.progress-stat') || el.querySelector('.stat-item');
        if (progressStat) {
            const baseProgress = item ? (item.progress || 0) : (Number(el.dataset.progress) || 0);
            const displayProgress = isDone ? 1 : baseProgress;
            progressStat.innerHTML = `<strong>Progress:</strong> ${Math.round(displayProgress * 100)}%`;
        }

        // 5. Update Timeline Canvas
        applyTimelineToBox(el, item);
    });
};

const insertItemIntoTodoView = (itemId) => {
    renderFromState();
};

const insertItemIntoCompletedView = (itemId) => {
    renderFromState();
};

const updateDeadlineStatusClass = (itemId) => {
    if (!itemId) return;
    const rows = Array.from(document.querySelectorAll(`[data-item-id="${itemId}"].list-box`));
    if (!rows.length) return;

    const item = beatmapItems.find((entry) => entry.id === itemId);
    const isDone = doneIds.includes(itemId);
    rows.forEach((el) => {
        el.classList.remove('list-box--overdue', 'list-box--due-soon');

        if (!item || !item.deadline || isDone) {
            return;
        }

        const diffDays = (item.deadline - Date.now()) / (1000 * 60 * 60 * 24);
        if (diffDays < 0) {
            el.classList.add('list-box--overdue');
        } else if (diffDays <= 3) {
            el.classList.add('list-box--due-soon');
        }
    });
};

const setItemDeadline = (itemId, deadline) => {
    if (!itemId) return false;
    const item = beatmapItems.find((entry) => entry.id === itemId);
    if (!item) return false;

    const normalized = (typeof deadline === 'number' && Number.isFinite(deadline)) ? deadline : null;
    if (item.deadline === normalized) {
        return true;
    }

    item.deadline = normalized;
    scheduleSave();
    updateDeadlineStatusClass(itemId);
    emitItemDetailsStateToUI(getItemDetailsByIdSnapshot(itemId));
    return true;
};

const setItemTargetStarRating = (itemId, rating) => {
    if (!itemId) return false;
    const item = beatmapItems.find((entry) => entry.id === itemId);
    if (!item) return false;

    const parsed = (typeof rating === 'number' && Number.isFinite(rating)) ? Math.max(0, Math.min(15, rating)) : null;
    if (item.targetStarRating === parsed) {
        return true;
    }

    item.targetStarRating = parsed;
    scheduleSave();

    document.querySelectorAll(`[data-item-id="${itemId}"].list-box`).forEach((el) => {
        if (typeof el._updateStarTag === 'function') {
            el._updateStarTag(parsed);
        }
    });

    emitItemDetailsStateToUI(getItemDetailsByIdSnapshot(itemId));
    return true;
};

const setItemNotes = (itemId, notes) => {
    if (!itemId) return false;
    const item = beatmapItems.find((entry) => entry.id === itemId);
    if (!item) return false;

    const normalized = String(notes || '');
    if (item.notes === normalized) {
        return true;
    }

    item.notes = normalized;
    scheduleSave();
    emitItemDetailsStateToUI(getItemDetailsByIdSnapshot(itemId));
    return true;
};

const reorderTodoIds = (draggedId, dropId) => {
    if (!draggedId || !dropId || draggedId === dropId) {
        return false;
    }

    const fromIndex = todoIds.indexOf(draggedId);
    const toIndex = todoIds.indexOf(dropId);
    if (fromIndex === -1 || toIndex === -1) {
        return false;
    }

    const [movedItem] = todoIds.splice(fromIndex, 1);
    todoIds.splice(toIndex, 0, movedItem);
    emitTodoOrderStateToUI(getTodoOrderSnapshot());
    scheduleSave();
    renderFromState();
    return true;
};

const toggleTodo = (itemId) => {
    const wasPinned = todoIds.includes(itemId);
    if (wasPinned) {
        // Remove from todo list
        todoIds = todoIds.filter(id => id !== itemId);
        emitTodoOrderStateToUI(getTodoOrderSnapshot());
        updateTabCounts();
        scheduleSave();

        if (viewMode === 'todo') {
            // Remove the element from the current view with an animation
            removeItemFromView(itemId);
        } else {
            // Just update the existing element appearance
            updateListItemElement(itemId);
        }
    } else {
        // Add to todo list (at end)
        todoIds.push(itemId);
        emitTodoOrderStateToUI(getTodoOrderSnapshot());
        updateTabCounts();
        scheduleSave();

        if (viewMode === 'todo') {
            insertItemIntoTodoView(itemId);
        } else {
            updateListItemElement(itemId);
        }
    }
};

const toggleDone = (itemId) => {
    const wasDone = doneIds.includes(itemId);
    if (wasDone) {
        // Unmarking as done: remove from done list and return to Todo
        doneIds = doneIds.filter(id => id !== itemId);
        if (!todoIds.includes(itemId)) {
            // Add to front of the todo list
            todoIds.unshift(itemId);
        }

        emitTodoOrderStateToUI(getTodoOrderSnapshot());
        updateTabCounts();
        scheduleSave();

        if (viewMode === 'completed') {
            removeItemFromView(itemId);
        } else if (viewMode === 'todo') {
            insertItemIntoTodoView(itemId);
        } else {
            updateListItemElement(itemId);
        }
    } else {
        // Marking as done: add and remove from todo
        doneIds.push(itemId);
        todoIds = todoIds.filter(id => id !== itemId);

        emitTodoOrderStateToUI(getTodoOrderSnapshot());
        updateTabCounts();
        scheduleSave();

        if (viewMode === 'todo') {
            removeItemFromView(itemId);
        } else if (viewMode === 'completed') {
            insertItemIntoCompletedView(itemId);
        } else {
            updateListItemElement(itemId);
        }
    }
};

const removeItemFromView = (itemId) => {
    const existingEl = getVisibleListBoxByItemId(itemId);

    // If it's the last item, we want an immediate collapse of the container
    const isLastItem = itemsToRender.length <= 1;

    if (existingEl) {
        animateRemoveElement(existingEl);

        // Delay full re-render so following items don't snap instantly, 
        // but if it's the last item, collapse immediately.
        setTimeout(() => {
            renderFromState();
        }, isLastItem ? 0 : 300);
    } else {
        renderFromState();
    }
};

const sortItems = (items, mode, direction) => {
    const sorted = [...items];
    const multiplier = direction === 'asc' ? 1 : -1;
    switch (mode) {
        case 'dateModified':
            sorted.sort((a, b) => ((a.dateModified || 0) - (b.dateModified || 0)) * multiplier);
            break;
        case 'name':
            sorted.sort((a, b) => {
                const nameA = `${a.artist} - ${a.title}`.toLowerCase();
                const nameB = `${b.artist} - ${b.title}`.toLowerCase();
                return nameA.localeCompare(nameB) * multiplier;
            });
            break;
        case 'progress':
            sorted.sort((a, b) => ((a.progress || 0) - (b.progress || 0)) * multiplier);
            break;
        case 'starRating':
            sorted.sort((a, b) => ((a.starRating || 0) - (b.starRating || 0)) * multiplier);
            break;
        case 'dateAdded':
        default:
            sorted.sort((a, b) => ((a.dateAdded || 0) - (b.dateAdded || 0)) * multiplier);
            break;
    }
    return sorted;
};

const filterItems = (items, query) => {
    let filtered = items;

    // Apply text search filter if query exists
    if (query) {
        const needle = query.toLowerCase();
        filtered = filtered.filter((item) => {
            return [
                item.title,
                item.titleUnicode,
                item.artist,
                item.artistUnicode,
                item.creator,
                item.version,
                item.beatmapSetID,
            ]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(needle));
        });
    }

    // Always apply star rating filter
    const isDefaultRange = srFilter.min === 0 && srFilter.max >= 10;
    if (!isDefaultRange) {
        filtered = filtered.filter(item => {
            const sr = item.starRating || 0;
            if (srFilter.max >= 10) {
                return sr >= srFilter.min;
            }
            return sr >= srFilter.min && sr <= srFilter.max;
        });
    }

    return filtered;
};

const renderFromState = () => {
    const listContainer = document.querySelector('#listContainer');

    // Always compute itemsToRender first — getViewModelSnapshot() depends on it for
    // groups/itemIds, so it must be up-to-date even when Svelte is handling the view.
    _cachedMapperNeedles = (getEffectiveMapperName() || '').split(',').map(m => m.trim().toLowerCase()).filter(Boolean);

    itemsToRender = [];
    if (viewMode === 'todo') {
        const itemMap = new Map();
        for (const item of beatmapItems) itemMap.set(item.id, item);
        for (const id of todoIds) {
            const item = itemMap.get(id);
            if (item && !isGuestDifficultyItem(item)) itemsToRender.push(item);
        }
    } else if (viewMode === 'completed') {
        const itemMap = new Map();
        for (const item of beatmapItems) itemMap.set(item.id, item);
        for (const id of doneIds) {
            const item = itemMap.get(id);
            if (item && !isGuestDifficultyItem(item)) itemsToRender.push(item);
        }
    } else {
        const visibleItems = beatmapItems.filter(item => !isGuestDifficultyItem(item));
        const filtered = filterItems(visibleItems, searchQuery);
        itemsToRender = sortItems(filtered, sortState.mode, sortState.direction);
    }

    if (!listContainer) {
        emitCoreStateToUI(getCoreStateSnapshot());
        emitItemDetailsStateToUI(getItemDetailsSnapshot());
        emitViewModelStateToUI(getViewModelSnapshot());
        return;
    }

    // Check if Svelte is handling the current view - skip all DOM work if so
    const isSvelteHandlingView =
        (settings.groupMapsBySong && viewMode === 'all' && shouldUseSvelteGroupedView()) ||
        (viewMode === 'all' && shouldUseSvelteAllView()) ||
        (viewMode === 'todo' && shouldUseSvelteTodoView()) ||
        (viewMode === 'completed' && shouldUseSvelteCompletedView());

    if (isSvelteHandlingView) {
        // Svelte is handling the view - emit state updates (itemsToRender already computed above)
        emitCoreStateToUI(getCoreStateSnapshot());
        emitItemDetailsStateToUI(getItemDetailsSnapshot());
        emitViewModelStateToUI(getViewModelSnapshot());
        return;
    }


    listContainer.className = '';
    listContainer.classList.add(`view-${viewMode}`);

    // Use grouped view only on 'all' tab when the setting is enabled
    if (settings.groupMapsBySong && viewMode === 'all') {
        listContainer.classList.add('view-grouped');
        if (shouldUseSvelteGroupedView()) {
            // Svelte-owned grouped shell; legacy renderer still powers child rows via bridge methods.
            groupedRenderPassToken += 1;
            cancelTimelineBatchRender();
            listContainer.style.height = '';
            listContainer.innerHTML = '';
        } else {
            const groups = groupItemsBySong(itemsToRender);
            renderGroupedView(listContainer, groups);
        }
    } else if (viewMode === 'all' && shouldUseSvelteAllView()) {
        groupedRenderPassToken += 1;
        cancelTimelineBatchRender();
        listContainer.style.height = '';
        listContainer.innerHTML = '';
    } else if (viewMode === 'todo' && shouldUseSvelteTodoView()) {
        groupedRenderPassToken += 1;
        cancelTimelineBatchRender();
        listContainer.style.height = '';
        listContainer.innerHTML = '';
    } else if (viewMode === 'completed' && shouldUseSvelteCompletedView()) {
        groupedRenderPassToken += 1;
        cancelTimelineBatchRender();
        listContainer.style.height = '';
        listContainer.innerHTML = '';
    } else {
        renderBeatmapList(listContainer, itemsToRender);
    }

    emitCoreStateToUI(getCoreStateSnapshot());
    emitItemDetailsStateToUI(getItemDetailsSnapshot());
    emitViewModelStateToUI(getViewModelSnapshot());
};

const serializeHighlights = (ranges) => ranges.map((range) => ([
    Number(range.start.toFixed(4)),
    Number(range.end.toFixed(4)),
    range.type === 'break' ? 'b' : (range.type === 'bookmark' ? 'k' : 'o'),
]));

const deserializeHighlights = (ranges) => ranges.map(([start, end, kind]) => ({
    start,
    end,
    type: kind === 'b' ? 'break' : (kind === 'k' ? 'bookmark' : 'object'),
}));

let saveTimer = null;

const saveToStorage = () => {
    const payload = {
        version: STORAGE_VERSION,
        todoIds,
        doneIds,
        sortState: {
            mode: sortState.mode,
            direction: sortState.direction
        },
        items: beatmapItems.map((item) => ({
            id: item.id,
            filePath: item.filePath,
            dateAdded: item.dateAdded,
            dateModified: item.dateModified,
            title: item.title,
            titleUnicode: item.titleUnicode,
            artist: item.artist,
            artistUnicode: item.artistUnicode,
            creator: item.creator,
            version: item.version,
            beatmapSetID: item.beatmapSetID,
            starRating: isValidStarRating(item.starRating) ? item.starRating : null,
            audio: item.audio || '',
            deadline: (typeof item.deadline === 'number' || item.deadline === null) ? item.deadline : null,
            targetStarRating: (typeof item.targetStarRating === 'number' || item.targetStarRating === null) ? item.targetStarRating : null,
            durationMs: (typeof item.durationMs === 'number') ? item.durationMs : null,
            previewTime: item.previewTime ?? -1,
            coverPath: item.coverPath || '',
            highlights: serializeHighlights(item.highlights || []),
            progress: item.progress || 0,
            notes: item.notes || '',
        })),
    };

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
        // Storage may be full
        showNotification('Storage Full', 'Could not save data. Try clearing some beatmaps.', 'error');
    }
};

const scheduleSave = () => {
    if (saveTimer) {
        window.clearTimeout(saveTimer);
    }
    saveTimer = window.setTimeout(() => {
        saveToStorage();
        // Trigger embed sync after save (rate-limited)
        if (settings.embedApiKey) {
            scheduleEmbedSync();
        }
    }, 500);
};

// ============================================
// Embed Sync Module
// ============================================
const EMBED_SYNC_RATE_LIMIT_MS = 5 * 60_000; // 5 minutes
const EMBED_SYNC_RATE_LIMIT_ON_429_MS = 15 * 60_000; // 15 minutes backoff on rate limit
let embedSyncTimer = null;
let lastEmbedSyncTime = 0;
let embedSyncBackoffUntil = 0;
let embedSyncInFlight = false;
let embedSyncResetTimer = null;
let embedSyncUiState = {
    status: 'idle',
    buttonLabel: 'Sync Now',
    buttonTooltip: 'Sync embed now',
    buttonDisabled: false
};

// Generate API key for embed sync
const generateApiKey = () => {
    return 'sk_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 20);
};

// Build the condensed embed payload from current data
const buildEmbedPayload = () => {
    const todoItems = todoIds
        .map(id => beatmapItems.find(item => item.id === id))
        .filter(Boolean)
        .map(item => ({
            id: item.id,
            title: item.title || 'Unknown',
            artist: item.artist || 'Unknown',
            creator: item.creator || 'Unknown',
            version: item.version || 'Unknown',
            progress: item.progress || 0,
            deadline: item.deadline || null,
            beatmapSetID: item.beatmapSetID || null,
            coverUrl: item.beatmapSetID ? `https://assets.ppy.sh/beatmaps/${item.beatmapSetID}/covers/cover.jpg` : null
        }));

    const completedItems = doneIds
        .map(id => beatmapItems.find(item => item.id === id))
        .filter(Boolean)
        .map(item => ({
            id: item.id,
            title: item.title || 'Unknown',
            artist: item.artist || 'Unknown',
            creator: item.creator || 'Unknown',
            version: item.version || 'Unknown',
            progress: 100,
            beatmapSetID: item.beatmapSetID || null,
            coverUrl: item.beatmapSetID ? `https://assets.ppy.sh/beatmaps/${item.beatmapSetID}/covers/cover.jpg` : null
        }));

    const totalProgress = beatmapItems.length > 0
        ? beatmapItems.reduce((sum, item) => sum + (item.progress || 0), 0) / beatmapItems.length
        : 0;

    return {
        version: 1,
        userid: settings.userId,
        mapperName: settings.mapperAliases?.[0] || null,
        lastUpdated: new Date().toISOString(),
        settings: {
            showTodoList: settings.embedShowTodoList,
            showCompletedList: settings.embedShowCompletedList,
            showProgressStats: settings.embedShowProgressStats
        },
        stats: {
            totalMaps: beatmapItems.length,
            todoCount: todoIds.length,
            completedCount: doneIds.length,
            overallProgress: Math.round(totalProgress * 10) / 10
        },
        todoItems,
        completedItems
    };
};

// Helper to persist settings from top-level code (saveSettings lives inside DOMContentLoaded)
const persistSettings = () => {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (e) { /* storage full */ }
};

// Perform the sync to the embed site
const performEmbedSync = async ({ manual = false } = {}) => {
    if (embedSyncInFlight) {
        return false;
    }

    if (!settings.embedApiKey) {
        settings.embedApiKey = generateApiKey();
        persistSettings();
    }

    embedSyncInFlight = true;
    const payload = buildEmbedPayload();
    const syncUrl = `${settings.embedSyncUrl}/api/sync`;
    updateEmbedSyncStatus('syncing');

    console.log('Starting embed sync to:', syncUrl);

    try {
        const result = await window.embedSyncApi.sync(syncUrl, settings.embedApiKey, payload);

        console.log('Sync result:', result);

        if (result.success && (result.data?.success || result.data === true)) {
            settings.embedLastSynced = Date.now();
            lastEmbedSyncTime = settings.embedLastSynced;
            embedSyncBackoffUntil = 0;
            persistSettings();
            updateEmbedSyncStatus('synced');
            if (manual) {
                showNotification('Sync Complete', 'Embed tracker has been updated.', 'success');
            }
            return true;
        } else {
            let errorMsg = result.data?.error || result.error || 'Sync Failed';

            // Handle specific HTTP status codes
            if (result.status === 429) {
                errorMsg = 'Rate Limited';
                embedSyncBackoffUntil = Date.now() + EMBED_SYNC_RATE_LIMIT_ON_429_MS;
            } else if (result.status === 401 || result.status === 403) {
                errorMsg = 'Invalid API Key';
            } else if (result.status === 404) {
                errorMsg = 'Invalid URL';
            } else if (result.status >= 500) {
                errorMsg = 'Server Error';
            }

            console.error('Embed sync failed:', errorMsg, result);
            updateEmbedSyncStatus('error', errorMsg);
            if (manual) {
                showNotification('Sync Failed', errorMsg, 'error');
            }
            return false;
        }
    } catch (err) {
        console.error('Embed sync error:', err);
        if (!manual) {
            embedSyncBackoffUntil = Math.max(embedSyncBackoffUntil, Date.now() + 120_000);
        }
        updateEmbedSyncStatus('error', 'Network Error');
        if (manual) {
            showNotification('Sync Failed', 'Network error - check your connection.', 'error');
        }
        return false;
    } finally {
        embedSyncInFlight = false;
    }
};

// Schedule embed sync with rate limiting
const scheduleEmbedSync = () => {
    if (!settings.embedApiKey) {
        return;
    }

    if (embedSyncTimer) {
        clearTimeout(embedSyncTimer);
        embedSyncTimer = null;
    }

    if (embedSyncInFlight) {
        return;
    }

    const now = Date.now();
    const timeSinceLastSync = now - lastEmbedSyncTime;
    const rateLimitDelay = Math.max(0, EMBED_SYNC_RATE_LIMIT_MS - timeSinceLastSync);
    const backoffDelay = Math.max(0, embedSyncBackoffUntil - now);
    const debounceDelay = 10_000;
    const delay = Math.max(debounceDelay, rateLimitDelay, backoffDelay);

    embedSyncTimer = setTimeout(() => {
        embedSyncTimer = null;
        performEmbedSync({ manual: false });
    }, delay);
};

// Update sync status UI
const updateEmbedSyncStatus = (status, error = null) => {
    if (embedSyncResetTimer) {
        clearTimeout(embedSyncResetTimer);
        embedSyncResetTimer = null;
    }

    if (status === 'syncing') {
        embedSyncUiState = {
            status: 'syncing',
            buttonLabel: 'Syncing...',
            buttonTooltip: 'Syncing with embed tracker...',
            buttonDisabled: true
        };
    } else if (status === 'synced') {
        embedSyncUiState = {
            status: 'synced',
            buttonLabel: 'Synced',
            buttonTooltip: 'Successfully synced!',
            buttonDisabled: false
        };
    } else if (status === 'error') {
        const reason = error || 'Sync Failed';
        embedSyncUiState = {
            status: 'error',
            buttonLabel: `Error: ${reason}`,
            buttonTooltip: `Error: ${reason}. Click to try again.`,
            buttonDisabled: false
        };
    } else {
        embedSyncUiState = {
            status: 'idle',
            buttonLabel: 'Sync Now',
            buttonTooltip: 'Sync embed now',
            buttonDisabled: false
        };
    }

    emitSettingsControlsState();

    if (status === 'synced' || status === 'error') {
        embedSyncResetTimer = setTimeout(() => {
            updateEmbedSyncStatus('idle');
        }, 5000);
    }
};

// Manual sync trigger
const triggerManualSync = async () => {
    lastEmbedSyncTime = 0;
    embedSyncBackoffUntil = 0;
    if (embedSyncTimer) {
        clearTimeout(embedSyncTimer);
        embedSyncTimer = null;
    }
    await performEmbedSync({ manual: true });
};

const buildItemFromContent = async (filePath, content, stat, existing) => {
    const metadata = parseMetadata(content);
    const { hitStarts, hitEnds } = parseHitObjects(content);
    const breakPeriods = parseBreakPeriods(content);
    const bookmarks = parseBookmarks(content);

    return processWorkerResult({
        metadata,
        hitStarts,
        hitEnds,
        breakPeriods,
        bookmarks,
        filePath,
        stat
    }, existing);
};

let audioAnalysisQueue = [];
let isAnalyzingAudio = false;
let audioAnalysisTotal = 0;
let starRatingQueue = [];
let isCalculatingStarRating = false;
let starRatingTotal = 0;

const persistAudioAnalysisState = () => {
    try {
        if (!audioAnalysisQueue.length) {
            localStorage.removeItem(AUDIO_ANALYSIS_STATE_KEY);
            return;
        }
        localStorage.setItem(AUDIO_ANALYSIS_STATE_KEY, JSON.stringify({
            queue: audioAnalysisQueue,
            total: audioAnalysisTotal,
        }));
    } catch (e) {
        // Non-fatal persistence failure.
    }
};

const restoreAudioAnalysisStateFromStorage = () => {
    try {
        const raw = localStorage.getItem(AUDIO_ANALYSIS_STATE_KEY);
        if (!raw) return;
        const state = JSON.parse(raw);
        if (!state || !Array.isArray(state.queue)) return;

        const previousQueueLen = state.queue.length;
        const previousTotal = Number(state.total) || 0;
        const previousCompleted = Math.max(0, previousTotal - previousQueueLen);

        const validQueue = [];
        const seen = new Set();
        for (const id of state.queue) {
            if (!id || seen.has(id)) continue;
            const item = beatmapItems.find(i => i.id === id);
            if (item && item.audio && item.filePath && typeof item.durationMs !== 'number') {
                validQueue.push(id);
                seen.add(id);
            }
        }

        if (!validQueue.length) {
            localStorage.removeItem(AUDIO_ANALYSIS_STATE_KEY);
            return;
        }

        audioAnalysisQueue = validQueue;
        audioAnalysisTotal = previousCompleted + validQueue.length;
        updateRefreshProgress(previousCompleted, audioAnalysisTotal);
    } catch (e) {
        // Ignore malformed state.
    }
};

const persistStarRatingState = () => {
    try {
        if (!starRatingQueue.length) {
            localStorage.removeItem(STAR_RATING_STATE_KEY);
            return;
        }
        localStorage.setItem(STAR_RATING_STATE_KEY, JSON.stringify({
            queue: starRatingQueue,
            total: starRatingTotal,
        }));
    } catch (e) {
        // Non-fatal persistence failure.
    }
};

const restoreStarRatingStateFromStorage = () => {
    try {
        const raw = localStorage.getItem(STAR_RATING_STATE_KEY);
        if (!raw) return;

        const state = JSON.parse(raw);
        if (!state || !Array.isArray(state.queue)) return;

        const previousQueueLen = state.queue.length;
        const previousTotal = Number(state.total) || 0;
        const previousCompleted = Math.max(0, previousTotal - previousQueueLen);

        const validQueue = [];
        const seen = new Set();
        for (const id of state.queue) {
            if (!id || seen.has(id)) continue;
            const item = beatmapItems.find(i => i.id === id);
            if (item && item.filePath && isStarRatingMissing(item.starRating)) {
                validQueue.push(id);
                seen.add(id);
            }
        }

        if (!validQueue.length) {
            localStorage.removeItem(STAR_RATING_STATE_KEY);
            return;
        }

        starRatingQueue = validQueue;
        starRatingTotal = previousCompleted + validQueue.length;
        updateRefreshProgress();
    } catch (e) {
        // Ignore malformed state.
    }
};

const queueMissingAudioAnalysisFromItems = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
        if (item && item.audio && typeof item.durationMs !== 'number' && item.id) {
            scheduleAudioAnalysis(item.id);
        }
    }
};

const queueMissingStarRatingFromItems = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
        if (item && item.filePath && item.id && isStarRatingMissing(item.starRating)) {
            scheduleStarRatingCalculation(item.id);
        }
    }
};

let _lastTooltipUpdate = 0;

const updateRefreshProgress = () => {
    const audioTotal = Math.max(0, audioAnalysisTotal);
    const starTotal = Math.max(0, starRatingTotal);
    const total = audioTotal + starTotal;

    const audioCompleted = audioTotal > 0 ? Math.max(0, audioTotal - audioAnalysisQueue.length) : 0;
    const starCompleted = starTotal > 0 ? Math.max(0, starTotal - starRatingQueue.length) : 0;
    const completed = audioCompleted + starCompleted;

    if (total <= 0) {
        refreshUiState = {
            ...refreshUiState,
            isAnalyzing: false,
            progressPct: 0,
            tooltip: 'Refresh last directory'
        };
        notifyRefreshUiToUI(getRefreshUiSnapshot());
        _lastTooltipUpdate = 0;
        return;
    }

    const progress = Math.min(100, Math.max(0, (completed / total) * 100));
    let tooltip = refreshUiState.tooltip || 'Refresh last directory';

    // Throttle tooltip text updates to every 2s — native tooltips flash when title changes
    const now = Date.now();
    if (now - _lastTooltipUpdate > 2000 || completed === total) {
        _lastTooltipUpdate = now;
        const hasAudio = audioTotal > 0;
        const hasStar = starTotal > 0;
        if (hasAudio && hasStar) {
            tooltip = `Background analysis... ${Math.round(progress)}% (Audio ${audioCompleted}/${audioTotal}, SR ${starCompleted}/${starTotal})`;
        } else if (hasStar) {
            tooltip = `Calculating star ratings... ${Math.round(progress)}% (${completed}/${total})`;
        } else {
            tooltip = `Analyzing audio durations... ${Math.round(progress)}% (${completed}/${total})`;
        }
    }

    refreshUiState = {
        ...refreshUiState,
        isAnalyzing: true,
        progressPct: progress,
        tooltip
    };
    notifyRefreshUiToUI(getRefreshUiSnapshot());
};

const scheduleAudioAnalysis = (itemId) => {
    if (!audioAnalysisQueue.includes(itemId)) {
        audioAnalysisQueue.push(itemId);
        if (isAnalyzingAudio || audioAnalysisTotal > 0) {
            audioAnalysisTotal += 1;
        }
        persistAudioAnalysisState();
    }
};

const scheduleStarRatingCalculation = (itemId) => {
    if (!starRatingQueue.includes(itemId)) {
        starRatingQueue.push(itemId);
        if (isCalculatingStarRating || starRatingTotal > 0) {
            starRatingTotal += 1;
        }
        persistStarRatingState();
    }
};

const processBackgroundQueues = () => {
    processStarRatingQueue();
    processAudioQueue();
};

const processAudioQueue = async () => {
    if (isAnalyzingAudio || audioAnalysisQueue.length === 0) return;
    isAnalyzingAudio = true;
    audioAnalysisTotal = Math.max(audioAnalysisTotal, audioAnalysisQueue.length);
    updateRefreshProgress();

    let unsavedCount = 0;
    let totalProcessed = 0;
    const pendingUIUpdates = new Set();
    let uiUpdateRAF = null;

    // Batch UI updates into a single animation frame
    const flushUIUpdates = () => {
        if (pendingUIUpdates.size === 0) return;
        const ids = [...pendingUIUpdates];
        pendingUIUpdates.clear();
        for (const id of ids) {
            const el = document.querySelector(`[data-item-id="${id}"]`);
            if (el) {
                updateListItemElement(id);
            }
        }
    };

    const scheduleUIUpdate = (itemId) => {
        pendingUIUpdates.add(itemId);
        if (!uiUpdateRAF) {
            uiUpdateRAF = requestAnimationFrame(() => {
                uiUpdateRAF = null;
                flushUIUpdates();
            });
        }
    };

    // Debounce persist calls to avoid excessive localStorage writes
    let persistTimer = null;
    const debouncedPersist = () => {
        if (persistTimer) return;
        persistTimer = setTimeout(() => {
            persistTimer = null;
            persistAudioAnalysisState();
        }, 500);
    };

    // Analyze a single item — returns true if duration was found
    const analyzeOne = async (itemId) => {
        const item = beatmapItems.find(i => i.id === itemId);
        if (!item || typeof item.durationMs === 'number' || !item.audio || !item.filePath) {
            return false;
        }

        try {
            const folderPath = getDirectoryPath(item.filePath);
            const audioPath = `${folderPath}${item.audio}`;
            const duration = await getAudioDurationMs(audioPath);

            if (duration) {
                item.durationMs = duration;

                // Recalculate accurately now that we have the real duration.
                // If raw timestamps are missing (e.g. item restored from cache without duration),
                // we attempt one-time re-parsing of the .osu file to get them.
                if (!item.rawTimestamps && item.filePath && window.beatmapApi?.readOsuFile) {
                    try {
                        const content = await window.beatmapApi.readOsuFile(item.filePath);
                        if (content) {
                            const { hitStarts, hitEnds } = parseHitObjects(content);
                            const breakPeriods = parseBreakPeriods(content);
                            const bookmarks = parseBookmarks(content);
                            item.rawTimestamps = { hitStarts, hitEnds, breakPeriods, bookmarks };
                        }
                    } catch (err) {
                        // Non-fatal re-parse failure
                    }
                }

                if (item.rawTimestamps) {
                    const { hitStarts, hitEnds, breakPeriods, bookmarks } = item.rawTimestamps;
                    const objectRanges = buildHighlightRanges(hitStarts || [], hitEnds || [], duration);
                    const breakRanges = buildBreakRanges(breakPeriods || [], duration);
                    const bookmarkRanges = buildBookmarkRanges(bookmarks || [], duration);

                    item.highlights = [...breakRanges, ...objectRanges, ...bookmarkRanges];
                    item.progress = computeProgress(item.highlights);

                    // Clean up temporary data
                    delete item.rawTimestamps;
                }

                scheduleUIUpdate(item.id);
                return true;
            }
        } catch (err) {
            // Non-fatal
        }
        return false;
    };

    // Process queue with concurrent workers
    const CONCURRENCY = 8;

    while (audioAnalysisQueue.length > 0) {
        // Take a batch from the queue
        const batch = audioAnalysisQueue.splice(0, CONCURRENCY);
        debouncedPersist();

        const results = await Promise.all(batch.map(id => analyzeOne(id)));

        for (const found of results) {
            if (found) {
                unsavedCount++;
                totalProcessed++;
            }
        }

        updateRefreshProgress();

        // Save periodically
        if (unsavedCount >= 25) {
            saveToStorage();
            unsavedCount = 0;
        }

        // Brief yield to keep UI responsive (one frame)
        await new Promise(r => setTimeout(r, 16));
    }

    // Cleanup
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    persistAudioAnalysisState();

    if (uiUpdateRAF) {
        cancelAnimationFrame(uiUpdateRAF);
        uiUpdateRAF = null;
    }
    flushUIUpdates();

    if (unsavedCount > 0) {
        saveToStorage();
    }

    isAnalyzingAudio = false;
    audioAnalysisTotal = 0;
    updateRefreshProgress();
    localStorage.removeItem(AUDIO_ANALYSIS_STATE_KEY);

    // Notify if we processed any items
    if (totalProcessed > 0) {
        showNotification('Audio Analysis Complete', `Analyzed ${totalProcessed} audio file${totalProcessed !== 1 ? 's' : ''}.`, 'success');
    }
};

const processStarRatingQueue = async () => {
    if (isCalculatingStarRating || starRatingQueue.length === 0) return;

    isCalculatingStarRating = true;
    starRatingTotal = Math.max(starRatingTotal, starRatingQueue.length);
    updateRefreshProgress();

    let unsavedCount = 0;
    let totalProcessed = 0;
    const pendingUIUpdates = new Set();
    let uiUpdateRAF = null;

    const flushUIUpdates = () => {
        if (pendingUIUpdates.size === 0) return;
        const ids = [...pendingUIUpdates];
        pendingUIUpdates.clear();
        for (const id of ids) {
            const el = document.querySelector(`[data-item-id="${id}"]`);
            if (el) {
                updateListItemElement(id);
            }
        }
    };

    const scheduleUIUpdate = (itemId) => {
        pendingUIUpdates.add(itemId);
        if (!uiUpdateRAF) {
            uiUpdateRAF = requestAnimationFrame(() => {
                uiUpdateRAF = null;
                flushUIUpdates();
            });
        }
    };

    let persistTimer = null;
    const debouncedPersist = () => {
        if (persistTimer) return;
        persistTimer = setTimeout(() => {
            persistTimer = null;
            persistStarRatingState();
        }, 500);
    };

    const calculateOne = async (itemId) => {
        const item = beatmapItems.find(i => i.id === itemId);
        if (!item || !item.filePath || isValidStarRating(item.starRating)) {
            return false;
        }

        try {
            const rating = await getStarRatingValue(item.filePath);
            if (isValidStarRating(rating)) {
                item.starRating = rating;
                scheduleUIUpdate(item.id);
                return true;
            }
        } catch (err) {
            // Non-fatal
        }
        return false;
    };

    const CONCURRENCY = 6;

    while (starRatingQueue.length > 0) {
        const batch = starRatingQueue.splice(0, CONCURRENCY);
        debouncedPersist();

        const results = await Promise.all(batch.map(id => calculateOne(id)));
        for (const found of results) {
            if (found) {
                unsavedCount++;
                totalProcessed++;
            }
        }

        updateRefreshProgress();

        if (unsavedCount >= 25) {
            saveToStorage();
            unsavedCount = 0;
        }

        await new Promise(r => setTimeout(r, 16));
    }

    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    persistStarRatingState();

    if (uiUpdateRAF) {
        cancelAnimationFrame(uiUpdateRAF);
        uiUpdateRAF = null;
    }
    flushUIUpdates();

    if (unsavedCount > 0) {
        saveToStorage();
    }

    isCalculatingStarRating = false;
    starRatingTotal = 0;
    updateRefreshProgress();
    localStorage.removeItem(STAR_RATING_STATE_KEY);

    // Notify if we processed any items
    if (totalProcessed > 0) {
        showNotification('Star Rating Complete', `Calculated ${totalProcessed} star rating${totalProcessed !== 1 ? 's' : ''}.`, 'success');
    }
};

const arrayMax = (arr) => {
    if (!arr || arr.length === 0) return 0;
    let max = arr[0];
    for (let i = 1; i < arr.length; i++) {
        if (arr[i] > max) max = arr[i];
    }
    return max;
};

const processWorkerResult = (file, existing) => {
    const { metadata, hitStarts, hitEnds, breakPeriods, bookmarks, filePath, stat } = file;
    let coverUrl = '';
    let coverPath = '';
    let highlights = [];

    if (metadata.background) {
        const folderPath = getDirectoryPath(filePath || '');
        coverPath = `${folderPath}${metadata.background}`;
        if (existing?.coverPath === coverPath && existing?.coverUrl) {
            coverUrl = existing.coverUrl;
        } else if (window.beatmapApi?.convertFileSrc) {
            // Generate asset URL instantly — no IPC needed
            coverUrl = window.beatmapApi.convertFileSrc(coverPath);
        }
    }

    const maxObjectTime = arrayMax(hitEnds);
    let maxBreakTime = 0;
    if (breakPeriods?.length) {
        for (let i = 0; i < breakPeriods.length; i++) {
            if (breakPeriods[i].end > maxBreakTime) maxBreakTime = breakPeriods[i].end;
        }
    }
    const maxBookmarkTime = arrayMax(bookmarks);

    const maxTime = Math.max(maxObjectTime, maxBreakTime, maxBookmarkTime);
    const fallbackDuration = maxTime > 0 ? maxTime + 1000 : 0;

    let durationMs = (existing && existing.audio === metadata.audio) ? existing.durationMs : null;

    const totalDuration = durationMs || fallbackDuration;
    if (totalDuration) {
        const objectRanges = buildHighlightRanges(hitStarts || [], hitEnds || [], totalDuration);
        const breakRanges = buildBreakRanges(breakPeriods || [], totalDuration);
        const bookmarkRanges = buildBookmarkRanges(bookmarks || [], totalDuration);
        highlights = [...breakRanges, ...objectRanges, ...bookmarkRanges];
    }

    const item = {
        ...metadata,
        durationMs,
        deadline: existing?.deadline ?? null,
        targetStarRating: existing?.targetStarRating ?? null,
        notes: existing?.notes || '',
        coverUrl,
        coverPath,
        highlights,
        progress: computeProgress(highlights),
        dateAdded: existing?.dateAdded ?? Date.now(),
        dateModified: stat?.mtimeMs ?? 0,
        id: existing?.id ?? createItemId(filePath),
        filePath,
        starRating: isValidStarRating(metadata?.starRating) ? metadata.starRating : null,
    };

    if (!durationMs && metadata.audio && filePath) {
        // Store raw hit object/break timestamps temporarily so we can recalculate 
        // accurate normalized highlights once the real audio duration is known.
        item.rawTimestamps = { hitStarts, hitEnds, breakPeriods, bookmarks };
        scheduleAudioAnalysis(item.id);
    }

    if (filePath && isStarRatingMissing(item.starRating)) {
        scheduleStarRatingCalculation(item.id);
    }

    return item;
};

const buildItemFromCache = (cached) => {
    // Generate cover URL instantly from path using the asset protocol.
    // This avoids the old base64 IPC round-trip for every single cover on startup.
    let coverUrl = '';
    if (cached.coverPath && window.beatmapApi?.convertFileSrc) {
        coverUrl = window.beatmapApi.convertFileSrc(cached.coverPath);
    }
    return {
        ...cached,
        coverUrl,
        highlights: cached.highlights ? deserializeHighlights(cached.highlights) : [],
        dateModified: cached.dateModified ?? 0,
        id: cached.id ?? createItemId(cached.filePath),
        starRating: isValidStarRating(cached.starRating) ? cached.starRating : null,
    };
};

const loadFromStorage = async () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        return;
    }
    let stored = null;
    try {
        stored = JSON.parse(raw);
    } catch (error) {
        return;
    }
    if (!stored || stored.version !== STORAGE_VERSION || !Array.isArray(stored.items)) {
        return;
    }
    todoIds = stored.todoIds || [];
    doneIds = stored.doneIds || [];
    emitTodoOrderStateToUI(getTodoOrderSnapshot());
    if (stored.sortState && typeof stored.sortState === 'object') {
        sortState.mode = stored.sortState.mode || 'dateAdded';
        sortState.direction = stored.sortState.direction || 'desc';
    }
    updateTabCounts();
    updateSortUI();

    // Instant restore: trust the cache, no IPC calls per item.
    // Cover images are deferred to the lazy load queue.
    const items = [];
    for (const cached of stored.items) {
        if (!cached?.filePath) continue;
        items.push(buildItemFromCache(cached));
    }

    beatmapItems = items;
    updateTabCounts();
    renderFromState();

    // Resume interrupted background analysis first, then queue any newly-missing data.
    restoreAudioAnalysisStateFromStorage();
    restoreStarRatingStateFromStorage();

    // Queue background analysis for missing item metadata.
    queueMissingAudioAnalysisFromItems(beatmapItems);
    queueMissingStarRatingFromItems(beatmapItems);
    processBackgroundQueues();
};

const updateSortUI = () => {
    emitFilterStateToUI(getFilterStateSnapshot());
};

const updateSRRangeUI = (event, { rerenderList = true, fromState = false } = {}) => {
    const minInput = document.getElementById('srMin');
    const maxInput = document.getElementById('srMax');
    const minHandle = document.getElementById('srMinHandle');
    const maxHandle = document.getElementById('srMaxHandle');
    const track = document.querySelector('.range-track');

    if (!minInput || !maxInput || !minHandle || !maxHandle || !track) return;

    // When fromState is true, read from srFilter (set by Svelte) instead of input values
    let min, max;
    if (fromState) {
        min = srFilter?.min ?? 0;
        max = srFilter?.max ?? 10;
    } else {
        min = parseFloat(minInput.value);
        max = parseFloat(maxInput.value);
    }

    if (min > max) {
        if (event?.target === minInput) {
            max = min;
            // Don't set input value - Svelte controls it
        } else {
            min = max;
            // Don't set input value - Svelte controls it
        }
    }

    // Precise calculation for 30px visual handles and 4px container cushions
    const container = document.querySelector('.range-slider-container');
    const containerWidth = container?.clientWidth || 180;

    // Total travel width is (Container - CushionL - CushionR - HandleWidth)
    // We'll use 4px for both Left and Right cushions
    const sideCushion = 4;
    const handleWidth = 30;
    const travelWidth = containerWidth - (sideCushion * 2) - handleWidth;

    // Enforce non-overlapping handles visually
    // Minimum gap needed between values to avoid handles touching
    const srGapPerPx = 10 / travelWidth;
    const minSRGap = (handleWidth + 4) * srGapPerPx; // 4px extra gap between handles

    if (max - min < minSRGap) {
        if (event?.target === minInput) {
            min = Math.max(0, max - minSRGap);
            // Don't set input value - Svelte controls it
        } else if (event?.target === maxInput) {
            max = Math.min(10, min + minSRGap);
            // Don't set input value - Svelte controls it
        }
    }

    srFilter = { min, max };

    // Update Handles Text
    minHandle.textContent = min.toFixed(1);
    if (max >= 10) {
        maxHandle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" width="14" height="14" fill="currentColor"><path d="M0 256c0-88.4 71.6-160 160-160 50.4 0 97.8 23.7 128 64l32 42.7 32-42.7c30.2-40.3 77.6-64 128-64 88.4 0 160 71.6 160 160S568.4 416 480 416c-50.4 0-97.8-23.7-128-64l-32-42.7-32 42.7c-30.2 40.3-77.6 64-128 64-88.4 0-160-71.6-160-160zm280 0l-43.2-57.6c-18.1-24.2-46.6-38.4-76.8-38.4-53 0-96 43-96 96s43 96 96 96c30.2 0 58.7-14.2 76.8-38.4L280 256zm80 0l43.2 57.6c18.1 24.2 46.6 38.4 76.8 38.4 53 0 96-43 96-96s-43-96-96-96c-30.2 0-58.7 14.2-76.8 38.4L360 256z"/></svg>`;
    } else {
        maxHandle.textContent = max.toFixed(1);
    }

    // Update Handle Background Colors
    minHandle.style.background = getStarRatingColor(min);
    // Determine text color based on background darkness (approximate)
    minHandle.style.color = (min > 6.5) ? 'var(--text-primary)' : 'var(--bg-tertiary)';

    const isMaxInfinity = max >= 10;
    maxHandle.style.background = isMaxInfinity ? 'var(--bg-tertiary)' : getStarRatingColor(max);
    maxHandle.style.color = (isMaxInfinity || max > 6.5) ? 'var(--text-primary)' : 'var(--bg-tertiary)';

    // Set handle positions using cushions
    const left1 = sideCushion + (min / 10) * travelWidth;
    const left2 = sideCushion + (max / 10) * travelWidth;

    minHandle.style.left = `${left1}px`;
    maxHandle.style.left = `${left2}px`;

    // Position track using clip-path on a fixed gradient
    // This makes the gradient NOT shrink when resizing the range
    // We add a 4px gap between the visual handle and the gradient start/end
    const gradientGap = 4;
    const clipStart = ((left1 + handleWidth + gradientGap) / containerWidth) * 100;
    const clipEnd = ((left2 - gradientGap) / containerWidth) * 100;

    if (clipEnd > clipStart) {
        track.style.display = 'block';
        track.style.clipPath = `inset(0 ${100 - clipEnd}% 0 ${clipStart}%)`;
    } else {
        track.style.display = 'none';
    }

    // Keep the currently interacted slider on top to avoid "stuck" handle interactions.
    if (event?.target === minInput) {
        minInput.style.zIndex = '30';
        maxInput.style.zIndex = '20';
    } else if (event?.target === maxInput) {
        maxInput.style.zIndex = '30';
        minInput.style.zIndex = '20';
    } else {
        minInput.style.zIndex = '21';
        maxInput.style.zIndex = '22';
    }

    if (rerenderList && typeof renderFromState === 'function') {
        renderFromState();
    }

    emitFilterStateToUI(getFilterStateSnapshot());
};

// Re-run UI update whenever the slider container changes width (e.g. window resize)
if (typeof ResizeObserver !== 'undefined') {
    const srResizeObserver = new ResizeObserver(() => {
        updateSRRangeUI(null, { rerenderList: false });
    });

    const observeSRContainer = () => {
        const container = document.querySelector('.range-slider-container');
        if (container) {
            srResizeObserver.observe(container);
            // Svelte mounts after renderer bootstrap; initialize slider UI once it exists.
            updateSRRangeUI(null, { rerenderList: false });
        } else {
            // Container not in DOM yet — wait for it
            requestAnimationFrame(observeSRContainer);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeSRContainer);
    } else {
        observeSRContainer();
    }
}

const getAudioDurationMs = async (filePath) => {
    if (!filePath || !window.beatmapApi?.getAudioDuration) {
        return null;
    }

    try {
        // Use efficient Rust-side duration extraction (no full decode/PCM spike)
        const duration = await window.beatmapApi.getAudioDuration(filePath);
        return duration || null;
    } catch (error) {
        console.error('Audio analysis failed:', error);
        return null;
    }
};

const getStarRatingValue = async (filePath) => {
    if (!filePath || !window.beatmapApi?.calculateStarRating) {
        return null;
    }

    try {
        const rating = await window.beatmapApi.calculateStarRating(filePath);
        return isValidStarRating(rating) ? rating : null;
    } catch (error) {
        return null;
    }
};

const AudioController = {
    audio: new Audio(),
    currentId: null,
    isPlaying: false,

    init() {
        this.audio.addEventListener('play', () => { this.isPlaying = true; this.startTick(); });
        this.audio.addEventListener('pause', () => { this.isPlaying = false; });
        this.audio.addEventListener('ended', () => { this.isPlaying = false; });
        this.audio.addEventListener('error', (e) => {
            console.error('Audio playback error:', e);
            this.isPlaying = false;
            showNotification('Audio Error', 'Failed to play audio preview.', 'error');
        });
        this.updateVolume();
    },

    updateVolume() {
        if (typeof settings.volume === 'number') {
            this.audio.volume = settings.volume;
        }
    },

    async play(itemId, percentage = null) {
        const item = beatmapItems.find(i => i.id === itemId);
        if (!item || !item.audio || !item.filePath) return;

        const folderPath = getDirectoryPath(item.filePath);
        const audioPath = `${folderPath}${item.audio}`;

        // Load audio source if switching items — use asset protocol for instant load
        if (this.currentId !== itemId) {
            // Clear playhead on the previous item's timeline
            if (this.currentId) {
                const prevEl = getVisibleListBoxByItemId(this.currentId);
                if (prevEl) {
                    const prevIdx = Number(prevEl.dataset.renderIndex);
                    applyTimelineToBox(prevEl, prevIdx);
                }
            }
            this.currentId = itemId;

            // Revoke old blob URL if it was one
            if (this.audio.src && this.audio.src.startsWith('blob:')) {
                URL.revokeObjectURL(this.audio.src);
            }

            // Use convertFileSrc for direct loading (no IPC round-trip)
            if (window.beatmapApi?.convertFileSrc) {
                this.audio.src = window.beatmapApi.convertFileSrc(audioPath);
            } else {
                // Fallback: read binary through IPC
                try {
                    const binary = await window.beatmapApi.readBinary(audioPath);
                    if (!binary) return;

                    const blob = new Blob([binary], { type: 'audio/mpeg' });
                    this.audio.src = URL.createObjectURL(blob);
                } catch (err) {
                    console.error('Failed to load audio binary:', err);
                    return;
                }
            }
        }

        // Seek immediately if we have duration info
        if (percentage !== null && item.durationMs) {
            this.audio.currentTime = percentage * (item.durationMs / 1000);
        } else if (this.audio.currentTime === 0 && item.previewTime > 0) {
            this.audio.currentTime = item.previewTime / 1000;
        }

        // Start playback immediately — don't wait for duration analysis
        this.audio.play().catch(e => console.warn('Audio play failed:', e));

        // Fire-and-forget: analyze duration in background if missing
        if (typeof item.durationMs !== 'number') {
            this._analyzeDurationInBackground(item, audioPath, percentage);
        }
    },

    async _analyzeDurationInBackground(item, audioPath, seekPercentage) {
        try {
            const duration = await getAudioDurationMs(audioPath);
            if (duration) {
                item.durationMs = duration;
                updateListItemElement(item.id);
                scheduleSave();

                // If user clicked a specific position, now seek to it accurately
                if (seekPercentage !== null && this.currentId === item.id) {
                    this.audio.currentTime = seekPercentage * (duration / 1000);
                }
            }
        } catch (err) {
            // Non-fatal
        }
    },

    stop() {
        if (this.currentId) {
            const el = getVisibleListBoxByItemId(this.currentId);
            if (el) {
                const renderIndex = Number(el.dataset.renderIndex);
                applyTimelineToBox(el, renderIndex);
            }
        }
        this.audio.pause();
        this.audio.currentTime = 0;
        this.currentId = null;
    },

    startTick() {
        const tick = () => {
            if (!this.isPlaying || !this.currentId) return;

            this.drawPlayhead();
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    },

    drawPlayhead() {
        if (!this.currentId) return;

        const el = getVisibleListBoxByItemId(this.currentId);
        if (!el) return;

        const canvas = el.querySelector('.list-timeline');
        if (!canvas) return;

        const item = beatmapItems.find(i => i.id === this.currentId);
        if (!item || !item.durationMs) return;

        const percentage = this.audio.currentTime / (item.durationMs / 1000);

        // Re-draw base timeline first
        const renderIndex = Number(el.dataset.renderIndex);
        applyTimelineToBox(el, renderIndex);

        // Draw playhead
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const width = canvas.width / dpr;
        const height = canvas.height / dpr;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = 'white';
        ctx.shadowBlur = 4;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.fillRect(percentage * width - 1, 0, 2, height);
        ctx.shadowBlur = 0;
    }
};

AudioController.init();

const loadBeatmapFromDialog = async () => {
    if (!window.beatmapApi?.openOsuFile) {
        return;
    }

    const listContainer = document.querySelector('#listContainer');

    let didSetLoading = false;
    try {
        const result = await window.beatmapApi.openOsuFile();
        if (!result || !result.files || !result.files.length || !listContainer) {
            updateEmptyState(listContainer);
            return;
        }

        setLoading(true);
        didSetLoading = true;
        const items = [];

        for (const file of result.files) {
            if (!file?.content) {
                continue;
            }

            const item = await buildItemFromContent(
                file.filePath,
                file.content,
                file.stat,
            );
            items.push(item);
        }

        if (!items.length) {
            updateEmptyState(listContainer);
            return;
        }

        beatmapItems = [...beatmapItems, ...items];
        updateTabCounts();
        renderFromState();
        queueMissingAudioAnalysisFromItems(items);
        queueMissingStarRatingFromItems(items);
        scheduleSave();
        processBackgroundQueues();
    } finally {
        if (didSetLoading) {
            setLoading(false);
        }
    }
};

// --- Streaming scan state ---
let streamingScanState = null; // { directory, existingMap, items, processed, totalFiles, resolveComplete }
let scanBatchUnlisten = null;
let scanCompleteUnlisten = null;

const initScanEventListeners = async () => {
    if (!window.tauriEvents?.listen) return;

    scanBatchUnlisten = await window.tauriEvents.listen('scan-batch', (payload) => {
        if (!streamingScanState) return;
        const { files, directory, totalFiles } = payload;

        if (directory) {
            streamingScanState.directory = directory;
        }
        if (totalFiles) {
            streamingScanState.totalFiles = totalFiles;
        }

        for (const file of files) {
            const existing = streamingScanState.existingMap.get(file.filePath);

            if (file.unchanged && existing) {
                streamingScanState.items.push(existing);
                if (existing.audio && typeof existing.durationMs !== 'number') {
                    scheduleAudioAnalysis(existing.id);
                }
                if (isStarRatingMissing(existing.starRating)) {
                    scheduleStarRatingCalculation(existing.id);
                }
            } else {
                try {
                    const item = processWorkerResult(file, existing);
                    streamingScanState.items.push(item);
                } catch (err) {
                    console.error(`Failed to process beatmap: ${file.filePath}`, err);
                }
            }
        }

        streamingScanState.processed += files.length;
        updateProgress(streamingScanState.processed, streamingScanState.totalFiles);
    });

    scanCompleteUnlisten = await window.tauriEvents.listen('scan-complete', (payload) => {
        if (!streamingScanState) return;
        const { directory, totalFiles } = payload;

        if (directory) {
            streamingScanState.directory = directory;
            lastScannedDirectory = directory;
            localStorage.setItem('lastScannedDirectory', lastScannedDirectory);
        }

        const items = streamingScanState.items;

        if (streamingScanState.directory) {
            const normalizedDir = streamingScanState.directory.toLowerCase().replace(/\\/g, '/');
            const endWithSlash = normalizedDir.endsWith('/') ? normalizedDir : normalizedDir + '/';
            const newPaths = new Set(items.map(i => i.filePath));

            if (items.length === 0) {
                beatmapItems = beatmapItems.filter(item => {
                    const itemPath = item.filePath.toLowerCase().replace(/\\/g, '/');
                    return !itemPath.startsWith(endWithSlash);
                });
            } else {
                const keptItems = beatmapItems.filter(i => !newPaths.has(i.filePath));
                beatmapItems = [...keptItems, ...items];
            }
        } else {
            const newPaths = new Set(items.map(i => i.filePath));
            const keptItems = beatmapItems.filter(i => !newPaths.has(i.filePath));
            beatmapItems = [...keptItems, ...items];
        }

        updateTabCounts();
        renderFromState();
        saveToStorage();
        queueMissingAudioAnalysisFromItems(items);
        queueMissingStarRatingFromItems(items);
        processBackgroundQueues();
        setLoading(false);

        if (streamingScanState.resolveComplete) {
            streamingScanState.resolveComplete();
        }
        streamingScanState = null;
    });
};

const startStreamingScan = (existingItemsMapOverride) => {
    const existingMap = existingItemsMapOverride instanceof Map
        ? existingItemsMapOverride
        : new Map();
    if (!(existingItemsMapOverride instanceof Map)) {
        beatmapItems.forEach(item => { if (item.filePath) existingMap.set(item.filePath, item); });
    }

    return new Promise((resolve) => {
        streamingScanState = {
            directory: '',
            existingMap,
            items: [],
            processed: 0,
            totalFiles: 0,
            resolveComplete: resolve,
        };
        setLoading(true);
        updateProgress(0, 0);
    });
};

const loadBeatmapsFromResult = async (result, existingItemsMapOverride) => {
    // For streaming scans, the IPC returns empty files array.
    // The real data comes via scan-batch/scan-complete events.
    // If we got actual files (e.g. from a non-streaming source), process them directly.
    if (result && Array.isArray(result.files) && result.files.length > 0) {
        const listContainer = document.querySelector('#listContainer');
        if (!listContainer) return;

        setLoading(true);
        try {
            if (result.directory) {
                lastScannedDirectory = result.directory;
                localStorage.setItem('lastScannedDirectory', lastScannedDirectory);
            }

            const existingItemsMap = existingItemsMapOverride instanceof Map
                ? existingItemsMapOverride
                : new Map();
            if (!(existingItemsMapOverride instanceof Map)) {
                beatmapItems.forEach(item => { if (item.filePath) existingItemsMap.set(item.filePath, item); });
            }

            const items = [];
            for (const file of result.files) {
                const existing = existingItemsMap.get(file.filePath);
                if (file.unchanged && existing) {
                    items.push(existing);
                } else {
                    try {
                        items.push(processWorkerResult(file, existing));
                    } catch (err) {
                        console.error(`Failed to process beatmap: ${file.filePath}`, err);
                    }
                }
            }

            if (result.directory) {
                const normalizedDir = result.directory.toLowerCase().replace(/\\/g, '/');
                const endWithSlash = normalizedDir.endsWith('/') ? normalizedDir : normalizedDir + '/';
                const newPaths = new Set(items.map(i => i.filePath));
                if (items.length === 0) {
                    beatmapItems = beatmapItems.filter(item => {
                        const itemPath = item.filePath.toLowerCase().replace(/\\/g, '/');
                        return !itemPath.startsWith(endWithSlash);
                    });
                } else {
                    const keptItems = beatmapItems.filter(i => !newPaths.has(i.filePath));
                    beatmapItems = [...keptItems, ...items];
                }
            } else {
                const newPaths = new Set(items.map(i => i.filePath));
                const keptItems = beatmapItems.filter(i => !newPaths.has(i.filePath));
                beatmapItems = [...keptItems, ...items];
            }

            updateTabCounts();
            renderFromState();
            saveToStorage();
            queueMissingAudioAnalysisFromItems(items);
            queueMissingStarRatingFromItems(items);
            processBackgroundQueues();
        } catch (err) {
            console.error('loadBeatmapsFromResult failed:', err);
        } finally {
            setLoading(false);
        }
    }
    // If files array is empty, streaming events handle everything
};

const refreshLastDirectory = async () => {
    const targetDir = settings.songsDir || lastScannedDirectory;

    if (!targetDir || !window.beatmapApi?.scanDirectoryOsuFiles) {
        loadBeatmapsFromFolder();
        return;
    }

    refreshUiState = {
        ...refreshUiState,
        isRefreshing: true
    };
    notifyRefreshUiToUI(getRefreshUiSnapshot());

    try {
        const mapperName = (getEffectiveMapperName() || '').trim() || null;

        // Build knownFiles cache (path -> mtime)
        const knownFiles = {};
        beatmapItems.forEach(item => {
            if (item.filePath) knownFiles[item.filePath] = item.dateModified;
        });

        // Start streaming scan — results arrive via scan-batch events
        const scanDone = startStreamingScan();
        await window.beatmapApi.scanDirectoryOsuFiles(targetDir, mapperName, knownFiles);
        await scanDone;

        // Success animation
        refreshUiState = {
            ...refreshUiState,
            isPulsing: true
        };
        notifyRefreshUiToUI(getRefreshUiSnapshot());
        setTimeout(() => {
            refreshUiState = {
                ...refreshUiState,
                isPulsing: false
            };
            notifyRefreshUiToUI(getRefreshUiSnapshot());
        }, 200);

        // Show completion notification
        const scannedCount = streamingScanState?.items?.length || 0;
        if (scannedCount > 0) {
            showNotification('Scan Complete', `Found ${scannedCount} beatmap${scannedCount !== 1 ? 's' : ''}.`, 'success');
        }
    } catch (error) {
        console.error('Refresh failed:', error);
        streamingScanState = null;
        setLoading(false);
        showNotification('Scan Failed', error.message || 'Failed to scan directory.', 'error');
    } finally {
        refreshUiState = {
            ...refreshUiState,
            isRefreshing: false
        };
        notifyRefreshUiToUI(getRefreshUiSnapshot());
    }
};

const loadBeatmapsByMapper = async () => {
    if (!window.beatmapApi?.openMapperOsuFiles) {
        return;
    }
    const mapperValue = await (window.mosuPrompts?.promptMapperName?.() || Promise.resolve(null));
    if (!mapperValue) {
        return;
    }
    setLoading(true);
    const mapperName = await processMapperInput(mapperValue);
    setLoading(false);

    if (!mapperName) {
        return;
    }
    const scanDone = startStreamingScan();
    const result = await window.beatmapApi.openMapperOsuFiles(mapperName);
    if (!result) {
        // User cancelled folder picker — clean up streaming state
        if (streamingScanState?.resolveComplete) streamingScanState.resolveComplete();
        streamingScanState = null;
        setLoading(false);
        return;
    }
    await scanDone;
};

const loadBeatmapsFromFolder = async () => {
    if (!window.beatmapApi?.openFolderOsuFiles) {
        return;
    }
    const scanDone = startStreamingScan();
    const result = await window.beatmapApi.openFolderOsuFiles();
    if (!result) {
        // User cancelled folder picker — clean up streaming state
        if (streamingScanState?.resolveComplete) streamingScanState.resolveComplete();
        streamingScanState = null;
        setLoading(false);
        return;
    }
    await scanDone;
};

const initEventDelegation = () => {
    document.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;
        if (!target.closest('.list-box')) return;

        const action = target.dataset.action;
        const itemId = target.dataset.itemId;
        const itemActions = window.mosuItemActions || {};

        if (action === 'toggle-pin') {
            if (typeof itemActions.toggleTodo === 'function') {
                itemActions.toggleTodo(itemId);
            } else {
                toggleTodo(itemId);
            }
        } else if (action === 'toggle-done') {
            if (typeof itemActions.toggleDone === 'function') {
                itemActions.toggleDone(itemId);
            } else {
                toggleDone(itemId);
            }
        } else if (action === 'open-web') {
            const url = target.dataset.url;
            if (typeof itemActions.openWeb === 'function') {
                itemActions.openWeb(url);
            } else if (url && window.appInfo?.openExternalUrl) {
                window.appInfo.openExternalUrl(url);
            } else if (url) {
                window.open(url, '_blank');
            }
        } else if (action === 'show-folder') {
            const path = target.dataset.path;
            if (typeof itemActions.showFolder === 'function') {
                itemActions.showFolder(path);
            } else if (path && window.beatmapApi?.showItemInFolder) {
                window.beatmapApi.showItemInFolder(path);
            }
        }

        // Remove focus to prevent "stuck" hover states due to :focus-within
        if (target instanceof HTMLElement) {
            target.blur();
        }
    });

    // Also handle right-click if needed here
};

const init = async () => {
    const listContainer = document.querySelector('#listContainer');
    const mapperPrompt = document.querySelector('#mapperPrompt');
    const songsDirPrompt = document.querySelector('#songsDirPrompt');
    const welcomePrompt = document.querySelector('#welcomePrompt');
    const firstRunPrompt = document.querySelector('#firstRunPrompt');
    const clearAllPrompt = document.querySelector('#clearAllPrompt');
    const settingsDialog = document.querySelector('#settingsDialog');
    const settingsBtn = document.querySelector('#settingsBtn');
    const aboutDialog = document.querySelector('#aboutDialog');
    const changelogDialog = document.querySelector('#changelogDialog');

    // UI State Loading
    const loadSettings = () => {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (raw) {
            try {
                const parsed = JSON.parse(raw);

                // Migration: Merge old mutually exclusive toggles into new autoRescan + rescanMode
                if (parsed.autoDetectMaps !== undefined || parsed.autoRescanMapper !== undefined) {
                    if (parsed.autoRescan === undefined) {
                        parsed.autoRescan = parsed.autoDetectMaps || parsed.autoRescanMapper || false;
                        parsed.rescanMode = parsed.autoDetectMaps ? 'all' : 'mapper';
                        // Clean up old keys
                        delete parsed.autoDetectMaps;
                        delete parsed.autoRescanMapper;
                    }
                }

                settings = { ...settings, ...parsed };
                const height = 170; // Forced to 170px
                VIRTUAL_ITEM_HEIGHT = height + 12;
                document.documentElement.style.setProperty('--list-item-height', `${height}px`);
                document.documentElement.style.setProperty('--title-lines', 2);
            } catch (e) { }
        }
        // Generate userId if not present (first run)
        if (!settings.userId) {
            settings.userId = generateUserId();
            persistSettings();
        }
    };

    const saveSettings = () => {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    };

    const settingsSubscribers = new Set();
    const emitSettingsState = () => {
        const snapshot = getSettingsStateSnapshot();
        emitSettingsStateToUI(snapshot);
        settingsSubscribers.forEach((callback) => {
            try {
                callback(snapshot);
            } catch (error) {
                // Non-fatal subscriber error
            }
        });
    };

    const updateSettingsUI = () => {
        emitSettingsState();
    };

    let rescanMapperTimer = null;

    const selectSongsDirFromUI = async () => {
        if (!window.beatmapApi?.selectDirectory) return getSettingsStateSnapshot();
        const dir = await window.beatmapApi.selectDirectory();
        if (dir) {
            settings.songsDir = dir;
            saveSettings();
            updateSettingsUI();
            showNotification('Directory Set', 'Songs folder has been updated.', 'success');
        }
        return getSettingsStateSnapshot();
    };

    const setEmbedToggleFromUI = (id, checked) => {
        if (!['embedShowTodoList', 'embedShowCompletedList', 'embedShowProgressStats'].includes(id)) {
            return getSettingsStateSnapshot();
        }
        settings[id] = !!checked;
        saveSettings();
        updateSettingsUI();
        return getSettingsStateSnapshot();
    };

    const setSettingToggleFromUI = (id, checked) => {
        if (!['autoRescan', 'ignoreStartAndBreaks', 'ignoreGuestDifficulties'].includes(id)) {
            return getSettingsStateSnapshot();
        }

        settings[id] = !!checked;
        persistSettings();
        updateSettingsUI();

        if (id === 'autoRescan' && checked) {
            refreshLastDirectory();
        } else if (id === 'ignoreStartAndBreaks') {
            beatmapItems = beatmapItems.map(item => ({
                ...item,
                progress: computeProgress(item.highlights)
            }));
            renderFromState();
        } else if (id === 'ignoreGuestDifficulties') {
            updateTabCounts();
            renderFromState();
        }
        return getSettingsStateSnapshot();
    };

    const setRescanModeFromUI = (mode) => {
        if (!['mapper', 'all'].includes(mode)) {
            return getSettingsStateSnapshot();
        }

        const prevMode = settings.rescanMode;
        settings.rescanMode = mode;
        persistSettings();
        updateSettingsUI();

        if (settings.autoRescan && prevMode !== mode) {
            if (mode === 'mapper' && prevMode === 'all') {
                beatmapItems = [];
                updateTabCounts();
                if (listContainer) listContainer.innerHTML = '';
                updateEmptyState(listContainer);
                saveToStorage();
            }
            refreshLastDirectory();
        }

        return getSettingsStateSnapshot();
    };

    const setGroupMapsBySongFromUI = (checked) => {
        settings.groupMapsBySong = !!checked;
        saveSettings();
        replaceExpandedGroups([]);
        renderFromState();
        updateSettingsUI();
        return getSettingsStateSnapshot();
    };

    const setVolumeFromUI = (value) => {
        const vol = Math.max(0, Math.min(1, Number(value) || 0));
        settings.volume = vol;
        AudioController.updateVolume();
        saveSettings();
        updateSettingsUI();
        return getSettingsStateSnapshot();
    };

    const toggleLinkedAliasFromUI = (name) => {
        if (!name) return getSettingsStateSnapshot();
        if (!settings.ignoredAliases) settings.ignoredAliases = [];

        const normalized = String(name).toLowerCase();
        const index = settings.ignoredAliases.indexOf(normalized);
        if (index > -1) settings.ignoredAliases.splice(index, 1);
        else settings.ignoredAliases.push(normalized);

        persistSettings();
        updateSettingsUI();

        if (settings.autoRescan && settings.rescanMode === 'mapper') {
            refreshLastDirectory();
        }
        return getSettingsStateSnapshot();
    };

    const setRescanMapperNameFromUI = (rawValue) => {
        const value = String(rawValue || '').trim();
        const isUrl = value.includes('osu.ppy.sh/users/') || value.includes('osu.ppy.sh/u/');
        const isId = /^\d+$/.test(value);

        settings.rescanMapperName = value;
        saveSettings();
        updateSettingsUI();

        if (rescanMapperTimer) clearTimeout(rescanMapperTimer);
        rescanMapperTimer = setTimeout(async () => {
            if (!value) {
                settings.mapperAliases = [];
                settings.ignoredAliases = [];
                settings.userId = null;
                settings.rescanMapperName = '';
                settings.embedApiKey = null;
                settings.embedLastSynced = null;
                saveSettings();

                beatmapItems = [];
                updateTabCounts();
                if (listContainer) listContainer.innerHTML = '';
                updateEmptyState(listContainer);
                saveToStorage();

                updateSettingsUI();
                return;
            }

            if (isUrl || (isId && value !== settings.userId?.toString())) {
                const processed = await processMapperInput(value);
                if (processed && processed !== value) {
                    settings.rescanMapperName = processed;
                    saveSettings();
                    updateSettingsUI();
                }
            }

            const currentListContainer = document.querySelector('#listContainer');
            if (currentListContainer) currentListContainer.innerHTML = '';

            const targetDir = settings.songsDir || lastScannedDirectory;
            if (!targetDir || !window.beatmapApi?.scanDirectoryOsuFiles) {
                updateTabCounts();
                renderFromState();
                return;
            }

            try {
                const knownFiles = {};
                beatmapItems.forEach(item => {
                    if (item.filePath) knownFiles[item.filePath] = item.dateModified;
                });

                const mapper = getEffectiveMapperName();
                const scanDone = startStreamingScan();
                await window.beatmapApi.scanDirectoryOsuFiles(targetDir, mapper || null, knownFiles);
                await scanDone;
            } catch (err) {
                console.error('Mapper rescan failed:', err);
                streamingScanState = null;
                setLoading(false);
                updateTabCounts();
                renderFromState();
                showNotification('Rescan Failed', err.message || 'Failed to rescan for maps.', 'error');
            }
        }, 800);

        return getSettingsStateSnapshot();
    };

    const copyUserIdFromUI = async () => {
        if (!settings.userId) return false;
        try {
            await navigator.clipboard.writeText(settings.userId);
            showNotification('Copied', 'User ID copied to clipboard.', 'success');
            return true;
        } catch (e) {
            console.error('Failed to copy user ID:', e);
            showNotification('Copy Failed', 'Could not copy user ID.', 'error');
            return false;
        }
    };

    const copyApiKeyFromUI = async () => {
        if (!settings.embedApiKey) return false;
        try {
            await navigator.clipboard.writeText(settings.embedApiKey);
            showNotification('Copied', 'API key copied to clipboard.', 'success');
            return true;
        } catch (e) {
            console.error('Failed to copy API key:', e);
            showNotification('Copy Failed', 'Could not copy API key.', 'error');
            return false;
        }
    };

    const copyEmbedUrlFromUI = async () => {
        if (!settings.userId) return false;
        const url = `${settings.embedSyncUrl}/embed/${settings.userId}`;
        try {
            await navigator.clipboard.writeText(url);
            showNotification('Copied', 'Embed URL copied to clipboard.', 'success');
            return true;
        } catch (e) {
            console.error('Failed to copy embed URL:', e);
            showNotification('Copy Failed', 'Could not copy embed URL.', 'error');
            return false;
        }
    };

    const regenerateApiKeyFromUI = () => {
        settings.embedApiKey = generateApiKey();
        settings.embedLastSynced = null;
        persistSettings();
        updateSettingsUI();
        showNotification('API Key Reset', 'A new API key has been generated and ready for sync.', 'success');
        return getSettingsStateSnapshot();
    };

    const triggerManualSyncFromUI = async () => {
        await triggerManualSync();
        updateSettingsUI();
        return getSettingsStateSnapshot();
    };

    window.mosuSettings = {
        ...(window.mosuSettings || {}),
        updateUI: updateSettingsUI,
        getState: () => getSettingsStateSnapshot(),
        subscribe: (callback) => {
            if (typeof callback !== 'function') return () => { };
            settingsSubscribers.add(callback);
            callback(getSettingsStateSnapshot());
            return () => settingsSubscribers.delete(callback);
        },
        selectSongsDir: selectSongsDirFromUI,
        setEmbedToggle: setEmbedToggleFromUI,
        setSettingToggle: setSettingToggleFromUI,
        setRescanMode: setRescanModeFromUI,
        setGroupMapsBySong: setGroupMapsBySongFromUI,
        setVolume: setVolumeFromUI,
        toggleLinkedAlias: toggleLinkedAliasFromUI,
        setRescanMapperName: setRescanMapperNameFromUI,
        copyUserId: copyUserIdFromUI,
        copyApiKey: copyApiKeyFromUI,
        copyEmbedUrl: copyEmbedUrlFromUI,
        regenerateApiKey: regenerateApiKeyFromUI,
        triggerManualSync: triggerManualSyncFromUI
    };
    // Keep external UI emitter decoupled from state broadcaster to avoid recursion.

    emitSettingsControlsState = emitSettingsState;

    const listUiSubscribers = new Set();
    notifyListUiToUI = (snapshot = getListUiSnapshot()) => {
        listUiSubscribers.forEach((callback) => {
            try {
                callback(snapshot);
            } catch (error) {
                // Non-fatal subscriber error
            }
        });
    };

    window.mosuListUI = {
        ...(window.mosuListUI || {}),
        getState: () => getListUiSnapshot(),
        subscribe: (callback) => {
            if (typeof callback !== 'function') return () => { };
            listUiSubscribers.add(callback);
            callback(getListUiSnapshot());
            return () => listUiSubscribers.delete(callback);
        }
    };

    const coreStateSubscribers = new Set();
    emitCoreStateToUI = (snapshot = getCoreStateSnapshot()) => {
        coreStateSubscribers.forEach((callback) => {
            try {
                callback(snapshot);
            } catch (error) {
                // Non-fatal subscriber error
            }
        });
    };

    window.mosuCoreState = {
        ...(window.mosuCoreState || {}),
        getState: () => getCoreStateSnapshot(),
        subscribe: (callback) => {
            if (typeof callback !== 'function') return () => { };
            coreStateSubscribers.add(callback);
            callback(getCoreStateSnapshot());
            return () => coreStateSubscribers.delete(callback);
        }
    };

    const todoOrderSubscribers = new Set();
    emitTodoOrderStateToUI = (snapshot = getTodoOrderSnapshot()) => {
        todoOrderSubscribers.forEach((callback) => {
            try {
                callback(snapshot);
            } catch (error) {
                // Non-fatal subscriber error
            }
        });
    };

    window.mosuTodoOrder = {
        ...(window.mosuTodoOrder || {}),
        getState: () => getTodoOrderSnapshot(),
        subscribe: (callback) => {
            if (typeof callback !== 'function') return () => { };
            todoOrderSubscribers.add(callback);
            callback(getTodoOrderSnapshot());
            return () => todoOrderSubscribers.delete(callback);
        },
        reorderTodo: (draggedId, dropId) => reorderTodoIds(draggedId, dropId)
    };

    const groupViewSubscribers = new Set();
    emitGroupViewStateToUI = (snapshot = getGroupViewSnapshot()) => {
        groupViewSubscribers.forEach((callback) => {
            try {
                callback(snapshot);
            } catch (error) {
                // Non-fatal subscriber error
            }
        });
    };

    window.mosuGroupView = {
        ...(window.mosuGroupView || {}),
        getState: () => getGroupViewSnapshot(),
        subscribe: (callback) => {
            if (typeof callback !== 'function') return () => { };
            groupViewSubscribers.add(callback);
            callback(getGroupViewSnapshot());
            return () => groupViewSubscribers.delete(callback);
        },
        toggleExpanded: (key) => {
            if (!key) return getGroupViewSnapshot();
            toggleGroupExpanded(String(key));
            return getGroupViewSnapshot();
        },
        setExpanded: (key, expanded) => {
            if (!key) return getGroupViewSnapshot();
            setGroupExpanded(String(key), !!expanded);
            return getGroupViewSnapshot();
        },
        replaceExpanded: (keys) => replaceExpandedGroups(keys)
    };

    const refreshUiSubscribers = new Set();
    notifyRefreshUiToUI = (snapshot = getRefreshUiSnapshot()) => {
        refreshUiSubscribers.forEach((callback) => {
            try {
                callback(snapshot);
            } catch (error) {
                // Non-fatal subscriber error
            }
        });
    };

    window.mosuRefreshUI = {
        ...(window.mosuRefreshUI || {}),
        getState: () => getRefreshUiSnapshot(),
        subscribe: (callback) => {
            if (typeof callback !== 'function') return () => { };
            refreshUiSubscribers.add(callback);
            callback(getRefreshUiSnapshot());
            return () => refreshUiSubscribers.delete(callback);
        }
    };

    const filterSubscribers = new Set();
    const emitFilterState = () => {
        emitFilterStateToUI(getFilterStateSnapshot());
        const snapshot = getFilterStateSnapshot();
        filterSubscribers.forEach((callback) => {
            try {
                callback(snapshot);
            } catch (error) {
                // Non-fatal subscriber error
            }
        });
    };

    const setViewModeFromUI = (tab) => {
        if (!tab || viewMode === tab) {
            return getFilterStateSnapshot();
        }

        viewMode = tab;
        emitFilterState();
        if (pendingTabRenderRaf) {
            cancelAnimationFrame(pendingTabRenderRaf);
            pendingTabRenderRaf = 0;
        }
        renderFromState();
        emitFilterState();

        return getFilterStateSnapshot();
    };

    const setSortModeFromUI = (mode) => {
        if (!mode) return getFilterStateSnapshot();

        if (sortState.mode === mode) {
            sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            sortState.mode = mode;
            sortState.direction = 'desc';
        }

        updateSortUI();
        renderFromState();
        scheduleSave();
        emitFilterState();
        return getFilterStateSnapshot();
    };

    let _searchRenderTimer = null;
    const setSearchQueryFromUI = (query) => {
        searchQuery = String(query || '').trim();
        // Update filter state immediately so UI reflects new query
        emitFilterState();
        // Debounce the expensive re-render to avoid per-keystroke lag
        if (_searchRenderTimer) clearTimeout(_searchRenderTimer);
        _searchRenderTimer = setTimeout(() => {
            _searchRenderTimer = null;
            renderFromState();
        }, 80);
        return getFilterStateSnapshot();
    };

    let _srRenderTimer = null;
    const setStarRangeFromUI = (min, max, activeHandle = null) => {
        // Update internal state - DO NOT set input values directly as Svelte controls them
        srFilter = {
            min: Math.max(0, Math.min(10, Number(min) || 0)),
            max: Math.max(0, Math.min(10, Number(max) || 10))
        };

        // Update visual handles only (Svelte owns the input values)
        updateSRRangeUI(null, { rerenderList: false, fromState: true });

        emitFilterState();

        // Debounce the expensive list re-render — the filter result during a slider
        // drag only matters once the user settles on a value.
        if (_srRenderTimer) clearTimeout(_srRenderTimer);
        _srRenderTimer = setTimeout(() => {
            _srRenderTimer = null;
            renderFromState();
        }, 80);

        return getFilterStateSnapshot();
    };

    window.mosuFilters = {
        ...(window.mosuFilters || {}),
        getState: () => getFilterStateSnapshot(),
        setViewMode: setViewModeFromUI,
        setSortMode: setSortModeFromUI,
        setSearchQuery: setSearchQueryFromUI,
        setStarRange: setStarRangeFromUI,
        subscribe: (callback) => {
            if (typeof callback !== 'function') {
                return () => { };
            }
            filterSubscribers.add(callback);
            callback(getFilterStateSnapshot());
            return () => filterSubscribers.delete(callback);
        }
    };
    // Keep external UI emitter decoupled from state broadcaster to avoid recursion.

    const refreshLastDirectoryFromUI = () => {
        // Ensure any pending background analysis resumes when the user clicks Refresh.
        try {
            if (Array.isArray(beatmapItems) && beatmapItems.length) {
                beatmapItems.forEach(item => {
                    if (item && item.audio && !item.durationMs) {
                        scheduleAudioAnalysis(item.id);
                    }
                    if (item && item.filePath && isStarRatingMissing(item.starRating)) {
                        scheduleStarRatingCalculation(item.id);
                    }
                });
            }
            try { processBackgroundQueues(); } catch (e) { /* swallow */ }
        } catch (e) {
            // non-fatal
        }

        return refreshLastDirectory();
    };

    const toggleTodoFromUI = (itemId) => {
        if (!itemId) return false;
        toggleTodo(itemId);
        return true;
    };

    const toggleDoneFromUI = (itemId) => {
        if (!itemId) return false;
        toggleDone(itemId);
        return true;
    };

    const openWebFromUI = (url) => {
        if (!url) return false;
        if (window.appInfo?.openExternalUrl) {
            window.appInfo.openExternalUrl(url);
        } else {
            window.open(url, '_blank');
        }
        return true;
    };

    const showFolderFromUI = (path) => {
        if (!path || !window.beatmapApi?.showItemInFolder) return false;
        window.beatmapApi.showItemInFolder(path);
        return true;
    };

    const clearAllBeatmapsFromUI = async () => {
        if (!listContainer) return false;
        const confirmed = await (window.mosuPrompts?.confirmClearAll?.() || Promise.resolve(false));

        if (!confirmed) return false;

        // Keep todoIds and doneIds so they persist across rescans
        beatmapItems = [];
        updateTabCounts();
        listContainer.innerHTML = '';
        updateEmptyState(listContainer);
        renderFromState();
        saveToStorage();
        showNotification('Cleared', 'All beatmaps have been removed.', 'success');
        return true;
    };

    window.mosuActions = {
        ...(window.mosuActions || {}),
        importOsuFile: () => loadBeatmapFromDialog(),
        importByMapper: () => loadBeatmapsByMapper(),
        importFromFolder: () => loadBeatmapsFromFolder(),
        refreshLastDirectory: refreshLastDirectoryFromUI,
        clearAll: clearAllBeatmapsFromUI
    };

    window.mosuItemActions = {
        ...(window.mosuItemActions || {}),
        toggleTodo: toggleTodoFromUI,
        toggleDone: toggleDoneFromUI,
        openWeb: openWebFromUI,
        showFolder: showFolderFromUI
    };

    const itemDetailsSubscribers = new Set();
    emitItemDetailsStateToUI = (snapshot = getItemDetailsSnapshot()) => {
        itemDetailsSubscribers.forEach((callback) => {
            try {
                callback(snapshot);
            } catch (error) {
                // Non-fatal subscriber error
            }
        });
    };

    window.mosuItemDetails = {
        ...(window.mosuItemDetails || {}),
        getState: (itemId) => itemId ? getItemDetailsByIdSnapshot(itemId) : getItemDetailsSnapshot(),
        subscribe: (callback) => {
            if (typeof callback !== 'function') return () => { };
            itemDetailsSubscribers.add(callback);
            callback(getItemDetailsSnapshot());
            return () => itemDetailsSubscribers.delete(callback);
        },
        setDeadline: (itemId, deadline) => setItemDeadline(itemId, deadline),
        setTargetStar: (itemId, rating) => setItemTargetStarRating(itemId, rating),
        setNotes: (itemId, notes) => setItemNotes(itemId, notes)
    };

    window.mosuLegacyRows = {
        ...(window.mosuLegacyRows || {}),
        mountListBox: (container, itemId, index, options) => mountLegacyListBox(container, itemId, index, options),
        clearListBox: (container) => clearLegacyListBox(container)
    };

    const viewModelSubscribers = new Set();
    emitViewModelStateToUI = (snapshot = getViewModelSnapshot()) => {
        viewModelSubscribers.forEach((callback) => {
            try {
                callback(snapshot);
            } catch (error) {
                // Non-fatal subscriber error
            }
        });
    };

    window.mosuViewModel = {
        ...(window.mosuViewModel || {}),
        getState: () => getViewModelSnapshot(),
        subscribe: (callback) => {
            if (typeof callback !== 'function') return () => { };
            viewModelSubscribers.add(callback);
            callback(getViewModelSnapshot());
            return () => viewModelSubscribers.delete(callback);
        }
    };

    document.addEventListener('click', (event) => {
        const target = event.target;
        const clickedSettingsBtn = settingsBtn && settingsBtn.contains(target);

        const isAnyDialogOpen = (settingsDialog && settingsDialog.open)
            || (mapperPrompt && mapperPrompt.open)
            || (songsDirPrompt && songsDirPrompt.open)
            || (welcomePrompt && welcomePrompt.open)
            || (firstRunPrompt && firstRunPrompt.open)
            || (clearAllPrompt && clearAllPrompt.open)
            || (aboutDialog && aboutDialog.open)
            || (changelogDialog && changelogDialog.open);

        if (isAnyDialogOpen) {
            return;
        }

        if (clickedSettingsBtn) {
            return;
        }

        // Stop audio preview when clicking outside the timeline
        if (AudioController.currentId && !target.closest('.list-timeline') && !target.closest('#settingsDialog') && !target.closest('#settingsBtn')) {
            AudioController.stop();
        }
    });

    // Drag and Drop for todo list (pointer-driven for Tauri compatibility)
    if (listContainer) {
        const stopAutoScroll = () => {
            if (autoScrollTimer) {
                clearInterval(autoScrollTimer);
                autoScrollTimer = null;
            }
        };

        const startAutoScroll = () => {
            if (autoScrollTimer) return;
            autoScrollTimer = setInterval(() => {
                const threshold = 120;
                const maxSpeed = 20;
                const h = window.innerHeight;

                let speed = 0;
                if (currentMouseY < threshold) {
                    speed = -Math.max(2, (1 - (currentMouseY / threshold)) * maxSpeed);
                } else if (currentMouseY > h - threshold) {
                    speed = Math.max(2, (1 - ((h - currentMouseY) / threshold)) * maxSpeed);
                }

                if (speed !== 0) {
                    window.scrollBy(0, speed);
                }
            }, 16);
        };

        const pointerDragState = {
            pointerId: null,
            isPointerDown: false,
            isDragging: false,
            draggedElement: null,
            draggedId: null,
            dropTarget: null,
            startX: 0,
            startY: 0,
        };

        const clearDropTarget = () => {
            if (pointerDragState.dropTarget) {
                pointerDragState.dropTarget.classList.remove('drop-target');
                pointerDragState.dropTarget = null;
            }
        };

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

        const shouldIgnoreDragStart = (target) => {
            if (!target) return false;
            return Boolean(target.closest('button, a, input, textarea, select, .list-timeline, .deadline-container, .target-star-container, .extra-actions, .list-action-links'));
        };

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

        const handlePointerDown = (e) => {
            if (viewMode !== 'todo') return;
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

        const maybeStartDragging = () => {
            if (pointerDragState.isDragging || !pointerDragState.draggedElement) return;
            pointerDragState.isDragging = true;
            pointerDragState.draggedElement.classList.add('is-dragging');
            document.body?.classList.add('is-dragging-any');
            startAutoScroll();
        };

        const handlePointerMove = (e) => {
            if (!pointerDragState.isPointerDown || e.pointerId !== pointerDragState.pointerId) return;

            const deltaX = Math.abs(e.clientX - pointerDragState.startX);
            const deltaY = Math.abs(e.clientY - pointerDragState.startY);
            if (!pointerDragState.isDragging && deltaX + deltaY > 6) {
                maybeStartDragging();
            }

            if (!pointerDragState.isDragging) return;

            e.preventDefault();
            currentMouseY = e.clientY;
            updateDropTarget(e.clientX, e.clientY);
        };

        const commitReorder = () => {
            if (!pointerDragState.draggedId || !pointerDragState.dropTarget) {
                return;
            }

            const draggedId = pointerDragState.draggedId;
            const dropId = pointerDragState.dropTarget.dataset.itemId;
            if (!dropId) {
                return;
            }
            reorderTodoIds(draggedId, dropId);
        };

        const handlePointerUp = (e) => {
            if (!pointerDragState.isPointerDown || e.pointerId !== pointerDragState.pointerId) {
                return;
            }

            if (pointerDragState.isDragging) {
                commitReorder();
            }

            resetPointerDragState();
        };

        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('pointermove', handlePointerMove, { passive: false });
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerUp);
    }

    // Virtual Scroll Sync — debounced via rAF to avoid redundant work
    let scrollRAF = null;
    let timelineRefreshRAF = null;
    let timelineRefreshTimer = null;
    let resizeSettleTimer = null;
    const debouncedSync = () => {
        if (isWindowResizeInProgress) return;
        if (scrollRAF) return;
        scrollRAF = requestAnimationFrame(() => {
            scrollRAF = null;
            if (isWindowResizeInProgress) return;
            syncVirtualList();
        });
    };
    const scheduleTimelineRefresh = () => {
        if (isWindowResizeInProgress) return;
        if (timelineRefreshRAF) return;
        timelineRefreshRAF = requestAnimationFrame(() => {
            timelineRefreshRAF = null;
            rerenderVisibleTimelines();
        });
    };
    const queueTimelineRefresh = ({ includeSync = false } = {}) => {
        if (isWindowResizeInProgress) return;
        if (includeSync) {
            debouncedSync();
        }

        if (timelineRefreshTimer) {
            clearTimeout(timelineRefreshTimer);
        }

        // Slight delay lets browser restore layout state after tab/window focus.
        timelineRefreshTimer = setTimeout(() => {
            timelineRefreshTimer = null;
            scheduleTimelineRefresh();
        }, 90);
    };
    window.addEventListener('scroll', debouncedSync, { passive: true });
    window.addEventListener('resize', () => {
        isWindowResizeInProgress = true;
        document.body?.classList.add('window-resizing');

        // Run a single final paint pass after resize settles to avoid artifacts.
        if (resizeSettleTimer) {
            clearTimeout(resizeSettleTimer);
        }
        resizeSettleTimer = setTimeout(() => {
            resizeSettleTimer = null;
            isWindowResizeInProgress = false;
            document.body?.classList.remove('window-resizing');
            debouncedSync();
            scheduleTimelineRefresh();
            scheduleTimelineBatchRender();
        }, 170);
    }, { passive: true });
    window.addEventListener('focus', () => {
        queueTimelineRefresh();
    }, { passive: true });
    window.addEventListener('pageshow', () => {
        queueTimelineRefresh();
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            queueTimelineRefresh();
        }
    });


    // Force-save on app close so background analysis state is never lost
    window.addEventListener('beforeunload', () => {
        if (saveTimer) {
            window.clearTimeout(saveTimer);
            saveTimer = null;
        }
        saveToStorage();
        persistAudioAnalysisState();
        persistStarRatingState();
    });

    // Startup sequence
    loadSettings();
    await initScanEventListeners();
    await loadFromStorage();

    initEventDelegation();
    updateSortUI();
    updateSRRangeUI(null, { rerenderList: false });

    renderFromState();

    const promptAndSelectSongsDirectory = async () => {
        if (settings.songsDir || !window.beatmapApi?.selectDirectory) {
            return !!settings.songsDir;
        }

        const confirmed = await (window.mosuPrompts?.confirmSongsDirPrompt?.() || Promise.resolve(false));
        if (!confirmed) {
            return false;
        }

        // Small delay before opening native explorer for focus/animation reasons
        await new Promise((resolve) => setTimeout(resolve, 400));
        const dir = await window.beatmapApi.selectDirectory();
        if (!dir) {
            return false;
        }

        settings.songsDir = dir;
        saveSettings();
        updateSettingsUI();
        return true;
    };

    const promptAndSetMapperName = async (label = 'Enter the mapper name:') => {
        const mapperValue = await (window.mosuPrompts?.promptMapperName?.({ label }) || Promise.resolve(null));
        if (!mapperValue) {
            return false;
        }

        setLoading(true);
        const processed = await processMapperInput(mapperValue);
        setLoading(false);
        if (!processed) {
            return false;
        }

        settings.rescanMapperName = processed;
        saveSettings();
        updateSettingsUI();
        return true;
    };

    // First run wizard
    // On very first launch, offer a choice: import all maps or only maps by a mapper.
    // If user chooses all -> show songs directory prompt only.
    // If user chooses mapper -> show songs directory prompt, then mapper name prompt.
    if (!settings.initialSetupDone) {
        await (window.mosuPrompts?.showWelcomePrompt?.() || Promise.resolve(false));

        const choice = await (window.mosuPrompts?.showFirstRunChoicePrompt?.() || Promise.resolve(null));

        // If user explicitly chose an option, mark setup done and follow flow
        if (choice === 'all') {
            settings.initialSetupDone = true;
            settings.initialImportChoice = 'all';
            saveSettings();

            await promptAndSelectSongsDirectory();
            if (settings.songsDir) {
                await refreshLastDirectory();
            }
        } else if (choice === 'mapper') {
            settings.initialSetupDone = true;
            settings.initialImportChoice = 'mapper';
            saveSettings();

            await promptAndSelectSongsDirectory();
            if (!settings.rescanMapperName) {
                await promptAndSetMapperName();
            }
            if (settings.songsDir && settings.rescanMapperName) {
                await refreshLastDirectory();
            }
        }
    }

    if (!settings.rescanMapperName || !settings.songsDir) {
        if (!settings.rescanMapperName && settings.initialImportChoice !== 'all') {
            await promptAndSetMapperName('Enter your default mapper name:');
        }
        if (!settings.songsDir) {
            await promptAndSelectSongsDirectory();
        }
        if (settings.autoRescan && settings.songsDir) {
            await refreshLastDirectory();
        }
    }

};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

