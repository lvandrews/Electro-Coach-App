import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  // The release number (0.1.N) from the Android build; other builds report "web".
  define: { __APP_VERSION__: JSON.stringify(process.env.VERSION_NAME || 'web') },
  base: './',            // relative paths so the build runs inside Capacitor and from a local file
  build: { outDir: 'dist', target: 'es2020' },
  test: { environment: 'node' },
} as any);
