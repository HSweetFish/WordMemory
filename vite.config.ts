import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  // 相对路径 + HashRouter：可部署到任意静态托管（Vercel/Netlify/GitHub Pages）无需路由回退配置
  base: './',
  server: {
    port: 5173,
    // 开发代理：TokenRhythm(基元律动) API 不支持浏览器跨域直连（无 CORS 头），
    // 经此同源转发，前端统一请求 /tr/v1/... 即可（生产部署需另行配置代理函数，见 README）
    proxy: {
      '/tr': {
        target: 'https://tokenrhythm.studio',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/tr/, ''),
        configure: (proxy) => {
          // TokenRhythm 服务端带 CSRF 校验：浏览器发出的 Origin/Referer/Sec-Fetch-* 等
          // 跨站标识头会被判为异常（403 CSRF_INVAALID）。这里在转发前剥掉这些头，
          // 让服务端看到的是与 curl 等价的“干净 API 调用”。
          proxy.on('proxyReq', (proxyReq) => {
            for (const h of [
              'origin',
              'referer',
              'sec-fetch-site',
              'sec-fetch-mode',
              'sec-fetch-dest',
              'sec-ch-ua',
              'sec-ch-ua-mobile',
              'sec-ch-ua-platform',
            ]) {
              proxyReq.removeHeader(h);
            }
          });
        },
      },
    },
  },
});
