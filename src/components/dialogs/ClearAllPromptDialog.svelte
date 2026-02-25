<script>
  import { onDestroy, onMount } from 'svelte';
  import { closeDialogWithAnimation } from '../../services/promptDialogService';

  let dialogEl;
  let cancelBtnEl;
  let activePromise = null;

  const confirmClearAll = () => {
    if (activePromise) return activePromise;
    if (!dialogEl) return Promise.resolve(false);

    activePromise = new Promise((resolve) => {
      const cleanup = async () => {
        await closeDialogWithAnimation(dialogEl);
        cancelBtnEl?.removeEventListener('click', onCancel);
        dialogEl.removeEventListener('submit', onSubmit);
        dialogEl.removeEventListener('cancel', onCancel);
        activePromise = null;
      };

      const onCancel = async () => {
        await cleanup();
        resolve(false);
      };

      const onSubmit = async (event) => {
        event.preventDefault();
        await cleanup();
        resolve(true);
      };

      dialogEl.showModal();
      cancelBtnEl?.addEventListener('click', onCancel, { once: true });
      dialogEl.addEventListener('submit', onSubmit, { once: true });
      dialogEl.addEventListener('cancel', onCancel, { once: true });
    });

    return activePromise;
  };

  onMount(() => {
    window.mosuPrompts = {
      ...(window.mosuPrompts || {}),
      confirmClearAll,
    };
  });

  onDestroy(() => {
    if (window.mosuPrompts?.confirmClearAll === confirmClearAll) {
      delete window.mosuPrompts.confirmClearAll;
      if (Object.keys(window.mosuPrompts).length === 0) {
        delete window.mosuPrompts;
      }
    }
  });
</script>

<dialog bind:this={dialogEl} class="prompt-dialog" id="clearAllPrompt">
    <form method="dialog" class="prompt-dialog-form">
        <p class="prompt-dialog-label">Clear All Maps?</p>
        <p class="settings-description">
            This will stop all current map processing and remove all imported maps from your current list.
            You will have to wait for the map durations to be re-analyzed if you re-import them.
            <br><br>
            The maps in your Todo and Completed lists will be saved.
        </p>
        <div class="prompt-dialog-actions">
            <button bind:this={cancelBtnEl} type="button" class="secondary-button" id="clearAllCancel">Cancel</button>
            <button type="submit" class="primary-button danger" id="clearAllConfirm">Clear Everything</button>
        </div>
    </form>
</dialog>
