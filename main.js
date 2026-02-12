const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const findOsuFiles = async (dirPath) => {
	try {
		const entries = await fs.readdir(dirPath, { withFileTypes: true });
		const tasks = entries.map(async (entry) => {
			const fullPath = path.join(dirPath, entry.name);
			if (entry.isDirectory()) {
				return findOsuFiles(fullPath);
			} else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.osu') {
				return [fullPath];
			}
			return [];
		});
		const results = await Promise.all(tasks);
		return results.flat();
	} catch {
		return [];
	}
};

const getMimeType = (filePath) => {
	const ext = path.extname(filePath).toLowerCase();
	switch (ext) {
		case '.jpg':
		case '.jpeg':
			return 'image/jpeg';
		case '.png':
			return 'image/png';
		case '.gif':
			return 'image/gif';
		case '.webp':
			return 'image/webp';
		default:
			return 'application/octet-stream';
	}
};


function createWindow() {
	const win = new BrowserWindow({
		width: 850,
		height: 600,
		minWidth: 850,
		minHeight: 400,
		icon: path.join(__dirname, 'assets', 'icons', 'mosu.ico'),
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
		},
		autoHideMenuBar: true,
	});
	win.loadFile('renderer/index.html');
	win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
	createWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

ipcMain.handle('get-app-version', () => {
	return app.getVersion();
});

ipcMain.handle('open-external-url', async (_event, url) => {
	if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
		await shell.openExternal(url);
	}
});

ipcMain.handle('check-for-updates', async () => {
	try {
		const response = await net.fetch('https://api.github.com/repos/fax1015/mosu/releases/latest', {
			headers: { 'User-Agent': 'mosu-app' }
		});
		if (!response.ok) return { error: 'Failed to fetch latest release' };
		const data = await response.json();
		const latestVersion = (data.tag_name || '').replace(/^v/, '');
		const currentVersion = app.getVersion();
		return { currentVersion, latestVersion, htmlUrl: data.html_url || '' };
	} catch (err) {
		return { error: err.message || 'Network error' };
	}
});

ipcMain.handle('read-image-file', async (_event, filePath) => {
	if (!filePath) {
		return null;
	}
	const data = await fs.readFile(filePath);
	const mimeType = getMimeType(filePath);
	return `data:${mimeType};base64,${data.toString('base64')}`;
});

ipcMain.handle('read-binary-file', async (_event, filePath) => {
	if (!filePath) {
		return null;
	}
	return fs.readFile(filePath);
});

ipcMain.handle('read-osu-file', async (_event, filePath) => {
	if (!filePath) {
		return null;
	}
	const content = await fs.readFile(filePath, 'utf8');
	const stat = await fs.stat(filePath);
	return { filePath, content, stat: { mtimeMs: stat.mtimeMs } };
});

ipcMain.handle('stat-file', async (_event, filePath) => {
	if (!filePath) {
		return null;
	}
	const stat = await fs.stat(filePath);
	return { mtimeMs: stat.mtimeMs };
});

ipcMain.handle('show-item-in-folder', async (_event, filePath) => {
	if (!filePath) return;
	shell.showItemInFolder(filePath);
});

ipcMain.handle('open-osu-file', async () => {
	const result = await dialog.showOpenDialog({
		title: 'Select a beatmap (.osu) file',
		properties: ['openFile', 'multiSelections'],
		filters: [{ name: 'osu! beatmap', extensions: ['osu'] }],
	});

	if (result.canceled || !result.filePaths.length) {
		return null;
	}

	const files = await Promise.all(
		result.filePaths.map(async (filePath) => {
			const content = await fs.readFile(filePath, 'utf8');
			const stat = await fs.stat(filePath);
			return { filePath, content, stat: { mtimeMs: stat.mtimeMs } };
		}),
	);

	return { files };
});

const { Worker } = require('worker_threads');
const os = require('os');

/**
 * FIXED: Properly handles worker messages with types
 * The optimized worker sends multiple messages: 'progress' and 'complete'
 * We must only resolve when we receive the 'complete' message with actual results
 */
const runScannerWorkers = (filePaths, mapperName, knownFiles) => {
	const numWorkers = Math.min(os.cpus().length, 4, filePaths.length);
	if (numWorkers === 0) return Promise.resolve([]);

	const chunkSize = Math.ceil(filePaths.length / numWorkers);
	const promises = [];

	for (let i = 0; i < numWorkers; i++) {
		const chunk = filePaths.slice(i * chunkSize, (i + 1) * chunkSize);
		if (chunk.length === 0) continue;

		promises.push(new Promise((resolve, reject) => {
			const worker = new Worker(path.join(__dirname, 'scanner-worker.js'), {
				workerData: { filePaths: chunk, mapperName, knownFiles }
			});

			// CRITICAL FIX: Check message type before resolving
			worker.on('message', (msg) => {
				// Handle different message types from optimized worker
				if (typeof msg === 'object' && msg !== null) {
					if (msg.type === 'complete') {
						// This is the final message with results
						resolve(msg.results);
					} else if (msg.type === 'error') {
						// Fatal error in worker
						reject(new Error(msg.error));
					}
					// Ignore 'progress' messages - they don't contain results
				} else if (Array.isArray(msg)) {
					// Original worker format - just an array of results
					resolve(msg);
				} else {
					// Unknown format
					console.warn('Unknown worker message format:', typeof msg);
					resolve([]);
				}
			});

			worker.on('error', reject);
			worker.on('exit', (code) => {
				if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
			});
		}));
	}

	return Promise.all(promises).then(results => results.flat());
};

ipcMain.handle('scan-directory-osu-files', async (_event, dirPath, mapperName, knownFiles = {}) => {
	if (!dirPath || typeof dirPath !== 'string') {
		return { files: [], directory: dirPath };
	}
	const osuPaths = await findOsuFiles(dirPath);
	const matchingFiles = await runScannerWorkers(osuPaths, mapperName, knownFiles);
	return { files: matchingFiles, directory: dirPath };
});

ipcMain.handle('open-mapper-osu-files', async (_event, mapperName) => {
	if (!mapperName || typeof mapperName !== 'string') {
		return null;
	}

	const result = await dialog.showOpenDialog({
		title: `Select the Songs folder to search for maps by "${mapperName}"`,
		properties: ['openDirectory'],
	});

	if (result.canceled || !result.filePaths.length) {
		return null;
	}

	const dirPath = result.filePaths[0];
	const osuPaths = await findOsuFiles(dirPath);
	const matchingFiles = await runScannerWorkers(osuPaths, mapperName, {});

	return matchingFiles.length ? { files: matchingFiles, directory: dirPath } : null;
});

ipcMain.handle('open-folder-osu-files', async () => {
	const result = await dialog.showOpenDialog({
		title: 'Select a songs folder to scan for .osu files',
		properties: ['openDirectory'],
	});

	if (result.canceled || !result.filePaths.length) {
		return null;
	}

	const dirPath = result.filePaths[0];
	const osuPaths = await findOsuFiles(dirPath);
	const matchingFiles = await runScannerWorkers(osuPaths, null, {});

	return matchingFiles.length ? { files: matchingFiles, directory: dirPath } : null;
});

ipcMain.handle('select-directory', async () => {
	const result = await dialog.showOpenDialog({
		title: 'Select Folder',
		properties: ['openDirectory'],
	});

	if (result.canceled || !result.filePaths.length) {
		return null;
	}

	return result.filePaths[0];
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});