/**
 * ListItemBuilder.js - List item DOM building module
 * Extracted from renderer.js (lines 1322-1900)
 */

import { getStarRatingColor, formatDuration, normalizeMetadata } from '../utils/Helpers.js';
import { isValidStarRating } from '../utils/Validation.js';
import { AudioController } from '../services/AudioController.js';
import { scheduleCoverLoad } from '../services/CoverLoader.js';
import { applyTimelineToBox } from '../services/TimelineRenderer.js';
import { beatmapApi } from '../bridge/Tauri.js';

// ============================================
// Constants
// ============================================

/** @type {number} Virtual item height including gap */
export const VIRTUAL_ITEM_HEIGHT = 182; // 170px + 12px gap

// ============================================
// List Item Building
// ============================================

/**
 * Build a complete list item DOM element
 * @param {Object} metadata - Beatmap metadata
 * @param {number} index - Item index
 * @param {Object} callbacks - Callback functions
 * @param {string} callbacks.viewMode - Current view mode ('all' | 'todo' | 'completed')
 * @param {Array<string>} callbacks.todoIds - Array of todo item IDs
 * @param {Array<string>} callbacks.doneIds - Array of done item IDs
 * @param {Function} callbacks.scheduleSave - Function to schedule a save
 * @param {Array<Object>} callbacks.beatmapItems - All beatmap items
 * @returns {HTMLElement} List box element
 */
export const buildListItem = (metadata, index, callbacks) => {
    const normalized = normalizeMetadata(metadata);
    const isDone = callbacks.doneIds.includes(normalized.id);
    const isTodoTab = callbacks.viewMode === 'todo';
    const isCompletedTab = callbacks.viewMode === 'completed';
    const isAllTab = callbacks.viewMode === 'all';
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

    // Determine cover URL - prefer coverUrl if already set, otherwise use convertFileSrc directly
    let coverUrl = normalized.coverUrl;
    if (!coverUrl && normalized.coverPath && beatmapApi?.convertFileSrc) {
        coverUrl = beatmapApi.convertFileSrc(normalized.coverPath);
    }

    if (coverUrl) {
        img.src = coverUrl;
        // Fallback to placeholder if the asset URL fails (e.g., file missing)
        img.onerror = () => {
            img.onerror = null;
            img.src = './assets/placeholder.png';
            img.classList.add('list-img--placeholder');
        };
    } else {
        img.src = './assets/placeholder.png';
        img.classList.add('list-img--placeholder');
        // Only schedule cover load if we have a coverPath but couldn't get URL
        if (normalized.coverPath) {
            scheduleCoverLoad(normalized.id, normalized.coverPath, {
                onSuccess: (loadedUrl) => {
                    img.src = loadedUrl;
                    img.classList.remove('list-img--placeholder');
                }
            });
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
        beatmapLink.dataset.itemId = normalized.id;
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
    folderLink.dataset.itemId = normalized.id;
    folderLink.dataset.path = normalized.filePath;

    const folderIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    folderIcon.setAttribute('viewBox', '0 0 512 512');
    folderIcon.classList.add('beatmap-link-icon');
    const folderPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    folderPath.setAttribute('d', 'M64 448l384 0c35.3 0 64-28.7 64-64l0-240c0-35.3-28.7-64-64-64L298.7 80c-6.9 0-13.7-2.2-19.2-6.4L241.1 44.8C230 36.5 216.5 32 202.7 32L64 32C28.7 32 0 60.7 0 96L0 384c0 35.3 28.7 64 64 64z');
    folderIcon.appendChild(folderPath);
    folderLink.appendChild(folderIcon);

    const mapPreviewLink = document.createElement('button');
    mapPreviewLink.type = 'button';
    mapPreviewLink.classList.add('beatmap-link');
    if (normalized.filePath) {
        mapPreviewLink.dataset.tooltip = 'Open map preview';
        mapPreviewLink.dataset.action = 'open-map-preview';
        mapPreviewLink.dataset.itemId = normalized.id;
    } else {
        mapPreviewLink.dataset.tooltip = 'Map path unavailable';
        mapPreviewLink.classList.add('beatmap-link--disabled');
    }

    const previewIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    previewIcon.setAttribute('viewBox', '0 0 576 512');
    previewIcon.classList.add('beatmap-link-icon');
    const previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    previewPath.setAttribute('d', 'M572.5 241.4C518.9 135.5 407.5 64 288 64S57.1 135.5 3.5 241.4a48.35 48.35 0 0 0 0 29.2C57.1 376.5 168.5 448 288 448s230.9-71.5 284.5-177.4a48.35 48.35 0 0 0 0-29.2zM288 384a128 128 0 1 1 128-128 128 128 0 0 1-128 128zm0-208a80 80 0 1 0 80 80 80 80 0 0 0-80-80z');
    previewIcon.appendChild(previewPath);
    mapPreviewLink.appendChild(previewIcon);

    const editorLink = document.createElement('button');
    editorLink.type = 'button';
    editorLink.classList.add('beatmap-link');
    if (normalized.filePath) {
        editorLink.dataset.tooltip = 'Open in text editor';
        editorLink.dataset.action = 'open-editor';
        editorLink.dataset.itemId = normalized.id;
        editorLink.dataset.path = normalized.filePath;
    } else {
        editorLink.dataset.tooltip = 'Map path unavailable';
        editorLink.classList.add('beatmap-link--disabled');
    }

    const editorIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    editorIcon.setAttribute('viewBox', '0 0 384 512');
    editorIcon.classList.add('beatmap-link-icon');
    const editorPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    editorPath.setAttribute('d', 'M64 0C28.7 0 0 28.7 0 64V448c0 35.3 28.7 64 64 64H320c35.3 0 64-28.7 64-64V160H256c-17.7 0-32-14.3-32-32V0H64zM256 0V128H384L256 0zM96 224c0-17.7 14.3-32 32-32H256c17.7 0 32 14.3 32 32s-14.3 32-32 32H128c-17.7 0-32-14.3-32-32zm32 96H256c17.7 0 32 14.3 32 32s-14.3 32-32 32H128c-17.7 0-32-14.3-32-32s14.3-32 32-32z');
    editorIcon.appendChild(editorPath);
    editorLink.appendChild(editorIcon);

    const actionLinks = document.createElement('div');
    actionLinks.classList.add('list-action-links');
    actionLinks.appendChild(beatmapLink);
    actionLinks.appendChild(mapPreviewLink);
    actionLinks.appendChild(folderLink);
    actionLinks.appendChild(editorLink);

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
    expansionArea.dataset.tab = callbacks.viewMode; // Add tab context for CSS styling

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
    const isPinned = callbacks.todoIds.includes(normalized.id);
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

    if (callbacks.viewMode === 'all' && callbacks.todoIds.includes(normalized.id)) {
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

            const input = document.createElement('input');
            input.type = 'text';
            input.inputMode = 'numeric';
            input.autocomplete = 'off';
            input.maxLength = 10;
            input.placeholder = 'dd/mm/yyyy';
            input.classList.add('date-picker-input');

            const formatInputAsTyped = (raw) => {
                const digits = raw.replace(/\D/g, '');
                let formatted = '';
                for (let i = 0; i < digits.length && i < 8; i++) {
                    if (i === 2 || i === 4) {
                        formatted += '/';
                    }
                    formatted += digits[i];
                }
                return formatted;
            };

            const parseInput = (str) => {
                if (!str) return null;
                if (window.GlobalDatePicker?.parseDDMMYYYY) {
                    return window.GlobalDatePicker.parseDDMMYYYY(str);
                }
                const parts = str.split('/');
                if (parts.length !== 3) return null;
                const day = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10) - 1;
                const year = parseInt(parts[2], 10);
                if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
                const date = new Date(year, month, day);
                if (date.getDate() !== day || date.getMonth() !== month || date.getFullYear() !== year) return null;
                return date;
            };

            const updateInputValue = (val) => {
                if (val) {
                    const d = new Date(val);
                    input.value = (window.GlobalDatePicker)
                        ? window.GlobalDatePicker.formatDDMMYYYY(d)
                        : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
                    input.classList.add('has-value');
                } else {
                    input.value = '';
                    input.classList.remove('has-value');
                }
            };
            updateInputValue(currentValue);

            const commitInputValue = () => {
                const raw = input.value.trim();
                if (!raw) {
                    currentValue = null;
                    updateInputValue(null);
                    onChange(null);
                    return;
                }

                const parsedDate = parseInput(raw);
                if (!parsedDate) {
                    updateInputValue(currentValue);
                    return;
                }

                parsedDate.setHours(23, 59, 59, 999);
                const nextValue = parsedDate.getTime();
                currentValue = nextValue;
                updateInputValue(nextValue);
                onChange(nextValue);
            };

            input.onclick = (e) => e.stopPropagation();

            input.addEventListener('input', (e) => {
                const cursorPos = input.selectionStart;
                const oldValue = input.value;
                const digits = oldValue.replace(/\D/g, '');
                const formatted = formatInputAsTyped(digits);
                if (formatted !== oldValue) {
                    input.value = formatted;
                    let newCursorPos = cursorPos;
                    if (cursorPos > 0) {
                        let slashCountBefore = 0;
                        for (let i = 0; i < cursorPos && i < oldValue.length; i++) {
                            if (oldValue[i] === '/') slashCountBefore++;
                        }
                        let digitCountBefore = cursorPos - slashCountBefore;
                        let newSlashCount = 0;
                        for (let i = 0; i < formatted.length && i < cursorPos; i++) {
                            if (formatted[i] === '/') newSlashCount++;
                        }
                        newCursorPos = digitCountBefore + newSlashCount;
                        if (newCursorPos > formatted.length) newCursorPos = formatted.length;
                    }
                    input.setSelectionRange(newCursorPos, newCursorPos);
                }
            });

            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commitInputValue();
                    input.blur();
                }
            });

            input.addEventListener('blur', commitInputValue);

            const calendarBtn = document.createElement('button');
            calendarBtn.type = 'button';
            calendarBtn.classList.add('date-picker-calendar-btn');
            calendarBtn.setAttribute('aria-label', 'Open calendar');
            calendarBtn.innerHTML = '<svg viewBox="0 0 448 512"><path d="M152 64c0-8.8-7.2-16-16-16s-16 7.2-16 16V96H64C28.7 96 0 124.7 0 160V448c0 35.3 28.7 64 64 64H384c35.3 0 64-28.7 64-64V160c0-35.3-28.7-64-64-64H328V64c0-8.8-7.2-16-16-16s-16 7.2-16 16V96H152V64zM416 224H32V160c0-17.7 14.3-32 32-32H120v32c0 8.8 7.2 16 16 16s16-7.2 16-16V128H296v32c0 8.8 7.2 16 16 16s16-7.2 16-16V128h56c17.7 0 32 14.3 32 32v64z"/></svg>';

            calendarBtn.onclick = (e) => {
                e.stopPropagation();
                if (window.GlobalDatePicker?._justClosedViaTrigger) {
                    window.GlobalDatePicker._justClosedViaTrigger = false;
                    return;
                }
                if (window.GlobalDatePicker) {
                    window.GlobalDatePicker.open(calendarBtn, currentValue, (newVal) => {
                        currentValue = newVal;
                        updateInputValue(newVal);
                        onChange(newVal);
                    });
                }
            };

            container.appendChild(input);
            container.appendChild(calendarBtn);
            return container;
        };

        const deadlinePicker = createCustomDatePicker(normalized.deadline, (newDeadline) => {
            // Update local data
            const itemIndex = callbacks.beatmapItems.findIndex(i => i.id === normalized.id);
            if (itemIndex !== -1) {
                callbacks.beatmapItems[itemIndex].deadline = newDeadline;
                callbacks.scheduleSave();

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
            const itemIndex = callbacks.beatmapItems.findIndex(i => i.id === normalized.id);
            if (itemIndex !== -1) {
                callbacks.beatmapItems[itemIndex].notes = e.target.value;
                callbacks.scheduleSave();
            }
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
            const itemIndex = callbacks.beatmapItems.findIndex(i => i.id === normalized.id);
            if (itemIndex !== -1) {
                const val = e.target.value;
                const rating = val === '' ? null : parseFloat(val);
                callbacks.beatmapItems[itemIndex].targetStarRating = rating;
                callbacks.scheduleSave();
                // Update the star tag dynamically
                if (listBox._updateStarTag) {
                    listBox._updateStarTag(rating);
                }
            }
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

    // Note: Click handler for expansion is handled by EventDelegation.js
    // to avoid duplicate handlers that would cancel each other out

    if (callbacks.viewMode === 'todo') {
        const num = document.createElement('span');
        num.classList.add('todo-number');
        num.textContent = `${index + 1}.`;
        details.appendChild(num);
    }

    listMain.appendChild(details);
    listMain.appendChild(rightPane);

    listBox.appendChild(listMain);

    // Apply timeline after DOM insertion
    requestAnimationFrame(() => {
        applyTimelineToBox(listBox, metadata);
    });

    return listBox;
};

/**
 * Apply calculated star tag state
 * @param {HTMLElement} tagElement - Star tag element
 * @param {number|null} rating - Star rating value
 */
export const applyCalculatedStarTagState = (tagElement, rating) => {
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

/**
 * Create a pin button element
 * @param {string} itemId - Item ID
 * @param {boolean} isTodo - Whether item is in todo
 * @param {Object} callbacks - Callback functions
 * @returns {HTMLButtonElement} Pin button element
 */
export const createPinButton = (itemId, isTodo, callbacks) => {
    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.classList.add('pin-btn');
    if (isTodo) {
        pinBtn.classList.add('is-active');
        pinBtn.dataset.tooltip = 'Unpin from Todo';
    } else {
        pinBtn.dataset.tooltip = 'Pin to Todo';
    }

    const pinSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pinSvg.setAttribute('viewBox', '0 0 384 512');
    pinSvg.setAttribute('aria-hidden', 'true');
    pinSvg.classList.add('pin-btn-icon');
    const pinPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pinPath.setAttribute('d', 'M32 32C32 14.3 46.3 0 64 0L320 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-29 0 0 160c0 17.1 6.8 33.5 19 45.7l44.3 44.3c14.1 14.1 21.4 33.1 20.3 52.8s-12.7 37.7-30.8 45.6c-10.3 4.5-21.5 6.8-32.8 6.8l-85 0 0 128c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-128-85 0c-11.3 0-22.5-2.3-32.8-6.8c-18.1-7.9-29.7-25.9-30.8-45.6s6.3-38.7 20.3-52.8L93 271.7c12.2-12.2 19-28.6 19-45.7l0-160-29 0c-17.7 0-32-14.3-32-32z');
    pinSvg.appendChild(pinPath);
    pinBtn.appendChild(pinSvg);

    pinBtn.dataset.action = 'toggle-pin';
    pinBtn.dataset.itemId = itemId;

    return pinBtn;
};

/**
 * Create a done button element
 * @param {string} itemId - Item ID
 * @param {boolean} isDone - Whether item is done
 * @param {Object} callbacks - Callback functions
 * @returns {HTMLButtonElement} Done button element
 */
export const createDoneButton = (itemId, isDone, callbacks) => {
    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.classList.add('done-btn');
    if (isDone) {
        doneBtn.classList.add('is-active');
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
    doneBtn.dataset.itemId = itemId;

    return doneBtn;
};

/**
 * Create metadata tags (creator, version, star ratings)
 * @param {Object} metadata - Beatmap metadata
 * @returns {DocumentFragment} Fragment containing tags
 */
export const createMetadataTags = (metadata) => {
    const normalized = normalizeMetadata(metadata);
    const fragment = document.createDocumentFragment();

    const creatorTag = document.createElement('span');
    creatorTag.classList.add('meta-tag');
    creatorTag.textContent = normalized.creator;
    creatorTag.dataset.tooltip = 'Mapper';
    fragment.appendChild(creatorTag);

    const versionTag = document.createElement('span');
    versionTag.classList.add('meta-tag');
    versionTag.textContent = normalized.version;
    versionTag.dataset.tooltip = 'Difficulty Name';
    fragment.appendChild(versionTag);

    if (isValidStarRating(normalized.starRating)) {
        const srTag = document.createElement('span');
        srTag.classList.add('meta-tag', 'meta-tag--star-rating');
        srTag.textContent = `${normalized.starRating.toFixed(2)}★`;
        srTag.dataset.tooltip = 'Calculated Star Rating';
        srTag.style.color = getStarRatingColor(normalized.starRating);
        fragment.appendChild(srTag);
    }

    return fragment;
};

/**
 * Create timeline canvas with click handler
 * @param {string} itemId - Item ID
 * @param {Object} callbacks - Callback functions
 * @returns {HTMLCanvasElement} Timeline canvas element
 */
export const createTimelineCanvas = (itemId, callbacks) => {
    const timeline = document.createElement('canvas');
    timeline.classList.add('list-timeline');
    timeline.setAttribute('aria-hidden', 'true');
    // Set a small default to avoid layout thrashing
    timeline.width = 400;
    timeline.height = 40;

    timeline.style.cursor = 'pointer';
    timeline.addEventListener('mousedown', (e) => {
        const rect = timeline.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = Math.min(Math.max(x / rect.width, 0), 1);

        AudioController.play(itemId, percentage);

        const onMouseMove = (moveEvent) => {
            const moveRect = timeline.getBoundingClientRect();
            const moveX = moveEvent.clientX - moveRect.left;
            const movePercentage = Math.min(Math.max(moveX / moveRect.width, 0), 1);
            AudioController.play(itemId, movePercentage);
        };

        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });

    return timeline;
};
