export const withBridge = (bridgeName, fn) => {
  if (!bridgeName || typeof fn !== 'function') return null;
  const bridge = window?.[bridgeName];
  if (!bridge) return null;
  return fn(bridge);
};

export const connectBridge = ({
  bridgeName,
  applySnapshot,
  pollMs = 50,
  getSnapshotFallback = (bridge) => bridge.getState?.(),
}) => {
  let hasHydratedFromSnapshot = false;
  const applySnapshotOnce = (snapshot) => {
    if (snapshot === undefined) return;
    if (typeof applySnapshot !== 'function') return;
    applySnapshot(snapshot);
    hasHydratedFromSnapshot = true;
  };

  const tryConnect = () =>
    withBridge(bridgeName, (bridge) => {
      if (typeof bridge.subscribe === 'function') {
        const unsubscribe = bridge.subscribe((snapshot) => {
          if (typeof applySnapshot === 'function') {
            applySnapshot(snapshot);
          }
        });

        // If the bridge emitted before this subscription was attached,
        // immediately hydrate from a direct snapshot pull once.
        if (!hasHydratedFromSnapshot) {
          applySnapshotOnce(getSnapshotFallback(bridge));
        }

        return unsubscribe;
      }

      if (!hasHydratedFromSnapshot) {
        applySnapshotOnce(getSnapshotFallback(bridge));
      }

      return null;
    });

  const direct = tryConnect();
  if (typeof direct === 'function') {
    return direct;
  }

  let stop = () => {};
  const timer = setInterval(() => {
    const resolved = tryConnect();
    if (typeof resolved === 'function') {
      clearInterval(timer);
      stop = resolved;
    }
  }, pollMs);

  return () => {
    clearInterval(timer);
    stop();
  };
};
