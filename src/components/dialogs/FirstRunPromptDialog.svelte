<script>
  import { onDestroy, onMount } from 'svelte';
  import { closeDialogWithAnimation } from '../../services/promptDialogService';

  let dialogEl;
  let allBtnEl;
  let mapperBtnEl;
  let activePromise = null;

  const showFirstRunChoicePrompt = () => {
    if (activePromise) return activePromise;
    if (!dialogEl) return Promise.resolve(null);

    activePromise = new Promise((resolve) => {
      const cleanup = async () => {
        await closeDialogWithAnimation(dialogEl);
        allBtnEl?.removeEventListener('click', onAll);
        mapperBtnEl?.removeEventListener('click', onMapper);
        dialogEl.removeEventListener('cancel', onCancel);
        activePromise = null;
      };

      const onAll = async () => {
        await cleanup();
        resolve('all');
      };

      const onMapper = async () => {
        await cleanup();
        resolve('mapper');
      };

      const onCancel = async () => {
        await cleanup();
        resolve(null);
      };

      dialogEl.showModal();
      allBtnEl?.addEventListener('click', onAll, { once: true });
      mapperBtnEl?.addEventListener('click', onMapper, { once: true });
      dialogEl.addEventListener('cancel', onCancel, { once: true });
    });

    return activePromise;
  };

  onMount(() => {
    window.mosuPrompts = {
      ...(window.mosuPrompts || {}),
      showFirstRunChoicePrompt,
    };
  });

  onDestroy(() => {
    if (window.mosuPrompts?.showFirstRunChoicePrompt === showFirstRunChoicePrompt) {
      delete window.mosuPrompts.showFirstRunChoicePrompt;
      if (Object.keys(window.mosuPrompts).length === 0) {
        delete window.mosuPrompts;
      }
    }
  });
</script>

<dialog bind:this={dialogEl} class="prompt-dialog" id="firstRunPrompt">
    <form method="dialog" class="prompt-dialog-form">
        <p class="prompt-dialog-label">How would you like to import your maps?</p>
        <p class="settings-description" style="margin-top: -0.5rem; margin-bottom: 0.5rem;">Choose to import all
            maps from
            your Songs folder, or only maps by a particular mapper.</p>
        <div class="prompt-dialog-actions">
            <button bind:this={allBtnEl} type="button" class="secondary-button" id="firstRunAllBtn">Import all maps</button>
            <button bind:this={mapperBtnEl} type="button" class="primary-button" id="firstRunMapperBtn">Only maps by a mapper</button>
        </div>
    </form>
</dialog>
