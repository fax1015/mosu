import { defaultRefreshUi, refreshUi } from '../stores/refreshUi';
import { connectBridge } from './bridgeUtils';

const applySnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return;
  refreshUi.set({
    isRefreshing: !!snapshot.isRefreshing,
    isAnalyzing: !!snapshot.isAnalyzing,
    progressPct: Number(snapshot.progressPct ?? defaultRefreshUi.progressPct),
    tooltip: snapshot.tooltip || defaultRefreshUi.tooltip,
    isPulsing: !!snapshot.isPulsing,
  });
};

export const connectRefreshUi = () =>
  connectBridge({
    bridgeName: 'mosuRefreshUI',
    applySnapshot,
  });
