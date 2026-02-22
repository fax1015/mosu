const STORAGE_KEY = 'beatmapItemsV1';
const SETTINGS_STORAGE_KEY = 'mapTrackerSettingsV1';
const AUDIO_ANALYSIS_STATE_KEY = 'audioAnalysisStateV1';
const STORAGE_VERSION = 1;

// Custom Tooltip System
const TooltipManager = {
    element: null,
    timeout: null,
    currentTrigger: null,
    delay: 500, // Balanced delay for feel
    observer: null,

    init() {
        this.element = document.getElementById('mosuCustomTooltip');
        if (!this.element) {
            this.element = document.createElement('div');
            this.element.id = 'mosuCustomTooltip';
            this.element.className = 'custom-tooltip';
            document.body.appendChild(this.element);
        }

        // MutationObserver to watch for tooltip text changes on the active trigger
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'data-tooltip') {
                    this.updateContent();
                }
            }
        });

        // Event delegation for all elements with data-tooltip
        document.addEventListener('mouseover', (e) => {
            const trigger = e.target.closest('[data-tooltip]');
            if (trigger && trigger !== this.currentTrigger) {
                this.startTimer(trigger);
            } else if (!trigger && this.currentTrigger) {
                this.hide();
            }
        });

        document.addEventListener('mouseout', (e) => {
            const trigger = e.target.closest('[data-tooltip]');
            if (trigger && trigger === this.currentTrigger) {
                const related = e.relatedTarget;
                if (!related || !trigger.contains(related)) {
                    this.hide();
                }
            }
        });

        // Hide on click or scroll
        document.addEventListener('mousedown', () => this.hide());
        window.addEventListener('scroll', () => this.hide(), true);
        window.addEventListener('resize', () => this.hide());
    },

    startTimer(trigger) {
        this.clearTimer();
        this.currentTrigger = trigger;
        this.timeout = setTimeout(() => {
            this.show(trigger);
        }, this.delay);
    },

    clearTimer() {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
    },

    show(trigger) {
        this.observer.disconnect();
        this.observer.observe(trigger, { attributes: true, attributeFilter: ['data-tooltip'] });

        this.updateContent();
        this.element.classList.add('visible');
    },

    updateContent() {
        if (!this.currentTrigger || !this.element) return;
        const text = this.currentTrigger.getAttribute('data-tooltip');
        if (!text) {
            this.hide();
            return;
        }

        this.element.textContent = text;

        // Use requestAnimationFrame to ensure the DOM has updated and we can measure the new size correctly
        requestAnimationFrame(() => {
            if (this.currentTrigger) this.updatePosition();
        });
    },

    hide() {
        this.clearTimer();
        this.observer.disconnect();
        this.currentTrigger = null;
        if (this.element) {
            this.element.classList.remove('visible');
        }
    },

    updatePosition() {
        if (!this.element || !this.currentTrigger) return;

        const triggerRect = this.currentTrigger.getBoundingClientRect();

        // Temporary reset scale to 1 to measure natural width accurately
        const originalTransform = this.element.style.transform;
        this.element.style.transform = 'none';
        this.element.style.display = 'block';

        const tooltipWidth = this.element.offsetWidth;
        const tooltipHeight = this.element.offsetHeight;

        this.element.style.transform = originalTransform;
        if (!this.element.classList.contains('visible')) {
            this.element.style.display = '';
        }

        let left = triggerRect.left + (triggerRect.width / 2) - (tooltipWidth / 2);
        let top = triggerRect.top - tooltipHeight - 12; // Increased gap for arrow
        let isTop = true;

        // Viewport constraints
        const padding = 16;
        const winWidth = window.innerWidth;

        if (left < padding) {
            left = padding;
        } else if (left + tooltipWidth > winWidth - padding) {
            left = winWidth - tooltipWidth - padding;
        }

        // Flip to bottom if it overflows the top
        if (top < padding) {
            top = triggerRect.bottom + 12;
            isTop = false;
        }

        // Position the arrow to point exactly at the trigger center
        const arrowLeft = triggerRect.left + (triggerRect.width / 2) - left;
        this.element.style.setProperty('--arrow-left', `${Math.round(arrowLeft)}px`);

        this.element.classList.toggle('mosu-tooltip--top', isTop);
        this.element.classList.toggle('mosu-tooltip--bottom', !isTop);

        this.element.style.left = `${Math.round(left)}px`;
        this.element.style.top = `${Math.round(top)}px`;
    }
};

// Initialize Tooltip Manager
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => TooltipManager.init());
} else {
    TooltipManager.init();
}

let beatmapItems = [];
let todoIds = [];
let doneIds = [];
let viewMode = 'all';
let sortState = { mode: 'dateAdded', direction: 'desc' };
let searchQuery = '';

// Auto-scroll state for dragging
let autoScrollTimer = null;
let currentMouseY = 0;

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
    return 'user_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 15);
};

let settings = {
    autoDetectMaps: false,
    autoRescanMapper: false,
    rescanMapperName: '',
    songsDir: null,
    ignoreStartAndBreaks: false,
    ignoreGuestDifficulties: false,
    volume: 0.5,
    listItemHeight: 240,
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
    embedLastSynced: null
};

// Returns the mapper name that should be used for backend operations.
// When `autoDetectMaps` is enabled we intentionally return an empty string
// (so the backend will perform an unfiltered / full scan) while keeping
// the stored `rescanMapperName` for display in the UI.
const getEffectiveMapperName = () => {
    return settings.autoDetectMaps ? '' : (settings.rescanMapperName || '').trim();
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
    if (!(timeline instanceof HTMLCanvasElement)) return;

    const ctx = timeline.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = timeline.clientWidth;
    const height = timeline.clientHeight;

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

let VIRTUAL_ITEM_HEIGHT = 252; // 240px + 12px gap
let itemsToRender = [];

const applyTimelineToBox = (box, index) => {
    const timeline = box.querySelector('.list-timeline');
    if (!timeline) return;

    const itemId = box.dataset.itemId;
    const isDone = doneIds.includes(itemId);
    let ranges = [];

    if (isDone) {
        ranges = [{ start: 0, end: 1, type: 'object' }];
    } else {
        const item = itemsToRender[index];
        ranges = item?.highlights || [];

        const hasProgress = Number(item?.progress) > 0;
        if (!ranges.length && hasProgress) {
            const fallback = index % 2 === 0 ? '0.1-0.18,0.42-0.52,0.76-0.96' : '0.15-0.22,0.58-0.72';
            ranges = parseHighlights(fallback);
        } else if (!hasProgress) {
            ranges = [];
        }
    }

    renderTimeline(timeline, ranges);
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
    const mapper = (getEffectiveMapperName() || '').trim().toLowerCase();
    if (!mapper) return false;
    try {
        const meta = parseMetadata(content || '');
        if (!meta) return false;
        const creator = String(meta.creator || '').toLowerCase();
        if (!creator.includes(mapper)) return false;
        const version = String(meta.version || '').toLowerCase();
        // If it includes the mapper's name followed by 's, it's likely not a GUEST difficulty but their own
        if (version.includes(mapper + "'s") || version.includes(mapper + "s'")) return false;
        return version.includes("'s") || version.includes("s'");
    } catch (e) {
        return false;
    }
};

// Cached mapper name for guest difficulty filtering (set before each render pass)
let _cachedMapperNeedle = '';

const isGuestDifficultyItem = (item) => {
    if (!settings.ignoreGuestDifficulties) return false;
    const mapper = _cachedMapperNeedle;
    if (!mapper) return false;
    const creator = String(item.creator || '').toLowerCase();
    if (!creator.includes(mapper)) return false;
    const version = String(item.version || '').toLowerCase();
    // If it includes the mapper's name followed by 's, it's likely not a GUEST difficulty but their own
    if (version.includes(mapper + "'s") || version.includes(mapper + "s'")) return false;
    return version.includes("'s") || version.includes("s'");
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
});

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

    const starTag = document.createElement('span');
    starTag.classList.add('meta-tag', 'meta-tag--star-rating');

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
            starTag.style.display = '';
        } else {
            starTag.style.display = 'none';
        }
    };

    // Initial state
    updateStarTag(normalized.targetStarRating);
    starTag.dataset.tooltip = 'Target Star Rating';
    meta.appendChild(starTag);

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

    const isTodoTab = viewMode === 'todo';
    const isCompletedTab = viewMode === 'completed';
    const isAllTab = viewMode === 'all';

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
            // Update local data
            const itemIndex = beatmapItems.findIndex(i => i.id === normalized.id);
            if (itemIndex !== -1) {
                beatmapItems[itemIndex].deadline = newDeadline;
                scheduleSave();

                // Update status class without re-rendering everything
                listBox.classList.remove('list-box--overdue', 'list-box--due-soon');
                if (newDeadline && !isDone) {
                    const now = Date.now();
                    const diffDays = (newDeadline - now) / (1000 * 60 * 60 * 24);
                    if (diffDays < 0) {
                        listBox.classList.add('list-box--overdue');
                    } else if (diffDays <= 3) {
                        listBox.classList.add('list-box--due-soon');
                    }
                }
            }
        });

        deadlineContainer.appendChild(deadlineLabel);
        deadlineContainer.appendChild(deadlinePicker);
        expansionArea.appendChild(deadlineContainer);

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
            const itemIndex = beatmapItems.findIndex(i => i.id === normalized.id);
            if (itemIndex !== -1) {
                const val = e.target.value;
                const rating = val === '' ? null : parseFloat(val);
                beatmapItems[itemIndex].targetStarRating = rating;
                scheduleSave();
                // Update the star tag dynamically
                if (listBox._updateStarTag) {
                    listBox._updateStarTag(rating);
                }
            }
        };

        targetStarContainer.appendChild(targetStarLabel);
        targetStarContainer.appendChild(targetStarInput);
        expansionArea.appendChild(targetStarContainer);

        // Extra Actions Row
        const extraActions = document.createElement('div');
        extraActions.classList.add('extra-actions');

        // Open Website (if available)
        if (normalized.beatmapSetID && normalized.beatmapSetID !== '-1' && normalized.beatmapSetID !== '0') {
            const openWebBtn = document.createElement('button');
            openWebBtn.type = 'button';
            openWebBtn.classList.add('extra-action-btn');
            openWebBtn.dataset.tooltip = 'Open Website';
            openWebBtn.innerHTML = `
                <svg viewBox="0 0 512 512"><path d="M320 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l82.7 0-201.4 201.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L448 109.3 448 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-160c0-17.7-14.3-32-32-32L320 0zM80 96C35.8 96 0 131.8 0 176L0 432c0 44.2 35.8 80 80 80l256 0c44.2 0 80-35.8 80-80l0-80c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 80c0 8.8-7.2 16-16 16L80 448c-8.8 0-16-7.2-16-16l0-256c0-8.8 7.2-16 16-16l80 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L80 96z"/></svg>
                <span>Open Website</span>
            `;
            openWebBtn.onclick = (e) => {
                e.stopPropagation();
                const bID = normalized.beatmapSetID;
                const isUrl = String(bID).startsWith('http');
                const url = isUrl ? bID : `https://osu.ppy.sh/beatmapsets/${bID}`;
                if (window.appInfo?.openExternalUrl) {
                    window.appInfo.openExternalUrl(url);
                } else {
                    window.open(url, '_blank');
                }
            };
            extraActions.appendChild(openWebBtn);
        }

        expansionArea.appendChild(extraActions);


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

const syncVirtualList = () => {
    const container = document.querySelector('#listContainer');
    if (!container) return;

    const scrollTop = window.scrollY;
    const windowHeight = window.innerHeight;
    const rect = container.getBoundingClientRect();
    const containerTop = rect.top + scrollTop;

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

    // Process timeline batch
    while (batchRenderTimelines.length > 0) {
        const { el, index } = batchRenderTimelines.shift();
        applyTimelineToBox(el, index);
    }

    updateEmptyState(container);
};

const renderBeatmapList = (listContainer, items) => {
    itemsToRender = items;
    const totalHeight = items.length > 0 ? (items.length * VIRTUAL_ITEM_HEIGHT - 12) : 0;
    listContainer.style.height = `${totalHeight}px`;
    listContainer.innerHTML = ''; // Fresh state
    syncVirtualList();
};

const setLoading = (isLoading) => {
    const spinner = document.querySelector('#loadingSpinner');
    if (!spinner) {
        return;
    }
    spinner.classList.toggle('is-hidden', !isLoading);

    const progressSection = document.querySelector('#loadingProgress');
    if (!isLoading && progressSection) {
        progressSection.classList.add('is-hidden');
    }
};

const updateProgress = (current, total) => {
    const progressSection = document.querySelector('#loadingProgress');
    const fill = document.querySelector('#progressBarFill');
    const label = document.querySelector('#progressLabel');
    if (!progressSection || !fill || !label) {
        return;
    }
    progressSection.classList.remove('is-hidden');
    const pct = total > 0 ? (current / total) * 100 : 0;
    fill.style.width = `${pct}%`;
    label.textContent = `Processing ${current} / ${total} files...`;
};

const updateEmptyState = (listContainer) => {
    const emptyState = document.querySelector('#emptyState');
    const clearAllButton = document.querySelector('#clearAllBtn');
    if (!emptyState || !listContainer) {
        return;
    }

    // Use current itemsToRender for accurate empty state per tab
    const hasItems = itemsToRender.length > 0;

    // Toggle is-active for transition, but avoid display: none so transitions work
    emptyState.classList.toggle('is-active', !hasItems);

    if (clearAllButton) {
        // Show clear button if there are any items in the current view
        clearAllButton.classList.toggle('is-hidden', !hasItems);
    }
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
    const allCountEl = document.querySelector('#allCount');
    const todoCountEl = document.querySelector('#todoCount');
    const completedCountEl = document.querySelector('#completedCount');

    const visibleItems = beatmapItems.filter(item => !isGuestDifficultyItem(item));
    const visibleAllCount = visibleItems.length;
    const visibleTodoCount = todoIds.reduce((count, id) => {
        const item = beatmapItems.find(i => i.id === id);
        if (!item) return count;
        if (isGuestDifficultyItem(item)) return count;
        return count + 1;
    }, 0);
    const visibleDoneCount = doneIds.reduce((count, id) => {
        const item = beatmapItems.find(i => i.id === id);
        if (!item) return count;
        if (isGuestDifficultyItem(item)) return count;
        return count + 1;
    }, 0);

    if (allCountEl) allCountEl.textContent = visibleAllCount;
    if (todoCountEl) todoCountEl.textContent = visibleTodoCount;
    if (completedCountEl) completedCountEl.textContent = visibleDoneCount;
};

const updateListItemElement = (itemId) => {
    const listContainer = document.querySelector('#listContainer');
    if (!listContainer) return;

    const el = listContainer.querySelector(`[data-item-id="${itemId}"]`);
    if (!el) return;

    const isPinned = todoIds.includes(itemId);
    const isDone = doneIds.includes(itemId);

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

    // 4. Update Stats (look up latest state from model if possible)
    const item = beatmapItems.find(i => i.id === itemId);
    if (item) {
        el.dataset.progress = String(item.progress || 0);
    }

    const durationStat = el.querySelector('.duration-stat');
    if (durationStat && item) {
        durationStat.innerHTML = `<strong>Duration:</strong> ${formatDuration(item.durationMs)}`;
    }

    const progressStat = el.querySelector('.progress-stat') || el.querySelector('.stat-item');
    if (progressStat) {
        const baseProgress = item ? (item.progress || 0) : (Number(el.dataset.progress) || 0);
        const displayProgress = isDone ? 1 : baseProgress;
        progressStat.innerHTML = `<strong>Progress:</strong> ${Math.round(displayProgress * 100)}%`;
    }

    // 5. Update Timeline Canvas
    const renderIndex = Number(el.dataset.renderIndex);
    applyTimelineToBox(el, renderIndex);
};

const insertItemIntoTodoView = (itemId) => {
    renderFromState();
};

const insertItemIntoCompletedView = (itemId) => {
    renderFromState();
};

const toggleTodo = (itemId) => {
    const wasPinned = todoIds.includes(itemId);
    if (wasPinned) {
        // Remove from todo list
        todoIds = todoIds.filter(id => id !== itemId);
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


const closeDialogWithAnimation = (dialog) => {
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

const removeItemFromView = (itemId) => {
    const listContainer = document.querySelector('#listContainer');
    const existingEl = listContainer?.querySelector(`[data-item-id="${itemId}"]`);

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
        case 'dateAdded':
        default:
            sorted.sort((a, b) => ((a.dateAdded || 0) - (b.dateAdded || 0)) * multiplier);
            break;
    }
    return sorted;
};

const filterItems = (items, query) => {
    if (!query) {
        return items;
    }
    const needle = query.toLowerCase();
    return items.filter((item) => {
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
};

const renderFromState = () => {
    const listContainer = document.querySelector('#listContainer');
    if (!listContainer) {
        return;
    }

    // Cache mapper name once per render pass for guest difficulty filtering
    _cachedMapperNeedle = (getEffectiveMapperName() || '').trim().toLowerCase();

    // Build a lookup map for O(1) access instead of O(n) Array.find per item
    const itemMap = new Map();
    for (const item of beatmapItems) {
        itemMap.set(item.id, item);
    }

    itemsToRender = [];
    if (viewMode === 'todo') {
        // In TODO mode, we only show items in todoIds (in that specific order) and exclude hidden guest difficulties
        for (const id of todoIds) {
            const item = itemMap.get(id);
            if (item && !isGuestDifficultyItem(item)) {
                itemsToRender.push(item);
            }
        }
    } else if (viewMode === 'completed') {
        // In Completed mode, show items that have been marked done in the order of doneIds, excluding hidden
        for (const id of doneIds) {
            const item = itemMap.get(id);
            if (item && !isGuestDifficultyItem(item)) {
                itemsToRender.push(item);
            }
        }
    } else {
        const visibleItems = beatmapItems.filter(item => !isGuestDifficultyItem(item));
        const filtered = filterItems(visibleItems, searchQuery);
        itemsToRender = sortItems(filtered, sortState.mode, sortState.direction);
    }

    listContainer.className = '';
    listContainer.classList.add(`view-${viewMode}`);

    renderBeatmapList(listContainer, itemsToRender);
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
            audio: item.audio || '',
            deadline: (typeof item.deadline === 'number' || item.deadline === null) ? item.deadline : null,
            targetStarRating: (typeof item.targetStarRating === 'number' || item.targetStarRating === null) ? item.targetStarRating : null,
            durationMs: (typeof item.durationMs === 'number') ? item.durationMs : null,
            previewTime: item.previewTime ?? -1,
            coverPath: item.coverPath || '',
            highlights: serializeHighlights(item.highlights || []),
            progress: item.progress || 0,
        })),
    };

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
        // Storage may be full; ignore.
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
const EMBED_SYNC_RATE_LIMIT_MS = 30_000; // 30 seconds
let embedSyncTimer = null;
let lastEmbedSyncTime = 0;

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
const performEmbedSync = async () => {
    if (!settings.embedApiKey) {
        settings.embedApiKey = generateApiKey();
        persistSettings();
    }

    const payload = buildEmbedPayload();
    const syncUrl = `${settings.embedSyncUrl}/api/sync`;

    console.log('Starting embed sync to:', syncUrl);

    try {
        const result = await window.embedSyncApi.sync(syncUrl, settings.embedApiKey, payload);

        console.log('Sync result:', result);

        if (result.success && result.data?.success) {
            settings.embedLastSynced = Date.now();
            persistSettings();
            updateEmbedSyncStatus('synced');
        } else {
            const errorMsg = result.data?.error || result.error || 'Unknown error';
            console.error('Embed sync failed:', errorMsg);
            updateEmbedSyncStatus('error', errorMsg);
        }
    } catch (err) {
        console.error('Embed sync error:', err);
        updateEmbedSyncStatus('error', err.message);
    }
};

// Schedule embed sync with rate limiting
const scheduleEmbedSync = () => {
    if (embedSyncTimer) {
        clearTimeout(embedSyncTimer);
    }

    const timeSinceLastSync = Date.now() - lastEmbedSyncTime;
    const delay = Math.max(0, EMBED_SYNC_RATE_LIMIT_MS - timeSinceLastSync);

    embedSyncTimer = setTimeout(() => {
        lastEmbedSyncTime = Date.now();
        performEmbedSync();
    }, delay);
};

// Update sync status UI
const updateEmbedSyncStatus = (status, error = null) => {
    const statusEl = document.querySelector('#embedSyncStatus');
    const lastSyncEl = document.querySelector('#embedLastSynced');

    if (statusEl) {
        statusEl.classList.remove('syncing', 'synced', 'error');
        if (status === 'syncing') {
            statusEl.classList.add('syncing');
            statusEl.textContent = 'Syncing...';
        } else if (status === 'synced') {
            statusEl.classList.add('synced');
            statusEl.textContent = 'Synced';
        } else if (status === 'error') {
            statusEl.classList.add('error');
            statusEl.textContent = `Error: ${error || 'Unknown'}`;
        }
    }

    if (lastSyncEl && settings.embedLastSynced) {
        const date = new Date(settings.embedLastSynced);
        lastSyncEl.textContent = `Last synced: ${date.toLocaleString()}`;
    }
};

// Manual sync trigger
const triggerManualSync = async () => {
    updateEmbedSyncStatus('syncing');
    lastEmbedSyncTime = 0; // Reset rate limit for manual sync
    await performEmbedSync();
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

const queueMissingAudioAnalysisFromItems = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
        if (item && item.audio && typeof item.durationMs !== 'number' && item.id) {
            scheduleAudioAnalysis(item.id);
        }
    }
};

let _lastTooltipUpdate = 0;

const updateRefreshProgress = (completed, total) => {
    const refreshBtn = document.querySelector('#refreshBtn');
    if (!refreshBtn) return;

    if (total <= 0) {
        refreshBtn.style.setProperty('--refresh-progress', '0%');
        refreshBtn.dataset.tooltip = 'Refresh last directory';
        _lastTooltipUpdate = 0;
        return;
    }

    const progress = Math.min(100, Math.max(0, (completed / total) * 100));
    refreshBtn.style.setProperty('--refresh-progress', `${progress}%`);

    // Throttle tooltip text updates to every 2s — native tooltips flash when title changes
    const now = Date.now();
    if (now - _lastTooltipUpdate > 2000 || completed === total) {
        _lastTooltipUpdate = now;
        refreshBtn.dataset.tooltip = `Analyzing audio durations... ${Math.round(progress)}% (${completed}/${total})`;
    }
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

const processAudioQueue = async () => {
    if (isAnalyzingAudio || audioAnalysisQueue.length === 0) return;
    isAnalyzingAudio = true;
    audioAnalysisTotal = Math.max(audioAnalysisTotal, audioAnalysisQueue.length);

    const refreshBtn = document.querySelector('#refreshBtn');
    if (refreshBtn) {
        refreshBtn.classList.add('is-analyzing');
        refreshBtn.dataset.tooltip = 'Analyzing audio durations...';
    }

    let unsavedCount = 0;
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
            if (found) unsavedCount++;
        }

        const completed = audioAnalysisTotal - audioAnalysisQueue.length;
        updateRefreshProgress(completed, audioAnalysisTotal);

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
    updateRefreshProgress(0, 0);
    if (refreshBtn) {
        refreshBtn.classList.remove('is-analyzing');
        refreshBtn.dataset.tooltip = 'Refresh last directory';
    }
    localStorage.removeItem(AUDIO_ANALYSIS_STATE_KEY);
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
        coverUrl,
        coverPath,
        highlights,
        progress: computeProgress(highlights),
        dateAdded: existing?.dateAdded ?? Date.now(),
        dateModified: stat?.mtimeMs ?? 0,
        id: existing?.id ?? createItemId(filePath),
        filePath,
    };

    if (!durationMs && metadata.audio && filePath) {
        // Store raw hit object/break timestamps temporarily so we can recalculate 
        // accurate normalized highlights once the real audio duration is known.
        item.rawTimestamps = { hitStarts, hitEnds, breakPeriods, bookmarks };
        scheduleAudioAnalysis(item.id);
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
    updateTabCounts();

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

    // Resume interrupted audio analysis first, then queue any newly-missing durations.
    restoreAudioAnalysisStateFromStorage();

    // Queue audio analysis for items missing duration (in background)
    queueMissingAudioAnalysisFromItems(beatmapItems);
    processAudioQueue();
};

const updateSortUI = () => {
    const dropdown = document.querySelector('#sortDropdown');
    const label = document.querySelector('#sortLabel');
    const direction = document.querySelector('#sortDirection');
    const options = document.querySelectorAll('.sort-option');
    const activeOption = Array.from(options).find((option) => option.dataset.sort === sortState.mode);

    if (label && activeOption) {
        label.textContent = activeOption.dataset.label || activeOption.textContent;
    }
    if (direction) {
        direction.dataset.direction = sortState.direction;
    }
    if (dropdown) {
        dropdown.classList.toggle('is-open', false);
    }
    options.forEach((option) => {
        option.classList.toggle('is-active', option.dataset.sort === sortState.mode);
    });
};



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
                const prevEl = document.querySelector(`[data-item-id="${this.currentId}"]`);
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
            const el = document.querySelector(`[data-item-id="${this.currentId}"]`);
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

        const el = document.querySelector(`[data-item-id="${this.currentId}"]`);
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
        scheduleSave();
        processAudioQueue();
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
        processAudioQueue();
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
            processAudioQueue();
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

    const refreshBtn = document.querySelector('#refreshBtn');
    if (refreshBtn) refreshBtn.classList.add('is-refreshing');

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
        if (refreshBtn) {
            refreshBtn.style.transform = 'scale(1.2)';
            setTimeout(() => refreshBtn.style.transform = '', 200);
        }
    } catch (error) {
        console.error('Refresh failed:', error);
        streamingScanState = null;
        setLoading(false);
    } finally {
        if (refreshBtn) refreshBtn.classList.remove('is-refreshing');
    }
};

const loadBeatmapsByMapper = async () => {
    if (!window.beatmapApi?.openMapperOsuFiles) {
        return;
    }

    const mapperName = await new Promise((resolve) => {
        const dialog = document.querySelector('#mapperPrompt');
        const input = document.querySelector('#mapperNameInput');
        const cancelBtn = document.querySelector('#mapperPromptCancel');
        if (!dialog || !input) {
            resolve(null);
            return;
        }

        input.value = '';
        dialog.showModal();
        input.focus();

        const cleanup = async () => {
            await closeDialogWithAnimation(dialog);
            cancelBtn?.removeEventListener('click', onCancel);
            dialog.removeEventListener('submit', onSubmit);
            dialog.removeEventListener('cancel', onCancel);
        };
        const onCancel = async () => { await cleanup(); resolve(null); };
        const onSubmit = async (event) => {
            event.preventDefault();
            const value = input.value.trim();
            await cleanup();
            resolve(value || null);
        };

        cancelBtn?.addEventListener('click', onCancel, { once: true });
        dialog.addEventListener('submit', onSubmit, { once: true });
        dialog.addEventListener('cancel', onCancel, { once: true });
    });

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
    const listContainer = document.querySelector('#listContainer');
    if (!listContainer) return;

    listContainer.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        const itemId = target.dataset.itemId;

        if (action === 'toggle-pin') {
            toggleTodo(itemId);
        } else if (action === 'toggle-done') {
            toggleDone(itemId);
        } else if (action === 'open-web') {
            const url = target.dataset.url;
            if (url && window.appInfo?.openExternalUrl) {
                window.appInfo.openExternalUrl(url);
            } else if (url) {
                window.open(url, '_blank');
            }
        } else if (action === 'show-folder') {
            const path = target.dataset.path;
            if (path && window.beatmapApi?.showItemInFolder) {
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
    const uploadButton = document.querySelector('#osuUploadBtn');
    const listContainer = document.querySelector('#listContainer');
    const clearAllButton = document.querySelector('#clearAllBtn');
    const uploadDropdown = document.querySelector('#uploadDropdown');
    const uploadMenuToggle = document.querySelector('#uploadMenuToggle');
    const uploadOptions = document.querySelectorAll('.upload-option');
    const sortDropdown = document.querySelector('#sortDropdown');
    const sortTrigger = document.querySelector('#sortTrigger');
    const sortOptions = document.querySelectorAll('.sort-option');
    const searchInput = document.querySelector('#searchInput');
    const menuToggle = document.querySelector('#menuToggle');
    const headerMenu = document.querySelector('#headerMenu');
    const mapperPrompt = document.querySelector('#mapperPrompt');
    const songsDirPrompt = document.querySelector('#songsDirPrompt');
    const settingsDialog = document.querySelector('#settingsDialog');
    const settingsBtn = document.querySelector('#settingsBtn');
    const aboutDialog = document.querySelector('#aboutDialog');
    const aboutBtn = document.querySelector('#aboutBtn');
    const closeAboutBtn = document.querySelector('#closeAboutBtn');
    const tabButtons = document.querySelectorAll('.tab-button');
    const closeSettingsBtn = document.querySelector('#closeSettingsBtn');
    const changelogDialog = document.querySelector('#changelogDialog');
    const closeChangelogBtn = document.querySelector('#closeChangelogBtn');
    const versionIndicator = document.querySelector('#versionIndicator');
    const selectSongsDirBtn = document.querySelector('#selectSongsDirBtn');
    const rescanNameInput = document.getElementById('rescanMapperName');

    // UI State Loading
    const loadSettings = () => {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (raw) {
            try {
                settings = { ...settings, ...JSON.parse(raw) };
                const height = settings.listItemHeight || 240;
                VIRTUAL_ITEM_HEIGHT = height + 12;
                document.documentElement.style.setProperty('--list-item-height', `${height}px`);
                document.documentElement.style.setProperty('--title-lines', height > 160 ? 4 : 2);
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

    const updateSettingsUI = () => {
        const autoDetect = document.querySelector('#autoDetectMaps');
        const autoRescan = document.querySelector('#autoRescanMapper');
        const rescanName = document.querySelector('#rescanMapperName');
        const dirLabel = document.querySelector('#songsDirLabel');

        if (autoDetect) autoDetect.checked = settings.autoDetectMaps;
        if (autoRescan) autoRescan.checked = settings.autoRescanMapper;
        if (rescanName) {
            const rescanWrapper = rescanName.closest('.settings-item');
            rescanName.value = settings.rescanMapperName || '';
            // Keep the stored name for display, but disable the input when auto-detect is enabled.
            rescanName.disabled = !!settings.autoDetectMaps;
            if (settings.autoDetectMaps) {
                rescanName.setAttribute('aria-disabled', 'true');
                if (rescanWrapper) rescanWrapper.classList.add('is-disabled');
            } else {
                rescanName.removeAttribute('aria-disabled');
                if (rescanWrapper) rescanWrapper.classList.remove('is-disabled');
            }
        }
        if (dirLabel) dirLabel.textContent = settings.songsDir || 'Not selected';

        const ignoreStartAndBreaks = document.querySelector('#ignoreStartAndBreaks');
        const ignoreGuests = document.querySelector('#ignoreGuestDifficulties');
        if (ignoreStartAndBreaks) ignoreStartAndBreaks.checked = settings.ignoreStartAndBreaks;
        if (ignoreGuests) ignoreGuests.checked = settings.ignoreGuestDifficulties;

        const volumeSlider = document.querySelector('#previewVolume');
        if (volumeSlider) volumeSlider.value = settings.volume ?? 0.5;
        if (volumeValue) volumeValue.textContent = `${Math.round((settings.volume ?? 0.5) * 100)}%`;

        const heightSlider = document.querySelector('#listItemHeightSlider');
        const heightValue = document.querySelector('#listItemHeightValue');
        if (heightSlider) heightSlider.value = settings.listItemHeight ?? 240;
        if (heightValue) heightValue.textContent = `${settings.listItemHeight ?? 240}px`;

        // Update user ID display
        const userIdValue = document.querySelector('#userIdValue');
        if (userIdValue) userIdValue.textContent = settings.userId || 'Not generated';

        // Update embed settings
        const apiKeyValue = document.querySelector('#apiKeyValue');
        if (apiKeyValue) apiKeyValue.textContent = settings.embedApiKey || 'Not generated';

        const embedUrlValue = document.querySelector('#embedUrlValue');
        if (embedUrlValue) {
            embedUrlValue.textContent = settings.userId
                ? `${settings.embedSyncUrl}/embed/${settings.userId}`
                : 'Generate user ID first';
        }

        const embedLastSynced = document.querySelector('#embedLastSynced');
        if (embedLastSynced) {
            if (settings.embedLastSynced) {
                const date = new Date(settings.embedLastSynced);
                embedLastSynced.textContent = `Last synced: ${date.toLocaleString()}`;
            } else {
                embedLastSynced.textContent = 'Not synced yet';
            }
        }

        // Embed toggles
        const embedShowTodoList = document.querySelector('#embedShowTodoList');
        const embedShowCompletedList = document.querySelector('#embedShowCompletedList');
        const embedShowProgressStats = document.querySelector('#embedShowProgressStats');

        if (embedShowTodoList) embedShowTodoList.checked = settings.embedShowTodoList;
        if (embedShowCompletedList) embedShowCompletedList.checked = settings.embedShowCompletedList;
        if (embedShowProgressStats) embedShowProgressStats.checked = settings.embedShowProgressStats;
    };

    // Tab Listeners
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            if (tab === viewMode) return;
            viewMode = tab;
            tabButtons.forEach(b => b.classList.toggle('is-active', b.dataset.tab === viewMode));
            renderFromState();
        });
    });

    // Upload Listeners
    if (uploadButton) uploadButton.addEventListener('click', loadBeatmapFromDialog);
    if (uploadMenuToggle && uploadDropdown) {
        uploadMenuToggle.addEventListener('click', () => {
            const isOpen = uploadDropdown.classList.toggle('is-open');
            uploadMenuToggle.setAttribute('aria-expanded', String(isOpen));
        });
    }
    uploadOptions.forEach(option => {
        option.addEventListener('click', () => {
            if (uploadDropdown && uploadMenuToggle) {
                uploadDropdown.classList.remove('is-open');
                uploadMenuToggle.setAttribute('aria-expanded', 'false');
            }
            const type = option.dataset.upload;
            if (type === 'mapper') loadBeatmapsByMapper();
            else if (type === 'folder') loadBeatmapsFromFolder();
        });
    });

    // Sort Listeners
    if (sortTrigger && sortDropdown) {
        sortTrigger.addEventListener('click', () => {
            const isOpen = sortDropdown.classList.toggle('is-open');
            sortTrigger.setAttribute('aria-expanded', String(isOpen));
        });
    }
    sortOptions.forEach(option => {
        option.addEventListener('click', () => {
            const mode = option.dataset.sort;
            if (sortState.mode === mode) {
                sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                sortState.mode = mode;
                sortState.direction = 'desc';
            }
            updateSortUI();
            renderFromState();
        });
    });

    const updateVersionLabels = async () => {
        if (!window.appInfo?.getVersion) return null;
        try {
            const version = await window.appInfo.getVersion();
            const aboutVersionEl = document.querySelector('#aboutVersion');
            if (aboutVersionEl) aboutVersionEl.textContent = `v${version}`;
            const changelogVersionEl = document.querySelector('#changelogVersionTag');
            if (changelogVersionEl) changelogVersionEl.textContent = `v${version}`;
            return version;
        } catch (err) {
            console.error('Failed to fetch app version:', err);
            return null;
        }
    };

    // About Listeners
    if (aboutBtn && aboutDialog) {
        aboutBtn.addEventListener('click', async () => {
            await updateVersionLabels();
            aboutDialog.showModal();
        });
    }
    if (closeAboutBtn && aboutDialog) {
        closeAboutBtn.addEventListener('click', () => closeDialogWithAnimation(aboutDialog));
    }
    if (aboutDialog) {
        aboutDialog.addEventListener('click', (event) => {
            if (event.target === aboutDialog) {
                closeDialogWithAnimation(aboutDialog);
            }
        });
    }

    // Changelog Listeners
    const showChangelog = async () => {
        if (!changelogDialog) return;
        await updateVersionLabels();
        changelogDialog.showModal();
    };

    if (closeChangelogBtn && changelogDialog) {
        closeChangelogBtn.addEventListener('click', () => closeDialogWithAnimation(changelogDialog));
    }
    if (changelogDialog) {
        changelogDialog.addEventListener('click', (event) => {
            if (event.target === changelogDialog) {
                closeDialogWithAnimation(changelogDialog);
            }
        });
    }
    if (versionIndicator) {
        versionIndicator.addEventListener('click', showChangelog);
    }

    // Settings Listeners
    if (settingsBtn && settingsDialog) {
        settingsBtn.addEventListener('click', () => {
            updateSettingsUI();
            settingsDialog.showModal();
        });
    }
    if (closeSettingsBtn && settingsDialog) {
        closeSettingsBtn.addEventListener('click', () => closeDialogWithAnimation(settingsDialog));
    }
    if (settingsDialog) {
        settingsDialog.addEventListener('click', (event) => {
            if (event.target === settingsDialog) {
                closeDialogWithAnimation(settingsDialog);
            }
        });
    }

    // User ID copy functionality
    const userIdDisplay = document.querySelector('#userIdDisplay');
    if (userIdDisplay) {
        const copyUserId = async () => {
            if (settings.userId) {
                try {
                    await navigator.clipboard.writeText(settings.userId);
                    // Visual feedback
                    userIdDisplay.classList.add('copied');
                    setTimeout(() => userIdDisplay.classList.remove('copied'), 1500);
                } catch (e) {
                    console.error('Failed to copy user ID:', e);
                }
            }
        };
        userIdDisplay.addEventListener('click', copyUserId);
        userIdDisplay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                copyUserId();
            }
        });
    }

    // API Key copy functionality
    const apiKeyDisplay = document.querySelector('#apiKeyDisplay');
    if (apiKeyDisplay) {
        const copyApiKey = async () => {
            if (settings.embedApiKey) {
                try {
                    await navigator.clipboard.writeText(settings.embedApiKey);
                    apiKeyDisplay.classList.add('copied');
                    setTimeout(() => apiKeyDisplay.classList.remove('copied'), 1500);
                } catch (e) {
                    console.error('Failed to copy API key:', e);
                }
            }
        };
        apiKeyDisplay.addEventListener('click', copyApiKey);
        apiKeyDisplay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                copyApiKey();
            }
        });
    }

    // Embed URL copy functionality
    const embedUrlDisplay = document.querySelector('#embedUrlDisplay');
    if (embedUrlDisplay) {
        const copyEmbedUrl = async () => {
            if (settings.userId) {
                const url = `${settings.embedSyncUrl}/embed/${settings.userId}`;
                try {
                    await navigator.clipboard.writeText(url);
                    embedUrlDisplay.classList.add('copied');
                    setTimeout(() => embedUrlDisplay.classList.remove('copied'), 1500);
                } catch (e) {
                    console.error('Failed to copy embed URL:', e);
                }
            }
        };
        embedUrlDisplay.addEventListener('click', copyEmbedUrl);
        embedUrlDisplay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                copyEmbedUrl();
            }
        });
    }

    // Embed sync now button
    const embedSyncNowBtn = document.querySelector('#embedSyncNowBtn');
    if (embedSyncNowBtn) {
        embedSyncNowBtn.addEventListener('click', triggerManualSync);
    }

    // Embed settings toggles
    ['embedShowTodoList', 'embedShowCompletedList', 'embedShowProgressStats'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                settings[id] = e.target.checked;
                saveSettings();
            });
        }
    });

    if (selectSongsDirBtn) {
        selectSongsDirBtn.addEventListener('click', async () => {
            if (window.beatmapApi?.selectDirectory) {
                const dir = await window.beatmapApi.selectDirectory();
                if (dir) {
                    settings.songsDir = dir;
                    saveSettings();
                    updateSettingsUI();
                }
            }
        });
    }

    // Generic Setting Toggles
    ['autoDetectMaps', 'autoRescanMapper', 'ignoreStartAndBreaks', 'ignoreGuestDifficulties'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                const checked = e.target.checked;
                const prevAutoDetect = !!settings.autoDetectMaps;
                const prevAutoRescan = !!settings.autoRescanMapper;

                // Make the two startup toggles mutually exclusive: when one is enabled, disable the other.
                if (id === 'autoDetectMaps' && checked) {
                    settings.autoRescanMapper = false;
                    const otherEl = document.getElementById('autoRescanMapper');
                    if (otherEl) otherEl.checked = false;
                } else if (id === 'autoRescanMapper' && checked) {
                    settings.autoDetectMaps = false;
                    const otherEl = document.getElementById('autoDetectMaps');
                    if (otherEl) otherEl.checked = false;
                }

                settings[id] = checked;
                saveSettings();
                // Reflect updated UI state immediately (disables mapper input if needed)
                try { updateSettingsUI(); } catch (e) { }

                // If we just switched from detecting all maps to rescan-by-mapper,
                // clear the current list and perform a mapper-only rescan immediately.
                if (id === 'autoRescanMapper' && checked && prevAutoDetect) {
                    // Preserve known durations/highlights before clearing the visible list
                    const preserved = new Map();
                    beatmapItems.forEach(item => {
                        if (item && item.filePath && typeof item.durationMs === 'number') preserved.set(item.filePath, item);
                    });

                    // Clear visible list and model (preserve todo/completed lists)
                    beatmapItems = [];
                    updateTabCounts();
                    if (listContainer) listContainer.innerHTML = '';
                    updateEmptyState(listContainer);
                    scheduleSave();

                    // Only trigger a rescan if we have an effective mapper and a songs dir
                    const mapper = getEffectiveMapperName();
                    const targetDir = settings.songsDir || lastScannedDirectory;
                    if (mapper && targetDir && window.beatmapApi?.scanDirectoryOsuFiles) {
                        (async () => {
                            try {
                                const knownFiles = {};
                                preserved.forEach((item, filePath) => {
                                    if (item && typeof item.dateModified === 'number') knownFiles[filePath] = item.dateModified;
                                });
                                const scanDone = startStreamingScan(preserved);
                                await window.beatmapApi.scanDirectoryOsuFiles(targetDir, mapper, knownFiles);
                                await scanDone;
                            } catch (err) {
                                console.error('Mapper rescan after toggle failed:', err);
                                streamingScanState = null;
                                setLoading(false);
                            }
                        })();
                    }
                }

                // If we just switched from mapper-only scanning to detect-all,
                // clear the current list and perform a full folder rescan immediately.
                if (id === 'autoDetectMaps' && checked && prevAutoRescan) {
                    // Preserve known durations/highlights before clearing the visible list
                    const preserved = new Map();
                    beatmapItems.forEach(item => {
                        if (item && item.filePath && typeof item.durationMs === 'number') preserved.set(item.filePath, item);
                    });

                    // Clear visible list and model (preserve todo/completed lists)
                    beatmapItems = [];
                    updateTabCounts();
                    if (listContainer) listContainer.innerHTML = '';
                    updateEmptyState(listContainer);
                    scheduleSave();

                    const targetDir = settings.songsDir || lastScannedDirectory;
                    if (targetDir && window.beatmapApi?.scanDirectoryOsuFiles) {
                        (async () => {
                            try {
                                const knownFiles = {};
                                preserved.forEach((item, filePath) => {
                                    if (item && typeof item.dateModified === 'number') knownFiles[filePath] = item.dateModified;
                                });
                                const scanDone = startStreamingScan(preserved);
                                await window.beatmapApi.scanDirectoryOsuFiles(targetDir, null, knownFiles);
                                await scanDone;
                            } catch (err) {
                                console.error('Full rescan after toggle failed:', err);
                                streamingScanState = null;
                                setLoading(false);
                            }
                        })();
                    }
                }

                if (id === 'ignoreStartAndBreaks') {
                    beatmapItems = beatmapItems.map(item => ({
                        ...item,
                        progress: computeProgress(item.highlights)
                    }));
                    renderFromState();
                } else if (id === 'ignoreGuestDifficulties') {
                    updateTabCounts();
                    renderFromState();
                }
            });
        }
    });

    // Volume Slider Listener
    const volumeSlider = document.getElementById('previewVolume');
    const volumeValueText = document.getElementById('volumeValue');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            const vol = parseFloat(e.target.value);
            settings.volume = vol;
            if (volumeValueText) volumeValueText.textContent = `${Math.round(vol * 100)}%`;
            AudioController.updateVolume();
            saveSettings();
        });
    }

    // List Item Height Slider
    const heightSlider = document.getElementById('listItemHeightSlider');
    const heightValueText = document.getElementById('listItemHeightValue');
    if (heightSlider) {
        heightSlider.addEventListener('input', (e) => {
            const height = parseInt(e.target.value);
            settings.listItemHeight = height;
            VIRTUAL_ITEM_HEIGHT = height + 12; // Height + 12px gap
            if (heightValueText) heightValueText.textContent = `${height}px`;

            // Update CSS variables immediately
            document.documentElement.style.setProperty('--list-item-height', `${height}px`);
            document.documentElement.style.setProperty('--title-lines', height > 160 ? 4 : 2);

            saveSettings();
            // Re-render to update the virtual list heights and container total height
            renderFromState();
        });
    }

    // Rescan Mapper Name Input
    let rescanMapperTimer = null;
    if (rescanNameInput) {
        rescanNameInput.addEventListener('input', (e) => {
            settings.rescanMapperName = e.target.value.trim();
            saveSettings();

            if (rescanMapperTimer) clearTimeout(rescanMapperTimer);
            rescanMapperTimer = setTimeout(async () => {
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
                }
            }, 500);
        });
    }

    // Search and Main Menu
    if (searchInput) {
        searchInput.addEventListener('input', (event) => {
            searchQuery = event.target.value.trim();
            renderFromState();
        });
    }

    const setHeaderMenuOpen = (isOpen) => {
        if (!headerMenu || !menuToggle) {
            return;
        }
        headerMenu.classList.toggle('is-open', isOpen);
        menuToggle.setAttribute('aria-expanded', String(isOpen));
        if (!isOpen && sortDropdown) {
            sortDropdown.classList.remove('is-open');
            if (sortTrigger) {
                sortTrigger.setAttribute('aria-expanded', 'false');
            }
        }
    };

    if (menuToggle && headerMenu) {
        menuToggle.addEventListener('click', () => {
            const isOpen = !headerMenu.classList.contains('is-open');
            setHeaderMenuOpen(isOpen);
        });
    }

    document.addEventListener('click', (event) => {
        const target = event.target;
        const clickedSortTrigger = sortTrigger && sortTrigger.contains(target);
        const clickedMenuToggle = menuToggle && menuToggle.contains(target);
        const clickedUploadToggle = uploadMenuToggle && uploadMenuToggle.contains(target);
        const clickedSettingsBtn = settingsBtn && settingsBtn.contains(target);

        const isAnyDialogOpen = (settingsDialog && settingsDialog.open) || (mapperPrompt && mapperPrompt.open) || (aboutDialog && aboutDialog.open) || (changelogDialog && changelogDialog.open);

        if (isAnyDialogOpen) {
            return;
        }

        if (clickedSettingsBtn) {
            return;
        }

        if (sortDropdown && !sortDropdown.contains(target) && !clickedSortTrigger) {
            sortDropdown.classList.remove('is-open');
            if (sortTrigger) {
                sortTrigger.setAttribute('aria-expanded', 'false');
            }
        }
        if (uploadDropdown && !uploadDropdown.contains(target) && !clickedUploadToggle) {
            uploadDropdown.classList.remove('is-open');
            if (uploadMenuToggle) {
                uploadMenuToggle.setAttribute('aria-expanded', 'false');
            }
        }
        if (headerMenu && menuToggle && !headerMenu.contains(target) && !clickedMenuToggle) {
            setHeaderMenuOpen(false);
        }

        // Stop audio preview when clicking outside the timeline
        if (AudioController.currentId && !target.closest('.list-timeline') && !target.closest('#settingsDialog') && !target.closest('#settingsBtn')) {
            AudioController.stop();
        }
    });

    // Refresh Btn
    document.querySelector('#refreshBtn')?.addEventListener('click', () => {
        // Ensure any pending audio analysis resumes when the user clicks Refresh.
        try {
            if (Array.isArray(beatmapItems) && beatmapItems.length) {
                beatmapItems.forEach(item => {
                    if (item && item.audio && !item.durationMs) {
                        scheduleAudioAnalysis(item.id);
                    }
                });
            }
            try { processAudioQueue(); } catch (e) { /* swallow */ }
        } catch (e) {
            // non-fatal
        }

        refreshLastDirectory();
    });

    // Clear All
    if (clearAllButton && listContainer) {
        clearAllButton.addEventListener('click', async () => {
            const clearDialog = document.querySelector('#clearAllPrompt');
            if (!clearDialog) return;

            const confirmed = await new Promise((resolve) => {
                const cancelBtn = document.querySelector('#clearAllCancel');
                const confirmBtn = document.querySelector('#clearAllConfirm');

                const cleanup = async () => {
                    await closeDialogWithAnimation(clearDialog);
                    cancelBtn?.removeEventListener('click', onCancel);
                    clearDialog.removeEventListener('submit', onSubmit);
                    clearDialog.removeEventListener('cancel', onCancel);
                };

                const onCancel = async () => { await cleanup(); resolve(false); };
                const onSubmit = async (e) => {
                    e.preventDefault();
                    await cleanup();
                    resolve(true);
                };

                clearDialog.showModal();
                cancelBtn?.addEventListener('click', onCancel, { once: true });
                clearDialog.addEventListener('submit', onSubmit, { once: true });
                clearDialog.addEventListener('cancel', onCancel, { once: true });
            });

            if (!confirmed) return;

            // Keep todoIds and doneIds so they persist across rescans
            beatmapItems = [];
            updateTabCounts();
            listContainer.innerHTML = '';
            updateEmptyState(listContainer);
            renderFromState();
            saveToStorage();
        });
    }

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
            if (!dropId || dropId === draggedId) {
                return;
            }

            const fromIndex = todoIds.indexOf(draggedId);
            const toIndex = todoIds.indexOf(dropId);
            if (fromIndex === -1 || toIndex === -1) {
                return;
            }

            const [movedItem] = todoIds.splice(fromIndex, 1);
            todoIds.splice(toIndex, 0, movedItem);
            scheduleSave();
            renderFromState();
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

        listContainer.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('pointermove', handlePointerMove, { passive: false });
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerUp);
    }

    // Virtual Scroll Sync — debounced via rAF to avoid redundant work
    let scrollRAF = null;
    const debouncedSync = () => {
        if (scrollRAF) return;
        scrollRAF = requestAnimationFrame(() => {
            scrollRAF = null;
            syncVirtualList();
        });
    };
    window.addEventListener('scroll', debouncedSync, { passive: true });
    window.addEventListener('resize', debouncedSync, { passive: true });


    // Force-save on app close so audio durations and state are never lost
    window.addEventListener('beforeunload', () => {
        if (saveTimer) {
            window.clearTimeout(saveTimer);
            saveTimer = null;
        }
        saveToStorage();
        persistAudioAnalysisState();
    });

    // Startup sequence
    loadSettings();
    await initScanEventListeners();
    await loadFromStorage();

    initEventDelegation();
    updateSortUI();
    renderFromState();

    // First run wizard
    // On very first launch, offer a choice: import all maps or only maps by a mapper.
    // If user chooses all -> show songs directory prompt only.
    // If user chooses mapper -> show songs directory prompt, then mapper name prompt.
    if (!settings.initialSetupDone) {
        const welcomeDialog = document.querySelector('#welcomePrompt');
        const firstRunDialog = document.querySelector('#firstRunPrompt');
        const songsDirDialog = document.querySelector('#songsDirPrompt');
        const mapperDialog = document.querySelector('#mapperPrompt');

        // Show welcome greeting first
        if (welcomeDialog) {
            await new Promise((resolve) => {
                const continueBtn = document.querySelector('#welcomeContinueBtn');
                const onContinue = async () => {
                    await closeDialogWithAnimation(welcomeDialog);
                    resolve();
                };
                welcomeDialog.showModal();
                continueBtn?.addEventListener('click', onContinue, { once: true });
                welcomeDialog.addEventListener('cancel', (e) => { e.preventDefault(); }, { once: true });
            });
        }

        if (firstRunDialog) {
            const choice = await new Promise((resolve) => {
                const allBtn = document.querySelector('#firstRunAllBtn');
                const mapperBtn = document.querySelector('#firstRunMapperBtn');

                const cleanup = async () => {
                    await closeDialogWithAnimation(firstRunDialog);
                    allBtn?.removeEventListener('click', onAll);
                    mapperBtn?.removeEventListener('click', onMapper);
                    firstRunDialog.removeEventListener('cancel', onCancel);
                };

                const onAll = async () => { await cleanup(); resolve('all'); };
                const onMapper = async () => { await cleanup(); resolve('mapper'); };
                const onCancel = async () => { await cleanup(); resolve(null); };

                firstRunDialog.showModal();
                allBtn?.addEventListener('click', onAll, { once: true });
                mapperBtn?.addEventListener('click', onMapper, { once: true });
                firstRunDialog.addEventListener('cancel', onCancel, { once: true });
            });

            // If user explicitly chose an option, mark setup done and follow flow
            if (choice === 'all') {
                settings.initialSetupDone = true;
                settings.initialImportChoice = 'all';
                saveSettings();

                // Prompt for songs dir only
                if (!settings.songsDir && window.beatmapApi?.selectDirectory && songsDirDialog) {
                    await new Promise((resolve) => {
                        const cancelBtn = document.querySelector('#songsDirPromptCancel');
                        songsDirDialog.showModal();

                        const onCancel = async () => {
                            await closeDialogWithAnimation(songsDirDialog);
                            cleanup();
                            resolve();
                        };

                        const onSubmit = async (event) => {
                            event.preventDefault();
                            await closeDialogWithAnimation(songsDirDialog);

                            // Small delay for focus/animation
                            await new Promise(r => setTimeout(r, 400));
                            const dir = await window.beatmapApi.selectDirectory();
                            if (dir) {
                                settings.songsDir = dir;
                                saveSettings();
                                updateSettingsUI();
                            }
                            cleanup();
                            resolve();
                        };

                        const cleanup = () => {
                            cancelBtn?.removeEventListener('click', onCancel);
                            songsDirDialog.removeEventListener('submit', onSubmit);
                            songsDirDialog.removeEventListener('cancel', onCancel);
                        };

                        cancelBtn?.addEventListener('click', onCancel, { once: true });
                        songsDirDialog.addEventListener('submit', onSubmit, { once: true });
                        songsDirDialog.addEventListener('cancel', onCancel, { once: true });
                    });
                }

                if (settings.songsDir) await refreshLastDirectory();
            } else if (choice === 'mapper') {
                settings.initialSetupDone = true;
                settings.initialImportChoice = 'mapper';
                saveSettings();

                // Ask for songs directory first
                if (!settings.songsDir && window.beatmapApi?.selectDirectory && songsDirDialog) {
                    await new Promise((resolve) => {
                        const cancelBtn = document.querySelector('#songsDirPromptCancel');
                        songsDirDialog.showModal();

                        const onCancel = async () => {
                            await closeDialogWithAnimation(songsDirDialog);
                            cleanup();
                            resolve();
                        };

                        const onSubmit = async (event) => {
                            event.preventDefault();
                            await closeDialogWithAnimation(songsDirDialog);

                            // Small delay for focus/animation
                            await new Promise(r => setTimeout(r, 400));
                            const dir = await window.beatmapApi.selectDirectory();
                            if (dir) {
                                settings.songsDir = dir;
                                saveSettings();
                                updateSettingsUI();
                            }
                            cleanup();
                            resolve();
                        };

                        const cleanup = () => {
                            cancelBtn?.removeEventListener('click', onCancel);
                            songsDirDialog.removeEventListener('submit', onSubmit);
                            songsDirDialog.removeEventListener('cancel', onCancel);
                        };

                        cancelBtn?.addEventListener('click', onCancel, { once: true });
                        songsDirDialog.addEventListener('submit', onSubmit, { once: true });
                        songsDirDialog.addEventListener('cancel', onCancel, { once: true });
                    });
                }

                // Then ask for mapper name
                if (!settings.rescanMapperName && mapperDialog) {
                    await new Promise((resolve) => {
                        const input = document.querySelector('#mapperNameInput');
                        const cancelBtn = document.querySelector('#mapperPromptCancel');

                        input.value = '';
                        mapperDialog.showModal();
                        input.focus();

                        const cleanup = async () => {
                            await closeDialogWithAnimation(mapperDialog);
                            cancelBtn?.removeEventListener('click', onCancel);
                            mapperDialog.removeEventListener('submit', onSubmit);
                            mapperDialog.removeEventListener('cancel', onCancel);
                            resolve();
                        };

                        const onCancel = async () => { await cleanup(); };
                        const onSubmit = async (event) => {
                            event.preventDefault();
                            const value = input.value.trim();
                            if (value) {
                                settings.rescanMapperName = value;
                                saveSettings();
                                updateSettingsUI();
                            }
                            await cleanup();
                        };

                        cancelBtn?.addEventListener('click', onCancel, { once: true });
                        mapperDialog.addEventListener('submit', onSubmit, { once: true });
                        mapperDialog.addEventListener('cancel', onCancel, { once: true });
                    });
                }

                if (settings.songsDir && settings.rescanMapperName) {
                    await refreshLastDirectory();
                }
            }
        }
    }
    if (!settings.rescanMapperName || !settings.songsDir) {
        if (!settings.rescanMapperName && settings.initialImportChoice !== 'all') {
            await new Promise((resolve) => {
                const dialog = mapperPrompt;
                const input = document.querySelector('#mapperNameInput');
                const label = dialog?.querySelector('.prompt-dialog-label');
                const cancelBtn = document.querySelector('#mapperPromptCancel');

                if (!dialog || !input) {
                    resolve();
                    return;
                }

                if (label) label.textContent = 'Enter your default mapper name:';
                input.value = '';
                dialog.showModal();
                input.focus();

                const cleanup = async () => {
                    await closeDialogWithAnimation(dialog);
                    cancelBtn?.removeEventListener('click', onCancel);
                    dialog.removeEventListener('submit', onSubmit);
                    dialog.removeEventListener('cancel', onCancel);
                    if (label) label.textContent = 'Enter the mapper name:';
                    resolve();
                };

                const onCancel = async () => { await cleanup(); };
                const onSubmit = async (event) => {
                    event.preventDefault();
                    const value = input.value.trim();
                    if (value) {
                        settings.rescanMapperName = value;
                        saveSettings();
                        updateSettingsUI();
                    }
                    await cleanup();
                };

                cancelBtn?.addEventListener('click', onCancel, { once: true });
                dialog.addEventListener('submit', onSubmit, { once: true });
                dialog.addEventListener('cancel', onCancel, { once: true });
            });
        }
        if (!settings.songsDir && window.beatmapApi?.selectDirectory) {
            await new Promise((resolve) => {
                const dialog = songsDirPrompt;
                const cancelBtn = document.querySelector('#songsDirPromptCancel');

                if (!dialog) {
                    resolve();
                    return;
                }

                dialog.showModal();

                const cleanup = async () => {
                    await closeDialogWithAnimation(dialog);
                    cancelBtn?.removeEventListener('click', onCancel);
                    dialog.removeEventListener('submit', onSubmit);
                    dialog.removeEventListener('cancel', onCancel);
                    resolve();
                };

                const onCancel = async () => { await cleanup(); };
                const onSubmit = async (event) => {
                    event.preventDefault();
                    await cleanup();

                    // Small delay before opening native explorer for focus/animation reasons
                    await new Promise(r => setTimeout(r, 400));
                    const dir = await window.beatmapApi.selectDirectory();
                    if (dir) {
                        settings.songsDir = dir;
                        saveSettings();
                        updateSettingsUI();
                    }
                };

                cancelBtn?.addEventListener('click', onCancel, { once: true });
                dialog.addEventListener('submit', onSubmit, { once: true });
                dialog.addEventListener('cancel', onCancel, { once: true });
            });
        }
        if (settings.rescanMapperName && settings.songsDir) {
            await refreshLastDirectory();
        }
    }

    // Check for updates in the background
    checkForUpdates();

    // Show changelog on first startup after an update
    if (window.appInfo?.getVersion) {
        try {
            const currentVersion = await window.appInfo.getVersion();
            const lastSeenVersion = localStorage.getItem('mosu_lastSeenVersion');
            if (lastSeenVersion && lastSeenVersion !== currentVersion) {
                // Version changed since last run — show changelog
                showChangelog();
            }
            localStorage.setItem('mosu_lastSeenVersion', currentVersion);
        } catch (e) {
            // Non-fatal
        }
    }
};

const checkForUpdates = async () => {
    const indicator = document.getElementById('versionIndicator');
    if (!indicator || !window.appInfo?.checkForUpdates) return;

    try {
        const result = await window.appInfo.checkForUpdates();

        const current = (result.currentVersion || '').replace(/^v/, '');
        const latest = (result.latestVersion || '').replace(/^v/, '');

        // If we got an error or no latest version info, just show the current version
        if (result.error || !latest) {
            indicator.textContent = `v${current}`;
            indicator.dataset.tooltip = current ? `Current version: v${current}` : 'Could not check for updates';
            indicator.className = 'version-indicator up-to-date';
            indicator.style.display = '';
            return;
        }

        // Compare base versions (strip pre-release suffixes like -beta for comparison)
        const parseVer = (v) => {
            const parts = v.replace(/-.+$/, '').split('.').map(Number);
            return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
        };
        const cur = parseVer(current);
        const lat = parseVer(latest);

        // Check if current >= latest (accounting for pre-release: 0.3.0-beta is still 0.3.0)
        const isUpToDate = cur[0] > lat[0] ||
            (cur[0] === lat[0] && cur[1] > lat[1]) ||
            (cur[0] === lat[0] && cur[1] === lat[1] && cur[2] >= lat[2]);

        if (isUpToDate) {
            indicator.textContent = `v${current}`;
            indicator.dataset.tooltip = 'You are on the latest version';
            indicator.className = 'version-indicator up-to-date';
        } else {
            indicator.textContent = `v${latest} available`;
            indicator.dataset.tooltip = `Update available! Click to open download page (current: v${current})`;
            indicator.className = 'version-indicator update-available';
            indicator.onclick = () => {
                if (result.htmlUrl && window.appInfo?.openExternalUrl) {
                    window.appInfo.openExternalUrl(result.htmlUrl);
                }
            };
        }
        indicator.style.display = '';
    } catch {
        indicator.textContent = '?';
        indicator.dataset.tooltip = 'Could not check for updates';
        indicator.className = 'version-indicator error';
        indicator.style.display = '';
    }
};

document.addEventListener('DOMContentLoaded', init);

