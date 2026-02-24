const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const tauriConfPath = path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(__dirname, '..', 'src-tauri', 'Cargo.toml');

// Read version from package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

console.log(`Syncing version ${version} to configuration files...`);

// 1. Update tauri.conf.json
try {
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
    if (tauriConf.version !== version) {
        tauriConf.version = version;
        // Check if tauri.conf.json uses 2 spaces or 4 spaces or tabs? 
        // We'll use 2 spaces as it seems standard in the previous view
        fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
        console.log(`✅ Updated tauri.conf.json to ${version}`);
    } else {
        console.log(`ℹ️ tauri.conf.json is already at ${version}`);
    }
} catch (error) {
    console.error(`❌ Failed to update tauri.conf.json: ${error.message}`);
}

// 2. Update Cargo.toml
try {
    let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
    // Regex to find version = "x.y.z" at the start of a line (under [package])
    // We assume the first occurrence of version = "..." is the package version
    const versionRegex = /^version\s*=\s*"(.*)"/m;

    match = cargoToml.match(versionRegex);
    if (match) {
        const currentCargoVersion = match[1];
        if (currentCargoVersion !== version) {
            const newCargoToml = cargoToml.replace(versionRegex, `version = "${version}"`);
            fs.writeFileSync(cargoTomlPath, newCargoToml);
            console.log(`✅ Updated Cargo.toml from ${currentCargoVersion} to ${version}`);
        } else {
            console.log(`ℹ️ Cargo.toml is already at ${version}`);
        }
    } else {
        console.warn('⚠️ Could not find version field in Cargo.toml');
    }
} catch (error) {
    console.error(`❌ Failed to update Cargo.toml: ${error.message}`);
}
