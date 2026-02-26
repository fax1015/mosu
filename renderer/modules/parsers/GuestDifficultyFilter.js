/**
 * Guest Difficulty Filter Module
 * Handles filtering of guest difficulties based on mapper names
 * Extracted from renderer.js (lines 820-858)
 */

import { settings, updateSettings } from '../state/Store.js';
import { appInfo } from '../bridge/Tauri.js';

// ============================================
// Cached State
// ============================================

/** @type {Array<string>} Cached mapper needles for filtering */
let _cachedMapperNeedles = [];

// ============================================
// Core Functions
// ============================================

/**
 * Check if difficulty should be filtered as a guest difficulty
 * @param {string} content - Raw .osu file content
 * @param {Array<string>} mapperNeedles - Array of mapper name needles to check against
 * @returns {boolean} True if should be ignored as guest difficulty
 */
export const shouldIgnoreGuestDifficulty = (content, mapperNeedles) => {
    if (!mapperNeedles || mapperNeedles.length === 0) return false;

    try {
        // Parse metadata inline to avoid circular dependency
        const meta = parseMetadataQuick(content || '');
        if (!meta) return false;

        const creator = String(meta.creator || '').toLowerCase();
        const version = String(meta.version || '').toLowerCase();

        return mapperNeedles.some(mapper => {
            if (!creator.includes(mapper)) return false;
            // If it includes the mapper's name followed by 's, it's likely not a GUEST difficulty but their own
            if (version.includes(mapper + "'s") || version.includes(mapper + "s'")) return false;
            return version.includes("'s") || version.includes("s'");
        });
    } catch (e) {
        return false;
    }
};

/**
 * Check item against mapper needles (uses cached needles)
 * @param {Object} item - Beatmap item with creator and version
 * @param {Array<string>} mapperNeedles - Array of mapper name needles to check against
 * @returns {boolean} True if is a guest difficulty
 */
export const isGuestDifficultyItem = (item, mapperNeedles) => {
    if (!mapperNeedles || mapperNeedles.length === 0) return false;

    const creator = String(item?.creator || '').toLowerCase();
    const version = String(item?.version || '').toLowerCase();

    return mapperNeedles.some(mapper => {
        if (!creator.includes(mapper)) return false;
        // If it includes the mapper's name followed by 's, it's likely not a GUEST difficulty but their own
        if (version.includes(mapper + "'s") || version.includes(mapper + "s'")) return false;
        return version.includes("'s") || version.includes("s'");
    });
};

/**
 * Generate mapper name needles for filtering
 * @param {Object} settings - Settings object with mapperAliases and rescanMapperName
 * @param {Array<string>} settings.mapperAliases - Array of mapper aliases
 * @param {string} settings.rescanMapperName - Primary mapper name
 * @returns {Array<string>} Array of lowercase mapper name needles
 */
export const generateMapperNeedles = (settings) => {
    const needles = [];

    if (settings?.mapperAliases && Array.isArray(settings.mapperAliases)) {
        settings.mapperAliases.forEach(alias => {
            if (alias && alias.trim()) {
                needles.push(alias.trim().toLowerCase());
            }
        });
    }

    if (settings?.rescanMapperName && settings.rescanMapperName.trim()) {
        const primary = settings.rescanMapperName.trim().toLowerCase();
        if (!needles.includes(primary)) {
            needles.push(primary);
        }
    }

    // Cache the needles
    _cachedMapperNeedles = needles;
    return needles;
};

/**
 * Clear cached mapper needles
 */
export const clearMapperNeedlesCache = () => {
    _cachedMapperNeedles = [];
};

/**
 * Get cached mapper needles
 * @returns {Array<string>} Cached mapper needles
 */
export const getCachedMapperNeedles = () => {
    return _cachedMapperNeedles;
};

// ============================================
// Mapper Name Processing
// ============================================

/**
 * Process mapper input - handles osu! profile URLs and IDs
 * @param {string} value - Mapper name, URL, or ID
 * @returns {Promise<string|null>} Processed mapper name or null
 */
export const processMapperInput = async (value) => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    console.log('[mosu] Processing mapper input:', trimmed);

    // Check if it's an osu! user URL or a numeric ID
    const isUrl = trimmed.includes('osu.ppy.sh/users/') || trimmed.includes('osu.ppy.sh/u/');
    const isNumericId = /^\d+$/.test(trimmed);

    if (isUrl || isNumericId) {
        try {
            if (appInfo?.getOsuUserData) {
                console.log('[mosu] Fetching user data for profile link/ID...');
                const userData = await appInfo.getOsuUserData(trimmed);
                console.log('[mosu] Received user data:', userData);

                if (userData && userData.names && userData.names.length > 0) {
                    updateSettings({
                        mapperAliases: userData.names
                    });

                    // Return the primary name (first in the list)
                    const primaryName = userData.names[0];
                    console.log('[mosu] Using primary mapper name:', primaryName);
                    return primaryName;
                }
            }
        } catch (error) {
            console.error('[mosu] Failed to fetch osu! user data:', error);
            // Fall through to return trimmed value
        }
    }

    return trimmed;
};

/**
 * Returns the mapper name that should be used for backend operations
 * @returns {string} Effective mapper name
 */
export const getEffectiveMapperName = () => {
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

// ============================================
// Helper Functions
// ============================================

/**
 * Quick metadata parser for guest difficulty filtering
 * Only extracts creator and version, doesn't normalize
 * @param {string} content - Raw .osu file content
 * @returns {Object|null} Metadata object or null
 */
function parseMetadataQuick(content) {
    let inMetadata = false;
    const data = {};

    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) continue;

        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            inMetadata = trimmed === '[Metadata]';
            continue;
        }

        if (!inMetadata) continue;

        const sep = trimmed.indexOf(':');
        if (sep === -1) continue;

        const key = trimmed.slice(0, sep).trim().toLowerCase();
        const value = trimmed.slice(sep + 1).trim();

        if (key === 'creator') data.creator = value;
        else if (key === 'version') data.version = value;

        // Early exit if we have both
        if (data.creator !== undefined && data.version !== undefined) break;
    }

    return data.creator !== undefined || data.version !== undefined ? data : null;
}
