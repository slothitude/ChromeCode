const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const watch = process.argv.includes('--watch');

// --- Extension build (browser target) ---
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
  // Externalize MCP SDK Node-only internals for browser build
  // MCP SDK is only used by the bridge; remote MCP client uses fetch/EventSource
  external: [
    '@modelcontextprotocol/sdk/client/stdio.js',
    'child_process',
    'net',
    'tls',
    'fs',
    'os',
    'crypto',
    'stream',
    'http',
    'https',
    'zlib',
    'events',
    'util',
    'buffer',
    'url',
    'path',
  ],
};

// --- Bridge build (Node.js target) ---
const bridgeBuild = {
  entryPoints: [
    { in: 'src/bridge/server.ts', out: 'bridge/server' },
  ],
  bundle: true,
  outdir: 'dist',
  minify: false,
  sourcemap: true,
  platform: 'node',
  format: 'esm',
  loader: { '.ts': 'ts' },
  // Don't bundle node_modules — they'll be resolved at runtime
  external: [
    '@modelcontextprotocol/*',
    'ws',
    'child_process',
    'fs',
    'path',
    'http',
    'https',
    'net',
    'tls',
    'os',
    'crypto',
    'stream',
    'readline',
    'events',
    'util',
    'buffer',
    'url',
    'zlib',
  ],
  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
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
    const extCtx = await esbuild.context({
      ...extensionBuild,
      plugins: [{
        name: 'on-rebuild',
        setup(build) {
          build.onEnd(() => copyFiles());
        },
      }],
    });
    await extCtx.watch();

    const bridgeCtx = await esbuild.context({
      ...bridgeBuild,
      plugins: [{
        name: 'on-rebuild-bridge',
        setup(build) {
          build.onEnd(() => console.log('Bridge rebuilt'));
        },
      }],
    });
    await bridgeCtx.watch();

    console.log('Watching extension + bridge...');
  } else {
    await esbuild.build(extensionBuild);
    await esbuild.build(bridgeBuild);
    copyFiles();
    console.log('Build complete (extension + bridge)');
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
