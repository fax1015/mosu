<script>
    import { onMount } from 'svelte';
    import { refreshUi } from '../stores/refreshUi';
    import { versionIndicatorState } from '../stores/appMeta';
    import { handleVersionIndicatorClick } from '../services/appMetaService';
    import { showAboutDialog, showChangelogDialog, showSettingsDialog } from '../services/dialogService';
    import { connectRefreshUi } from '../services/refreshUiService';
    import {
        importByMapper,
        importFromFolder,
        importOsuFile,
        refreshLastDirectory
    } from '../services/primaryActionsService';

    let uploadDropdownEl;
    let uploadMenuToggleEl;
    let isUploadMenuOpen = false;

    const handleVersionIndicatorKeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleVersionIndicatorActivated();
        }
    };

    const handleVersionIndicatorActivated = () => {
        handleVersionIndicatorClick();
        showChangelogDialog();
    };

    const closeUploadMenu = () => {
        isUploadMenuOpen = false;
    };

    const toggleUploadMenu = () => {
        isUploadMenuOpen = !isUploadMenuOpen;
    };

    const handleUploadOption = (action) => {
        closeUploadMenu();
        action?.();
    };

    onMount(() => {
        const unsubscribeRefreshUi = connectRefreshUi();

        const onDocumentClick = (event) => {
            const target = event.target;
            const clickedToggle = uploadMenuToggleEl?.contains(target);
            const clickedDropdown = uploadDropdownEl?.contains(target);

            if (isUploadMenuOpen && !clickedToggle && !clickedDropdown) {
                closeUploadMenu();
            }
        };

        document.addEventListener('click', onDocumentClick);
        return () => {
            unsubscribeRefreshUi?.();
            document.removeEventListener('click', onDocumentClick);
        };
    });
</script>

<div class="header-container">
    <button type="button" id="aboutBtn" class="logo-button" aria-label="About"
        style="display: flex; align-items: center; gap: 0; background: none; border: none; cursor: pointer; padding: 0;"
        data-tooltip="About" on:click={showAboutDialog}>
        <h1 style="color: var(--accent-primary); margin-right: 0;">m</h1>
        <h1 style="margin-left: 0;">osu!</h1>
    </button>
    <span id="versionIndicator" class={$versionIndicatorState.className} data-tooltip={$versionIndicatorState.tooltip}
        style:display={$versionIndicatorState.visible ? '' : 'none'} role="button" tabindex="0"
        on:click={handleVersionIndicatorActivated}
        on:keydown={handleVersionIndicatorKeydown}>{$versionIndicatorState.text}</span>
    <nav class="header-nav" aria-label="Primary Actions">
        <div bind:this={uploadDropdownEl} class="upload-dropdown" id="uploadDropdown" class:is-open={isUploadMenuOpen}>
            <button type="button" class="primary-button" id="osuUploadBtn" on:click={importOsuFile}>Import
                .osu File</button>
            <button bind:this={uploadMenuToggleEl} type="button" class="primary-button upload-caret" id="uploadMenuToggle" aria-expanded={isUploadMenuOpen ? 'true' : 'false'}
                aria-label="More upload options" data-tooltip="More import options" on:click={toggleUploadMenu}>
                <svg viewBox="0 0 320 512">
                    <path
                        d="M311.1 233.4c12.5 12.5 12.5 32.8 0 45.3l-192 192c-12.5 12.5-32.8 12.5-45.3 0s-12.5-32.8 0-45.3L243.2 256 73.9 86.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l192 192z" />
                </svg>
            </button>
            <div class="upload-menu" id="uploadMenu" role="menu">
                <button type="button" class="upload-option" data-upload="mapper" on:click={() => handleUploadOption(importByMapper)}>Import all maps from a specific
                    mapper</button>
                <button type="button" class="upload-option" data-upload="folder" on:click={() => handleUploadOption(importFromFolder)}>Import all maps in song folder (may
                    take a long time)</button>
            </div>
        </div>
        <button type="button"
            class="primary-button icon-button refresh-btn {$refreshUi.isAnalyzing ? 'is-analyzing' : ''} {$refreshUi.isRefreshing ? 'is-refreshing' : ''} {$refreshUi.isPulsing ? 'is-pulsing' : ''}"
            id="refreshBtn"
            aria-label="Refresh last directory" data-tooltip={$refreshUi.tooltip}
            style:--refresh-progress={`${$refreshUi.progressPct}%`} on:click={refreshLastDirectory}>
            <svg viewBox="0 0 512 512">
                <path fill="currentColor"
                    d="M65.9 228.5c13.3-93 93.4-164.5 190.1-164.5 53 0 101 21.5 135.8 56.2 .2 .2 .4 .4 .6 .6l7.6 7.2-47.9 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l128 0c17.7 0 32-14.3 32-32l0-128c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 53.4-11.3-10.7C390.5 28.6 326.5 0 256 0 127 0 20.3 95.4 2.6 219.5 .1 237 12.2 253.2 29.7 255.7s33.7-9.7 36.2-27.1zm443.5 64c2.5-17.5-9.7-33.7-27.1-36.2s-33.7 9.7-36.2 27.1c-13.3 93-93.4 164.5-190.1 164.5-53 0-101-21.5-135.8-56.2-.2-.2-.4-.4-.6-.6l-7.6-7.2 47.9 0c17.7 0 32-14.3 32-32s14.3-32-32-32L32 320c-8.5 0-16.7 3.4-22.7 9.5S-.1 343.7 0 352.3l1 127c.1 17.7 14.6 31.9 32.3 31.7S65.2 496.4 65 478.7l-.4-51.5 10.7 10.1c46.3 46.1 110.2 74.7 180.7 74.7 129 0 235.7-95.4 253.4-219.5z" />
            </svg>
        </button>
        <button type="button" class="primary-button icon-button settings-btn" id="settingsBtn" aria-label="Settings"
            data-tooltip="Settings" on:click={showSettingsDialog}>
            <svg viewBox="0 0 24 24">
                <path
                    d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.35 19.43,11.03L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.97 19.05,5.05L16.56,6.05C16.04,5.66 15.47,5.34 14.86,5.12L14.47,2.44C14.43,2.21 14.24,2.05 14,2.05H10C9.76,2.05 9.57,2.21 9.53,2.44L9.14,5.12C8.53,5.34 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.97 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11.03C4.53,11.35 4.5,11.67 4.5,12C4.5,11.67 4.53,11.35 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.95C7.96,18.34 8.53,18.66 9.14,18.88L9.53,21.56C9.57,21.79 9.76,21.95 10,21.95H14C14.24,21.95 14.43,21.79 14.47,21.56L14.86,18.88C15.47,18.66 16.04,18.34 16.56,17.95L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" />
            </svg>
        </button>
    </nav>
</div>
