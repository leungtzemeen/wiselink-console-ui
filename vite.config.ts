import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    // 监听所有网卡，手机可用 http://<电脑局域网IP>:5173 访问（勿用手机上的 localhost）
    host: true,
    proxy: {
      '/api': {
        // 代理在「跑 Vite 的那台电脑」上转发；本机 Java 用 127.0.0.1 即可（勿写手机能访问的局域网 IP，除非 Java 只绑在该 IP）
        target: 'http://127.0.0.1:8081',
        changeOrigin: true,
      },
    },
  },
})
