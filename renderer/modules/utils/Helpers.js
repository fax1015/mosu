/**
 * Get color for a star rating value
 * @param {number} rating - Star rating value
 * @returns {string} RGB color string
 */
export const getStarRatingColor = (rating) => {
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

/**
 * Generate a unique user ID for embed syncing
 * Format: msu + 6 lowercase alnum chars (9 chars total)
 * Includes extra letters in the suffix to avoid looking like numeric osu! profile IDs.
 * @returns {string} Stable-style user ID token
 */
export const generateUserId = () => {
    const prefix = 'msu';
    const suffixLength = 6;
    const letterAlphabet = 'abcdefghijklmnopqrstuvwxyz';
    const mixedAlphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const forcedLetterCount = 2;
    const chars = [];

    if (globalThis.crypto?.getRandomValues) {
        const randomBytes = new Uint8Array(suffixLength);
        globalThis.crypto.getRandomValues(randomBytes);
        for (let i = 0; i < randomBytes.length; i++) {
            const alphabet = i < forcedLetterCount ? letterAlphabet : mixedAlphabet;
            chars.push(alphabet[randomBytes[i] % alphabet.length]);
        }
        return prefix + chars.join('');
    }

    for (let i = 0; i < suffixLength; i++) {
        const alphabet = i < forcedLetterCount ? letterAlphabet : mixedAlphabet;
        chars.push(alphabet[Math.floor(Math.random() * alphabet.length)]);
    }
    return prefix + chars.join('');
};

/**
 * Format duration in milliseconds to MM:SS format
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration string
 */
export const formatDuration = (ms) => {
    if (typeof ms !== 'number' || isNaN(ms)) return '--:--';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Parse highlight ranges from a raw string
 * @param {string} raw - Raw highlight string (e.g., "0.1-0.5,0.7-0.9")
 * @returns {Array<{start: number, end: number}>} Array of highlight ranges
 */
export const parseHighlights = (raw) => {
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

/**
 * Get the directory path from a full file path
 * @param {string} filePath - Full file path
 * @returns {string} Directory path
 */
export const getDirectoryPath = (filePath) => {
    const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    if (lastSlash === -1) {
        return '';
    }
    return filePath.slice(0, lastSlash + 1);
};

/**
 * Create a unique item ID
 * @param {string} seed - Optional seed string for deterministic ID
 * @returns {string} Unique item ID
 */
export const createItemId = (seed) => {
    if (!seed) return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        const char = seed.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return 'id-' + Math.abs(hash).toString(36) + seed.length.toString(36);
};

/**
 * Get the maximum value in an array
 * @param {Array<number>} arr - Array of numbers
 * @returns {number} Maximum value or 0 if empty
 */
export const arrayMax = (arr) => {
    if (!arr || arr.length === 0) return 0;
    let max = arr[0];
    for (let i = 1; i < arr.length; i++) {
        if (arr[i] > max) max = arr[i];
    }
    return max;
};

/**
 * Compute progress from highlight ranges
 * @param {Array<{start: number, end: number, type?: string}>} ranges - Highlight ranges
 * @param {Object} settings - Settings object with ignoreStartAndBreaks option
 * @returns {number} Progress value between 0 and 1
 */
export const computeProgress = (ranges, settings = { ignoreStartAndBreaks: false }) => {
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

/**
 * Normalize metadata object with default values
 * @param {Object} metadata - Raw metadata object
 * @returns {Object} Normalized metadata object
 */
export const normalizeMetadata = (metadata) => ({
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
    mode: Number.isFinite(metadata?.mode) ? Math.min(Math.max(metadata.mode, 0), 3) : 0,
    deadline: metadata?.deadline ?? null,
    targetStarRating: metadata?.targetStarRating ?? null,
    starRating: (typeof metadata?.starRating === 'number' && Number.isFinite(metadata.starRating) && metadata.starRating > 0)
        ? metadata.starRating
        : null,
    notes: metadata?.notes || '',
});

/**
 * Serialize highlight ranges for storage
 * @param {Array<{start: number, end: number, type?: string}>} ranges - Highlight ranges
 * @returns {Array<[number, number, string]>} Serialized ranges
 */
export const serializeHighlights = (ranges) => ranges.map((range) => ([
    Number(range.start.toFixed(4)),
    Number(range.end.toFixed(4)),
    range.type === 'break' ? 'b' : (range.type === 'bookmark' ? 'k' : 'o'),
]));

/**
 * Deserialize highlight ranges from storage
 * @param {Array<[number, number, string]>} ranges - Serialized ranges
 * @returns {Array<{start: number, end: number, type: string}>} Deserialized ranges
 */
export const deserializeHighlights = (ranges) => ranges.map(([start, end, kind]) => ({
    start,
    end,
    type: kind === 'b' ? 'break' : (kind === 'k' ? 'bookmark' : 'object'),
}));

/**
 * Generate API key for embed sync
 * @returns {string} Generated API key
 */
export const generateApiKey = () => {
    return 'sk_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 20);
};
