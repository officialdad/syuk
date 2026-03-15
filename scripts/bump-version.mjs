#!/usr/bin/env node
/**
 * Bump version and push a tag to trigger deployment.
 *
 * Usage:
 *   node scripts/bump-version.mjs          → bumps patch, e.g. 1.0.0 → 1.0.1-rc.1
 *   node scripts/bump-version.mjs minor    → bumps minor, e.g. 1.0.0 → 1.1.0-rc.1
 *   node scripts/bump-version.mjs major    → bumps major, e.g. 1.0.0 → 2.0.0-rc.1
 *
 * What it does:
 *   1. Reads current version from dashboard/package.json
 *   2. Increments the requested part and appends -rc.N
 *   3. Updates version in package.json, index.ts, and HTML footers
 *   4. git add → git commit → git tag → git push --follow-tags
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const pkgPath = resolve(rootDir, 'dashboard/package.json');
const indexTsPath = resolve(rootDir, 'dashboard/src/index.ts');
const indexHtmlPath = resolve(rootDir, 'dashboard/public/index.html');
const hazardsHtmlPath = resolve(rootDir, 'dashboard/public/hazards.html');
const cifsHtmlPath = resolve(rootDir, 'dashboard/public/cifs-viewer.html');

const bump = process.argv[2] ?? 'patch';
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error(`Unknown bump type "${bump}". Use: patch | minor | major`);
  process.exit(1);
}

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: rootDir }).trim();
}

function replaceInFile(filePath, search, replace) {
  const content = readFileSync(filePath, 'utf8');
  writeFileSync(filePath, content.replaceAll(search, replace));
}

// Read current version (strip any existing pre-release suffix)
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const currentVersion = pkg.version;
const base = currentVersion.replace(/-.*$/, '');
const [major, minor, patch] = base.split('.').map(Number);

let next;
if (bump === 'major') next = `${major + 1}.0.0`;
else if (bump === 'minor') next = `${major}.${minor + 1}.0`;
else next = `${major}.${minor}.${patch + 1}`;

// Find next rc number for this version
const existingTags = run('git tag --list').split('\n');
const rcPattern = new RegExp(`^v${next.replace(/\./g, '\\.')}-rc\\.(\\d+)$`);
const rcNumbers = existingTags
  .map(t => t.match(rcPattern))
  .filter(Boolean)
  .map(m => Number(m[1]));
const nextRc = rcNumbers.length ? Math.max(...rcNumbers) + 1 : 1;

const version = `${next}-rc.${nextRc}`;
const tag = `v${version}`;

console.log(`\n📦 Bumping ${currentVersion} → ${version}\n`);

// Update package.json
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// Update index.ts version endpoint
replaceInFile(indexTsPath, `version: '${currentVersion}'`, `version: '${version}'`);

// Update HTML footers
replaceInFile(indexHtmlPath, `v${currentVersion}`, `v${version}`);
replaceInFile(hazardsHtmlPath, `v${currentVersion}`, `v${version}`);
replaceInFile(cifsHtmlPath, `v${currentVersion}`, `v${version}`);

console.log(`Updated files:`);
console.log(`  - dashboard/package.json`);
console.log(`  - dashboard/src/index.ts`);
console.log(`  - dashboard/public/index.html`);
console.log(`  - dashboard/public/hazards.html`);
console.log(`  - dashboard/public/cifs-viewer.html`);
console.log();

// Commit and tag
run(`git add ${pkgPath} ${indexTsPath} ${indexHtmlPath} ${hazardsHtmlPath} ${cifsHtmlPath}`);
run(`git commit -m "release: ${tag}"`);
run(`git tag -a ${tag} -m "${tag}"`);
run('git push --follow-tags');

console.log(`\n✓ Released ${tag} — GitHub Actions will deploy automatically\n`);
