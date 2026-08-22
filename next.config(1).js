/** @type {import('next').NextConfig} */
const nextConfig = {
  // Объединенные экспериментальные настройки из твоего кода
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  
  // Оставляем только ОДНУ функцию headers()
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            // Снимаем блокировку COEP для загрузки скриптов рекламы
            key: "Cross-Origin-Embedder-Policy",
            value: "unsafe-none",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          {
            key: "Cross-Origin-Resource-Policy",
            value: "cross-origin",
          }
        ],
      },
    ];
  },
};

export default nextConfig;