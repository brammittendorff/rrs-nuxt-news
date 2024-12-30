export default defineNuxtConfig({
  css: [
    'bootstrap/dist/css/bootstrap.min.css',
    'bootstrap-icons/font/bootstrap-icons.css'
  ],
  runtimeConfig: {
    public: {
      workerUrl: process.env.NODE_ENV === 'development' 
        ? 'http://localhost:8787/rss'
        : 'https://news-worker.nerd.host/rss'
    }
  },
  devtools: { enabled: true }
})