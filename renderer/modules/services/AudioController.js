/**
 * AudioController.js - Audio playback and playhead rendering service
 * Extracted from renderer.js (lines 3813-3996)
 */

import { beatmapApi } from '../bridge/Tauri.js';
import {
    beatmapItems,
    settings
} from '../state/Store.js';
import { resolveItemAssetPath } from '../utils/Helpers.js';
import { getAudioSourceUrl } from '../utils/AudioAssetLoader.js';
import { showNotification } from '../components/NotificationSystem.js';
import { applyTimelineToBox } from './TimelineRenderer.js';

// ============================================
// Audio Duration Helper
// ============================================

const getAudioDurationMs = async (filePath, fileNameHint = '') => {
    if (!filePath || !beatmapApi?.getAudioDuration) {
        return null;
    }

    try {
        // Use efficient Rust-side duration extraction (no full decode/PCM spike)
        const duration = await beatmapApi.getAudioDuration(filePath, fileNameHint);
        return duration || null;
    } catch (error) {
        console.error('Audio analysis failed:', error);
        return null;
    }
};

// ============================================
// Audio Controller Singleton
// ============================================

export const AudioController = {
    audio: new Audio(),
    currentItemId: null,
    isPlaying: false,
    pendingSeekPercentage: null,
    playheadCtx: null,
    playheadCanvas: null,
    playheadAnimation: null,

    /**
     * Initialize the audio controller
     */
    init() {
        this.audio.addEventListener('play', () => {
            this.isPlaying = true;
            this.startTick();
        });
        this.audio.addEventListener('loadedmetadata', () => {
            this._syncDurationFromAudio();
            this._applyPendingSeek();
        });
        this.audio.addEventListener('durationchange', () => {
            this._syncDurationFromAudio();
        });
        this.audio.addEventListener('pause', () => {
            this.isPlaying = false;
            this._stopTick();
        });
        this.audio.addEventListener('ended', () => {
            this.isPlaying = false;
            this._stopTick();
            this._clearPlayhead();
            this.audio.currentTime = 0;
            this.currentItemId = null;
            this.pendingSeekPercentage = null;
        });
        this.audio.addEventListener('error', (e) => {
            console.error('Audio playback error:', e);
            this.isPlaying = false;
            this._stopTick();
            this._clearPlayhead();
            this.currentItemId = null;
            this.pendingSeekPercentage = null;
            showNotification('Audio Error', 'Failed to play audio preview.', 'error');
        });
        this.updateVolume();
    },

    /**
     * Update volume from settings
     */
    updateVolume() {
        if (typeof settings.volume === 'number') {
            this.audio.volume = settings.volume;
        }
    },

    /**
     * Play audio for an item at a specific percentage
     * @param {string} itemId - Item ID to play
     * @param {number} [percentage] - Position percentage (0-1)
     * @param {Object} [callbacks] - Optional callbacks
     * @param {Function} callbacks.onEnd - Called when playback ends
     * @param {Function} callbacks.onStop - Called when playback stops
     */
    async play(itemId, percentage = null, callbacks = {}) {
        const item = beatmapItems.find(i => i.id === itemId);
        if (!item || !item.audio || !item.filePath) return;

        const audioPath = resolveItemAssetPath(item.filePath, item.audio);
        if (!audioPath) return;

        // Load audio source if switching items — use asset protocol for instant load
        if (this.currentItemId !== itemId) {
            // Clear playhead on the previous item's timeline
            if (this.currentItemId) {
                this._clearPlayhead();
                const prevEl = document.querySelector(`[data-item-id="${this.currentItemId}"]`);
                if (prevEl && callbacks.onStop) {
                    callbacks.onStop(this.currentItemId);
                }
            }
            this.currentItemId = itemId;
            this.pendingSeekPercentage = null;

            try {
                const audioSrc = await getAudioSourceUrl(audioPath, item.audioFileName);
                if (!audioSrc) {
                    return;
                }
                this.audio.src = audioSrc;
            } catch (err) {
                console.error('Failed to load audio source:', err);
                return;
            }
        }

        const effectiveDurationMs = this._getEffectiveDurationMs(item);
        if (percentage !== null && effectiveDurationMs) {
            this.audio.currentTime = percentage * (effectiveDurationMs / 1000);
            this.pendingSeekPercentage = null;
        } else if (percentage !== null) {
            this.pendingSeekPercentage = percentage;
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

    /**
     * Analyze audio duration in the background
     * @private
     * @param {Object} item - Beatmap item
     * @param {string} audioPath - Path to audio file
     * @param {number} [seekPercentage] - Position to seek after analysis
     */
    async _analyzeDurationInBackground(item, audioPath, seekPercentage) {
        try {
            const duration = await getAudioDurationMs(audioPath, item.audioFileName);
            if (duration) {
                item.durationMs = duration;
                item.progressPending = false;

                // If user clicked a specific position, now seek to it accurately
                if (seekPercentage !== null && this.currentItemId === item.id) {
                    this.audio.currentTime = seekPercentage * (duration / 1000);
                    this.pendingSeekPercentage = null;
                }
            }
        } catch (err) {
            // Non-fatal
        }
    },

    /**
     * Stop audio playback
     * @param {Object} [callbacks] - Optional callbacks
     * @param {Function} callbacks.onStop - Called when playback stops
     */
    stop(callbacks = {}) {
        if (this.currentItemId && callbacks.onStop) {
            callbacks.onStop(this.currentItemId);
        }
        this._clearPlayhead();
        this.audio.pause();
        this.audio.currentTime = 0;
        this.currentItemId = null;
        this.pendingSeekPercentage = null;
    },

    /**
     * Check if audio is currently playing
     * @returns {boolean} Whether audio is playing
     */
    isPlayingAudio() {
        return this.isPlaying;
    },

    /**
     * Get the currently playing item ID
     * @returns {string|null} Current item ID
     */
    getCurrentItemId() {
        return this.currentItemId;
    },

    /**
     * Start the playhead animation tick
     * @private
     */
    startTick() {
        this._stopTick();
        const tick = () => {
            if (!this.isPlaying || !this.currentItemId) return;
            this.drawPlayhead();
            this.playheadAnimation = requestAnimationFrame(tick);
        };
        this.playheadAnimation = requestAnimationFrame(tick);
    },

    /**
     * Draw the playhead on the timeline canvas
     */
    drawPlayhead() {
        if (!this.currentItemId) return;

        const el = document.querySelector(`[data-item-id="${this.currentItemId}"]`);
        if (!el) return;

        const canvas = el.querySelector('.list-timeline');
        if (!canvas) return;

        const item = beatmapItems.find(i => i.id === this.currentItemId);
        const durationMs = this._getEffectiveDurationMs(item);
        if (!item || !durationMs) return;

        const percentage = this.audio.currentTime / (durationMs / 1000);

        // Re-draw base timeline first (clears previous playhead)
        // Pass the item directly instead of using renderIndex to avoid wrong highlights
        applyTimelineToBox(el, item);

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
    },

    /**
     * Clear the playhead canvas by redrawing the base timeline
     * @private
     */
    _clearPlayhead() {
        if (!this.currentItemId) return;

        const el = document.querySelector(`[data-item-id="${this.currentItemId}"]`);
        if (!el) return;

        // Get the item and pass it directly to avoid wrong highlights
        const item = beatmapItems.find(i => i.id === this.currentItemId);
        applyTimelineToBox(el, item);
    },

    _stopTick() {
        if (!this.playheadAnimation) return;
        cancelAnimationFrame(this.playheadAnimation);
        this.playheadAnimation = null;
    },

    _getEffectiveDurationMs(item) {
        if (typeof item?.durationMs === 'number' && item.durationMs > 0) {
            return item.durationMs;
        }

        if (item?.id === this.currentItemId) {
            const mediaDurationMs = this._getLoadedAudioDurationMs();
            if (mediaDurationMs) {
                item.durationMs = mediaDurationMs;
                item.progressPending = false;
                return mediaDurationMs;
            }
        }

        return null;
    },

    _getLoadedAudioDurationMs() {
        const durationSeconds = Number(this.audio?.duration);
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
            return null;
        }

        return Math.round(durationSeconds * 1000);
    },

    _syncDurationFromAudio() {
        if (!this.currentItemId) {
            return null;
        }

        const item = beatmapItems.find(i => i.id === this.currentItemId);
        if (!item) {
            return null;
        }

        return this._getEffectiveDurationMs(item);
    },

    _applyPendingSeek() {
        if (this.pendingSeekPercentage === null) {
            return;
        }

        const item = beatmapItems.find(i => i.id === this.currentItemId);
        const durationMs = this._getEffectiveDurationMs(item);
        if (!durationMs) {
            return;
        }

        this.audio.currentTime = this.pendingSeekPercentage * (durationMs / 1000);
        this.pendingSeekPercentage = null;
    }
};

export default AudioController;
