<script>
    /**
     * VirtualList – renders only visible items using absolute positioning.
     * Mirrors the legacy renderer's syncVirtualList approach.
     *
     * Props:
     *   items      – string[] of item IDs in display order
     *   itemHeight – fixed row height in px (must match CSS)
     *   overscan   – extra rows to render above/below the viewport
     */
    import { onMount, onDestroy, afterUpdate } from "svelte";
    import LegacyListBoxHost from "./LegacyListBoxHost.svelte";

    export let items = [];
    export let itemHeight = 182;
    export let overscan = 5;

    let containerEl;
    let scrollY = 0;
    let viewportH = 800;
    let cachedTop = 0; // absolute page-Y of the container top

    // Recalculate visible slice every scroll / resize
    $: totalHeight = items.length * itemHeight;
    $: startIdx = Math.max(
        0,
        Math.floor((scrollY - cachedTop) / itemHeight) - overscan,
    );
    $: endIdx = Math.min(
        items.length,
        Math.ceil((scrollY - cachedTop + viewportH) / itemHeight) + overscan,
    );
    $: visibleItems = items.slice(startIdx, endIdx);

    const measure = () => {
        if (!containerEl) return;
        cachedTop = containerEl.getBoundingClientRect().top + window.scrollY;
    };

    let rafId = 0;
    const onScroll = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            rafId = 0;
            scrollY = window.scrollY;
        });
    };

    const onResize = () => {
        viewportH = window.innerHeight;
        measure();
    };

    onMount(() => {
        scrollY = window.scrollY;
        viewportH = window.innerHeight;
        measure();
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onResize, { passive: true });
    });

    onDestroy(() => {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onResize);
        if (rafId) cancelAnimationFrame(rafId);
    });

    // Re-measure after the DOM updates (items list may have changed height)
    afterUpdate(measure);
</script>

<div
    class="virtual-list"
    bind:this={containerEl}
    style:height="{totalHeight}px"
>
    {#each visibleItems as itemId, i (itemId)}
        {@const absIdx = startIdx + i}
        <div class="virtual-row" style:top="{absIdx * itemHeight}px">
            <LegacyListBoxHost
                {itemId}
                index={absIdx}
                options={{ flow: true }}
            />
        </div>
    {/each}
</div>

<style>
    .virtual-list {
        position: relative;
        width: 100%;
    }
    .virtual-row {
        position: absolute;
        width: 100%;
        /* Height must match itemHeight prop but we can't pass a prop to style in a scoped block.
       The LegacyListBoxHost renders into this div and sets its own height. */
    }
</style>
