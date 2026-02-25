import { writable } from 'svelte/store';

export const notifications = writable([]);

let nextId = 1;
const dismissTimers = new Map();
const removeTimers = new Map();

const setVisible = (id, isVisible) => {
  notifications.update((items) => items.map((item) => (
    item.id === id ? { ...item, isVisible } : item
  )));
};

const removeNow = (id) => {
  notifications.update((items) => items.filter((item) => item.id !== id));
};

export const dismissNotification = (id) => {
  const dismissTimer = dismissTimers.get(id);
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimers.delete(id);
  }

  const existingRemoveTimer = removeTimers.get(id);
  if (existingRemoveTimer) {
    clearTimeout(existingRemoveTimer);
  }

  setVisible(id, false);

  const removeTimer = setTimeout(() => {
    removeNow(id);
    removeTimers.delete(id);
  }, 300);

  removeTimers.set(id, removeTimer);
};

export const pushNotification = (title, message, type = 'default', duration = 5000) => {
  const id = nextId++;

  notifications.update((items) => [
    ...items,
    {
      id,
      title: String(title ?? ''),
      message: String(message ?? ''),
      type,
      isVisible: false,
    },
  ]);

  setTimeout(() => setVisible(id, true), 10);

  if (duration > 0) {
    const timer = setTimeout(() => dismissNotification(id), duration);
    dismissTimers.set(id, timer);
  }

  return id;
};