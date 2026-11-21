import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rolldownOptions: {
      input: { gallery: 'index.html', simulator: 'simulator.html', assembly: 'assembly.html', stations: 'stations.html', knee: 'knee.html', whole: 'whole.html' },
    },
  },
});
