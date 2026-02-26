import { defaultItemDetails, itemDetails } from '../stores/itemDetails';
import { connectBridge, withBridge } from './bridgeUtils';

const normalizeOne = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  if (!entry.id) return null;
  return {
    id: String(entry.id),
    deadline:
      typeof entry.deadline === 'number' || entry.deadline === null
        ? entry.deadline
        : null,
    targetStarRating:
      typeof entry.targetStarRating === 'number' || entry.targetStarRating === null
        ? entry.targetStarRating
        : null,
    notes: String(entry.notes || ''),
  };
};

const normalizeMany = (snapshot) => {
  if (!Array.isArray(snapshot)) return defaultItemDetails;
  return snapshot.map((entry) => normalizeOne(entry)).filter(Boolean);
};

const applySnapshot = (snapshot) => {
  const normalized = normalizeMany(snapshot);
  itemDetails.set(normalized);
};

export const connectItemDetails = () =>
  connectBridge({
    bridgeName: 'mosuItemDetails',
    applySnapshot,
  });

export const setItemDeadline = (itemId, deadline) =>
  withBridge('mosuItemDetails', (bridge) => bridge.setDeadline?.(itemId, deadline));

export const setItemTargetStar = (itemId, rating) =>
  withBridge('mosuItemDetails', (bridge) => bridge.setTargetStar?.(itemId, rating));

export const setItemNotes = (itemId, notes) =>
  withBridge('mosuItemDetails', (bridge) => bridge.setNotes?.(itemId, notes));
