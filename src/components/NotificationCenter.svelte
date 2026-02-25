<script>
  import { onMount } from 'svelte';
  import { dismissNotification, notifications, pushNotification } from '../stores/notifications';

  let container;

  const bringToTopLayer = () => {
    if (!container) return;

    try {
      if (container.hidePopover && container.matches?.(':popover-open')) {
        container.hidePopover();
      }
      if (container.showPopover) {
        container.showPopover();
      }
    } catch {
      // Ignore if popover API is unavailable.
    }
  };

  $: notificationLayerKey = $notifications.map((entry) => `${entry.id}:${entry.isVisible}`).join('|');

  $: if (notificationLayerKey) {
    bringToTopLayer();
  }

  onMount(() => {
    window.mosuNotifications = { show: pushNotification };
    bringToTopLayer();

    return () => {
      if (window.mosuNotifications?.show === pushNotification) {
        delete window.mosuNotifications;
      }
    };
  });
</script>

<div bind:this={container} class="notification-container" popover="manual">
  {#each $notifications as notification (notification.id)}
    <div class="notification is-{notification.type} {notification.isVisible ? 'is-visible' : ''}">
      {#if notification.type === 'success'}
        <svg class="notification-icon" viewBox="0 0 512 512">
          <path fill="var(--success)" d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM369 209L241 337c-9.4 9.4-24.6 9.4-33.9 0l-64-64c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l47 47L335 175c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9z" />
        </svg>
      {:else if notification.type === 'error'}
        <svg class="notification-icon" viewBox="0 0 512 512">
          <path fill="var(--error)" d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm0-384c13.3 0 24 10.7 24 24V264c0 13.3-10.7 24-24 24s-24-10.7-24-24V152c0-13.3 10.7-24 24-24zM224 352a32 32 0 1 1 64 0a32 32 0 1 1 -64 0z" />
        </svg>
      {:else}
        <svg class="notification-icon" viewBox="0 0 512 512">
          <path fill="var(--accent-primary)" d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-144a32 32 0 1 1 0-64 32 32 0 1 1 0 64z" />
        </svg>
      {/if}

      <div class="notification-content">
        <div class="notification-title">{notification.title}</div>
        <div class="notification-message">{notification.message}</div>
      </div>

      <button type="button" class="notification-close" aria-label="Dismiss" on:click={() => dismissNotification(notification.id)}>
        <svg viewBox="0 0 384 512">
          <path fill="currentColor" d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z" />
        </svg>
      </button>
    </div>
  {/each}
</div>
