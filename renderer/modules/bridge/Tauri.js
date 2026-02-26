/**
 * Tauri Bridge Module
 * Provides ES module wrappers for Tauri global APIs
 */

/**
 * Beatmap API for file operations
 */
export const beatmapApi = window.beatmapApi || {
    openOsuFile: () => { throw new Error('Tauri not available'); },
    openMapperOsuFiles: (mapperName) => { throw new Error('Tauri not available'); },
    openFolderOsuFiles: () => { throw new Error('Tauri not available'); },
    readImage: (filePath) => { throw new Error('Tauri not available'); },
    readBinary: (filePath) => { throw new Error('Tauri not available'); },
    readOsuFile: (filePath) => { throw new Error('Tauri not available'); },
    statFile: (filePath) => { throw new Error('Tauri not available'); },
    scanDirectoryOsuFiles: (dirPath, mapperName, knownFiles) => { throw new Error('Tauri not available'); },
    listDirectoryOsuFiles: (dirPath, mapperName) => { throw new Error('Tauri not available'); },
    selectDirectory: () => { throw new Error('Tauri not available'); },
    showItemInFolder: (filePath) => { throw new Error('Tauri not available'); },
    openInTextEditor: (filePath) => { throw new Error('Tauri not available'); },
    convertFileSrc: (filePath) => { throw new Error('Tauri not available'); },
    getAudioDuration: (filePath) => { throw new Error('Tauri not available'); },
    calculateStarRating: (filePath) => { throw new Error('Tauri not available'); },
};

/**
 * App Info API for application-related operations
 */
export const appInfo = window.appInfo || {
    getVersion: () => { throw new Error('Tauri not available'); },
    checkForUpdates: () => { throw new Error('Tauri not available'); },
    openExternalUrl: (url) => { throw new Error('Tauri not available'); },
    getOsuUserData: (urlOrId) => { throw new Error('Tauri not available'); },
};

/**
 * Tauri Events API for listening to backend events
 */
export const tauriEvents = window.tauriEvents || {
    listen: (event, callback) => { throw new Error('Tauri not available'); },
};

/**
 * Embed Sync API for syncing data to external embed site
 */
export const embedSyncApi = window.embedSyncApi || {
    sync: (url, apiKey, data) => { throw new Error('Tauri not available'); },
};
