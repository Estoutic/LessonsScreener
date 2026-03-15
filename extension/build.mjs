import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

const isWatch = process.argv.includes('--watch');
const distDir = 'dist';

// Ensure dist exists
mkdirSync(distDir, { recursive: true });

// Copy static files to dist
const staticFiles = [
  ['manifest.json', 'manifest.json'],
  ['popup.html', 'popup.html'],
  ['offscreen.html', 'offscreen.html'],
];

for (const [src, dest] of staticFiles) {
  cpSync(src, `${distDir}/${dest}`);
}

// Copy assets directory
if (existsSync('assets')) {
  cpSync('assets', `${distDir}/assets`, { recursive: true });
}

console.log('Static files copied to dist/');

// Build configurations
const builds = [
  {
    entryPoints: ['src/service-worker.ts'],
    outfile: `${distDir}/service-worker.js`,
    bundle: true,
    format: 'esm',
    target: 'chrome120',
    logLevel: 'info',
  },
  {
    entryPoints: ['src/content-script.ts'],
    outfile: `${distDir}/content-script.js`,
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    logLevel: 'info',
  },
  {
    entryPoints: ['src/popup.ts'],
    outfile: `${distDir}/popup.js`,
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    logLevel: 'info',
  },
  {
    entryPoints: ['src/offscreen.ts'],
    outfile: `${distDir}/offscreen.js`,
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    logLevel: 'info',
  },
];

async function build() {
  for (const options of builds) {
    if (isWatch) {
      const ctx = await esbuild.context(options);
      await ctx.watch();
      console.log(`Watching ${options.entryPoints}...`);
    } else {
      await esbuild.build(options);
    }
  }
  console.log('Build complete. Load extension from: extension/dist/');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
