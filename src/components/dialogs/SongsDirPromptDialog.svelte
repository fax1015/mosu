<script>
  import { onDestroy, onMount } from 'svelte';
  import { closeDialogWithAnimation } from '../../services/promptDialogService';

  let dialogEl;
  let cancelBtnEl;
  let activePromise = null;

  const confirmSongsDirPrompt = () => {
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
      confirmSongsDirPrompt,
    };
  });

  onDestroy(() => {
    if (window.mosuPrompts?.confirmSongsDirPrompt === confirmSongsDirPrompt) {
      delete window.mosuPrompts.confirmSongsDirPrompt;
      if (Object.keys(window.mosuPrompts).length === 0) {
        delete window.mosuPrompts;
      }
    }
  });
</script>

<dialog bind:this={dialogEl} class="prompt-dialog" id="songsDirPrompt">
    <form method="dialog" class="prompt-dialog-form">
        <p class="prompt-dialog-label">Locate your osu! Songs folder.</p>
        <p class="settings-description" style="margin-top: -0.5rem; margin-bottom: 0.5rem;">We'll use this to
            scan for your maps.</p>
        <div class="prompt-dialog-actions">
            <button bind:this={cancelBtnEl} type="button" class="secondary-button" id="songsDirPromptCancel">Cancel</button>
            <button type="submit" class="primary-button" id="songsDirPromptConfirm">Select Folder</button>
        </div>
    </form>
</dialog>
