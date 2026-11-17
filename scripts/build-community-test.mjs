/**
 * Build the Community TEST plugin into a new isolated staging directory.
 * It never installs into a vault or touches the normal build/release outputs.
 * TEST builds are intentionally not release-compatible.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { bundleCSS } from './bundle-css.mjs';
import { generateEmbeddedAssets } from './embed-plugin-assets.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.cwd() !== repo || process.argv.length !== 2) {
  throw new Error('Run from the main plugin repository with no arguments.');
}
const testRoot = path.resolve(repo, '../../Platform/Community Test Environment');
if (!fs.existsSync(testRoot) || fs.realpathSync(testRoot) !== testRoot) {
  throw new Error('Expected isolated Community Test Environment folder.');
}
const builds = path.join(testRoot, 'plugin-builds');
fs.mkdirSync(builds, { recursive: true });
if (fs.realpathSync(builds) !== builds) throw new Error('Refusing a linked build directory.');
const output = fs.mkdtempSync(path.join(builds, 'community-test-'));
const prodProject = 'gjffqdfjcjdmqxuqlzsj.supabase.co';
const testProject = 'bzdtwxckbacjvgmsuyrm.supabase.co';
const prodCommunity = 'community.radialtimeline.com';
const testCommunity = 'radial-timeline-community-test.vercel.app';
const oldInstallation = 'rt.community-share.installation-id';
const oldConnection = 'rt.community-share.connection-secret';
const newInstallation = 'rt.community-test.installation-id';
const newConnection = 'rt.community-test.connection-secret';
const seen = new Set();
const rewrite = {
  name: 'isolate-community-test',
  setup(build) {
    build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
      if (!args.path.startsWith(path.join(repo, 'src') + path.sep)) return;
      const ext = path.extname(args.path);
      if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return;
      let text = await fs.promises.readFile(args.path, 'utf8');
      let changed = false;
      for (const [before, after] of [[prodProject,testProject],[prodCommunity,testCommunity],
        [oldInstallation,newInstallation],[oldConnection,newConnection],['radial-timeline:','radial-timeline-community-test:']]) {
        if (text.includes(before)) { text = text.replaceAll(before, after); seen.add(before); changed = true; }
      }
      if (args.path === path.join(repo, 'src/main.ts')) {
        const start = '    async onload() {';
        if (text.split(start).length !== 2) throw new Error('Plugin startup changed; review the test banner.');
        text = text.replace(start, `${start}\n        this.addStatusBarItem().setText('TEST COMMUNITY — fictional data only');\n        new Notice('TEST COMMUNITY — isolated test plugin', 10000);`);
        changed = true;
      }
      if (!changed) return;
      return { contents: text, loader: ext === '.tsx' ? 'tsx' : ext === '.jsx' ? 'jsx' : ext === '.ts' ? 'ts' : 'js' };
    });
  },
};

generateEmbeddedAssets({ quiet: true });
const result = await esbuild.build({
  entryPoints: ['src/main.ts'], bundle: true, write: false, plugins: [rewrite],
  drop: ['console', 'debugger'],
  external: ['obsidian','electron','codemirror','@codemirror/autocomplete','@codemirror/collab',
    '@codemirror/commands','@codemirror/language','@codemirror/lint','@codemirror/search',
    '@codemirror/state','@codemirror/view',...builtinModules,...builtinModules.map(x => `node:${x}`)],
  format: 'cjs', charset: 'utf8', target: 'es2018', treeShaking: true, keepNames: true,
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.RT_FONT_CATALOG': 'undefined', '__RT_DEV__': 'false' },
});
const js = result.outputFiles[0].text;
for (const value of [prodProject, prodCommunity, oldInstallation, oldConnection]) {
  if (js.includes(value) || !seen.has(value)) throw new Error(`Test isolation check failed for ${value}`);
}
for (const value of [testProject, testCommunity, newInstallation, newConnection, 'TEST COMMUNITY']) {
  if (!js.includes(value)) throw new Error(`Test bundle is missing ${value}`);
}
await bundleCSS({ quiet: true });
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'src/manifest.json'), 'utf8'));
manifest.id = 'radial-timeline-community-test';
manifest.name = 'Radial Timeline — COMMUNITY TEST';
manifest.description = 'Isolated Community testing only. Use fictional data in the dedicated test vault.';
fs.writeFileSync(path.join(output, 'main.js'), js);
fs.copyFileSync(path.join(repo, 'styles.css'), path.join(output, 'styles.css'));
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Test-only plugin staged at ${output}`);
console.log('No vault was modified. Native Obsidian and network isolation remain unverified.');
