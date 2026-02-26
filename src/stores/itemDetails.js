import { derived, writable } from 'svelte/store';

export const defaultItemDetails = [];

export const itemDetails = writable(defaultItemDetails);

export const itemDetailsById = derived(itemDetails, ($itemDetails) => {
  const map = new Map();
  for (const item of $itemDetails) {
    if (!item?.id) continue;
    map.set(item.id, item);
  }
  return map;
});
