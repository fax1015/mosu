import { beatmapApi } from '../bridge/Tauri.js';
import * as Store from '../state/Store.js';
import { showNotification } from '../components/NotificationSystem.js';
import { closeDialogWithAnimation } from '../ui/DialogManager.js';

const state = {
    initialized: false,
    dialog: null,
    title: null,
    description: null,
    path: null,
    confirmBtn: null,
    activeSession: null,
    resolveDone: null,
    isBusy: false,
};

const initDialog = () => {
    if (state.initialized) {
        return !!state.dialog;
    }

    state.dialog = document.querySelector('#lazerSessionDialog');
    state.title = document.querySelector('#lazerSessionTitle');
    state.description = document.querySelector('#lazerSessionDescription');
    state.path = document.querySelector('#lazerSessionPath');
    state.confirmBtn = document.querySelector('#lazerSessionDoneBtn');

    if (!state.dialog || !state.title || !state.description || !state.path || !state.confirmBtn) {
        return false;
    }

    state.dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
    });

    state.confirmBtn.addEventListener('click', () => {
        if (state.isBusy || !state.resolveDone) {
            return;
        }

        const resolve = state.resolveDone;
        state.resolveDone = null;
        resolve();
    });

    state.initialized = true;
    return true;
};

const setDialogState = ({
    title,
    description,
    path = '',
    buttonLabel = 'Done',
    buttonDisabled = false,
} = {}) => {
    if (!initDialog()) {
        return;
    }

    state.title.textContent = title || 'osu!lazer map session';
    state.description.textContent = description || '';
    state.path.textContent = path || '';
    state.path.hidden = !path;
    state.confirmBtn.textContent = buttonLabel;
    state.confirmBtn.disabled = !!buttonDisabled;
}

const openDialog = () => {
    if (!initDialog()) {
        return false;
    }

    state.dialog.classList.remove('is-closing');
    if (!state.dialog.open) {
        state.dialog.showModal();
    }
    return true;
};

const closeDialog = async () => {
    state.resolveDone = null;
    if (state.dialog?.open) {
        await closeDialogWithAnimation(state.dialog);
    }
};

const waitForDone = () => new Promise((resolve) => {
    state.resolveDone = resolve;
});

const getActionCopy = (action) => {
    if (action === 'open-editor') {
        return {
            unpacking: 'Unpacking this lazer map into a temporary folder for text editing...',
            waiting: 'The mapset is unpacked. Finish editing in your text editor, then click Done to repack it back into lazer storage.',
            repacking: 'Repacking edited files back into lazer storage and refreshing the list...',
            success: 'Map edits were repacked back into lazer storage.',
        };
    }

    return {
        unpacking: 'Unpacking this lazer mapset into a temporary folder...',
        waiting: 'The mapset is unpacked. Make your changes in the opened folder, then click Done to repack it back into lazer storage.',
        repacking: 'Repacking edited files back into lazer storage and refreshing the list...',
        success: 'Mapset changes were repacked back into lazer storage.',
    };
};

export const openLazerSessionForAction = async (itemId, action, callbacks = {}) => {
    if ((Store.settings?.osuClient || 'stable') !== 'lazer') {
        return false;
    }

    const item = Store.beatmapItems.find((entry) => entry.id === itemId);
    const dataRoot = Store.settings?.lazerDataDir || Store.settings?.songsDir || '';

    if (!item?.filePath || !dataRoot) {
        showNotification('Lazer action failed', 'The lazer data folder or beatmap path is missing.', 'error');
        return true;
    }

    if (state.activeSession) {
        openDialog();
        showNotification('Finish current session', 'Complete the current lazer unpack session before opening another one.', 'info');
        return true;
    }

    const copy = getActionCopy(action);
    let preparedSession = null;

    try {
        state.isBusy = true;
        setDialogState({
            title: 'Preparing lazer map',
            description: copy.unpacking,
            path: item.filePath,
            buttonLabel: 'Working...',
            buttonDisabled: true,
        });
        openDialog();

        preparedSession = await beatmapApi.prepareLazerMapSession(item.filePath, dataRoot);
        state.activeSession = { ...preparedSession, itemId, action };

        if (action === 'open-editor') {
            if (!preparedSession.unpackedOsuPath) {
                throw new Error('Could not locate the unpacked .osu file for this beatmap.');
            }
            await beatmapApi.openInTextEditor(preparedSession.unpackedOsuPath);
        } else {
            await beatmapApi.showItemInFolder(preparedSession.unpackedOsuPath || preparedSession.unpackedDir);
        }

        state.isBusy = false;
        setDialogState({
            title: 'Lazer map unpacked',
            description: copy.waiting,
            path: preparedSession.unpackedDir,
            buttonLabel: 'Done',
            buttonDisabled: false,
        });

        await waitForDone();

        state.isBusy = true;
        setDialogState({
            title: 'Repacking lazer map',
            description: copy.repacking,
            path: preparedSession.unpackedDir,
            buttonLabel: 'Working...',
            buttonDisabled: true,
        });

        await beatmapApi.commitLazerMapSession(preparedSession.sessionDir);

        if (callbacks.refreshAfterCommit) {
            await callbacks.refreshAfterCommit(item);
        }

        await closeDialog();
        showNotification('Lazer repack complete', copy.success, 'success');
    } catch (error) {
        console.error('[LazerEditSession] Session failed:', error);
        if (preparedSession?.sessionDir) {
            try {
                await beatmapApi.commitLazerMapSession(preparedSession.sessionDir);
            } catch {
                // Best-effort cleanup.
            }
        }
        await closeDialog();
        showNotification('Lazer action failed', error?.message || 'Failed to unpack or repack this lazer map.', 'error');
    } finally {
        state.isBusy = false;
        state.activeSession = null;
        state.resolveDone = null;
    }

    return true;
};

export default {
    openLazerSessionForAction,
};
