const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const path = require('path');
const fs = require('fs');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: 'assets/icons/mosu',

    // Ignore unnecessary files from being packaged
    ignore: [
      /^\/\.git/,
      /^\/\.vscode/,
      /^\/out/,
      /^\/plans/,
      /^\/extra\.txt/,
      /^\/\.env/,
      /^\/README\.md/,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32'],
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
    }),
  ],
  hooks: {
    postPackage: async (forgeConfig, options) => {
      const outputPath = options.outputPaths[0];
      
      // Remove LICENSES.chromium.html (~15MB)
      const licensePath = path.join(outputPath, 'LICENSES.chromium.html');
      if (fs.existsSync(licensePath)) {
        fs.unlinkSync(licensePath);
        console.log('Removed LICENSES.chromium.html (~15MB saved)');
      }

      // Strip unused locales (~28MB saved, keep only English)
      const localesDir = path.join(outputPath, 'locales');
      if (fs.existsSync(localesDir)) {
        const files = fs.readdirSync(localesDir);
        let removed = 0;
        for (const file of files) {
          if (file !== 'en-US.pak') {
            fs.unlinkSync(path.join(localesDir, file));
            removed++;
          }
        }
        console.log(`Stripped ${removed} unused locale files`);
      }
    },
  },
};
