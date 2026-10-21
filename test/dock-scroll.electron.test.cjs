'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildSync } = require('esbuild');

const preview = process.argv.includes('--preview');
for (const reduced of preview ? [false] : [false, true]) {
  test(`conversation scrolling in Electron${reduced ? ' with reduced motion' : ''}`, { timeout: preview ? Infinity : 90000 }, async () => {
    // Value: protects=reading continuity and explicit navigation in the mounted dock;
    // fails_when=arrivals move the reader or polling recenters a retained target;
    // why_new=the existing dock tests check markup, not real layout; seam=main IPC only.
    const root = path.resolve(__dirname, '..');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dock scroll '));
    try {
      const result = buildSync({
        entryPoints: [path.join(__dirname, 'fixtures', 'dock-scroll.tsx')], bundle: true, write: false,
        outdir: dir, jsx: 'automatic', format: 'iife',
        alias: { '@': path.join(root, 'src/renderer/src'), '@shared': path.join(root, 'src/shared') },
        loader: { '.woff2': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' }
      });
      const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
      const css = result.outputFiles.find((f) => f.path.endsWith('.css')).text;
      fs.writeFileSync(path.join(dir, 'dock.html'), `<!doctype html><html><head><style>${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require('electron'), [path.join(__dirname, 'fixtures', 'dock-scroll-main.cjs'), dir, ...(preview ? ['--preview'] : []), ...(reduced ? ['--reduced-motion'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (s) => { output += s; });
      child.stderr.on('data', (s) => { output += s; });
      const code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new Error(`Dock fixture timed out:\n${output}`)); }, preview ? 3600000 : 75000);
        child.on('error', (e) => { clearTimeout(timer); reject(e); });
        child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
      });
      assert.equal(code, 0, output);
      console.log(output);
    } finally {
      // Windows can hold Chromium's cache files for a moment after the child exits.
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp folder */ }
    }
  });
}
