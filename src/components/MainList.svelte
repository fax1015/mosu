<script>
    import { onMount } from "svelte";
    import {
        coreGroupedItemsForView,
        coreItemsForView,
        coreState,
    } from "../stores/coreState";
    import { connectCoreState } from "../services/coreStateService";
    import { listUi } from "../stores/listUi";
    import { connectListUi } from "../services/listUiService";
    import { connectTodoOrder } from "../services/todoOrderService";
    import { connectGroupView } from "../services/groupViewService";
    import { connectItemDetails } from "../services/itemDetailsService";
    import {
        enableSvelteCompletedSurface,
        enableSvelteTodoSurface,
        enableSvelteAllSurface,
        enableSvelteGroupedSurface,
        disableSvelteCompletedSurface,
        disableSvelteTodoSurface,
        disableSvelteAllSurface,
        disableSvelteGroupedSurface,
    } from "../services/renderSurfaceService";
    import GroupedList from "./grouped/GroupedList.svelte";
    import CompletedList from "./list/CompletedList.svelte";
    import TodoList from "./list/TodoList.svelte";
    import AllList from "./list/AllList.svelte";

    $: isGroupedMode =
        !!$coreState.settings?.groupMapsBySong && $coreState.viewMode === "all";

    $: useSvelteGrouped = isGroupedMode;
    $: useSvelteAll = !isGroupedMode && $coreState.viewMode === "all";
    $: useSvelteTodo = !isGroupedMode && $coreState.viewMode === "todo";
    $: useSvelteCompleted =
        !isGroupedMode && $coreState.viewMode === "completed";
    $: useLegacyList = !(
        useSvelteGrouped ||
        useSvelteAll ||
        useSvelteTodo ||
        useSvelteCompleted
    );

    // Track which surfaces have ever been activated to avoid rendering before data is ready
    let hasMountedAll = false;
    let hasMountedTodo = false;
    let hasMountedCompleted = false;
    let hasMountedGrouped = false;

    $: if (useSvelteAll) hasMountedAll = true;
    $: if (useSvelteTodo) hasMountedTodo = true;
    $: if (useSvelteCompleted) hasMountedCompleted = true;
    $: if (useSvelteGrouped) hasMountedGrouped = true;

    onMount(() => {
        enableSvelteGroupedSurface();
        enableSvelteAllSurface();
        enableSvelteTodoSurface();
        enableSvelteCompletedSurface();
        const unsubscribeListUi = connectListUi();
        const unsubscribeCoreState = connectCoreState();
        const unsubscribeTodoOrder = connectTodoOrder();
        const unsubscribeGroupView = connectGroupView();
        const unsubscribeItemDetails = connectItemDetails();
        return () => {
            unsubscribeListUi?.();
            unsubscribeCoreState?.();
            unsubscribeTodoOrder?.();
            unsubscribeGroupView?.();
            unsubscribeItemDetails?.();
            disableSvelteCompletedSurface();
            disableSvelteTodoSurface();
            disableSvelteAllSurface();
            disableSvelteGroupedSurface();
        };
    });
</script>

<div class="main-container">
    <div class="section-container">
        <div
            class="loading-overlay {$listUi.isLoading ? '' : 'is-hidden'}"
            id="loadingSpinner"
            aria-live="polite"
            aria-label="Loading"
        >
            <div class="loading-content">
                <svg
                    class="loading-spinner"
                    viewBox="0 0 40 40"
                    height="40"
                    width="40"
                    aria-hidden="true"
                >
                    <circle
                        class="spinner-track"
                        cx="20"
                        cy="20"
                        r="17.5"
                        pathlength="100"
                        stroke-width="5px"
                        fill="none"
                    />
                    <circle
                        class="spinner-car"
                        cx="20"
                        cy="20"
                        r="17.5"
                        pathlength="100"
                        stroke-width="5px"
                        fill="none"
                    />
                </svg>
                <div
                    class="loading-progress {$listUi.progressVisible
                        ? ''
                        : 'is-hidden'}"
                    id="loadingProgress"
                >
                    <div class="progress-bar">
                        <div
                            class="progress-bar-fill"
                            id="progressBarFill"
                            style:width={`${$listUi.progressPct}%`}
                        ></div>
                    </div>
                    <p class="progress-label" id="progressLabel">
                        {$listUi.progressLabel}
                    </p>
                </div>
            </div>
        </div>
        <p
            class="empty-state {(isGroupedMode
                ? ($coreGroupedItemsForView || []).length
                : ($coreItemsForView || []).length) === 0 && !$listUi.isLoading
                ? 'is-active'
                : ''}"
            id="emptyState"
        >
            No maps here~
        </p>
        <div
            class="list-container"
            id="listContainer"
            hidden={!useLegacyList}
        ></div>
        <!-- Keep-alive pattern: mount once, hide/show with CSS to avoid expensive remounts -->
        {#if hasMountedAll}
            <div
                class="list-container"
                id="svelteAllListContainer"
                hidden={!useSvelteAll}
            >
                <AllList />
            </div>
        {/if}
        {#if hasMountedTodo}
            <div
                class="list-container"
                id="svelteTodoListContainer"
                hidden={!useSvelteTodo}
            >
                <TodoList />
            </div>
        {/if}
        {#if hasMountedCompleted}
            <div
                class="list-container"
                id="svelteCompletedListContainer"
                hidden={!useSvelteCompleted}
            >
                <CompletedList />
            </div>
        {/if}
        {#if hasMountedGrouped}
            <div
                class="list-container view-grouped"
                id="svelteGroupedListContainer"
                hidden={!useSvelteGrouped}
            >
                <GroupedList />
            </div>
        {/if}
    </div>
</div>
