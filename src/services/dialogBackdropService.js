export const isOutsideDialogBoundsClick = (event) => {
  const dialog = event?.currentTarget;
  if (!(dialog instanceof HTMLDialogElement)) return false;

  if (event.target !== dialog) {
    return false;
  }

  const rect = dialog.getBoundingClientRect();
  const x = Number(event.clientX);
  const y = Number(event.clientY);

  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
};
