<script>
  import { onDestroy, onMount } from 'svelte';
  import { clearListBox, mountListBox } from '../../services/legacyRowsService';

  export let itemId = '';
  export let index = 0;
  export let options = {};

  let hostEl;
  let retryTimer = null;
  let retryCount = 0;
  const MAX_RETRIES = 60;

  const clearRetry = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const mount = () => {
    if (!hostEl || !itemId) return false;
    const mounted = mountListBox(hostEl, itemId, index, options || {});
    return mounted === true;
  };

  const scheduleMount = () => {
    clearRetry();
    if (!hostEl || !itemId) return;

    const mounted = mount();
    if (mounted) {
      retryCount = 0;
      return;
    }

    if (retryCount >= MAX_RETRIES) return;
    retryCount += 1;
    retryTimer = setTimeout(scheduleMount, 60);
  };

  onMount(() => {
    scheduleMount();
  });

  onDestroy(() => {
    clearRetry();
    clearListBox(hostEl);
  });

  $: if (hostEl && itemId) {
    retryCount = 0;
    scheduleMount();
  }
</script>

<div bind:this={hostEl}></div>
