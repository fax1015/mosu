<script>
  import { onDestroy, onMount } from 'svelte';
  import { closeDialogWithAnimation } from '../../services/promptDialogService';

  let dialogEl;
  let continueBtnEl;
  let activePromise = null;

  const showWelcomePrompt = () => {
    if (activePromise) return activePromise;
    if (!dialogEl) return Promise.resolve(false);

    activePromise = new Promise((resolve) => {
      const cleanup = async () => {
        await closeDialogWithAnimation(dialogEl);
        continueBtnEl?.removeEventListener('click', onContinue);
        dialogEl.removeEventListener('cancel', onCancel);
        activePromise = null;
      };

      const onContinue = async () => {
        await cleanup();
        resolve(true);
      };

      const onCancel = (event) => {
        event.preventDefault();
      };

      dialogEl.showModal();
      continueBtnEl?.addEventListener('click', onContinue, { once: true });
      dialogEl.addEventListener('cancel', onCancel);
    });

    return activePromise;
  };

  onMount(() => {
    window.mosuPrompts = {
      ...(window.mosuPrompts || {}),
      showWelcomePrompt,
    };
  });

  onDestroy(() => {
    if (window.mosuPrompts?.showWelcomePrompt === showWelcomePrompt) {
      delete window.mosuPrompts.showWelcomePrompt;
      if (Object.keys(window.mosuPrompts).length === 0) {
        delete window.mosuPrompts;
      }
    }
  });
</script>

<dialog bind:this={dialogEl} class="prompt-dialog" id="welcomePrompt">
    <form method="dialog" class="prompt-dialog-form">
        <p class="prompt-dialog-label">Hi there!</p>
        <p class="settings-description">
            Stay organized and track your work in progress maps.
            <br>
            Click anywhere on a map's timeline to listen and seek through its audio instantly.
        </p>
        <div class="prompt-dialog-actions" style="justify-content: center;">
            <button bind:this={continueBtnEl} type="button" class="primary-button" id="welcomeContinueBtn">Continue</button>
        </div>
    </form>
</dialog>
