const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const freshConfigPath = path.join(rootDir, 'src-tauri', 'tauri.firstrun.conf.json');

const freshIdentifier = 'com.fax1015.mosu.firstrun';
const freshConfig = {
  productName: 'mosu-firstrun',
  identifier: freshIdentifier
};

fs.writeFileSync(freshConfigPath, `${JSON.stringify(freshConfig, null, 2)}\n`, 'utf8');

const removeDirIfExists = (dirPath) => {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`[mosu] Cleared: ${dirPath}`);
    }
  } catch (error) {
    console.warn(`[mosu] Could not clear ${dirPath}: ${error.message}`);
  }
};

const candidateDirs = [];
const home = process.env.HOME || process.env.USERPROFILE || '';

if (process.platform === 'win32') {
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;

  if (appData) {
    candidateDirs.push(path.join(appData, freshIdentifier));
    candidateDirs.push(path.join(appData, 'mosu-firstrun'));
  }
  if (localAppData) {
    candidateDirs.push(path.join(localAppData, freshIdentifier));
    candidateDirs.push(path.join(localAppData, 'mosu-firstrun'));
  }
} else if (process.platform === 'darwin') {
  candidateDirs.push(path.join(home, 'Library', 'Application Support', freshIdentifier));
  candidateDirs.push(path.join(home, 'Library', 'Application Support', 'mosu-firstrun'));
} else {
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  candidateDirs.push(path.join(xdgDataHome, freshIdentifier));
  candidateDirs.push(path.join(xdgDataHome, 'mosu-firstrun'));
  candidateDirs.push(path.join(xdgConfigHome, freshIdentifier));
  candidateDirs.push(path.join(xdgConfigHome, 'mosu-firstrun'));
}

new Set(candidateDirs).forEach(removeDirIfExists);

console.log(`[mosu] Fresh run identifier: ${freshIdentifier}`);
console.log('[mosu] Launching clean first-run instance...');

const child = spawn(
  'npx',
  ['tauri', 'dev', '--config', freshConfigPath],
  {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  }
);

child.on('error', (error) => {
  console.error('[mosu] Failed to launch tauri dev:', error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
