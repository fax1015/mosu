/**
 * AudioController.js - Audio playback and playhead rendering service
 * Extracted from renderer.js (lines 3813-3996)
 */

import { beatmapApi } from '../bridge/Tauri.js';
import {
    beatmapItems,
    settings
} from '../state/Store.js';
import { getDirectoryPath } from '../utils/Helpers.js';
import { showNotification } from '../components/NotificationSystem.js';
import { applyTimelineToBox } from './TimelineRenderer.js';

// ============================================
// Audio Duration Helper
// ============================================

const getAudioDurationMs = async (filePath) => {
    if (!filePath || !beatmapApi?.getAudioDuration) {
        return null;
    }

    try {
        // Use efficient Rust-side duration extraction (no full decode/PCM spike)
        const duration = await beatmapApi.getAudioDuration(filePath);
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
    playheadCtx: null,
    playheadCanvas: null,
    playheadAnimation: null,

    /**
     * Initialize the audio controller
     */
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

        const folderPath = getDirectoryPath(item.filePath);
        const audioPath = `${folderPath}${item.audio}`;

        // Load audio source if switching items — use asset protocol for instant load
        if (this.currentItemId !== itemId) {
            // Clear playhead on the previous item's timeline
            if (this.currentItemId) {
                const prevEl = document.querySelector(`[data-item-id="${this.currentItemId}"]`);
                if (prevEl && callbacks.onStop) {
                    callbacks.onStop(this.currentItemId);
                }
            }
            this.currentItemId = itemId;

            // Revoke old blob URL if it was one
            if (this.audio.src && this.audio.src.startsWith('blob:')) {
                URL.revokeObjectURL(this.audio.src);
            }

            // Use convertFileSrc for direct loading (no IPC round-trip)
            if (beatmapApi?.convertFileSrc) {
                this.audio.src = beatmapApi.convertFileSrc(audioPath);
            } else {
                // Fallback: read binary through IPC
                try {
                    const binary = await beatmapApi.readBinary(audioPath);
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

    /**
     * Analyze audio duration in the background
     * @private
     * @param {Object} item - Beatmap item
     * @param {string} audioPath - Path to audio file
     * @param {number} [seekPercentage] - Position to seek after analysis
     */
    async _analyzeDurationInBackground(item, audioPath, seekPercentage) {
        try {
            const duration = await getAudioDurationMs(audioPath);
            if (duration) {
                item.durationMs = duration;

                // If user clicked a specific position, now seek to it accurately
                if (seekPercentage !== null && this.currentItemId === item.id) {
                    this.audio.currentTime = seekPercentage * (duration / 1000);
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
        const tick = () => {
            if (!this.isPlaying || !this.currentItemId) return;
            this.drawPlayhead();
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
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
        if (!item || !item.durationMs) return;

        const percentage = this.audio.currentTime / (item.durationMs / 1000);

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
    }
};

export default AudioController;
