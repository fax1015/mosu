export const closeDialogWithAnimation = (dialog) => {
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
