// scripts/sync.mjs
// Automated Addon Verification, Sanitization, and Version Sync Engine
// Supports HTTP, Sandboxed JS, and Pre-audited Local Rust Addons

import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_FIELDS = ['id', 'name', 'version', 'type', 'description', 'publisher'];
const CATALOG_CONFIG = [
  { filename: 'http_addon_catalog.json', expectedType: 'http' },
  { filename: 'js_addon_catalog.json', expectedType: 'js' },
  { filename: 'local_addon_catalog.json', expectedType: 'local' }, // Audited local addons
];

let totalUpdated = 0;
let totalRemoved = 0;

for (const { filename, expectedType } of CATALOG_CONFIG) {
  const filePath = path.resolve(filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`[WARN] ${filename} does not exist. Skipping.`);
    continue;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  let catalog;
  try {
    catalog = JSON.parse(raw);
  } catch (err) {
    console.error(`[ERROR] Invalid JSON in ${filename}:`, err.message);
    continue;
  }

  if (!Array.isArray(catalog.addons)) {
    console.warn(`[WARN] ${filename} does not contain an 'addons' array.`);
    continue;
  }

  const cleanList = [];
  let fileModified = false;

  console.log(`\n--- Checking ${filename} (${catalog.addons.length} addons, type: ${expectedType}) ---`);

  for (const addon of catalog.addons) {
    if (!addon.manifestUrl) {
      console.warn(`[REMOVE] ${addon.id || 'unknown'}: Missing manifestUrl.`);
      totalRemoved++;
      fileModified = true;
      continue;
    }

    try {
      console.log(`[PROBING] ${addon.name || addon.id} (${addon.manifestUrl})...`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(addon.manifestUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'delulu-catalog-ci/1.0',
          Accept: 'application/json',
        },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        console.warn(`[UNREACHABLE] ${addon.id}: HTTP ${res.status}. Keeping existing entry.`);
        cleanList.push(addon);
        continue;
      }

      const remote = await res.json();

      // RULE 1: Type check matches catalog category
      if (remote.type !== expectedType) {
        console.error(`[INVALIDATE/REMOVE] ${addon.id}: Manifest type '${remote.type}' does not match expected '${expectedType}'.`);
        totalRemoved++;
        fileModified = true;
        continue;
      }

      // RULE 2: ID Match Check
      if (remote.id && remote.id.toLowerCase() !== addon.id.toLowerCase()) {
        console.error(`[INVALIDATE/REMOVE] ${addon.id}: Remote ID mismatch ('${remote.id}' vs registered '${addon.id}').`);
        totalRemoved++;
        fileModified = true;
        continue;
      }

      // RULE 3: Required Fields Validation
      let hasMissing = false;
      for (const field of REQUIRED_FIELDS) {
        if (!remote[field] || typeof remote[field] !== 'string') {
          console.warn(`[INVALID] ${addon.id}: Missing or invalid field '${field}'. Keeping existing entry.`);
          hasMissing = true;
          break;
        }
      }
      if (hasMissing) {
        cleanList.push(addon);
        continue;
      }

      // RULE 4: Sanitize fields to standard schema
      const sanitized = {
        id: remote.id.trim(),
        name: remote.name.trim(),
        version: remote.version.trim(),
        type: remote.type.trim(),
        description: remote.description.trim(),
        publisher: remote.publisher.trim(),
        manifestUrl: addon.manifestUrl,
        logo: typeof remote.logo === 'string' && remote.logo.trim() ? remote.logo.trim() : addon.logo,
      };

      // Check for changes (version bump, description, name, logo)
      let changed = false;
      if (sanitized.version !== addon.version) {
        console.log(`  🚀 [VERSION BUMP] ${addon.id}: ${addon.version} -> ${sanitized.version}`);
        changed = true;
      }
      if (sanitized.description !== addon.description) {
        console.log(`  ✏️ [DESC UPDATE] ${addon.id}`);
        changed = true;
      }
      if (sanitized.name !== addon.name) {
        console.log(`  ✏️ [NAME UPDATE] ${addon.id}: ${addon.name} -> ${sanitized.name}`);
        changed = true;
      }
      if (sanitized.logo !== addon.logo) {
        console.log(`  🖼️ [LOGO UPDATE] ${addon.id}`);
        changed = true;
      }

      if (changed) {
        fileModified = true;
        totalUpdated++;
      }

      cleanList.push(sanitized);
    } catch (err) {
      console.warn(`[WARN] Probing failed for ${addon.id}: ${err.message}. Preserving existing entry.`);
      cleanList.push(addon);
    }
  }

  if (fileModified) {
    cleanList.sort((a, b) => a.name.localeCompare(b.name));
    fs.writeFileSync(filePath, JSON.stringify({ addons: cleanList }, null, 2) + '\n');
    console.log(`[SAVED] ${filename} successfully updated and written.`);
  } else {
    console.log(`[NO CHANGES] All addons in ${filename} are verified and up to date.`);
  }
}

console.log(`\n=== Summary: ${totalUpdated} addons updated, ${totalRemoved} removed ===`);
