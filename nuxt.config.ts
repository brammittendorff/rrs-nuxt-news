export default defineNuxtConfig({
  css: [
    'bootstrap/dist/css/bootstrap.min.css',
    'bootstrap-icons/font/bootstrap-icons.css'
  ],
  modules: [
    '@pinia/nuxt',
  ],
  runtimeConfig: {
    public: {
      workerUrl: process.env.NODE_ENV === 'development' 
        ? 'http://localhost:8787/rss'
        : 'https://news-worker.news-worker.workers.dev/rss'
    }
  },
  devtools: { enabled: true }
})