<script>
  import { onMount } from 'svelte';
  import DialogCloseButton from '../shared/DialogCloseButton.svelte';
  import { closeSettingsDialog } from '../../services/dialogService';
  import { isOutsideDialogBoundsClick } from '../../services/dialogBackdropService';
  import { settingsControls } from '../../stores/settingsControls';
  import {
    connectSettingsControls,
    copyApiKey,
    copyEmbedUrl,
    copyUserId,
    regenerateApiKey,
    selectSongsDir,
    setEmbedToggle,
    setGroupMapsBySong,
    setRescanMapperName,
    setRescanMode,
    setSettingToggle,
    setVolume,
    toggleLinkedAlias,
    triggerManualSync,
  } from '../../services/settingsControlsService';

  const handleBackdropClick = (event) => {
    if (isOutsideDialogBoundsClick(event)) {
      closeSettingsDialog();
    }
  };

  const onCopyKeydown = (event, fn) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fn();
    }
  };

  onMount(() => {
    const unsubscribe = connectSettingsControls();
    return () => unsubscribe?.();
  });
</script>

<dialog class="prompt-dialog settings-dialog" id="settingsDialog" on:click={handleBackdropClick}>
    <div class="settings-header">
        <h2 class="settings-title">Settings</h2>
        <DialogCloseButton id="closeSettingsBtn" onClick={closeSettingsDialog} />
    </div>
    <div class="settings-content">
        <div class="settings-section">
            <h3 class="settings-section-title">Scanning</h3>
            <div class="settings-item">
                <div class="settings-info">
                    <p class="settings-label">Songs directory</p>
                    <p class="settings-description" id="songsDirLabel">{$settingsControls.songsDirLabel}</p>
                </div>
                <button type="button" class="secondary-button" id="selectSongsDirBtn"
                    data-tooltip="Select songs folder" on:click={selectSongsDir}>Select folder</button>
            </div>
            <div class="settings-item">
                <div class="settings-info">
                    <p class="settings-label">Ignore start and breaks</p>
                    <p class="settings-description">Ignore the leading silence and treat breaks as populated
                        time
                        when calculating map progress.</p>
                </div>
                <label class="switch">
                    <input type="checkbox" id="ignoreStartAndBreaks" checked={$settingsControls.ignoreStartAndBreaks}
                        on:change={(event) => setSettingToggle('ignoreStartAndBreaks', event.currentTarget.checked)}>
                    <span class="slider"></span>
                </label>
            </div>
            <div class="settings-item">
                <div class="settings-info">
                    <p class="settings-label">Auto-rescan on startup</p>
                    <p class="settings-description">Automatically scan for new maps when the app starts.</p>
                </div>
                <label class="switch">
                    <input type="checkbox" id="autoRescan" checked={$settingsControls.autoRescan}
                        on:change={(event) => setSettingToggle('autoRescan', event.currentTarget.checked)}>
                    <span class="slider"></span>
                </label>
            </div>

            <div id="autoRescanOptions" class="settings-sub-group" style:display={$settingsControls.autoRescan ? 'block' : 'none'}>
                <div class="settings-item is-nested">
                    <div class="settings-info">
                        <p class="settings-label">Rescan Mode</p>
                    </div>
                    <div class="radio-group">
                        <label class="radio-label">
                            <input type="radio" name="rescanMode" value="mapper" id="rescanModeMapper" checked={$settingsControls.rescanMode === 'mapper'}
                                on:change={(event) => event.currentTarget.checked && setRescanMode('mapper')}>
                            <span>Specific Mapper</span>
                        </label>
                        <label class="radio-label">
                            <input type="radio" name="rescanMode" value="all" id="rescanModeAll" checked={$settingsControls.rescanMode === 'all'}
                                on:change={(event) => event.currentTarget.checked && setRescanMode('all')}>
                            <span>All Maps</span>
                        </label>
                    </div>
                </div>

                <div id="mapperRescanConfig" style:display={$settingsControls.autoRescan && $settingsControls.rescanMode === 'mapper' ? 'block' : 'none'}>
                    <div class="settings-item is-nested">
                        <div class="settings-info">
                            <p class="settings-label">osu! profile link</p>
                            <p class="settings-description">The profile link used for scanning beatmaps.</p>
                        </div>
                        <input type="text" class="control-input" id="rescanMapperName"
                            placeholder="Paste osu! profile URL..." value={$settingsControls.rescanMapperName}
                            on:input={(event) => setRescanMapperName(event.currentTarget.value)}>
                    </div>

                    <div class="settings-item is-nested" id="linkedAliasesContainer" style:display={$settingsControls.hasLinkedAliases ? 'block' : 'none'}>
                        <div class="settings-info">
                            <p class="settings-label">Linked Aliases</p>
                            <p class="settings-description">The app will look for maps from any of these names:</p>
                            <div id="linkedAliasesList" class="alias-tag-container">
                                {#each $settingsControls.linkedAliases as alias}
                                  <div class="alias-tag {alias.isPrimary ? 'is-primary' : ''} {alias.isIgnored ? 'is-ignored' : ''}" data-name={alias.name}
                                      role="button" tabindex="0"
                                      on:click={() => toggleLinkedAlias(alias.name)}
                                      on:keydown={(event) => onCopyKeydown(event, () => toggleLinkedAlias(alias.name))}>
                                      <span>{alias.name}</span>
                                      <div class="alias-tag-icon">
                                        {#if alias.isIgnored}
                                          <svg viewBox="0 0 448 512"><path d="M256 80c0-8.8-7.2-16-16-16s-16 7.2-16 16V240H64c-8.8 0-16 7.2-16 16s7.2 16 16 16H224V432c0 8.8 7.2 16 16 16s16-7.2 16-16V272H400c8.8 0 16-7.2 16-16s-7.2-16-16-16H256V80z"/></svg>
                                        {:else}
                                          <svg viewBox="0 0 448 512"><path d="M432 256c0 17.7-14.3 32-32 32L48 288c-17.7 0-32-14.3-32-32s14.3-32 32-32l352 0c17.7 0 32 14.3 32 32z"/></svg>
                                        {/if}
                                      </div>
                                  </div>
                                {/each}
                            </div>
                        </div>
                    </div>

                    <div class="settings-item is-nested">
                        <div class="settings-info">
                            <p class="settings-label">Hide guest difficulties in your own mapsets</p>
                            <p class="settings-description">Hide maps with difficulty names containing "'s" (e.g.,
                                "guest's Extra") when they appear in your folders.</p>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="ignoreGuestDifficulties" checked={$settingsControls.ignoreGuestDifficulties}
                                on:change={(event) => setSettingToggle('ignoreGuestDifficulties', event.currentTarget.checked)}>
                            <span class="slider"></span>
                        </label>
                    </div>
                </div>
            </div>
        </div>
        <div class="settings-section">
            <h3 class="settings-section-title">List View</h3>
            <div class="settings-item">
                <div class="settings-info">
                    <p class="settings-label">Preview volume</p>
                    <p class="settings-description">Adjust the volume of the song preview.</p>
                </div>
                <div class="slider-control">
                    <input type="range" id="previewVolume" min="0" max="1" step="0.01" value={$settingsControls.volume}
                        on:input={(event) => setVolume(event.currentTarget.value)}>
                    <span id="volumeValue">{$settingsControls.volumePercent}</span>
                </div>
            </div>
            <div class="settings-item">
                <div class="settings-info">
                    <p class="settings-label">Group maps by song</p>
                    <p class="settings-description">Group multiple difficulties of the same song into a collapsible
                        group in the All tab.</p>
                </div>
                <label class="switch">
                    <input type="checkbox" id="groupMapsBySong" checked={$settingsControls.groupMapsBySong}
                        on:change={(event) => setGroupMapsBySong(event.currentTarget.checked)}>
                    <span class="slider"></span>
                </label>
            </div>
        </div>
        <div class="settings-section">
            <h3 class="settings-section-title">Embed Sync</h3>
            <div class="settings-item">
                <div class="settings-info">
                    <p class="settings-label">Sync Status</p>
                    <p class="settings-description" id="embedLastSynced">{$settingsControls.embedLastSyncedLabel}</p>
                </div>
                <button type="button"
                    class="secondary-button {$settingsControls.embedSyncStatus === 'syncing' ? 'status-syncing' : ''} {$settingsControls.embedSyncStatus === 'synced' ? 'status-synced' : ''} {$settingsControls.embedSyncStatus === 'error' ? 'status-error' : ''}"
                    id="embedSyncNowBtn" data-tooltip={$settingsControls.embedSyncButtonTooltip}
                    disabled={$settingsControls.embedSyncButtonDisabled}
                    on:click={triggerManualSync}>{$settingsControls.embedSyncButtonLabel}</button>
            </div>
            <div class="settings-item">
                <div class="settings-info">
                    <p class="settings-label">Your User ID</p>
                    <p class="settings-description">Use this ID to sync your todo list to the embed page. Click to
                        copy.</p>
                    <div class="user-id-display" id="userIdDisplay" tabindex="0" role="button"
                        aria-label="Copy user ID" on:click={copyUserId}
                        on:keydown={(event) => onCopyKeydown(event, copyUserId)}>
                        <code id="userIdValue">{$settingsControls.userIdLabel}</code>
                        <svg class="copy-icon" viewBox="0 0 24 24" width="14" height="14">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </div>
                </div>
            </div>
            <div class="settings-item">
                <div class="settings-info">
                    <p class="settings-label">API Key</p>
                    <p class="settings-description">Your secret key for syncing. Keep this private. Click to copy.
                    </p>
                    <div class="user-id-display" id="apiKeyDisplay" tabindex="0" role="button"
                        aria-label="Copy API key" on:click={copyApiKey}
                        on:keydown={(event) => onCopyKeydown(event, copyApiKey)}>
                        <code id="apiKeyValue">{$settingsControls.apiKeyLabel}</code>
                        <svg class="copy-icon" viewBox="0 0 24 24" width="14" height="14">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </div>
                </div>
                <button type="button" class="secondary-button" id="regenerateApiKeyBtn"
                    data-tooltip="Regenerate API key" on:click={regenerateApiKey}>Reset Key</button>
            </div>
            <div class="settings-item">
                <div class="settings-info">
                    <p class="settings-label">Embed URL</p>
                    <p class="settings-description">Use this URL to embed your tracker on other sites.</p>
                    <div class="user-id-display" id="embedUrlDisplay" tabindex="0" role="button"
                        aria-label="Copy embed URL" on:click={copyEmbedUrl}
                        on:keydown={(event) => onCopyKeydown(event, copyEmbedUrl)}>
                        <code id="embedUrlValue">{$settingsControls.embedUrlLabel}</code>
                        <svg class="copy-icon" viewBox="0 0 24 24" width="14" height="14">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </div>
                </div>
            </div>
            <div class="settings-item">
                <div class="settings-info">
                    <p class="settings-label">Show Todo List</p>
                    <p class="settings-description">Display your todo list on the embed page.</p>
                </div>
                <label class="switch">
                    <input type="checkbox" id="embedShowTodoList" checked={$settingsControls.embedShowTodoList}
                        on:change={(event) => setEmbedToggle('embedShowTodoList', event.currentTarget.checked)}>
                    <span class="slider"></span>
                </label>
            </div>
            <div class="settings-item">
                <div class="settings-info">
                    <p class="settings-label">Show Completed List</p>
                    <p class="settings-description">Display your completed maps on the embed page.</p>
                </div>
                <label class="switch">
                    <input type="checkbox" id="embedShowCompletedList" checked={$settingsControls.embedShowCompletedList}
                        on:change={(event) => setEmbedToggle('embedShowCompletedList', event.currentTarget.checked)}>
                    <span class="slider"></span>
                </label>
            </div>
            <div class="settings-item">
                <div class="settings-info">
                    <p class="settings-label">Show Progress Stats</p>
                    <p class="settings-description">Display progress statistics on the embed page.</p>
                </div>
                <label class="switch">
                    <input type="checkbox" id="embedShowProgressStats" checked={$settingsControls.embedShowProgressStats}
                        on:change={(event) => setEmbedToggle('embedShowProgressStats', event.currentTarget.checked)}>
                    <span class="slider"></span>
                </label>
            </div>
        </div>
    </div>
</dialog>
