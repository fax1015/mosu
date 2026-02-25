<script>
  import LegacyListBoxHost from "../list/LegacyListBoxHost.svelte";

  export let item = null;
  export let index = 0;

  const getItemId = (value) => String(value?.id || "");
</script>

<div class="group-child-row">
  <div class="group-child-indicator"></div>
  <div class="group-child-item-host">
    {#if getItemId(item)}
      <LegacyListBoxHost
        itemId={getItemId(item)}
        {index}
        options={{ groupChild: true }}
      />
    {/if}
  </div>
</div>
