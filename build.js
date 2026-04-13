const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const watch = process.argv.includes('--watch');

const extensionBuild = {
  entryPoints: [
    { in: 'src/background/background.ts', out: 'background/background' },
    { in: 'src/panel/panel.ts', out: 'panel/panel' },
    { in: 'src/options/options.ts', out: 'options/options' }
  ],
  bundle: true,
  outdir: 'dist',
  minify: !watch,
  sourcemap: watch,
  target: ['chrome100'],
  format: 'esm',
  loader: { '.ts': 'ts' },
  define: {
    'process.env.NODE_ENV': '"development"',
  },
};

function copyFiles() {
  if (!fs.existsSync('dist')) fs.mkdirSync('dist', { recursive: true });
  if (!fs.existsSync('dist/panel')) fs.mkdirSync('dist/panel', { recursive: true });
  if (!fs.existsSync('dist/options')) fs.mkdirSync('dist/options', { recursive: true });

  fs.copyFileSync('manifest.json', 'dist/manifest.json');
  fs.copyFileSync('src/panel/panel.html', 'dist/panel/panel.html');
  fs.copyFileSync('src/panel/panel.css', 'dist/panel/panel.css');
  fs.copyFileSync('src/options/options.html', 'dist/options/options.html');
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
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(extensionBuild);
    copyFiles();
    console.log('Build complete');
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
