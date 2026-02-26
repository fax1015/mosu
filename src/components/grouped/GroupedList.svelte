<script>
  import {
    coreBeatmapMap,
    coreGroupedItemsForView,
    coreState,
  } from "../../stores/coreState";
  import { groupView } from "../../stores/groupView";
  import GroupedRow from "./GroupedRow.svelte";

  // Freeze the group list when grouped mode is off — the component is hidden so
  // there's no need to destroy/recreate GroupedRow instances. We keep the last
  // known groups so that toggling back is instant (the rows are already mounted).
  let frozenGroups = [];

  $: isGroupedMode =
    !!$coreState.settings?.groupMapsBySong && $coreState.viewMode === "all";

  // Use coreGroupedItemsForView to compute grouped view instantly (and with correct sort order!)
  $: if (isGroupedMode) {
    frozenGroups = $coreGroupedItemsForView || [];
  }

  $: expandedSet = new Set($groupView.expandedKeys || []);

  $: displayGroups = frozenGroups.map((group) => {
    // coreGroupedItemsForView gives us group.items directly
    const items = group.items || [];
    const representative = items[0] || null;
    return {
      ...group,
      representative,
      items,
      isExpanded: expandedSet.has(group.key),
    };
  });
</script>

{#each displayGroups as group (group.key)}
  <GroupedRow
    {group}
    representative={group.representative}
    items={group.items}
    isExpanded={group.isExpanded}
  />
{/each}
