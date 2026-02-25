<script>
  import {
    openWeb,
    showFolder,
    toggleDone,
  } from "../../services/listItemActionsService";

  const PLACEHOLDER_COVER_SRC = "./assets/placeholder.png";

  export let item = null;

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

  $: beatmapWebUrl = getBeatmapWebUrl(item?.beatmapSetID);
  $: hasFolderPath = !!String(item?.filePath || "").trim();

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

  const handleCoverError = () => {
    coverLoadFailed = true;
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

  const handleToggleDone = () => {
    if (!itemId) return;
    toggleDone(itemId);
  };
</script>

<div class="list-box list-box--flow is-done" data-item-id={itemId}>
  <div class="list-main">
    <div class="list-details">
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
      <button
        type="button"
        class="done-btn is-active"
        aria-label="Mark as not completed"
        data-tooltip="Mark as not completed"
        on:click={handleToggleDone}
      >
        <svg viewBox="0 0 448 512" class="done-btn-icon" aria-hidden="true">
          <path
            d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"
          ></path>
        </svg>
      </button>
    </div>
  </div>
</div>
