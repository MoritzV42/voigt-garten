import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';

// Static build for Pi hosting (served by Flask backend)
export default defineConfig({
  output: 'static',
  integrations: [
    tailwind(),
    react()
  ],
  site: 'https://garten.infinityspace42.de',
  build: {
    // Assets go into _astro folder
    assets: '_astro'
  }
});
