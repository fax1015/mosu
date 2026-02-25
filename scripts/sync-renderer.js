const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const sourcePath = path.join(rootDir, 'renderer', 'renderer.js');
const targetPath = path.join(rootDir, 'public', 'renderer.js');

if (!fs.existsSync(sourcePath)) {
  console.error(`[sync-renderer] Missing source file: ${sourcePath}`);
  process.exit(1);
}

const sourceContent = fs.readFileSync(sourcePath, 'utf8');
fs.mkdirSync(path.dirname(targetPath), { recursive: true });

const existingContent = fs.existsSync(targetPath)
  ? fs.readFileSync(targetPath, 'utf8')
  : null;

if (existingContent === sourceContent) {
  console.log('[sync-renderer] renderer.js already in sync');
  process.exit(0);
}

fs.writeFileSync(targetPath, sourceContent, 'utf8');
console.log('[sync-renderer] Synced renderer/renderer.js -> public/renderer.js');
