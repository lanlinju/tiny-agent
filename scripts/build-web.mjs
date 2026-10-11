import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

/**
 * Build the React Web GUI into the server's static web root.
 *
 * Runs after `tsc` in `npm run build`. The React sources under
 * `clients/web/src` are bundled here (they are intentionally not part of the
 * main tsconfig), and the static shell is copied next to the bundle.
 */
const outdir = 'dist/clients/web';
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: ['clients/web/src/main.tsx'],
  outfile: `${outdir}/app.js`,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

cpSync('clients/web/index.html', `${outdir}/index.html`);
cpSync('clients/web/styles.css', `${outdir}/styles.css`);
