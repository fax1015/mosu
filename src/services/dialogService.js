const closeDialogWithAnimation = (dialog) => {
  return new Promise((resolve) => {
    if (!dialog || !dialog.open) {
      resolve();
      return;
    }

    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      dialog.classList.remove('is-closing');
      dialog.close();
      dialog.removeEventListener('animationend', onAnimationEnd);
      resolve();
    };

    const onAnimationEnd = (event) => {
      if (event.target !== dialog) return;
      finish();
    };

    dialog.classList.add('is-closing');
    dialog.addEventListener('animationend', onAnimationEnd);
    setTimeout(finish, 500);
  });
};

const getDialog = (id) => document.getElementById(id);

export const showAboutDialog = () => {
  getDialog('aboutDialog')?.showModal();
};

export const showChangelogDialog = () => {
  getDialog('changelogDialog')?.showModal();
};

export const showSettingsDialog = () => {
  window.mosuSettings?.updateUI?.();
  getDialog('settingsDialog')?.showModal();
};

export const closeAboutDialog = () => {
  return closeDialogWithAnimation(getDialog('aboutDialog'));
};

export const closeChangelogDialog = () => {
  return closeDialogWithAnimation(getDialog('changelogDialog'));
};

export const closeSettingsDialog = () => {
  return closeDialogWithAnimation(getDialog('settingsDialog'));
};

export const initializeDialogApi = () => {
  window.mosuDialogs = {
    ...(window.mosuDialogs || {}),
    showAboutDialog,
    showChangelogDialog,
    showSettingsDialog,
    closeAboutDialog,
    closeChangelogDialog,
    closeSettingsDialog,
  };
};
