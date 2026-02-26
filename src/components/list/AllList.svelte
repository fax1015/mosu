<script>
  import { coreItemsForView, coreState } from "../../stores/coreState";
  import LegacyListBoxHost from "./LegacyListBoxHost.svelte";

  // Freeze item list when this view is hidden — avoids clearing and rebuilding
  // rows when switching to another tab/view, making switching back instant.
  let frozenItems = [];

  const getItemId = (item) => String(item?.id || "");

  $: isGroupedMode =
    !!$coreState.settings?.groupMapsBySong && $coreState.viewMode === "all";

  $: isActiveView = !isGroupedMode && $coreState.viewMode === "all";

  $: if (isActiveView) {
    frozenItems = $coreItemsForView || [];
  }
</script>

{#each frozenItems as item, index (`${getItemId(item)}::${index}`)}
  {#if getItemId(item)}
    <LegacyListBoxHost
      itemId={getItemId(item)}
      {index}
      options={{ flow: true }}
    />
  {/if}
{/each}
