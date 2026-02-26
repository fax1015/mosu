/**
 * Beatmap Parser Module
 * Handles parsing of .osu file content and related calculations
 * Extracted from renderer.js (lines 760-1167)
 */

// ============================================
// Section Parsers
// ============================================

/**
 * Parse .osu file metadata section
 * @param {string} content - Raw .osu file content
 * @returns {Object} Parsed metadata with title, artist, creator, etc.
 */
export const parseMetadata = (content) => {
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
            else if (key === 'mode') data.Mode = parseInt(value, 10);
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
        mode: Number.isFinite(data.Mode) ? Math.min(Math.max(data.Mode, 0), 3) : 0,
        audio: data.Audio || '',
    };
};

/**
 * Parse hit objects with timing calculations
 * @param {string} content - Raw .osu file content
 * @returns {Object} Object with hitStarts and hitEnds arrays
 */
export const parseHitObjects = (content) => {
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

/**
 * Parse beatmap data for playfield preview rendering
 * @param {string} content - Raw .osu file content
 * @param {{maxObjects?: number}} options - Parser options
 * @returns {{
 *   objects: Array<{
 *     x: number,
 *     y: number,
 *     time: number,
 *     endTime: number,
 *     kind: 'circle'|'slider'|'spinner'|'hold',
 *     hitSound: number,
 *     sliderPoints: Array<{x:number,y:number}>,
 *     sliderCurveType: string,
 *     slides: number,
 *     length: number,
 *     newCombo: boolean,
 *     comboSkip: number
 *   }>,
 *   circleSize: number,
 *   approachRate: number,
 *   overallDifficulty: number,
 *   stackLeniency: number,
 *   mode: number,
 *   sliderMultiplier: number,
 *   bpmMin: number,
 *   bpmMax: number,
 *   comboColours: Array<{r:number,g:number,b:number}>,
 *   maxObjectTime: number
 * }} Parsed preview data
 */
export const parseMapPreviewData = (content, options = {}) => {
    const maxObjects = Number.isFinite(options?.maxObjects) && options.maxObjects > 0
        ? Math.floor(options.maxObjects)
        : 8000;

    const timingPoints = [];
    const objects = [];

    let section = '';
    let sliderMultiplier = 1.0;
    let circleSize = 5;
    let approachRate = 5;
    let overallDifficulty = 5;
    let stackLeniency = 0.7;
    let mode = 0;

    const lines = content.split(/\r?\n/);

    const getTiming = (time) => {
        let activeBeatLength = 60000 / 120;
        let activeSv = 1.0;

        for (const tp of timingPoints) {
            if (tp.time > time) {
                break;
            }

            if (tp.uninherited && tp.beatLength > 0) {
                activeBeatLength = tp.beatLength;
                activeSv = 1.0;
            } else if (!tp.uninherited && tp.beatLength < 0) {
                activeSv = -100 / tp.beatLength;
            }
        }

        return { beatLength: activeBeatLength, sv: activeSv > 0 ? activeSv : 1.0 };
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) {
            continue;
        }

        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            section = trimmed.slice(1, -1).toLowerCase();
            continue;
        }

        if (section === 'general') {
            const sep = trimmed.indexOf(':');
            if (sep !== -1) {
                const key = trimmed.slice(0, sep).trim().toLowerCase();
                if (key === 'stackleniency') {
                    const value = parseFloat(trimmed.slice(sep + 1));
                    if (Number.isFinite(value)) {
                        stackLeniency = value;
                    }
                } else if (key === 'mode') {
                    const value = parseInt(trimmed.slice(sep + 1), 10);
                    if (Number.isFinite(value)) {
                        mode = value;
                    }
                }
            }
            continue;
        }

        if (section === 'difficulty') {
            const sep = trimmed.indexOf(':');
            if (sep === -1) {
                continue;
            }

            const key = trimmed.slice(0, sep).trim().toLowerCase();
            const value = parseFloat(trimmed.slice(sep + 1));
            if (!Number.isFinite(value)) {
                continue;
            }

            if (key === 'slidermultiplier') {
                sliderMultiplier = value || 1.0;
            } else if (key === 'circlesize') {
                circleSize = value;
            } else if (key === 'approachrate') {
                approachRate = value;
            } else if (key === 'overalldifficulty') {
                overallDifficulty = value;
            }
            continue;
        }

        if (section === 'timingpoints') {
            const parts = trimmed.split(',');
            if (parts.length < 2) {
                continue;
            }

            const time = parseInt(parts[0], 10);
            const beatLength = parseFloat(parts[1]);
            if (!Number.isFinite(time) || !Number.isFinite(beatLength)) {
                continue;
            }

            timingPoints.push({
                time,
                beatLength,
                uninherited: parts.length > 6 ? parts[6] === '1' : true
            });
            continue;
        }

        if (section !== 'hitobjects') {
            continue;
        }

        if (objects.length >= maxObjects) {
            continue;
        }

        const parts = trimmed.split(',');
        if (parts.length < 5) {
            continue;
        }

        const x = parseFloat(parts[0]);
        const y = parseFloat(parts[1]);
        const time = parseInt(parts[2], 10);
        const type = parseInt(parts[3], 10);
        const hitSound = parseInt(parts[4], 10);

        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(time) || !Number.isFinite(type)) {
            continue;
        }

        const isSlider = (type & 2) !== 0;
        const isSpinner = (type & 8) !== 0;
        const isHold = (type & 128) !== 0;
        const kind = isSlider ? 'slider' : (isSpinner ? 'spinner' : (isHold ? 'hold' : 'circle'));

        let endTime = time;
        let sliderPoints = [];
        let sliderCurveType = 'B';
        let slides = 1;
        let length = 0;

        if (isSlider) {
            if (parts.length >= 8) {
                const pathString = parts[5] || '';
                const firstToken = pathString.split('|')[0] || '';
                sliderCurveType = firstToken.trim().charAt(0).toUpperCase() || 'B';
                slides = parseInt(parts[6], 10) || 1;
                length = parseFloat(parts[7]) || 0;

                const timing = getTiming(time);
                const duration = (length / (sliderMultiplier * 100 * timing.sv)) * timing.beatLength * slides;
                endTime = time + Math.max(0, Math.round(duration));

                sliderPoints = parseSliderPath(pathString)
                    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
            }
        } else if (isSpinner) {
            endTime = parseInt(parts[5], 10) || time;
        } else if (isHold) {
            const holdData = parts[5] || '';
            endTime = parseInt(holdData.split(':')[0], 10) || time;
        }

        objects.push({
            x,
            y,
            time,
            endTime: Math.max(time, endTime),
            kind,
            hitSound: Number.isFinite(hitSound) ? hitSound : 0,
            sliderPoints,
            sliderCurveType,
            slides,
            length,
            newCombo: (type & 4) !== 0,
            comboSkip: (type >> 4) & 0b111
        });
    }

    let maxObjectTime = 0;
    for (const object of objects) {
        if (object.endTime > maxObjectTime) {
            maxObjectTime = object.endTime;
        }
    }

    let bpmMin = 0;
    let bpmMax = 0;
    const uninheritedBpms = timingPoints
        .filter((tp) => tp.uninherited && Number.isFinite(tp.beatLength) && tp.beatLength > 0)
        .map((tp) => 60000 / tp.beatLength)
        .filter((bpm) => Number.isFinite(bpm) && bpm > 0);

    if (uninheritedBpms.length > 0) {
        bpmMin = Math.min(...uninheritedBpms);
        bpmMax = Math.max(...uninheritedBpms);
    }

    return {
        objects,
        circleSize: Number.isFinite(circleSize) ? circleSize : 5,
        approachRate: Number.isFinite(approachRate) ? approachRate : (Number.isFinite(overallDifficulty) ? overallDifficulty : 5),
        overallDifficulty: Number.isFinite(overallDifficulty) ? overallDifficulty : 5,
        stackLeniency: Number.isFinite(stackLeniency) ? stackLeniency : 0.7,
        mode: Number.isFinite(mode) ? Math.min(Math.max(mode, 0), 3) : 0,
        sliderMultiplier: Number.isFinite(sliderMultiplier) ? sliderMultiplier : 1.0,
        bpmMin,
        bpmMax,
        comboColours: parseColours(content),
        maxObjectTime
    };
};

/**
 * Parse break periods from Events section
 * @param {string} content - Raw .osu file content
 * @returns {Array<{start: number, end: number}>} Array of break periods
 */
export const parseBreakPeriods = (content) => {
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

/**
 * Parse editor bookmarks
 * @param {string} content - Raw .osu file content
 * @returns {Array<number>} Array of bookmark timestamps
 */
export const parseBookmarks = (content) => {
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

/**
 * Extract audio filename from General section
 * @param {string} content - Raw .osu file content
 * @returns {string} Audio filename or empty string
 */
export const parseAudioFilename = (content) => {
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

/**
 * Extract background from Events section
 * @param {string} content - Raw .osu file content
 * @returns {string} Background filename or empty string
 */
export const parseBackgroundFilename = (content) => {
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

/**
 * Parse timing points for SR calculation
 * @param {string} content - Raw .osu file content
 * @returns {Array<{time: number, beatLength: number, uninherited: boolean}>} Timing points
 */
export const parseTimingPoints = (content) => {
    const timingPoints = [];
    let inTimingPoints = false;
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;

        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            inTimingPoints = trimmed === '[TimingPoints]';
            continue;
        }

        if (!inTimingPoints) continue;

        const parts = trimmed.split(',');
        if (parts.length >= 2) {
            timingPoints.push({
                time: parseInt(parts[0], 10),
                beatLength: parseFloat(parts[1]),
                uninherited: parts.length > 6 ? parts[6] === '1' : true
            });
        }
    }

    return timingPoints;
};

/**
 * Parse combo colors from Colours section
 * @param {string} content - Raw .osu file content
 * @returns {Array<{r: number, g: number, b: number}>} Array of RGB color objects
 */
export const parseColours = (content) => {
    const colours = [];
    let inColours = false;
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;

        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            inColours = trimmed.toLowerCase() === '[colours]';
            continue;
        }

        if (!inColours) continue;

        const match = trimmed.match(/^(Combo\d+)\s*:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/i);
        if (match) {
            colours.push({
                r: parseInt(match[2], 10),
                g: parseInt(match[3], 10),
                b: parseInt(match[4], 10)
            });
        }
    }

    return colours;
};

// ============================================
// Range Builders
// ============================================

/**
 * Build normalized highlight ranges
 * @param {Array<number>} starts - Array of start times
 * @param {Array<number>} ends - Array of end times
 * @param {number} durationMs - Total duration in milliseconds
 * @returns {Array<{start: number, end: number, type: string}>} Normalized ranges
 */
export const buildHighlightRanges = (starts, ends, durationMs) => {
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

/**
 * Normalize break periods
 * @param {Array<{start: number, end: number}>} breaks - Array of break periods
 * @param {number} durationMs - Total duration in milliseconds
 * @returns {Array<{start: number, end: number, type: string}>} Normalized break ranges
 */
export const buildBreakRanges = (breaks, durationMs) => {
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

/**
 * Normalize bookmarks
 * @param {Array<number>} bookmarks - Array of bookmark timestamps
 * @param {number} durationMs - Total duration in milliseconds
 * @returns {Array<{start: number, end: number, type: string}>} Normalized bookmark ranges
 */
export const buildBookmarkRanges = (bookmarks, durationMs) => {
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

// ============================================
// Timing and Calculation Utilities
// ============================================

/**
 * Calculate stack leniency based on circle size
 * @param {number} circleSize - Circle size (CS) value
 * @returns {number} Stack leniency in milliseconds
 */
export const calculateAutoStackLeniency = (circleSize) => {
    // Stack leniency is approximately 3 * (54.4 - 4.48 * CS) ms
    // This is the time window where objects are considered for stacking
    const radius = 54.4 - 4.48 * circleSize;
    return 3 * radius;
};

/**
 * Find nearest timing point
 * @param {number} time - Time in milliseconds
 * @param {Array<{time: number, beatLength: number, uninherited: boolean}>} timingPoints - Timing points array
 * @returns {{time: number, beatLength: number, uninherited: boolean}|null} Nearest timing point
 */
export const findNearestTimingPoint = (time, timingPoints) => {
    if (!timingPoints || timingPoints.length === 0) return null;

    let nearest = timingPoints[0];
    for (const tp of timingPoints) {
        if (tp.time > time) break;
        nearest = tp;
    }
    return nearest;
};

/**
 * Calculate BPM at specific time
 * @param {number} time - Time in milliseconds
 * @param {Array<{time: number, beatLength: number, uninherited: boolean}>} timingPoints - Timing points array
 * @returns {number} BPM value
 */
export const calculateBpmAt = (time, timingPoints) => {
    const tp = findNearestTimingPoint(time, timingPoints);
    if (!tp || !tp.beatLength) return 120; // Default BPM

    // beatLength is in milliseconds per beat
    // BPM = 60000 / beatLength
    return tp.uninherited ? 60000 / tp.beatLength : 0;
};

/**
 * Calculate slider duration
 * @param {Object} slider - Slider object with slides, length
 * @param {{beatLength: number, sv: number}} timingPoint - Timing point with beatLength and sv
 * @param {{sliderMultiplier: number}} beatmap - Beatmap with sliderMultiplier
 * @returns {number} Slider duration in milliseconds
 */
export const calculateSliderDuration = (slider, timingPoint, beatmap) => {
    const slides = slider.slides || 1;
    const length = slider.length || 0;
    const multiplier = beatmap?.sliderMultiplier || 1.0;
    const sv = timingPoint?.sv || 1.0;
    const beatLength = timingPoint?.beatLength || 500;

    // Duration = (length / (sliderMultiplier * 100 * sv)) * beatLength * slides
    return (length / (multiplier * 100 * sv)) * beatLength * slides;
};

/**
 * Parse slider path points
 * @param {string} pathString - Slider path string (e.g., "B|100:100|200:200|300:100")
 * @returns {Array<{x: number, y: number}>} Array of path points
 */
export const parseSliderPath = (pathString) => {
    if (!pathString) return [];

    const points = [];
    // Path format: type|x:y|x:y|...
    const parts = pathString.split('|');

    for (let i = 1; i < parts.length; i++) {
        const coords = parts[i].split(':');
        if (coords.length === 2) {
            points.push({
                x: parseFloat(coords[0]),
                y: parseFloat(coords[1])
            });
        }
    }

    return points;
};
