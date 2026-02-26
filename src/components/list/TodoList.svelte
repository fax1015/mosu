<script>
  import { coreBeatmapMap, coreItemsForView, coreState } from "../../stores/coreState";
  import { todoOrder } from "../../stores/todoOrder";
  import LegacyListBoxHost from "./LegacyListBoxHost.svelte";

  let frozenItems = [];
  let orderedTodoIds = [];

  const getItemId = (item) => String(item?.id || "");

  $: isGroupedMode =
    !!$coreState.settings?.groupMapsBySong && $coreState.viewMode === "all";

  $: isActiveView = !isGroupedMode && $coreState.viewMode === "todo";

  $: if (isActiveView) {
    const orderedIds = $todoOrder.todoIds || [];
    const visibleIds = new Set(($coreItemsForView || []).map((item) => getItemId(item)).filter(Boolean));
    frozenItems = orderedIds
      .filter((id) => visibleIds.has(id) && $coreBeatmapMap.has(id))
      .map((id) => $coreBeatmapMap.get(id))
      .filter(Boolean);

    orderedTodoIds = frozenItems.map((item) => getItemId(item)).filter(Boolean);
  } else {
    frozenItems = [];
    orderedTodoIds = [];
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
