const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const watch = process.argv.includes('--watch');

const sharedConfig = {
  bundle: true,
  outdir: 'dist',
  minify: !watch,
  sourcemap: watch,
  target: ['chrome100'],
  loader: { '.ts': 'ts' },
  define: {
    'process.env.NODE_ENV': '"development"',
  },
};

const extensionBuild = {
  ...sharedConfig,
  entryPoints: [
    { in: 'src/background/background.ts', out: 'background/background' },
    { in: 'src/panel/panel.ts', out: 'panel/panel' },
    { in: 'src/options/options.ts', out: 'options/options' },
    { in: 'src/offscreen/offscreen.ts', out: 'offscreen/offscreen' }
  ],
  format: 'esm',
};

const contentScriptBuild = {
  ...sharedConfig,
  entryPoints: [
    { in: 'src/content/macro-recorder.ts', out: 'content/macro-recorder' }
  ],
  format: 'iife',
};

function copyFiles() {
  if (!fs.existsSync('dist')) fs.mkdirSync('dist', { recursive: true });
  if (!fs.existsSync('dist/panel')) fs.mkdirSync('dist/panel', { recursive: true });
  if (!fs.existsSync('dist/options')) fs.mkdirSync('dist/options', { recursive: true });
  if (!fs.existsSync('dist/offscreen')) fs.mkdirSync('dist/offscreen', { recursive: true });
  if (!fs.existsSync('dist/content')) fs.mkdirSync('dist/content', { recursive: true });

  fs.copyFileSync('manifest.json', 'dist/manifest.json');
  fs.copyFileSync('src/panel/panel.html', 'dist/panel/panel.html');
  fs.copyFileSync('src/panel/panel.css', 'dist/panel/panel.css');
  fs.copyFileSync('src/options/options.html', 'dist/options/options.html');
  fs.copyFileSync('src/offscreen/offscreen.html', 'dist/offscreen/offscreen.html');
  console.log('Manifest and UI files copied to dist/');
}

async function run() {
  if (watch) {
    const ctx = await esbuild.context({
      ...extensionBuild,
      plugins: [{
        name: 'on-rebuild',
        setup(build) {
          build.onEnd(() => copyFiles());
        },
      }],
    });
    const contentCtx = await esbuild.context({
      ...contentScriptBuild,
      plugins: [{
        name: 'on-rebuild-content',
        setup(build) {
          build.onEnd(() => copyFiles());
        },
      }],
    });
    await Promise.all([ctx.watch(), contentCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([esbuild.build(extensionBuild), esbuild.build(contentScriptBuild)]);
    copyFiles();
    console.log('Build complete');
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
