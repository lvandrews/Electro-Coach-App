import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  base: './',            // relative paths so the build runs inside Capacitor and from a local file
  build: { outDir: 'dist', target: 'es2020' },
  test: { environment: 'node' },
} as any);
