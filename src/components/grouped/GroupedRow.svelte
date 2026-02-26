<script>
  import { tick } from 'svelte';
  import { setExpanded } from '../../services/groupViewService';
  import GroupedChildItem from './GroupedChildItem.svelte';

  const PLACEHOLDER_COVER = '/assets/placeholder.png';

  export let group = { key: '', itemIds: [], count: 0 };
  export let representative = null;
  export let items = [];
  export let isExpanded = false;

  let childrenInner;
  let hasRenderedChildren = false;
  let coverSrc = PLACEHOLDER_COVER;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  $: displayArtist = representative?.artistUnicode || representative?.artist || 'Unknown Artist';
  $: displayTitle = representative?.titleUnicode || representative?.title || 'Unknown Title';
  $: displayCreator = representative?.creator || 'Unknown';
  $: displayCount = Number(group?.count || items.length || 0);
  $: coverSrc = representative?.coverUrl || PLACEHOLDER_COVER;
  $: if (isExpanded && !hasRenderedChildren) {
    hasRenderedChildren = true;
  }

  const onHeaderClick = () => {
    if (!group?.key) return;
    setExpanded(group.key, !isExpanded);
  };

  const onHeaderKeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onHeaderClick();
    }
  };

  const onCoverError = () => {
    coverSrc = PLACEHOLDER_COVER;
  };

  const focusChildItem = async (itemId) => {
    if (!itemId) return;

    if (!isExpanded) {
      setExpanded(group.key, true);
      await tick();
      await wait(500);
    } else {
      await tick();
      await wait(50);
    }

    const target = childrenInner?.querySelector(`[data-item-id="${itemId}"]`);
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const rect = target.getBoundingClientRect();
    const distance = Math.abs(rect.top - window.innerHeight / 2);
    const highlightDelay = Math.min(1200, 350 + distance / 5);
    await wait(highlightDelay);

    target.style.transition =
      'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), outline 0.3s ease';
    target.style.transform = 'scale(1.01)';
    target.style.outline = '2px solid var(--accent-primary)';
    target.style.outlineOffset = '0px';
    target.style.zIndex = '100';

    await wait(1200);
    target.style.transform = '';
    target.style.outline = '';
    target.style.outlineOffset = '';
    target.style.zIndex = '';
  };

  const onChipKeydown = (event, itemId) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      focusChildItem(itemId);
    }
  };
</script>

<div class="group-row {isExpanded ? 'is-expanded' : ''}" data-group-key={group.key}>
  <div class="group-row-header" role="button" tabindex="0" on:click={onHeaderClick} on:keydown={onHeaderKeydown}>
    <div class="group-row-cover-section">
      <div class="group-row-cover">
        <img src={coverSrc} alt={`${displayArtist} - ${displayTitle}`} loading="lazy" decoding="async" on:error={onCoverError} />
        <div class="group-row-cover-overlay"></div>
      </div>
      <div class="group-row-info">
        <h3 class="group-row-title">{displayArtist} - {displayTitle}</h3>
        <span class="group-row-count">{displayCount} difficult{displayCount === 1 ? 'y' : 'ies'}</span>
        <span class="meta-tag group-row-creator-tag" data-tooltip="Mapper">{displayCreator}</span>
      </div>
    </div>

    <div class="group-row-carousel">
      {#each items as item (item.id)}
        <span
          class="group-row-version-chip"
          role="button"
          tabindex="0"
          title={item.version || 'Unknown'}
          on:click|stopPropagation={() => focusChildItem(item.id)}
          on:keydown|stopPropagation={(event) => onChipKeydown(event, item.id)}
          >{item.version || 'Unknown'}</span
        >
      {/each}
    </div>

    <div class="group-row-chevron">
      <svg viewBox="0 0 448 512">
        <path
          d="M201.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L224 338.7 54.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"
        ></path>
      </svg>
    </div>
  </div>

  <div class="group-row-children {isExpanded ? 'is-open' : ''}">
    <div class="group-row-children-inner" bind:this={childrenInner}>
      {#if hasRenderedChildren}
        {#each items as item, index (item.id)}
          <GroupedChildItem {item} {index} />
        {/each}
      {/if}
    </div>
  </div>
</div>
