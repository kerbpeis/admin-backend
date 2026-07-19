import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    },
    hmr: {
      overlay: false // 禁用热更新覆盖层，可能解决与devtools的冲突
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis' // 解决某些依赖的全局变量问题
      }
    }
  }
});