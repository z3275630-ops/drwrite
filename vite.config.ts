import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tauri 固定端口
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // Tauri 模板标准配置：Rust 构建产物频繁加锁，别监视
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    target: 'chrome110',
    outDir: 'dist',
  },
});
