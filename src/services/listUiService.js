import { defaultListUi, listUi } from '../stores/listUi';
import { connectBridge } from './bridgeUtils';

const applySnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return;
  listUi.set({
    isLoading: !!snapshot.isLoading,
    progressVisible: !!snapshot.progressVisible,
    progressPct: Number(snapshot.progressPct ?? defaultListUi.progressPct),
    progressLabel: snapshot.progressLabel || defaultListUi.progressLabel,
    isEmpty: !!snapshot.isEmpty,
    showClearAll: !!snapshot.showClearAll,
  });
};

export const connectListUi = () =>
  connectBridge({
    bridgeName: 'mosuListUI',
    applySnapshot,
  });
