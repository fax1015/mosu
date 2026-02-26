import { writable } from 'svelte/store';

export const defaultTodoOrder = {
  todoIds: [],
  doneIds: [],
};

export const todoOrder = writable(defaultTodoOrder);
