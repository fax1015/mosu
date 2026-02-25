<script>
  import { onMount, tick } from "svelte";
  import { filterControls } from "../stores/filterControls";
  import { coreItemsForView, coreTabStats } from "../stores/coreState";
  import {
    connectFilterControls,
    setSearchQuery,
    setSortMode,
    setStarRange,
    setViewMode,
  } from "../services/filterControlsService";
  import { connectCoreState } from "../services/coreStateService";
  import { clearAllBeatmaps } from "../services/primaryActionsService";

  const sortLabels = {
    dateAdded: "Date added",
    dateModified: "Date modified",
    name: "Name",
    progress: "Progress",
    starRating: "Star rating",
  };

  // Star rating color helper (interpolates between colors like the legacy renderer)
  const getStarRatingColor = (rating) => {
    const r = Math.max(0, Math.min(15, rating));

    // Define color stops: [starRating, r, g, b]
    // Offset by 0.3 larger than original thresholds
    const colorStops = [
      [0.3, 79, 192, 255], // #4fc0ff - light blue
      [2.3, 124, 255, 79], // #7cff4f - green
      [3.0, 246, 240, 92], // #f6f05c - yellow
      [4.3, 255, 78, 111], // #ff4e6f - red/pink
      [5.6, 198, 69, 184], // #c645b8 - purple
      [6.8, 101, 99, 222], // #6563de - blue/purple
      [10.3, 0, 0, 0], // black
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

  let menuToggleEl;
  let headerMenuEl;
  let sortDropdownEl;
  let sliderContainerEl;

  let isHeaderMenuOpen = false;
  let isSortMenuOpen = false;

  let srMinValue = 0;
  let srMaxValue = 10;

  $: activeViewMode = $filterControls.viewMode;
  $: activeSortMode = $filterControls.sortState.mode;
  $: activeSortDirection = $filterControls.sortState.direction;
  $: activeSearchQuery = $filterControls.searchQuery;
  $: activeSortLabel = sortLabels[activeSortMode] || "Date added";

  // Sync store values to local state (one-way sync from store to UI)
  $: {
    const nextMin = Number($filterControls.srFilter.min ?? 0);
    const nextMax = Number($filterControls.srFilter.max ?? 10);
    if (!Number.isNaN(nextMin)) {
      srMinValue = nextMin;
    }
    if (!Number.isNaN(nextMax)) {
      srMaxValue = nextMax;
    }
  }

  // Update visual handles when values change
  $: updateVisualHandles(srMinValue, srMaxValue);

  $: if (!isHeaderMenuOpen) {
    isSortMenuOpen = false;
  }

  // Re-render handles when menu opens — the container has no layout width while closed.
  $: if (isHeaderMenuOpen) {
    tick().then(() => updateVisualHandles(srMinValue, srMaxValue));
  }

  const updateVisualHandles = (min, max) => {
    if (!sliderContainerEl) return;

    const minHandle = document.getElementById("srMinHandle");
    const maxHandle = document.getElementById("srMaxHandle");
    const track = document.querySelector(".range-track");

    if (!minHandle || !maxHandle || !track) return;

    const containerWidth = sliderContainerEl.clientWidth || 180;
    const sideCushion = 4;
    const handleWidth = 30;
    const travelWidth = containerWidth - sideCushion * 2 - handleWidth;

    // Update handle text
    minHandle.textContent = min.toFixed(1);
    if (max >= 10) {
      maxHandle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" width="14" height="14" fill="currentColor"><path d="M0 256c0-88.4 71.6-160 160-160 50.4 0 97.8 23.7 128 64l32 42.7 32-42.7c30.2-40.3 77.6-64 128-64 88.4 0 160 71.6 160 160S568.4 416 480 416c-50.4 0-97.8-23.7-128-64l-32-42.7-32 42.7c-30.2 40.3-77.6 64-128 64-88.4 0-160-71.6-160-160zm280 0l-43.2-57.6c-18.1-24.2-46.6-38.4-76.8-38.4-53 0-96 43-96 96s43 96 96 96c30.2 0 58.7-14.2 76.8-38.4L280 256zm80 0l43.2 57.6c18.1 24.2 46.6 38.4 76.8 38.4 53 0 96-43 96-96s-43-96-96-96c-30.2 0-58.7 14.2-76.8 38.4L360 256z"/></svg>`;
    } else {
      maxHandle.textContent = max.toFixed(1);
    }

    // Update handle colors
    minHandle.style.background = getStarRatingColor(min);
    minHandle.style.color =
      min > 6.5 ? "var(--text-primary)" : "var(--bg-tertiary)";

    const isMaxInfinity = max >= 10;
    maxHandle.style.background = isMaxInfinity
      ? "var(--bg-tertiary)"
      : getStarRatingColor(max);
    maxHandle.style.color =
      isMaxInfinity || max > 6.5 ? "var(--text-primary)" : "var(--bg-tertiary)";

    // Set handle positions
    const left1 = sideCushion + (min / 10) * travelWidth;
    const left2 = sideCushion + (max / 10) * travelWidth;

    minHandle.style.left = `${left1}px`;
    maxHandle.style.left = `${left2}px`;

    // Position track
    const gradientGap = 4;
    const clipStart =
      ((left1 + handleWidth + gradientGap) / containerWidth) * 100;
    const clipEnd = ((left2 - gradientGap) / containerWidth) * 100;

    if (clipEnd > clipStart) {
      track.style.display = "block";
      track.style.clipPath = `inset(0 ${100 - clipEnd}% 0 ${clipStart}%)`;
    } else {
      track.style.display = "none";
    }
  };

  const handleRangeInput = (event) => {
    const id = event?.currentTarget?.id;
    let freshValue = Number(event.currentTarget.value);
    const activeHandle = id === "srMin" ? "min" : id === "srMax" ? "max" : null;

    const containerWidth = sliderContainerEl?.clientWidth || 180;
    const sideCushion = 4;
    const handleWidth = 30;
    const travelWidth = containerWidth - sideCushion * 2 - handleWidth;

    // Calculate the physical value gap so handles don't visually overlap (30px + 4px padding)
    const srGapPerPx = 10 / travelWidth;
    const minSRGap = (handleWidth + 4) * srGapPerPx;

    // Update local variables immediately so updateVisualHandles uses correct values
    if (id === "srMin") {
      if (freshValue > srMaxValue - minSRGap) {
        freshValue = Math.max(0, srMaxValue - minSRGap);
      }
      srMinValue = freshValue;
    } else if (id === "srMax") {
      if (freshValue < srMinValue + minSRGap) {
        freshValue = Math.min(10, srMinValue + minSRGap);
      }
      srMaxValue = freshValue;
    }

    setStarRange(srMinValue, srMaxValue, activeHandle);
  };

  onMount(() => {
    const unsubscribeFilters = connectFilterControls();
    const unsubscribeCoreState = connectCoreState();

    const onDocumentClick = (event) => {
      const target = event.target;
      const clickedMenuToggle = menuToggleEl?.contains(target);
      const clickedHeaderMenu = headerMenuEl?.contains(target);
      const clickedSortDropdown = sortDropdownEl?.contains(target);

      if (isSortMenuOpen && !clickedSortDropdown) {
        isSortMenuOpen = false;
      }

      if (isHeaderMenuOpen && !clickedMenuToggle && !clickedHeaderMenu) {
        isHeaderMenuOpen = false;
      }
    };

    document.addEventListener("click", onDocumentClick);

    return () => {
      unsubscribeFilters?.();
      unsubscribeCoreState?.();
      document.removeEventListener("click", onDocumentClick);
    };
  });
</script>

<div class="sticky-header-container">
  <div class="tabs-bar">
    <button
      type="button"
      class="tab-button {activeViewMode === 'all' ? 'is-active' : ''}"
      data-tab="all"
      on:click={() => setViewMode("all")}
    >
      All
      <span class="tab-count" id="allCount">{$coreTabStats.all}</span>
    </button>
    <button
      type="button"
      class="tab-button {activeViewMode === 'todo' ? 'is-active' : ''}"
      data-tab="todo"
      on:click={() => setViewMode("todo")}
    >
      Todo
      <span class="tab-count" id="todoCount">{$coreTabStats.todo}</span>
    </button>
    <button
      type="button"
      class="tab-button {activeViewMode === 'completed' ? 'is-active' : ''}"
      data-tab="completed"
      on:click={() => setViewMode("completed")}
    >
      Completed
      <span class="tab-count" id="completedCount"
        >{$coreTabStats.completed}</span
      >
    </button>
    <div class="tabs-actions">
      <button
        bind:this={menuToggleEl}
        type="button"
        class="secondary-button icon-button"
        id="menuToggle"
        aria-expanded={isHeaderMenuOpen ? "true" : "false"}
        aria-label="Filter"
        data-tooltip="Filter options"
        on:click={() => {
          isHeaderMenuOpen = !isHeaderMenuOpen;
        }}
      >
        <svg class="icon-button-icon" viewBox="0 0 512 512" aria-hidden="true">
          <path
            d="M32 64C19.1 64 7.4 71.8 2.4 83.8S.2 109.5 9.4 118.6L192 301.3 192 416c0 8.5 3.4 16.6 9.4 22.6l64 64c9.2 9.2 22.9 11.9 34.9 6.9S320 492.9 320 480l0-178.7 182.6-182.6c9.2-9.2 11.9-22.9 6.9-34.9S492.9 64 480 64L32 64z"
          />
        </svg>
      </button>
      <button
        type="button"
        class="secondary-button {$coreItemsForView.length > 0
          ? ''
          : 'is-hidden'}"
        id="clearAllBtn"
        on:click={clearAllBeatmaps}
        data-tooltip="Clear all beatmaps">Clear all</button
      >
    </div>
  </div>

  <div
    bind:this={headerMenuEl}
    class="header-menu"
    id="headerMenu"
    aria-label="Filter"
    class:is-open={isHeaderMenuOpen}
  >
    <div class="header-menu-inner">
      <div
        bind:this={sortDropdownEl}
        class="sort-dropdown"
        id="sortDropdown"
        class:is-open={isSortMenuOpen}
      >
        <button
          type="button"
          class="sort-trigger"
          id="sortTrigger"
          aria-expanded={isSortMenuOpen ? "true" : "false"}
          on:click={() => {
            isSortMenuOpen = !isSortMenuOpen;
          }}
        >
          <span class="sort-label" id="sortLabel">{activeSortLabel}</span>
          <span
            class="sort-direction"
            id="sortDirection"
            data-direction={activeSortDirection}
          >
            <svg viewBox="0 0 448 512">
              <path
                d="M201.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 338.7 54.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"
              />
            </svg>
          </span>
        </button>
        <div class="sort-menu" id="sortMenu" role="menu">
          <button
            type="button"
            class="sort-option {activeSortMode === 'dateAdded'
              ? 'is-active'
              : ''}"
            data-sort="dateAdded"
            data-label="Date added"
            on:click={() => {
              setSortMode("dateAdded");
              isSortMenuOpen = false;
            }}>Date added</button
          >
          <button
            type="button"
            class="sort-option {activeSortMode === 'dateModified'
              ? 'is-active'
              : ''}"
            data-sort="dateModified"
            data-label="Date modified"
            on:click={() => {
              setSortMode("dateModified");
              isSortMenuOpen = false;
            }}>Date modified</button
          >
          <button
            type="button"
            class="sort-option {activeSortMode === 'name' ? 'is-active' : ''}"
            data-sort="name"
            data-label="Name"
            on:click={() => {
              setSortMode("name");
              isSortMenuOpen = false;
            }}>Name</button
          >
          <button
            type="button"
            class="sort-option {activeSortMode === 'progress'
              ? 'is-active'
              : ''}"
            data-sort="progress"
            data-label="Progress"
            on:click={() => {
              setSortMode("progress");
              isSortMenuOpen = false;
            }}>Progress</button
          >
          <button
            type="button"
            class="sort-option {activeSortMode === 'starRating'
              ? 'is-active'
              : ''}"
            data-sort="starRating"
            data-label="Star rating"
            on:click={() => {
              setSortMode("starRating");
              isSortMenuOpen = false;
            }}>Star rating</button
          >
        </div>
      </div>
      <div class="control-group">
        <label class="control-label" for="searchInput">Search</label>
        <input
          id="searchInput"
          class="control-input"
          type="search"
          placeholder="Search maps..."
          value={activeSearchQuery}
          on:input={(event) => setSearchQuery(event.currentTarget.value)}
        />
      </div>
      <div class="sr-range-group">
        <div class="sr-range-title">Star Rating</div>
        <div bind:this={sliderContainerEl} class="range-slider-container">
          <div class="range-track"></div>
          <div class="range-handle-value" id="srMinHandle">0.0</div>
          <div class="range-handle-value" id="srMaxHandle">10.0</div>
          <input
            type="range"
            id="srMin"
            min="0"
            max="10"
            step="0.1"
            bind:value={srMinValue}
            on:input={handleRangeInput}
            aria-label="Minimum Star Rating"
          />
          <input
            type="range"
            id="srMax"
            min="0"
            max="10"
            step="0.1"
            bind:value={srMaxValue}
            on:input={handleRangeInput}
            aria-label="Maximum Star Rating"
          />
        </div>
      </div>
    </div>
  </div>
</div>
