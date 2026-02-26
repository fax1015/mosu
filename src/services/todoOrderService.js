import { get } from 'svelte/store';
import { defaultTodoOrder, todoOrder } from '../stores/todoOrder';
import { connectBridge, withBridge } from './bridgeUtils';

const applySnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return;
  todoOrder.set({
    todoIds: Array.isArray(snapshot.todoIds) ? snapshot.todoIds : defaultTodoOrder.todoIds,
    doneIds: Array.isArray(snapshot.doneIds) ? snapshot.doneIds : defaultTodoOrder.doneIds,
  });
};

export const connectTodoOrder = () =>
  connectBridge({
    bridgeName: 'mosuTodoOrder',
    applySnapshot,
  });

export const reorderTodo = (draggedId, dropId) => {
  const result = withBridge('mosuTodoOrder', (bridge) =>
    bridge.reorderTodo?.(draggedId, dropId)
  );
  if (result === true) {
    const snapshot = withBridge('mosuTodoOrder', (bridge) => bridge.getState?.());
    if (snapshot) applySnapshot(snapshot);
    return true;
  }

  if (!window.mosuTodoOrder) {
    const state = get(todoOrder);
    const fromIndex = state.todoIds.indexOf(draggedId);
    const toIndex = state.todoIds.indexOf(dropId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
      return false;
    }

    const nextTodoIds = [...state.todoIds];
    const [moved] = nextTodoIds.splice(fromIndex, 1);
    nextTodoIds.splice(toIndex, 0, moved);
    applySnapshot({ ...state, todoIds: nextTodoIds });
    return true;
  }

  return !!result;
};
