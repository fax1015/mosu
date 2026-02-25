<script>
  import DialogCloseButton from '../shared/DialogCloseButton.svelte';
  import { appVersion } from '../../stores/appMeta';
  import { closeChangelogDialog } from '../../services/dialogService';
  import { isOutsideDialogBoundsClick } from '../../services/dialogBackdropService';

  const handleBackdropClick = (event) => {
    if (isOutsideDialogBoundsClick(event)) {
      closeChangelogDialog();
    }
  };
</script>

<dialog class="prompt-dialog changelog-dialog" id="changelogDialog" on:click={handleBackdropClick}>
    <div class="settings-header">
        <h2 class="settings-title">What's New</h2>
        <DialogCloseButton id="closeChangelogBtn" onClick={closeChangelogDialog} />
    </div>
    <div class="changelog-content" id="changelogContent">
        <div class="changelog-version-header">
            <span class="changelog-version-tag" id="changelogVersionTag">v{$appVersion}</span>
        </div>
        <ul class="changelog-list">
            <h4>migration to svelte</h4>
            <li>- the app was getting a little too big and unwieldy in vanilla js, so i decided to migrate to svelte
                <br><br>
                - this is a pretty big change, so if you encounter any bugs or issues, please let me know!</li>
        </ul>
    </div>
</dialog>
