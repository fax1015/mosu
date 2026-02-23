(function () {
  if (window.beatmapApi && window.appInfo && window.embedSyncApi) {
    return;
  }

  const invoke = async (command, args) => {
    const tauri = window.__TAURI__;
    if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') {
      throw new Error('Tauri runtime is not available');
    }
    return tauri.core.invoke(command, args || {});
  };

  const convertFileSrc = (filePath) => {
    const tauri = window.__TAURI__;
    if (tauri && tauri.core && typeof tauri.core.convertFileSrc === 'function') {
      return tauri.core.convertFileSrc(filePath);
    }
    // Fallback: construct asset URL manually
    const encoded = encodeURIComponent(filePath);
    return `http://asset.localhost/${encoded}`;
  };

  const toBinary = (value) => {
    if (!value) return null;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      return value;
    }
    if (Array.isArray(value)) {
      return new Uint8Array(value);
    }
    return null;
  };

  window.windowControls = window.windowControls || {
    minimize: () => invoke('window_minimize'),
    maximize: () => invoke('window_maximize'),
    close: () => invoke('window_close'),
  };

  window.analysisChannel = window.analysisChannel || {
    sendState: (isAnalyzing) => invoke('analysis_state', { isAnalyzing: !!isAnalyzing }).catch(() => { }),
  };

  const listen = async (event, callback) => {
    const tauri = window.__TAURI__;
    if (!tauri || !tauri.event || typeof tauri.event.listen !== 'function') {
      throw new Error('Tauri event runtime is not available');
    }
    return tauri.event.listen(event, (e) => callback(e.payload));
  };

  window.tauriEvents = window.tauriEvents || {
    listen,
  };

  window.beatmapApi = window.beatmapApi || {
    openOsuFile: () => invoke('open_osu_file'),
    openMapperOsuFiles: (mapperName) => invoke('open_mapper_osu_files', { mapperName }),
    openFolderOsuFiles: () => invoke('open_folder_osu_files'),
    readImage: (filePath) => invoke('read_image_file', { filePath }),
    readBinary: async (filePath) => toBinary(await invoke('read_binary_file', { filePath })),
    readOsuFile: (filePath) => invoke('read_osu_file', { filePath }),
    statFile: (filePath) => invoke('stat_file', { filePath }),
    scanDirectoryOsuFiles: (dirPath, mapperName, knownFiles) =>
      invoke('scan_directory_osu_files', { dirPath, mapperName, knownFiles }),
    listDirectoryOsuFiles: (dirPath, mapperName) =>
      invoke('list_directory_osu_files', { dirPath, mapperName }),
    selectDirectory: () => invoke('select_directory'),
    showItemInFolder: (filePath) => invoke('show_item_in_folder', { filePath }),
    convertFileSrc: (filePath) => convertFileSrc(filePath),
    getAudioDuration: (filePath) => invoke('get_audio_duration', { filePath }),
    calculateStarRating: (filePath) => invoke('calculate_star_rating', { filePath }),
  };

  window.appInfo = window.appInfo || {
    getVersion: () => invoke('get_app_version'),
    checkForUpdates: () => invoke('check_for_updates'),
    openExternalUrl: (url) => invoke('open_external_url', { url }),
  };

  window.embedSyncApi = window.embedSyncApi || {
    sync: (url, apiKey, data) => invoke('embed_sync', { url, apiKey, data }),
  };
})();
