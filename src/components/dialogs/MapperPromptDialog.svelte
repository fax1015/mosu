<script>
  import { onDestroy, onMount } from 'svelte';
  import { closeDialogWithAnimation } from '../../services/promptDialogService';

  const defaultLabel = 'Enter the mapper name:';
  const defaultPlaceholder = 'Mapper name or osu! URL...';
  const defaultConfirmLabel = 'Save';

  let dialogEl;
  let inputEl;
  let cancelBtnEl;
  let confirmBtnEl;
  let labelText = defaultLabel;
  let placeholder = defaultPlaceholder;
  let confirmText = defaultConfirmLabel;
  let activePromise = null;

  const promptMapperName = (options = {}) => {
    if (activePromise) return activePromise;
    if (!dialogEl || !inputEl) return Promise.resolve(null);

    labelText = options.label || defaultLabel;
    placeholder = options.placeholder || defaultPlaceholder;
    confirmText = options.confirmLabel || defaultConfirmLabel;
    inputEl.value = options.initialValue || '';

    activePromise = new Promise((resolve) => {
      const cleanup = async () => {
        await closeDialogWithAnimation(dialogEl);
        cancelBtnEl?.removeEventListener('click', onCancel);
        dialogEl.removeEventListener('submit', onSubmit);
        dialogEl.removeEventListener('cancel', onCancel);
        labelText = defaultLabel;
        placeholder = defaultPlaceholder;
        confirmText = defaultConfirmLabel;
        activePromise = null;
      };

      const onCancel = async () => {
        await cleanup();
        resolve(null);
      };

      const onSubmit = async (event) => {
        event.preventDefault();
        const value = String(inputEl.value || '').trim();
        await cleanup();
        resolve(value || null);
      };

      dialogEl.showModal();
      inputEl.focus();
      cancelBtnEl?.addEventListener('click', onCancel, { once: true });
      dialogEl.addEventListener('submit', onSubmit, { once: true });
      dialogEl.addEventListener('cancel', onCancel, { once: true });
    });

    return activePromise;
  };

  onMount(() => {
    window.mosuPrompts = {
      ...(window.mosuPrompts || {}),
      promptMapperName,
    };
  });

  onDestroy(() => {
    if (window.mosuPrompts?.promptMapperName === promptMapperName) {
      delete window.mosuPrompts.promptMapperName;
      if (Object.keys(window.mosuPrompts).length === 0) {
        delete window.mosuPrompts;
      }
    }
  });
</script>

<dialog bind:this={dialogEl} class="prompt-dialog" id="mapperPrompt">
    <form method="dialog" class="prompt-dialog-form">
        <label class="prompt-dialog-label" for="mapperNameInput">{labelText}</label>
        <input bind:this={inputEl} class="prompt-dialog-input" id="mapperNameInput" type="text" placeholder={placeholder}
            autocomplete="off" />
        <div class="prompt-dialog-actions">
            <button bind:this={cancelBtnEl} type="button" class="secondary-button" id="mapperPromptCancel">Cancel</button>
            <button bind:this={confirmBtnEl} type="submit" class="primary-button" id="mapperPromptConfirm">{confirmText}</button>
        </div>
    </form>
</dialog>
