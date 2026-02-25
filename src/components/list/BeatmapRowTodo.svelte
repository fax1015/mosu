<script>
  import { coreState } from "../../stores/coreState";
  import { itemDetailsById } from "../../stores/itemDetails";
  import {
    setItemDeadline,
    setItemNotes,
    setItemTargetStar,
  } from "../../services/itemDetailsService";
  import {
    openWeb,
    showFolder,
    toggleDone,
    toggleTodo,
  } from "../../services/listItemActionsService";
  import { reorderTodo } from "../../services/todoOrderService";

  const PLACEHOLDER_COVER_SRC = "./assets/placeholder.png";

  export let item = null;
  export let index = 0;
  export let todoIds = [];
  export let previousTodoId = "";
  export let nextTodoId = "";

  let coverLoadFailed = false;

  $: itemId = String(item?.id || "");
  $: artistText = String(item?.artistUnicode || item?.artist || "Unknown Artist");
  $: titleText = String(item?.titleUnicode || item?.title || "Unknown Title");
  $: versionText = String(item?.version || "Unknown Difficulty");
  $: creatorText = String(item?.creator || "Unknown Mapper");
  $: displayTitle = `${artistText} - ${titleText}`;

  $: coverSrc =
    !coverLoadFailed && item?.coverUrl ? item.coverUrl : PLACEHOLDER_COVER_SRC;
  $: isPlaceholderCover = coverSrc === PLACEHOLDER_COVER_SRC;

  $: coreTodoIds = $coreState.todoIds || [];
  $: doneIds = $coreState.doneIds || [];
  $: isPinned = !!itemId && coreTodoIds.includes(itemId);
  $: isDone = !!itemId && doneIds.includes(itemId);

  $: detail = itemId ? $itemDetailsById.get(itemId) : null;
  $: notesText = String(detail?.notes ?? item?.notes ?? "");
  $: targetStarValue =
    typeof detail?.targetStarRating === "number"
      ? detail.targetStarRating
      : typeof item?.targetStarRating === "number"
        ? item.targetStarRating
        : null;
  $: deadlineValue =
    typeof detail?.deadline === "number"
      ? detail.deadline
      : typeof item?.deadline === "number"
        ? item.deadline
        : null;

  $: deadlineInputValue = formatDateInput(deadlineValue);
  $: deadlineStatusClass = getDeadlineStatusClass(deadlineValue, isDone);

  $: beatmapWebUrl = getBeatmapWebUrl(item?.beatmapSetID);
  $: hasFolderPath = !!String(item?.filePath || "").trim();

  $: normalizedTodoIds = Array.isArray(todoIds)
    ? todoIds.map((id) => String(id || "")).filter(Boolean)
    : [];
  $: currentTodoIndex = itemId ? normalizedTodoIds.indexOf(itemId) : -1;
  $: fallbackPreviousTodoId =
    currentTodoIndex > 0 ? normalizedTodoIds[currentTodoIndex - 1] : "";
  $: fallbackNextTodoId =
    currentTodoIndex > -1 && currentTodoIndex < normalizedTodoIds.length - 1
      ? normalizedTodoIds[currentTodoIndex + 1]
      : "";
  $: resolvedPreviousTodoId = String(previousTodoId || fallbackPreviousTodoId || "");
  $: resolvedNextTodoId = String(nextTodoId || fallbackNextTodoId || "");
  $: canMoveUp = !!itemId && !!resolvedPreviousTodoId && resolvedPreviousTodoId !== itemId;
  $: canMoveDown = !!itemId && !!resolvedNextTodoId && resolvedNextTodoId !== itemId;

  const getBeatmapWebUrl = (beatmapSetID) => {
    if (!beatmapSetID) return "";
    const raw = String(beatmapSetID).trim();
    if (!raw) return "";
    if (raw.startsWith("http")) return raw;

    const idNum = Number(raw);
    if (Number.isFinite(idNum) && idNum > 0) {
      return `https://osu.ppy.sh/beatmapsets/${idNum}`;
    }

    return "";
  };

  const formatDateInput = (deadlineMs) => {
    if (typeof deadlineMs !== "number" || !Number.isFinite(deadlineMs)) return "";
    const date = new Date(deadlineMs);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const parseDateInput = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const parsed = Date.parse(`${raw}T00:00:00`);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const getDeadlineStatusClass = (deadlineMs, done) => {
    if (done) return "";
    if (typeof deadlineMs !== "number" || !Number.isFinite(deadlineMs)) return "";

    const diffDays = (deadlineMs - Date.now()) / (1000 * 60 * 60 * 24);
    if (diffDays < 0) return "list-box--overdue";
    if (diffDays <= 3) return "list-box--due-soon";
    return "";
  };

  const handleCoverError = () => {
    coverLoadFailed = true;
  };

  const handleTogglePin = () => {
    if (!itemId) return;
    toggleTodo(itemId);
  };

  const handleToggleDone = () => {
    if (!itemId) return;
    toggleDone(itemId);
  };

  const handleOpenWeb = () => {
    if (!beatmapWebUrl) return;
    openWeb(beatmapWebUrl);
  };

  const handleShowFolder = () => {
    const filePath = String(item?.filePath || "").trim();
    if (!filePath) return;
    showFolder(filePath);
  };

  const handleNotesInput = (event) => {
    if (!itemId) return;
    setItemNotes(itemId, event?.target?.value || "");
  };

  const handleTargetStarInput = (event) => {
    if (!itemId) return;
    const raw = String(event?.target?.value || "").trim();
    const parsed = raw === "" ? null : Number.parseFloat(raw);
    setItemTargetStar(itemId, Number.isFinite(parsed) ? parsed : null);
  };

  const handleDeadlineInput = (event) => {
    if (!itemId) return;
    setItemDeadline(itemId, parseDateInput(event?.target?.value));
  };

  const handleClearDeadline = () => {
    if (!itemId) return;
    setItemDeadline(itemId, null);
  };

  const handleMoveUp = () => {
    if (!canMoveUp) return;
    reorderTodo(itemId, resolvedPreviousTodoId);
  };

  const handleMoveDown = () => {
    if (!canMoveDown) return;
    reorderTodo(itemId, resolvedNextTodoId);
  };
</script>

<div
  class="list-box list-box--flow expanded {isPinned ? 'is-pinned' : ''} {isDone
    ? 'is-done'
    : ''} {deadlineStatusClass}"
  data-item-id={itemId}
>
  <div class="list-main">
    <div class="list-details">
      <span class="todo-number">{index + 1}.</span>

      <div class="list-img">
        <img
          src={coverSrc}
          alt={displayTitle}
          loading="lazy"
          decoding="async"
          class:list-img--placeholder={isPlaceholderCover}
          on:error={handleCoverError}
        />
      </div>

      <div class="list-action-links">
        <button
          type="button"
          class="beatmap-link"
          aria-label="Move up"
          data-tooltip="Move up"
          on:click={handleMoveUp}
          disabled={!canMoveUp}
        >
          ▲
        </button>

        <button
          type="button"
          class="beatmap-link"
          aria-label="Move down"
          data-tooltip="Move down"
          on:click={handleMoveDown}
          disabled={!canMoveDown}
        >
          ▼
        </button>

        <button
          type="button"
          class="beatmap-link {beatmapWebUrl ? '' : 'beatmap-link--disabled'}"
          aria-label={beatmapWebUrl ? "Open beatmap in browser" : "Beatmap not uploaded"}
          data-tooltip={beatmapWebUrl ? "Open in browser" : "Not uploaded"}
          on:click={handleOpenWeb}
        >
          <svg viewBox="0 0 512 512" class="beatmap-link-icon" aria-hidden="true">
            <path
              d="M320 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l82.7 0-201.4 201.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L448 109.3 448 192c0 17.7 14.3 32 32 32s32-14.3 32-32l0-160c0-17.7-14.3-32-32-32L320 0zM80 96C35.8 96 0 131.8 0 176L0 432c0 44.2 35.8 80 80 80l256 0c44.2 0 80-35.8 80-80l0-80c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 80c0 8.8-7.2 16-16 16L80 448c-8.8 0-16-7.2-16-16l0-256c0-8.8 7.2-16 16-16l80 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L80 96z"
            ></path>
          </svg>
        </button>

        <button
          type="button"
          class="beatmap-link {hasFolderPath ? '' : 'beatmap-link--disabled'}"
          aria-label={hasFolderPath ? "Show beatmap in folder" : "Folder path unavailable"}
          data-tooltip={hasFolderPath ? "Show in folder" : "Folder path unavailable"}
          on:click={handleShowFolder}
        >
          <svg viewBox="0 0 512 512" class="beatmap-link-icon" aria-hidden="true">
            <path
              d="M64 448l384 0c35.3 0 64-28.7 64-64l0-240c0-35.3-28.7-64-64-64L298.7 80c-6.9 0-13.7-2.2-19.2-6.4L241.1 44.8C230 36.5 216.5 32 202.7 32L64 32C28.7 32 0 60.7 0 96L0 384c0 35.3 28.7 64 64 64z"
            ></path>
          </svg>
        </button>
      </div>

      <h3 class="list-title">{displayTitle}</h3>

      <div class="list-meta">
        <span class="meta-tag" data-tooltip="Mapper">{creatorText}</span>
        <span class="meta-tag" data-tooltip="Difficulty Name">{versionText}</span>
      </div>
    </div>

    <div class="list-right">
      <div class="timeline-container" aria-hidden="true">
        <div class="list-timeline"></div>

        <div class="extra-info-pane" data-tab="todo">
          <div class="expansion-content">
            <div class="notes-container">
              <textarea
                class="notes-textarea"
                placeholder="Add notes..."
                value={notesText}
                on:click|stopPropagation
                on:input={handleNotesInput}
              ></textarea>
            </div>

            <div class="expansion-controls">
              <div class="deadline-container">
                <label class="deadline-label" for={`deadline-${itemId}`}>Deadline:</label>
                <input
                  id={`deadline-${itemId}`}
                  type="date"
                  class="control-input"
                  value={deadlineInputValue}
                  on:click|stopPropagation
                  on:change={handleDeadlineInput}
                />
                <button
                  type="button"
                  class="date-picker-btn date-picker-btn--clear"
                  aria-label="Clear deadline"
                  data-tooltip="Clear deadline"
                  on:click|stopPropagation={handleClearDeadline}
                >
                  Clear
                </button>
              </div>

              <div class="target-star-container">
                <label class="target-star-label" for={`target-star-${itemId}`}>
                  Target star rating:
                </label>
                <input
                  id={`target-star-${itemId}`}
                  type="number"
                  step="0.1"
                  min="0"
                  max="15"
                  class="target-star-input"
                  value={targetStarValue ?? ""}
                  on:click|stopPropagation
                  on:input={handleTargetStarInput}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        class="done-btn"
        aria-label="Mark as completed"
        data-tooltip="Mark as completed"
        on:click={handleToggleDone}
      >
        <svg viewBox="0 0 448 512" class="done-btn-icon" aria-hidden="true">
          <path
            d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"
          ></path>
        </svg>
      </button>

      <button
        type="button"
        class="pin-btn is-todo-tab {isPinned ? 'is-active' : ''}"
        aria-label="Remove from Todo"
        data-tooltip="Remove from Todo"
        on:click={handleTogglePin}
      >
        <svg viewBox="0 0 384 512" class="pin-btn-icon" aria-hidden="true">
          <path
            d="M32 32C32 14.3 46.3 0 64 0L320 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-29 0 0 160c0 17.1 6.8 33.5 19 45.7l44.3 44.3c14.1 14.1 21.4 33.1 20.3 52.8s-12.7 37.7-30.8 45.6c-10.3 4.5-21.5 6.8-32.8 6.8l-85 0 0 128c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-128-85 0c-11.3 0-22.5-2.3-32.8-6.8c-18.1-7.9-29.7-25.9-30.8-45.6s6.3-38.7 20.3-52.8L93 271.7c12.2-12.2 19-28.6 19-45.7l0-160-29 0c-17.7 0-32-14.3-32-32z"
          ></path>
        </svg>
      </button>
    </div>
  </div>
</div>
