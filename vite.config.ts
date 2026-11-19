/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base = ime repozitorija, ker GitHub Pages streže aplikacijo na /JN-delniski_portfelj/
export default defineConfig({
  base: '/JN-delniski_portfelj/',
  plugins: [react(), tailwindcss()],
  test: {
    include: ['src/**/*.test.ts', 'supabase/functions/_shared/**/*.test.ts'],
  },
});
