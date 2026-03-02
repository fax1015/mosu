/**
 * StorageWorker.js - Web Worker for offloading JSON.stringify operations
 * Offloads heavy JSON.stringify from main thread to prevent UI blocking
 */

/**
 * Handle messages from the main thread
 * Expected message format: { payload: Object, id: string }
 * Response format: { result: string, id: string } or { error: string, id: string }
 */
self.onmessage = function(event) {
    const { payload, id } = event.data;

    if (!payload) {
        self.postMessage({
            error: 'No payload provided',
            id: id || null
        });
        return;
    }

    try {
        // Perform the heavy JSON.stringify operation off the main thread
        const result = JSON.stringify(payload);

        self.postMessage({
            result: result,
            id: id
        });
    } catch (error) {
        self.postMessage({
            error: error.message || 'JSON.stringify failed in worker',
            id: id
        });
    }
};
