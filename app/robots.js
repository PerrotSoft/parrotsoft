export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/private/', 
    },
    sitemap: 'https://parrotsoft.vercel.app/sitemap.xml', 
  }
}