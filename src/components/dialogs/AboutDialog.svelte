<script>
  import DialogCloseButton from '../shared/DialogCloseButton.svelte';
  import { appVersion } from '../../stores/appMeta';
  import { closeAboutDialog } from '../../services/dialogService';
  import { isOutsideDialogBoundsClick } from '../../services/dialogBackdropService';

  const handleBackdropClick = (event) => {
    if (isOutsideDialogBoundsClick(event)) {
      closeAboutDialog();
    }
  };
</script>

<dialog class="prompt-dialog about-dialog" id="aboutDialog" on:click={handleBackdropClick}>
    <div class="settings-header">
        <h2 class="settings-title">About</h2>
        <DialogCloseButton id="closeAboutBtn" onClick={closeAboutDialog} />
    </div>
    <div class="about-content">
        <div class="about-logo">
            <span style="display: flex; align-items: center; gap: 0; justify-content: center;">
                <h1 style="color: var(--accent-primary); margin-right: 0; font-size: 2rem;">m</h1>
                <h1 style="margin-left: 0; font-size: 2rem;">osu!</h1>
            </span>
            <p class="about-version" id="aboutVersion">v{$appVersion}</p>
        </div>
        <p class="about-description">a progress tracker for osu! mappers.</p>
        <div class="about-credits">
            <p class="about-credit-line">made by <strong>fax1015</strong></p>
            <p class="about-credit-line">licensed under MIT</p>
        </div>
    </div>
</dialog>
