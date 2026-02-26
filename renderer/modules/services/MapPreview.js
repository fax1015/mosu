/**
 * MapPreview.js - Bottom-right playfield preview popup
 */

import { beatmapApi } from '../bridge/Tauri.js';
import * as Store from '../state/Store.js';
import { parseMapPreviewData } from '../parsers/BeatmapParser.js';
import { showNotification } from '../components/NotificationSystem.js';
import { getDirectoryPath } from '../utils/Helpers.js';
import { renderTimeline } from './TimelineRenderer.js';

const OSU_PLAYFIELD_WIDTH = 512;
const OSU_PLAYFIELD_HEIGHT = 384;
const STACK_OFFSET_OSU = 5.2;
const DRAWN_CIRCLE_RADIUS_SCALE = 0.95;
const CIRCLE_POST_HIT_FADE_MS = 30;
const LONG_OBJECT_POST_HIT_FADE_MS = 70;

const DEFAULT_COMBO_COLOURS = [
    { r: 255, g: 102, b: 171 },
    { r: 92, g: 197, b: 255 },
    { r: 132, g: 255, b: 128 },
    { r: 255, g: 218, b: 89 }
];

const previewCache = new Map();

const MODE_LABELS = {
    0: 'osu!',
    1: 'taiko',
    2: 'catch',
    3: 'mania'
};

const state = {
    initialized: false,
    popup: null,
    closeBtn: null,
    playBtn: null,
    timeline: null,
    canvas: null,
    toggleIndicator: null,
    title: null,
    version: null,
    stats: null,
    timeLabel: null,
    item: null,
    mapData: null,
    currentTime: 0,
    totalDuration: 0,
    isPlaying: false,
    playbackMode: 'none',
    catcherRenderX: Number.NaN,
    catcherRenderTime: Number.NaN,
    audio: new Audio(),
    audioSyncEnabled: false,
    rafId: 0,
    lastTickMs: 0,
    loadToken: 0
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatTime = (timeMs) => {
    const safe = Math.max(0, Math.floor(timeMs || 0));
    const totalSeconds = Math.floor(safe / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const withAlpha = (color, alpha) => `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(alpha, 0, 1)})`;

const getApproachPreemptMs = (ar) => {
    const value = clamp(Number.isFinite(ar) ? ar : 5, 0, 11);
    if (value < 5) {
        return 1800 - (120 * value);
    }
    return 1200 - (150 * (value - 5));
};

const getCircleRadius = (cs) => {
    const value = clamp(Number.isFinite(cs) ? cs : 5, 0, 10);
    return 54.4 - 4.48 * value;
};

const drawReverseIndicator = (ctx, position, direction, size, alpha = 1) => {
    const length = Math.hypot(direction.x, direction.y);
    if (!Number.isFinite(length) || length <= 0.001) {
        return;
    }

    const nx = direction.x / length;
    const ny = direction.y / length;
    const px = -ny;
    const py = nx;

    const tipX = position.x + (nx * size * 0.7);
    const tipY = position.y + (ny * size * 0.7);
    const backX = position.x - (nx * size * 0.55);
    const backY = position.y - (ny * size * 0.55);
    const wing = size * 0.48;

    ctx.strokeStyle = `rgba(255, 255, 255, ${clamp(alpha, 0, 1)})`;
    ctx.lineWidth = Math.max(1.4, size * 0.16);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(backX + (px * wing), backY + (py * wing));
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(backX - (px * wing), backY - (py * wing));
    ctx.stroke();
};

const getObjectStackOffset = (object) => {
    if (!object || object.kind === 'spinner') {
        return { x: 0, y: 0 };
    }

    const stackIndex = Math.max(0, Number(object.stackIndex) || 0);
    if (stackIndex <= 0) {
        return { x: 0, y: 0 };
    }

    const offset = stackIndex * STACK_OFFSET_OSU;
    return { x: -offset, y: -offset };
};

const getObjectStartPositionOsu = (object) => {
    if (!object) {
        return { x: 0, y: 0 };
    }
    const stackOffset = getObjectStackOffset(object);
    return {
        x: object.x + stackOffset.x,
        y: object.y + stackOffset.y
    };
};

const applyPreviewStacking = (objects, approachRate, stackLeniency) => {
    if (!Array.isArray(objects) || objects.length === 0) {
        return;
    }

    const leniency = clamp(Number.isFinite(stackLeniency) ? stackLeniency : 0.7, 0, 2);
    const stackTimeThreshold = getApproachPreemptMs(approachRate) * leniency;
    const stackDistanceThreshold = 3;

    for (const object of objects) {
        object.stackIndex = 0;
        delete object._cachedSliderPathPoints;
        delete object._cachedSliderPathStackIndex;
    }

    for (let i = 1; i < objects.length; i++) {
        const object = objects[i];
        if (!object || object.kind === 'spinner') {
            continue;
        }

        let bestStack = 0;
        for (let j = i - 1; j >= 0; j--) {
            const previous = objects[j];
            if (!previous || previous.kind === 'spinner') {
                continue;
            }

            const dt = object.time - previous.time;
            if (dt > stackTimeThreshold) {
                break;
            }

            const dx = object.x - previous.x;
            const dy = object.y - previous.y;
            if (Math.hypot(dx, dy) <= stackDistanceThreshold) {
                bestStack = Math.max(bestStack, (previous.stackIndex || 0) + 1);
            }
        }

        object.stackIndex = bestStack;
    }
};

const clearPreviewStacking = (objects) => {
    if (!Array.isArray(objects)) {
        return;
    }
    for (const object of objects) {
        object.stackIndex = 0;
        delete object._cachedSliderPathPoints;
        delete object._cachedSliderPathStackIndex;
    }
};

const pointsEqual = (a, b, epsilon = 0.001) => (
    Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
);

const pointDistance = (a, b) => Math.hypot((b.x - a.x), (b.y - a.y));

const dedupeAdjacentPoints = (points, epsilon = 0.001) => {
    if (!Array.isArray(points) || points.length === 0) {
        return [];
    }
    const out = [points[0]];
    for (let i = 1; i < points.length; i++) {
        if (!pointsEqual(points[i], out[out.length - 1], epsilon)) {
            out.push(points[i]);
        }
    }
    return out;
};

const trimPathToLength = (points, targetLength) => {
    const cleanPoints = dedupeAdjacentPoints(points);
    if (cleanPoints.length < 2 || !Number.isFinite(targetLength) || targetLength <= 0) {
        return cleanPoints;
    }

    let remaining = targetLength;
    const trimmed = [cleanPoints[0]];
    for (let i = 1; i < cleanPoints.length; i++) {
        const start = cleanPoints[i - 1];
        const end = cleanPoints[i];
        const segmentLength = pointDistance(start, end);
        if (segmentLength <= 0) {
            continue;
        }

        if (remaining >= segmentLength) {
            trimmed.push(end);
            remaining -= segmentLength;
            continue;
        }

        const t = clamp(remaining / segmentLength, 0, 1);
        trimmed.push({
            x: start.x + ((end.x - start.x) * t),
            y: start.y + ((end.y - start.y) * t)
        });
        return dedupeAdjacentPoints(trimmed);
    }

    return dedupeAdjacentPoints(trimmed);
};

const evaluateBezierPoint = (controlPoints, t) => {
    const temp = controlPoints.map((point) => ({ x: point.x, y: point.y }));
    for (let order = temp.length - 1; order > 0; order--) {
        for (let i = 0; i < order; i++) {
            temp[i].x += (temp[i + 1].x - temp[i].x) * t;
            temp[i].y += (temp[i + 1].y - temp[i].y) * t;
        }
    }
    return temp[0];
};

const sampleBezierSegment = (controlPoints) => {
    if (!Array.isArray(controlPoints) || controlPoints.length < 2) {
        return [];
    }

    let estimate = 0;
    for (let i = 1; i < controlPoints.length; i++) {
        estimate += pointDistance(controlPoints[i - 1], controlPoints[i]);
    }

    const steps = Math.max(8, Math.min(96, Math.ceil(estimate / 6)));
    const sampled = [];
    for (let i = 0; i <= steps; i++) {
        sampled.push(evaluateBezierPoint(controlPoints, i / steps));
    }
    return sampled;
};

const sampleBezierPath = (pathPoints) => {
    if (!Array.isArray(pathPoints) || pathPoints.length < 2) {
        return pathPoints || [];
    }

    const segments = [];
    let current = [pathPoints[0]];

    for (let i = 1; i < pathPoints.length; i++) {
        const point = pathPoints[i];
        current.push(point);

        if (i < pathPoints.length - 1 && pointsEqual(point, pathPoints[i + 1])) {
            if (current.length >= 2) {
                segments.push(current);
            }
            current = [point];
            i += 1;
        }
    }

    if (current.length >= 2) {
        segments.push(current);
    }

    if (!segments.length) {
        return dedupeAdjacentPoints(pathPoints);
    }

    const sampled = [];
    for (const segment of segments) {
        const partial = sampleBezierSegment(segment);
        if (!partial.length) {
            continue;
        }
        if (sampled.length && pointsEqual(sampled[sampled.length - 1], partial[0])) {
            sampled.push(...partial.slice(1));
        } else {
            sampled.push(...partial);
        }
    }

    return dedupeAdjacentPoints(sampled);
};

const sampleCatmullPath = (pathPoints) => {
    if (!Array.isArray(pathPoints) || pathPoints.length < 2) {
        return pathPoints || [];
    }

    const sampled = [];
    const catmull = (p0, p1, p2, p3, t) => {
        const t2 = t * t;
        const t3 = t2 * t;
        return {
            x: 0.5 * ((2 * p1.x) + ((-p0.x + p2.x) * t) + ((2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2) + ((-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)),
            y: 0.5 * ((2 * p1.y) + ((-p0.y + p2.y) * t) + ((2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2) + ((-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3))
        };
    };

    for (let i = 0; i < pathPoints.length - 1; i++) {
        const p0 = i === 0 ? pathPoints[i] : pathPoints[i - 1];
        const p1 = pathPoints[i];
        const p2 = pathPoints[i + 1];
        const p3 = (i + 2 < pathPoints.length) ? pathPoints[i + 2] : pathPoints[i + 1];
        const steps = Math.max(6, Math.min(48, Math.ceil(pointDistance(p1, p2) / 8)));

        for (let step = 0; step <= steps; step++) {
            const t = step / steps;
            const point = catmull(p0, p1, p2, p3, t);
            if (!sampled.length || !pointsEqual(sampled[sampled.length - 1], point)) {
                sampled.push(point);
            }
        }
    }

    return dedupeAdjacentPoints(sampled);
};

const samplePerfectCirclePath = (pathPoints) => {
    if (!Array.isArray(pathPoints) || pathPoints.length < 3) {
        return null;
    }

    const p0 = pathPoints[0];
    const p1 = pathPoints[1];
    const p2 = pathPoints[2];

    const d = 2 * ((p0.x * (p1.y - p2.y)) + (p1.x * (p2.y - p0.y)) + (p2.x * (p0.y - p1.y)));
    if (Math.abs(d) < 0.0001) {
        return null;
    }

    const ux = (
        ((p0.x * p0.x) + (p0.y * p0.y)) * (p1.y - p2.y) +
        ((p1.x * p1.x) + (p1.y * p1.y)) * (p2.y - p0.y) +
        ((p2.x * p2.x) + (p2.y * p2.y)) * (p0.y - p1.y)
    ) / d;

    const uy = (
        ((p0.x * p0.x) + (p0.y * p0.y)) * (p2.x - p1.x) +
        ((p1.x * p1.x) + (p1.y * p1.y)) * (p0.x - p2.x) +
        ((p2.x * p2.x) + (p2.y * p2.y)) * (p1.x - p0.x)
    ) / d;

    const radius = pointDistance({ x: ux, y: uy }, p0);
    if (!Number.isFinite(radius) || radius <= 0) {
        return null;
    }

    const angle0 = Math.atan2(p0.y - uy, p0.x - ux);
    const angle1 = Math.atan2(p1.y - uy, p1.x - ux);
    const angle2 = Math.atan2(p2.y - uy, p2.x - ux);

    const angleDistance = (start, end, direction) => {
        if (direction > 0) {
            let delta = end - start;
            while (delta < 0) delta += Math.PI * 2;
            return delta;
        }
        let delta = start - end;
        while (delta < 0) delta += Math.PI * 2;
        return delta;
    };

    let direction = 1;
    const ccwStartMid = angleDistance(angle0, angle1, 1);
    const ccwStartEnd = angleDistance(angle0, angle2, 1);
    if (ccwStartMid > ccwStartEnd + 0.0001) {
        direction = -1;
    }

    const arcAngle = angleDistance(angle0, angle2, direction);
    const arcLength = arcAngle * radius;
    const steps = Math.max(10, Math.min(128, Math.ceil(arcLength / 6)));

    const sampled = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const angle = angle0 + (direction * arcAngle * t);
        sampled.push({
            x: ux + (Math.cos(angle) * radius),
            y: uy + (Math.sin(angle) * radius)
        });
    }
    return dedupeAdjacentPoints(sampled);
};

const buildSliderPathPointsOsu = (object) => {
    if (!object || object.kind !== 'slider') {
        return [];
    }

    if (
        Array.isArray(object._cachedSliderPathPoints) &&
        object._cachedSliderPathPoints.length >= 2 &&
        (object._cachedSliderPathStackIndex === (object.stackIndex || 0))
    ) {
        return object._cachedSliderPathPoints;
    }

    const stackOffset = getObjectStackOffset(object);
    const basePoints = dedupeAdjacentPoints([
        { x: object.x + stackOffset.x, y: object.y + stackOffset.y },
        ...(Array.isArray(object.sliderPoints) ? object.sliderPoints : []).map((point) => ({
            x: point.x + stackOffset.x,
            y: point.y + stackOffset.y
        }))
    ]);

    if (basePoints.length < 2) {
        object._cachedSliderPathPoints = basePoints;
        return basePoints;
    }

    const curveType = String(object.sliderCurveType || 'B').toUpperCase();
    let sampled;
    if (curveType === 'L') {
        sampled = basePoints;
    } else if (curveType === 'C') {
        sampled = sampleCatmullPath(basePoints);
    } else if (curveType === 'P') {
        sampled = samplePerfectCirclePath(basePoints) || sampleBezierPath(basePoints);
    } else {
        sampled = sampleBezierPath(basePoints);
    }

    const trimmed = trimPathToLength(sampled, object.length);
    object._cachedSliderPathPoints = (trimmed.length >= 2) ? trimmed : sampled;
    object._cachedSliderPathStackIndex = object.stackIndex || 0;
    return object._cachedSliderPathPoints;
};

const getSliderBallPositionOsu = (object, currentTime) => {
    const path = buildSliderPathPointsOsu(object);

    if (path.length <= 1) {
        const offset = getObjectStackOffset(object);
        return { x: object.x + offset.x, y: object.y + offset.y };
    }

    const totalDuration = Math.max(1, (object.endTime || object.time) - object.time);
    const slides = Math.max(1, object.slides || 1);
    const spanDuration = totalDuration / slides;
    const elapsed = clamp(currentTime - object.time, 0, totalDuration);

    let spanIndex = Math.min(slides - 1, Math.floor(elapsed / spanDuration));
    if (!Number.isFinite(spanIndex) || spanIndex < 0) {
        spanIndex = 0;
    }

    let spanProgress = spanDuration > 0
        ? (elapsed - (spanIndex * spanDuration)) / spanDuration
        : 0;
    spanProgress = clamp(spanProgress, 0, 1);

    const isForward = (spanIndex % 2) === 0;
    const localProgress = isForward ? spanProgress : (1 - spanProgress);

    const segmentLengths = [];
    let totalPathLength = 0;
    for (let i = 1; i < path.length; i++) {
        const dx = path[i].x - path[i - 1].x;
        const dy = path[i].y - path[i - 1].y;
        const length = Math.hypot(dx, dy);
        segmentLengths.push(length);
        totalPathLength += length;
    }

    if (totalPathLength <= 0) {
        return { x: object.x, y: object.y };
    }

    let targetDistance = localProgress * totalPathLength;
    for (let i = 0; i < segmentLengths.length; i++) {
        const segmentLength = segmentLengths[i];
        const start = path[i];
        const end = path[i + 1];

        if (targetDistance <= segmentLength || i === segmentLengths.length - 1) {
            const t = segmentLength <= 0 ? 0 : clamp(targetDistance / segmentLength, 0, 1);
            return {
                x: start.x + ((end.x - start.x) * t),
                y: start.y + ((end.y - start.y) * t)
            };
        }

        targetDistance -= segmentLength;
    }

    const fallback = path[path.length - 1];
    return { x: fallback.x, y: fallback.y };
};

const getObjectEndPositionOsu = (object) => {
    if (!object) {
        return { x: 0, y: 0 };
    }
    if (object.kind === 'slider') {
        return getSliderBallPositionOsu(object, object.endTime);
    }
    return getObjectStartPositionOsu(object);
};

const stopPlayback = (options = {}) => {
    state.isPlaying = false;
    state.playbackMode = 'none';
    state.lastTickMs = 0;
    if (state.rafId) {
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
    }
    if (options.pauseAudio !== false && state.audio) {
        state.audio.pause();
    }
    if (options.resetAudioTime && state.audio) {
        state.audio.currentTime = 0;
    }
    if (state.playBtn) {
        state.playBtn.textContent = 'Play';
    }
};

const showCanvasToggleFeedback = (action) => {
    if (!state.toggleIndicator) {
        return;
    }

    state.toggleIndicator.classList.remove('is-visible', 'is-play', 'is-pause');
    // Force layout so repeated clicks replay the animation reliably.
    void state.toggleIndicator.offsetWidth;
    state.toggleIndicator.classList.add(action === 'pause' ? 'is-pause' : 'is-play');
    state.toggleIndicator.classList.add('is-visible');
};

const updateStatsLabel = () => {
    if (!state.stats || !state.mapData) {
        return;
    }

    const objectCount = state.mapData.objects.length;
    const cs = Number.isFinite(state.mapData.circleSize) ? state.mapData.circleSize.toFixed(1) : '--';
    const ar = Number.isFinite(state.mapData.approachRate) ? state.mapData.approachRate.toFixed(1) : '--';
    const mode = Number.isFinite(state.mapData.mode) ? state.mapData.mode : 0;
    const modeLabel = MODE_LABELS[mode] || 'osu!';
    const bpmMin = Number.isFinite(state.mapData.bpmMin) ? state.mapData.bpmMin : 0;
    const bpmMax = Number.isFinite(state.mapData.bpmMax) ? state.mapData.bpmMax : 0;
    let bpmText = '--';
    if (bpmMin > 0 && bpmMax > 0) {
        bpmText = Math.abs(bpmMax - bpmMin) < 0.5
            ? `${Math.round(bpmMin)}`
            : `${Math.round(bpmMin)}-${Math.round(bpmMax)}`;
    }
    state.stats.textContent = `${objectCount} objects | ${modeLabel} | CS ${cs} | AR ${ar} | BPM ${bpmText}`;
};

const updateTimeLabel = () => {
    if (!state.timeLabel) {
        return;
    }
    state.timeLabel.textContent = `${formatTime(state.currentTime)}/${formatTime(state.totalDuration)}`;
};

const renderBottomTimeline = () => {
    if (!state.timeline) {
        return;
    }

    const ranges = Array.isArray(state.item?.highlights) ? state.item.highlights : [];
    renderTimeline(state.timeline, ranges, state.totalDuration || 0);

    const ctx = state.timeline.getContext('2d');
    if (!ctx) {
        return;
    }

    const dpr = window.devicePixelRatio || 1;
    const width = state.timeline.width / dpr;
    const height = state.timeline.height / dpr;
    const progress = clamp(
        state.totalDuration > 0 ? (state.currentTime / state.totalDuration) : 0,
        0,
        1
    );

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowBlur = 4;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect((progress * width) - 1, 0, 2, height);
    ctx.shadowBlur = 0;
};

const seekFromTimelineEvent = (event, options = {}) => {
    if (!state.timeline || !state.totalDuration) {
        return;
    }

    const rect = state.timeline.getBoundingClientRect();
    if (rect.width <= 0) {
        return;
    }

    const x = event.clientX - rect.left;
    const ratio = clamp(x / rect.width, 0, 1);
    const nextTime = ratio * state.totalDuration;
    setCurrentTime(nextTime, { render: true, syncAudio: true });

    if (options.resumePlayback && state.playbackMode === 'audio' && state.audioSyncEnabled && state.audio && !state.audio.paused) {
        state.audio.currentTime = nextTime / 1000;
    }
};

const getComboColourArray = () => {
    if (state.mapData?.comboColours?.length) {
        return state.mapData.comboColours;
    }
    return DEFAULT_COMBO_COLOURS;
};

const assignComboIndices = (objects, comboColours = DEFAULT_COMBO_COLOURS) => {
    const colours = (comboColours && comboColours.length) ? comboColours : DEFAULT_COMBO_COLOURS;
    const colourCount = Math.max(1, colours.length);
    let comboIndex = 0;

    for (let i = 0; i < objects.length; i++) {
        if (i > 0 && objects[i].newCombo) {
            comboIndex = (comboIndex + 1 + (objects[i].comboSkip || 0)) % colourCount;
        }
        objects[i].comboIndex = comboIndex;
    }
};

const setCurrentTime = (nextTimeMs, options = {}) => {
    const clamped = clamp(nextTimeMs, 0, state.totalDuration || 0);
    state.currentTime = clamped;

    if (options.syncAudio !== false && state.audioSyncEnabled && state.audio) {
        const targetSeconds = clamped / 1000;
        if (Math.abs((state.audio.currentTime || 0) - targetSeconds) > 0.025) {
            state.audio.currentTime = targetSeconds;
        }
    }

    renderBottomTimeline();
    updateTimeLabel();

    if (options.render !== false) {
        render();
    }
};

const clearCanvas = () => {
    if (!state.canvas) {
        return null;
    }

    const ctx = state.canvas.getContext('2d');
    if (!ctx) {
        return null;
    }

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(state.canvas.clientWidth || 1));
    const height = Math.max(1, Math.floor(state.canvas.clientHeight || 1));

    if (state.canvas.width !== width * dpr || state.canvas.height !== height * dpr) {
        state.canvas.width = width * dpr;
        state.canvas.height = height * dpr;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx, width, height };
};

const drawFollowPoints = ({
    ctx,
    toCanvas,
    objects,
    currentTime,
    preemptMs,
    minVisibleTime,
    maxVisibleTime,
    circleRadius
}) => {
    if (!Array.isArray(objects) || objects.length < 2) {
        return;
    }

    const fadeOutMs = LONG_OBJECT_POST_HIT_FADE_MS;
    for (let i = 0; i < objects.length - 1; i++) {
        const current = objects[i];
        const next = objects[i + 1];
        if (!current || !next) {
            continue;
        }
        if ((current.comboIndex ?? 0) !== (next.comboIndex ?? 0)) {
            continue;
        }
        if (current.kind === 'spinner' || next.kind === 'spinner') {
            continue;
        }
        if (next.time > maxVisibleTime || next.endTime < minVisibleTime) {
            continue;
        }

        const fadeInStart = next.time - preemptMs;
        const fadeInPeak = next.time - (preemptMs * 0.35);
        const fadeOutEnd = next.time + fadeOutMs;

        if (currentTime < fadeInStart || currentTime > fadeOutEnd) {
            continue;
        }

        let alpha = 1;
        if (currentTime < fadeInPeak) {
            alpha = clamp((currentTime - fadeInStart) / Math.max(1, fadeInPeak - fadeInStart), 0, 1);
        } else if (currentTime > next.time) {
            alpha = 1 - clamp((currentTime - next.time) / fadeOutMs, 0, 1);
        }
        if (alpha <= 0.02) {
            continue;
        }

        const start = getObjectEndPositionOsu(current);
        const end = getObjectStartPositionOsu(next);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const distance = Math.hypot(dx, dy);
        const minGapDistance = (circleRadius * 2) + 2;
        if (!Number.isFinite(distance) || distance <= minGapDistance) {
            continue;
        }

        const trim = (circleRadius * 1.02) + 1;
        const visibleLength = distance - (trim * 2);
        if (visibleLength <= 2) {
            continue;
        }

        const startCanvas = toCanvas(start.x, start.y);
        const endCanvas = toCanvas(end.x, end.y);
        const nx = dx / distance;
        const ny = dy / distance;

        const fromX = startCanvas.x + (nx * trim);
        const fromY = startCanvas.y + (ny * trim);
        const toX = endCanvas.x - (nx * trim);
        const toY = endCanvas.y - (ny * trim);

        ctx.strokeStyle = `rgba(255, 255, 255, ${clamp(alpha * 0.2, 0, 1)})`;
        ctx.lineWidth = Math.max(0.9, circleRadius * 0.08);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();
    }
};

const renderTaikoMode = ({
    ctx,
    playfieldX,
    playfieldY,
    playfieldWidth,
    playfieldHeight,
    currentTime,
    objects
}) => {
    const laneY = playfieldY + (playfieldHeight * 0.5);
    const laneHeight = playfieldHeight * 0.22;
    const judgeX = playfieldX + (playfieldWidth * 0.12);
    const noteTravelWidth = playfieldWidth * 0.82;
    const lookAheadMs = 1900;
    const lookBehindMs = 320;
    const visibleEnd = currentTime + lookAheadMs + 140;
    const visibleStart = currentTime - lookBehindMs;
    const donColor = { r: 242, g: 86, b: 86 };
    const katColor = { r: 92, g: 166, b: 255 };
    const rollColor = { r: 255, g: 196, b: 84 };

    ctx.fillStyle = 'rgba(28, 30, 36, 0.9)';
    ctx.fillRect(playfieldX, laneY - (laneHeight / 2), playfieldWidth, laneHeight);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(playfieldX + 0.5, laneY - (laneHeight / 2) + 0.5, playfieldWidth - 1, laneHeight - 1);

    const receptorRadius = Math.max(8, laneHeight * 0.38);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.beginPath();
    ctx.arc(judgeX, laneY, receptorRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.lineWidth = Math.max(1.2, laneHeight * 0.09);
    ctx.beginPath();
    ctx.arc(judgeX, laneY, receptorRadius, 0, Math.PI * 2);
    ctx.stroke();

    for (const object of objects) {
        if (object.time > visibleEnd) {
            break;
        }
        if (object.endTime < visibleStart) {
            continue;
        }

        if (object.kind === 'spinner') {
            const duration = Math.max(1, object.endTime - object.time);
            const progress = clamp((currentTime - object.time) / duration, 0, 1);
            const radiusStart = laneHeight * 0.85;
            const radiusEnd = laneHeight * 0.28;
            const radius = radiusStart - ((radiusStart - radiusEnd) * progress);
            const alpha = currentTime < object.time
                ? clamp(1 - ((object.time - currentTime) / lookAheadMs), 0, 1) * 0.6
                : clamp(1 - ((currentTime - object.endTime) / LONG_OBJECT_POST_HIT_FADE_MS), 0, 1) * 0.8;
            if (alpha <= 0.02) continue;
            ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
            ctx.lineWidth = Math.max(2, laneHeight * 0.14);
            ctx.beginPath();
            ctx.arc(judgeX, laneY, radius, 0, Math.PI * 2);
            ctx.stroke();
            continue;
        }

        if (object.kind === 'slider' || object.kind === 'hold') {
            const headDt = object.time - currentTime;
            const tailDt = object.endTime - currentTime;
            const headX = judgeX + ((headDt / lookAheadMs) * noteTravelWidth);
            const tailX = judgeX + ((tailDt / lookAheadMs) * noteTravelWidth);
            const leftX = Math.min(headX, tailX);
            const rightX = Math.max(headX, tailX);
            if (rightX < (playfieldX - 24) || leftX > (playfieldX + playfieldWidth + 24)) {
                continue;
            }

            let alpha = 0.86;
            if (headDt > 0) {
                alpha = 0.18 + (0.68 * clamp(1 - (headDt / lookAheadMs), 0, 1));
            } else if (currentTime > object.endTime) {
                alpha = 0.86 * clamp(1 - ((currentTime - object.endTime) / LONG_OBJECT_POST_HIT_FADE_MS), 0, 1);
            }
            if (alpha <= 0.02) {
                continue;
            }

            const rollThickness = Math.max(6, laneHeight * 0.48);
            ctx.strokeStyle = withAlpha(rollColor, alpha * 0.9);
            ctx.lineWidth = rollThickness;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(leftX, laneY);
            ctx.lineTo(rightX, laneY);
            ctx.stroke();

            ctx.strokeStyle = withAlpha({ r: 255, g: 255, b: 255 }, alpha * 0.28);
            ctx.lineWidth = Math.max(1.2, rollThickness * 0.22);
            ctx.beginPath();
            ctx.moveTo(leftX, laneY);
            ctx.lineTo(rightX, laneY);
            ctx.stroke();
            continue;
        }

        const dt = object.time - currentTime;
        const x = judgeX + ((dt / lookAheadMs) * noteTravelWidth);
        if (x < (playfieldX - 20) || x > (playfieldX + playfieldWidth + 20)) {
            continue;
        }

        let alpha = 0.88;
        if (dt > 0) {
            alpha = 0.2 + (0.68 * clamp(1 - (dt / lookAheadMs), 0, 1));
        } else if (dt < 0) {
            alpha = 0.88 * clamp(1 - ((-dt) / CIRCLE_POST_HIT_FADE_MS), 0, 1);
        }
        if (alpha <= 0.02) continue;

        const hitSound = Number.isFinite(object.hitSound) ? object.hitSound : 0;
        const isKat = (hitSound & (2 | 8)) !== 0;
        const isFinish = (hitSound & 4) !== 0;
        const noteColor = isKat ? katColor : donColor;
        const baseRadius = Math.max(6, laneHeight * 0.28);
        const radius = baseRadius * (isFinish ? 1.38 : 1);
        ctx.fillStyle = withAlpha(noteColor, alpha);
        ctx.beginPath();
        ctx.arc(x, laneY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${clamp(alpha * 0.8, 0, 1)})`;
        ctx.lineWidth = Math.max(1.3, radius * 0.18);
        ctx.beginPath();
        ctx.arc(x, laneY, radius, 0, Math.PI * 2);
        ctx.stroke();
    }
};

const renderCatchMode = ({
    ctx,
    playfieldX,
    playfieldY,
    playfieldWidth,
    playfieldHeight,
    currentTime,
    objects,
    preemptMs,
    comboColours,
    circleSize
}) => {
    const catcherY = playfieldY + (playfieldHeight * 0.9);
    const lookAheadMs = Math.max(900, preemptMs);
    const postCatchFadeMs = 16;
    const lookBehindMs = Math.max(36, postCatchFadeMs + 14);
    const visibleStart = currentTime - lookBehindMs;
    const visibleEnd = currentTime + lookAheadMs + 140;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(playfieldX, catcherY + 0.5);
    ctx.lineTo(playfieldX + playfieldWidth, catcherY + 0.5);
    ctx.stroke();

    const mapX = (x) => playfieldX + ((clamp(x, 0, OSU_PLAYFIELD_WIDTH) / OSU_PLAYFIELD_WIDTH) * playfieldWidth);

    let targetCatcherX = playfieldX + (playfieldWidth / 2);
    let previousObject = null;
    let nextObject = null;
    for (const object of objects) {
        if (!object || object.kind === 'spinner') {
            continue;
        }
        if (object.time <= currentTime) {
            previousObject = object;
            continue;
        }
        nextObject = object;
        break;
    }

    if (previousObject && nextObject && nextObject.time > previousObject.time) {
        const t = clamp(
            (currentTime - previousObject.time) / (nextObject.time - previousObject.time),
            0,
            1
        );
        const prevX = mapX(previousObject.x);
        const nextX = mapX(nextObject.x);
        targetCatcherX = prevX + ((nextX - prevX) * t);
    } else if (nextObject) {
        targetCatcherX = mapX(nextObject.x);
    } else if (previousObject) {
        targetCatcherX = mapX(previousObject.x);
    }

    const lastRenderX = Number.isFinite(state.catcherRenderX) ? state.catcherRenderX : Number.NaN;
    const lastRenderTime = Number.isFinite(state.catcherRenderTime) ? state.catcherRenderTime : Number.NaN;
    const deltaTime = currentTime - lastRenderTime;
    if (!Number.isFinite(lastRenderX) || !Number.isFinite(lastRenderTime) || deltaTime < 0 || deltaTime > 220) {
        state.catcherRenderX = targetCatcherX;
    } else {
        const blend = clamp(deltaTime / 110, 0.14, 1);
        state.catcherRenderX = lastRenderX + ((targetCatcherX - lastRenderX) * blend);
    }
    state.catcherRenderTime = currentTime;
    const catcherX = state.catcherRenderX;

    const catcherWidth = Math.max(42, playfieldWidth * 0.1);
    const catcherHeight = Math.max(8, playfieldHeight * 0.03);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(catcherX - (catcherWidth / 2), catcherY - catcherHeight / 2, catcherWidth, catcherHeight);

    const baseFruitRadius = Math.max(6, playfieldHeight * 0.038);
    const csRadiusScale = clamp(getCircleRadius(circleSize) / getCircleRadius(5), 0.45, 1.8);
    const fruitRadius = baseFruitRadius * csRadiusScale;
    const spawnY = playfieldY + 10;
    const catchContactY = catcherY - (catcherHeight / 2) - fruitRadius + 0.5;
    const dropDistance = Math.max(1, catchContactY - spawnY);
    const pixelsPerMs = dropDistance / lookAheadMs;

    for (const object of objects) {
        if (object.time > visibleEnd) {
            break;
        }
        if (object.time < visibleStart) {
            continue;
        }
        if (object.kind === 'spinner') {
            continue;
        }

        const dt = object.time - currentTime;
        if (dt > lookAheadMs) {
            continue;
        }
        const hitElapsed = Math.max(0, -dt);
        if (hitElapsed > postCatchFadeMs) {
            continue;
        }

        let alpha = 0.86;
        if (dt > 0) {
            const preHitProgress = clamp(1 - (dt / lookAheadMs), 0, 1);
            const minPreHitAlpha = 0.08;
            alpha = minPreHitAlpha + ((0.86 - minPreHitAlpha) * Math.pow(preHitProgress, 1.2));
        } else {
            alpha = 0.86 * (1 - clamp(hitElapsed / postCatchFadeMs, 0, 1));
        }
        if (alpha <= 0.02) {
            continue;
        }

        const x = mapX(object.x);
        const fallingY = catchContactY - (dt * pixelsPerMs);
        const y = clamp(fallingY, spawnY, catchContactY);
        if (y < playfieldY - 20 || y > catcherY + 8) {
            continue;
        }

        const combo = comboColours[object.comboIndex % comboColours.length] || DEFAULT_COMBO_COLOURS[0];
        ctx.fillStyle = withAlpha(combo, alpha);
        ctx.beginPath();
        ctx.arc(x, y, fruitRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${clamp(alpha * 0.8, 0, 1)})`;
        ctx.lineWidth = Math.max(1.2, fruitRadius * 0.18);
        ctx.beginPath();
        ctx.arc(x, y, fruitRadius, 0, Math.PI * 2);
        ctx.stroke();
    }
};

const renderManiaMode = ({
    ctx,
    playfieldX,
    playfieldY,
    playfieldWidth,
    playfieldHeight,
    currentTime,
    objects,
    circleSize,
    approachRate,
    overallDifficulty
}) => {
    const keys = clamp(Math.round(circleSize || 4), 1, 10);
    const laneAreaWidth = playfieldWidth * 0.62;
    const laneAreaX = playfieldX + ((playfieldWidth - laneAreaWidth) / 2);
    const laneWidth = laneAreaWidth / keys;
    const receptorY = playfieldY + (playfieldHeight * 0.88);
    const diffValue = clamp(
        Number.isFinite(overallDifficulty)
            ? overallDifficulty
            : (Number.isFinite(approachRate) ? approachRate : 5),
        0,
        10
    );
    const diffProgress = Math.pow(diffValue / 10, 0.95);
    const lookAheadMs = 1500 - (diffProgress * 1100);
    const lookBehindMs = 80;
    const speed = (receptorY - (playfieldY + 8)) / lookAheadMs;
    const visibleStart = currentTime - lookBehindMs;
    const visibleEnd = currentTime + lookAheadMs + 180;
    const centerLane = (keys % 2 === 1) ? Math.floor(keys / 2) : -1;
    const leftBase = { r: 86, g: 154, b: 255 };
    const rightBase = { r: 255, g: 120, b: 178 };
    const centerBase = { r: 255, g: 211, b: 108 };

    const getLaneGroupBase = (lane) => {
        if (lane === centerLane) {
            return centerBase;
        }
        if (centerLane >= 0) {
            return lane < centerLane ? leftBase : rightBase;
        }
        return lane < (keys / 2) ? leftBase : rightBase;
    };

    for (let lane = 0; lane < keys; lane++) {
        const laneX = laneAreaX + (lane * laneWidth);
        const base = getLaneGroupBase(lane);
        const laneAlpha = (lane % 2 === 0) ? 0.11 : 0.07;
        ctx.fillStyle = withAlpha(base, laneAlpha);
        ctx.fillRect(laneX, playfieldY, laneWidth, playfieldHeight);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(laneX + 0.5, playfieldY);
        ctx.lineTo(laneX + 0.5, playfieldY + playfieldHeight);
        ctx.stroke();
    }

    const receptorThickness = 4;
    const receptorHalf = receptorThickness / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(laneAreaX, receptorY - receptorHalf, laneAreaWidth, receptorThickness);

    const lanePadding = Math.max(2, laneWidth * 0.12);
    const noteWidth = Math.max(4, laneWidth - (lanePadding * 2));
    const noteHeight = Math.max(8, playfieldHeight * 0.03);
    const postJudgeTravelPx = Math.max(receptorHalf, noteHeight * 0.25);
    const postJudgeDelayMs = postJudgeTravelPx / Math.max(speed, 0.001);
    const holdBodyBottomClampY = receptorY + receptorHalf;
    const receptorVanishCenterY = receptorY + (receptorHalf * 0.5);
    const receptorVanishFadePx = Math.max(1, receptorHalf);

    for (const object of objects) {
        if (object.time > visibleEnd) {
            break;
        }
        if (object.endTime < visibleStart) {
            continue;
        }
        if (object.kind === 'spinner') {
            continue;
        }

        const isHoldNote = object.kind === 'hold' || object.endTime > object.time;
        const dt = object.time - currentTime;
        const holdEndClampTime = object.endTime + postJudgeDelayMs;
        if (isHoldNote && currentTime > holdEndClampTime) {
            continue;
        }
        let alpha = 0.9;
        if (dt > 0) {
            alpha = 0.24 + (0.66 * clamp(1 - (dt / lookAheadMs), 0, 1));
        } else if (isHoldNote) {
            alpha = 0.9;
        } else if (dt < 0) {
            const postHitElapsed = (-dt) - postJudgeDelayMs;
            if (postHitElapsed <= 0) {
                alpha = 0.9;
            } else {
                alpha = 0.9 * clamp(1 - (postHitElapsed / CIRCLE_POST_HIT_FADE_MS), 0, 1);
            }
        }
        if (alpha <= 0.02) continue;

        const lane = clamp(Math.floor((clamp(object.x, 0, OSU_PLAYFIELD_WIDTH - 0.001) / OSU_PLAYFIELD_WIDTH) * keys), 0, keys - 1);
        const laneX = laneAreaX + (lane * laneWidth);
        const noteX = laneX + lanePadding;
        const rawHeadY = receptorY - ((object.time - currentTime) * speed) - (noteHeight / 2);
        const headY = (isHoldNote && currentTime >= object.time && currentTime <= holdEndClampTime)
            ? (receptorY - (noteHeight / 2))
            : rawHeadY;
        const shouldRenderHoldBody = isHoldNote && currentTime <= holdEndClampTime;
        if (!isHoldNote) {
            const noteCenterY = headY + (noteHeight / 2);
            if (noteCenterY > receptorVanishCenterY) {
                const overPx = noteCenterY - receptorVanishCenterY;
                alpha *= clamp(1 - (overPx / receptorVanishFadePx), 0, 1);
                if (alpha <= 0.02) {
                    continue;
                }
            }
        }

        const groupBase = getLaneGroupBase(lane);
        const noteColor = {
            r: Math.min(255, groupBase.r + 16),
            g: Math.min(255, groupBase.g + 16),
            b: Math.min(255, groupBase.b + 16)
        };
        if (shouldRenderHoldBody) {
            const tailY = receptorY - ((object.endTime - currentTime) * speed) + (noteHeight / 2);
            const bodyTop = Math.max(playfieldY - 20, Math.min(headY, tailY));
            const bodyBottom = Math.min(
                holdBodyBottomClampY,
                Math.max(headY + noteHeight, tailY)
            );
            const bodyHeight = bodyBottom - bodyTop;
            if (bodyHeight > 2) {
                ctx.fillStyle = withAlpha(groupBase, alpha * 0.35);
                ctx.fillRect(noteX + noteWidth * 0.2, bodyTop, noteWidth * 0.6, bodyHeight);
            }
        }

        if (headY > playfieldY + playfieldHeight + 20 || (headY + noteHeight) < playfieldY - 20) {
            continue;
        }

        ctx.fillStyle = withAlpha(noteColor, alpha);
        ctx.fillRect(noteX, headY, noteWidth, noteHeight);
        ctx.strokeStyle = `rgba(255,255,255,${clamp(alpha * 0.8, 0, 1)})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(noteX + 0.5, headY + 0.5, noteWidth - 1, noteHeight - 1);
    }
};

const render = () => {
    const result = clearCanvas();
    if (!result) {
        return;
    }

    const { ctx, width, height } = result;

    ctx.fillStyle = 'rgba(8, 8, 10, 0.85)';
    ctx.fillRect(0, 0, width, height);

    if (!state.mapData || !state.mapData.objects?.length) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.font = '600 14px Torus, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No preview data available', width / 2, height / 2);
        return;
    }

    const padding = 14;
    const availableWidth = Math.max(10, width - (padding * 2));
    const availableHeight = Math.max(10, height - (padding * 2));
    const scale = Math.min(availableWidth / OSU_PLAYFIELD_WIDTH, availableHeight / OSU_PLAYFIELD_HEIGHT);
    const playfieldWidth = OSU_PLAYFIELD_WIDTH * scale;
    const playfieldHeight = OSU_PLAYFIELD_HEIGHT * scale;
    const playfieldX = Math.floor((width - playfieldWidth) / 2);
    const playfieldY = Math.floor((height - playfieldHeight) / 2);

    ctx.fillStyle = 'rgba(19, 21, 26, 0.95)';
    ctx.fillRect(playfieldX, playfieldY, playfieldWidth, playfieldHeight);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(playfieldX + 0.5, playfieldY + 0.5, playfieldWidth - 1, playfieldHeight - 1);

    const toCanvas = (x, y) => ({
        x: playfieldX + ((x / OSU_PLAYFIELD_WIDTH) * playfieldWidth),
        y: playfieldY + ((y / OSU_PLAYFIELD_HEIGHT) * playfieldHeight)
    });

    const mode = Number.isFinite(state.mapData.mode) ? state.mapData.mode : 0;
    const comboColours = getComboColourArray();
    const preemptMs = getApproachPreemptMs(state.mapData.approachRate);

    if (mode === 1) {
        renderTaikoMode({
            ctx,
            playfieldX,
            playfieldY,
            playfieldWidth,
            playfieldHeight,
            currentTime: state.currentTime,
            objects: state.mapData.objects
        });
        return;
    }

    if (mode === 2) {
        renderCatchMode({
            ctx,
            playfieldX,
            playfieldY,
            playfieldWidth,
            playfieldHeight,
            currentTime: state.currentTime,
            objects: state.mapData.objects,
            preemptMs,
            comboColours,
            circleSize: state.mapData.circleSize
        });
        return;
    }

    if (mode === 3) {
        renderManiaMode({
            ctx,
            playfieldX,
            playfieldY,
            playfieldWidth,
            playfieldHeight,
            currentTime: state.currentTime,
            objects: state.mapData.objects,
            circleSize: state.mapData.circleSize,
            approachRate: state.mapData.approachRate,
            overallDifficulty: state.mapData.overallDifficulty
        });
        return;
    }

    const circleRadius = getCircleRadius(state.mapData.circleSize) * scale;
    const drawnCircleRadius = circleRadius * DRAWN_CIRCLE_RADIUS_SCALE;
    const sliderBodyRadius = Math.max(2, drawnCircleRadius * 0.95);
    const minVisibleTime = state.currentTime - LONG_OBJECT_POST_HIT_FADE_MS;
    const maxVisibleTime = state.currentTime + preemptMs + 220;

    drawFollowPoints({
        ctx,
        toCanvas,
        objects: state.mapData.objects,
        currentTime: state.currentTime,
        preemptMs,
        minVisibleTime,
        maxVisibleTime,
        circleRadius: drawnCircleRadius
    });

    const visibleObjects = [];
    for (const object of state.mapData.objects) {
        if (object.time > maxVisibleTime) {
            break;
        }
        if (object.endTime < minVisibleTime) {
            continue;
        }
        visibleObjects.push(object);
    }

    // Draw future objects first (underneath), then current/past objects on top.
    visibleObjects.sort((a, b) => {
        const aIsFuture = a.time > state.currentTime;
        const bIsFuture = b.time > state.currentTime;
        if (aIsFuture !== bIsFuture) {
            return aIsFuture ? -1 : 1;
        }
        return a.time - b.time;
    });

    for (const object of visibleObjects) {

        const combo = comboColours[object.comboIndex % comboColours.length] || DEFAULT_COMBO_COLOURS[0];
        let objectPosition = getObjectStartPositionOsu(object);
        if (object.kind === 'slider' && state.currentTime >= object.time) {
            const sampledTime = clamp(state.currentTime, object.time, object.endTime);
            objectPosition = getSliderBallPositionOsu(object, sampledTime);
        }
        const point = toCanvas(objectPosition.x, objectPosition.y);
        const timeUntil = object.time - state.currentTime;
        const fadeAnchorTime = object.kind === 'circle' ? object.time : object.endTime;
        const fadeWindowMs = object.kind === 'circle' ? CIRCLE_POST_HIT_FADE_MS : LONG_OBJECT_POST_HIT_FADE_MS;
        const timeSinceFadeAnchor = state.currentTime - fadeAnchorTime;

        let baseAlpha = 0.78;
        if (timeUntil > 0) {
            const fadeInProgress = 1 - clamp(timeUntil / preemptMs, 0, 1);
            baseAlpha = 0.82 * Math.pow(fadeInProgress, 1.75);
        } else if (timeSinceFadeAnchor > 0) {
            baseAlpha = 0.82 * (1 - clamp(timeSinceFadeAnchor / fadeWindowMs, 0, 1));
        } else {
            baseAlpha = 0.82;
        }

        if (baseAlpha <= 0.03) {
            continue;
        }

        if (object.kind === 'slider') {
            const pathPoints = buildSliderPathPointsOsu(object).map((p) => toCanvas(p.x, p.y));
            if (pathPoints.length > 1) {
                ctx.strokeStyle = withAlpha({ r: 255, g: 255, b: 255 }, baseAlpha * 0.28);
                ctx.lineWidth = (sliderBodyRadius * 2) + Math.max(1, circleRadius * 0.12);
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
                for (let i = 1; i < pathPoints.length; i++) {
                    ctx.lineTo(pathPoints[i].x, pathPoints[i].y);
                }
                ctx.stroke();

                ctx.strokeStyle = withAlpha(combo, baseAlpha * 0.65);
                ctx.lineWidth = sliderBodyRadius * 2;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
                for (let i = 1; i < pathPoints.length; i++) {
                    ctx.lineTo(pathPoints[i].x, pathPoints[i].y);
                }
                ctx.stroke();

                if ((object.slides || 1) > 1) {
                    const startPoint = pathPoints[0];
                    const endPoint = pathPoints[pathPoints.length - 1];
                    const startDir = {
                        x: pathPoints[Math.min(1, pathPoints.length - 1)].x - startPoint.x,
                        y: pathPoints[Math.min(1, pathPoints.length - 1)].y - startPoint.y
                    };
                    const endDir = {
                        x: pathPoints[Math.max(0, pathPoints.length - 2)].x - endPoint.x,
                        y: pathPoints[Math.max(0, pathPoints.length - 2)].y - endPoint.y
                    };
                    const indicatorSize = Math.max(5, drawnCircleRadius * 0.45);

                    drawReverseIndicator(
                        ctx,
                        endPoint,
                        endDir,
                        indicatorSize,
                        baseAlpha * 0.95
                    );

                    if ((object.slides || 1) >= 3) {
                        drawReverseIndicator(
                            ctx,
                            startPoint,
                            startDir,
                            indicatorSize,
                            baseAlpha * 0.95
                        );
                    }
                }
            }
        } else if (object.kind === 'spinner') {
            const centerX = playfieldX + (playfieldWidth / 2);
            const centerY = playfieldY + (playfieldHeight / 2);

            const spinnerDuration = Math.max(1, object.endTime - object.time);
            const spinnerProgress = clamp((state.currentTime - object.time) / spinnerDuration, 0, 1);
            const spinnerStartRadius = Math.min(playfieldWidth, playfieldHeight) * 0.46;
            const spinnerEndRadius = Math.max(
                drawnCircleRadius * 1.1,
                Math.min(playfieldWidth, playfieldHeight) * 0.08
            );
            const spinnerRadius = spinnerStartRadius - ((spinnerStartRadius - spinnerEndRadius) * spinnerProgress);

            ctx.strokeStyle = withAlpha(combo, baseAlpha * 0.8);
            ctx.lineWidth = Math.max(2, drawnCircleRadius * 0.3);
            ctx.beginPath();
            ctx.arc(centerX, centerY, spinnerRadius, 0, Math.PI * 2);
            ctx.stroke();

            // Spinners should not render a hitcircle in the center.
            continue;
        }

        if (timeUntil > 0 && timeUntil <= preemptMs) {
            const approachProgress = clamp(timeUntil / preemptMs, 0, 1);
            const approachRadius = drawnCircleRadius * (1 + 2.2 * approachProgress);
            const fadeInProgress = 1 - approachProgress;
            ctx.strokeStyle = withAlpha(combo, (0.55 * fadeInProgress) + 0.06);
            ctx.lineWidth = Math.max(1.5, drawnCircleRadius * 0.14);
            ctx.beginPath();
            ctx.arc(point.x, point.y, approachRadius, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.fillStyle = withAlpha(combo, baseAlpha);
        ctx.beginPath();
        ctx.arc(point.x, point.y, drawnCircleRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = withAlpha({ r: 255, g: 255, b: 255 }, 0.75 * baseAlpha);
        ctx.lineWidth = Math.max(1.3, drawnCircleRadius * 0.1);
        ctx.beginPath();
        ctx.arc(point.x, point.y, drawnCircleRadius, 0, Math.PI * 2);
        ctx.stroke();
    }
};

const animate = (now) => {
    if (!state.isPlaying) {
        state.rafId = 0;
        return;
    }

    if (state.playbackMode === 'audio' && state.audioSyncEnabled && state.audio) {
        if (state.audio.paused) {
            stopPlayback({ pauseAudio: false });
            return;
        }

        const audioTimeMs = Math.max(0, (state.audio.currentTime || 0) * 1000);
        setCurrentTime(audioTimeMs, { render: true, syncAudio: false });

        if (state.audio.ended || audioTimeMs >= state.totalDuration - 5) {
            setCurrentTime(state.totalDuration, { render: true, syncAudio: false });
            stopPlayback({ pauseAudio: false });
            return;
        }

        state.rafId = requestAnimationFrame(animate);
        return;
    }

    if (state.playbackMode !== 'manual') {
        state.rafId = 0;
        return;
    }

    if (!state.lastTickMs) {
        state.lastTickMs = now;
    }
    const delta = now - state.lastTickMs;
    state.lastTickMs = now;
    const next = state.currentTime + Math.max(0, delta);
    if (next >= state.totalDuration) {
        setCurrentTime(state.totalDuration, { render: true, syncAudio: false });
        stopPlayback();
        return;
    }

    setCurrentTime(next, { render: true, syncAudio: false });
    state.rafId = requestAnimationFrame(animate);
};

export const closeMapPreview = () => {
    stopPlayback({ resetAudioTime: true });
    state.catcherRenderX = Number.NaN;
    state.catcherRenderTime = Number.NaN;
    if (state.toggleIndicator) {
        state.toggleIndicator.classList.remove('is-visible', 'is-play', 'is-pause');
    }
    if (state.popup) {
        state.popup.classList.remove('is-open');
        state.popup.hidden = true;
    }
};

const startManualPlayback = () => {
    if (state.currentTime >= state.totalDuration - 4) {
        setCurrentTime(0, { render: true, syncAudio: false });
    }
    state.playbackMode = 'manual';
    state.isPlaying = true;
    state.lastTickMs = 0;
    if (state.playBtn) {
        state.playBtn.textContent = 'Pause';
    }
    if (!state.rafId) {
        state.rafId = requestAnimationFrame(animate);
    }
};

const startAudioPlayback = async () => {
    if (!state.audioSyncEnabled || !state.audio || !state.audio.src) {
        return false;
    }

    if (state.currentTime >= state.totalDuration - 4) {
        setCurrentTime(0, { render: true });
    }

    try {
        state.audio.currentTime = Math.max(0, state.currentTime / 1000);
        await state.audio.play();
        state.playbackMode = 'audio';
        state.isPlaying = true;
        state.lastTickMs = 0;
        if (state.playBtn) {
            state.playBtn.textContent = 'Pause';
        }
        if (!state.rafId) {
            state.rafId = requestAnimationFrame(animate);
        }
        return true;
    } catch (error) {
        console.warn('[MapPreview] Audio playback failed:', error);
        return false;
    }
};

const togglePlayback = async () => {
    if (!state.mapData) {
        return null;
    }

    if (state.isPlaying) {
        stopPlayback();
        return false;
    }

    const startedAudio = await startAudioPlayback();
    if (!startedAudio) {
        startManualPlayback();
    }
    return true;
};

const prepareAudioForItem = (item) => {
    state.audioSyncEnabled = false;

    if (!state.audio || !item?.filePath || !item?.audio || !beatmapApi?.convertFileSrc) {
        return;
    }

    const folderPath = getDirectoryPath(item.filePath);
    if (!folderPath) {
        return;
    }

    const audioPath = `${folderPath}${item.audio}`;
    const nextSrc = beatmapApi.convertFileSrc(audioPath);
    if (!nextSrc) {
        return;
    }

    if (state.audio.src !== nextSrc) {
        state.audio.src = nextSrc;
    }

    const volume = typeof Store.settings?.volume === 'number' ? Store.settings.volume : 0.5;
    state.audio.volume = clamp(volume, 0, 1);
    state.audio.currentTime = Math.max(0, state.currentTime / 1000);
    state.audioSyncEnabled = true;
};

export const initMapPreview = () => {
    if (state.initialized) {
        return true;
    }

    state.popup = document.querySelector('#mapPreviewPopup');
    state.closeBtn = document.querySelector('#closeMapPreviewBtn');
    state.playBtn = document.querySelector('#mapPreviewPlayBtn');
    state.timeline = document.querySelector('#mapPreviewTimeline');
    state.canvas = document.querySelector('#mapPreviewCanvas');
    state.toggleIndicator = document.querySelector('#mapPreviewToggleIndicator');
    state.title = document.querySelector('#mapPreviewTitle');
    state.version = document.querySelector('#mapPreviewVersion');
    state.stats = document.querySelector('#mapPreviewStats');
    state.timeLabel = document.querySelector('#mapPreviewTimeLabel');

    if (!state.popup || !state.closeBtn || !state.playBtn || !state.timeline || !state.canvas || !state.title || !state.version || !state.stats || !state.timeLabel) {
        console.warn('[MapPreview] Popup UI not found');
        return false;
    }

    state.audio.preload = 'auto';
    state.closeBtn.addEventListener('click', () => closeMapPreview());
    state.playBtn.addEventListener('click', async () => { await togglePlayback(); });
    state.canvas.addEventListener('click', async () => {
        const wasPlaying = state.isPlaying;
        const nextPlaying = await togglePlayback();
        if (typeof nextPlaying === 'boolean') {
            showCanvasToggleFeedback(wasPlaying ? 'pause' : 'play');
        }
    });

    state.timeline.addEventListener('mousedown', (event) => {
        seekFromTimelineEvent(event, { resumePlayback: true });

        const onMove = (moveEvent) => {
            seekFromTimelineEvent(moveEvent, { resumePlayback: true });
        };

        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && state.popup?.classList.contains('is-open')) {
            closeMapPreview();
        }
    });

    state.initialized = true;
    return true;
};

export const openMapPreview = async (itemId) => {
    if (!initMapPreview()) {
        return false;
    }

    const item = Store.beatmapItems.find((entry) => entry.id === itemId);
    if (!item || !item.filePath) {
        closeMapPreview();
        showNotification('Preview unavailable', 'This map has no readable file path.', 'error');
        return false;
    }

    state.loadToken += 1;
    const token = state.loadToken;
    stopPlayback();
    if (state.popup) {
        state.popup.classList.remove('is-open');
        state.popup.hidden = true;
    }

    const cacheKey = `${item.filePath}|${item.dateModified || 0}`;

    try {
        let parsed = previewCache.get(cacheKey);
        if (!parsed) {
            const payload = await beatmapApi.readOsuFile(item.filePath);
            const content = (typeof payload === 'string')
                ? payload
                : (typeof payload?.content === 'string' ? payload.content : '');
            if (!content) {
                throw new Error('Map file is empty');
            }

            parsed = parseMapPreviewData(content, { maxObjects: 12000 });
            assignComboIndices(parsed.objects, parsed.comboColours);
            if ((parsed.mode ?? 0) === 0) {
                applyPreviewStacking(parsed.objects, parsed.approachRate, parsed.stackLeniency);
            } else {
                clearPreviewStacking(parsed.objects);
            }
            previewCache.set(cacheKey, parsed);
        } else {
            if ((parsed.mode ?? 0) === 0) {
                applyPreviewStacking(parsed.objects, parsed.approachRate, parsed.stackLeniency);
            } else {
                clearPreviewStacking(parsed.objects);
            }
        }

        if (token !== state.loadToken) {
            return false;
        }

        if (!parsed.objects.length) {
            throw new Error('No hit objects found');
        }

        state.item = item;
        state.mapData = parsed;
        state.catcherRenderX = Number.NaN;
        state.catcherRenderTime = Number.NaN;
        state.totalDuration = Math.max(
            Number(item.durationMs) || 0,
            Number(parsed.maxObjectTime) + 800
        );
        state.totalDuration = Math.max(1000, state.totalDuration);

        updateStatsLabel();
        renderBottomTimeline();

        const initialTime = Number.isFinite(item.previewTime) && item.previewTime > 0
            ? item.previewTime
            : 0;
        setCurrentTime(initialTime, { render: true, syncAudio: false });
        prepareAudioForItem(item);

        state.popup.hidden = false;
        state.popup.classList.add('is-open');
        state.title.textContent = `${item.artistUnicode || item.artist || 'Unknown Artist'} - ${item.titleUnicode || item.title || 'Unknown Title'}`;
        state.version.textContent = item.version || '';
        state.version.title = item.version || '';
        updateStatsLabel();
        updateTimeLabel();
        render();

        const startedAudio = await startAudioPlayback();
        if (!startedAudio) {
            startManualPlayback();
        }

        return true;
    } catch (error) {
        if (token !== state.loadToken) {
            return false;
        }

        console.error('[MapPreview] Failed to open map preview:', error);
        showNotification('Preview failed', 'Unable to render this map preview.', 'error');
        closeMapPreview();
        return false;
    }
};

export default {
    initMapPreview,
    openMapPreview,
    closeMapPreview
};
