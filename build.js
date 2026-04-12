const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const watch = process.argv.includes('--watch');

const buildOptions = {
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
  }
};

function copyFiles() {
  if (!fs.existsSync('dist')) fs.mkdirSync('dist');
  if (!fs.existsSync('dist/panel')) fs.mkdirSync('dist/panel');
  if (!fs.existsSync('dist/options')) fs.mkdirSync('dist/options');
  
  fs.copyFileSync('manifest.json', 'dist/manifest.json');
  fs.copyFileSync('src/panel/panel.html', 'dist/panel/panel.html');
  fs.copyFileSync('src/panel/panel.css', 'dist/panel/panel.css');
  fs.copyFileSync('src/options/options.html', 'dist/options/options.html');
  console.log('Manifest and UI files copied to dist/');
}

async function run() {
  if (watch) {
    let ctx = await esbuild.context({
      ...buildOptions,
      plugins: [{
        name: 'on-rebuild',
        setup(build) {
          build.onEnd(() => copyFiles());
        },
      }],
    });
    await ctx.watch();
    console.log('Watching...');
  } else {
    await esbuild.build(buildOptions);
    copyFiles();
    console.log('Build complete');
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
