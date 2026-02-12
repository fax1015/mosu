
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windowControls', {
	minimize: () => ipcRenderer.send('window-minimize'),
	maximize: () => ipcRenderer.send('window-maximize'),
	close: () => ipcRenderer.send('window-close'),
});

contextBridge.exposeInMainWorld('beatmapApi', {
	openOsuFile: () => ipcRenderer.invoke('open-osu-file'),
	openMapperOsuFiles: (mapperName) => ipcRenderer.invoke('open-mapper-osu-files', mapperName),
	openFolderOsuFiles: () => ipcRenderer.invoke('open-folder-osu-files'),
	readImage: (filePath) => ipcRenderer.invoke('read-image-file', filePath),
	readBinary: (filePath) => ipcRenderer.invoke('read-binary-file', filePath),
	readOsuFile: (filePath) => ipcRenderer.invoke('read-osu-file', filePath),
	statFile: (filePath) => ipcRenderer.invoke('stat-file', filePath),
	scanDirectoryOsuFiles: (dirPath, mapperName, knownFiles) => ipcRenderer.invoke('scan-directory-osu-files', dirPath, mapperName, knownFiles),
	listDirectoryOsuFiles: (dirPath, mapperName) => ipcRenderer.invoke('list-directory-osu-files', dirPath, mapperName),
	selectDirectory: () => ipcRenderer.invoke('select-directory'),
	showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
});

// Allow renderer to notify main about analysis state changes
contextBridge.exposeInMainWorld('analysisChannel', {
	sendState: (isAnalyzing) => ipcRenderer.send('analysis-state', !!isAnalyzing),
});

contextBridge.exposeInMainWorld('appInfo', {
	getVersion: () => ipcRenderer.invoke('get-app-version'),
	checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
	openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
});
