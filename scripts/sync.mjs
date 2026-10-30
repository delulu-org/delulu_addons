import fs from 'node:fs';
import path from 'node:path';

const files = ['http_addon_catalog.json', 'js_addon_catalog.json'];
let hasChanges = false;

for (const filename of files) {
  const filePath = path.resolve(filename);
  if (!fs.existsSync(filePath)) continue;

  const catalog = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!Array.isArray(catalog.addons)) continue;

  let fileUpdated = false;

  for (let i = 0; i < catalog.addons.length; i++) {
    const addon = catalog.addons[i];
    if (!addon.manifestUrl) continue;

    try {
      const res = await fetch(addon.manifestUrl, {
        headers: { 'User-Agent': 'delulu-catalog-sync/1.0' },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) continue;

      const remote = await res.json();
      if (!remote.id || remote.id !== addon.id) continue;

      let addonChanged = false;
      if (remote.version && remote.version !== addon.version) {
        console.log(`[UPDATE] ${addon.id} version ${addon.version} -> ${remote.version}`);
        addon.version = remote.version;
        addonChanged = true;
      }
      if (remote.description && remote.description !== addon.description) {
        addon.description = remote.description;
        addonChanged = true;
      }
      if (remote.name && remote.name !== addon.name) {
        addon.name = remote.name;
        addonChanged = true;
      }
      if (remote.logo && remote.logo !== addon.logo) {
        addon.logo = remote.logo;
        addonChanged = true;
      }

      if (addonChanged) {
        fileUpdated = true;
        hasChanges = true;
      }
    } catch (err) {
      console.warn(`[WARN] Could not probe ${addon.id}:`, err.message);
    }
  }

  if (fileUpdated) {
    fs.writeFileSync(filePath, JSON.stringify(catalog, null, 2) + '\n');
    console.log(`[SAVED] ${filename} updated with latest versions.`);
  }
}

if (!hasChanges) {
  console.log('[OK] All registered catalog addons are up to date.');
}
