//stores/feed.js
import { defineStore } from 'pinia'

export const useFeedStore = defineStore('feed', {
  state: () => ({
    items: [],
    loading: true,
    error: null,
    tagLoadingTimeout: false,
    pollingInterval: null,
    tagTimeoutTimer: null,
    lastUpdateTime: null,
    updateInterval: 5 * 60 * 1000, // 5 minutes
    cacheExpiration: 3600000 // 1 hour
  }),

  getters: {
    hasUntaggedItems: (state) => {
      return state.items.some(item => !item.tags || item.tags.length === 0)
    }
  },

  actions: {
    // Main feed fetching function
    async fetchFeeds(sources) {
      this.loading = true
      this.error = null
      
      try {
        const cachedFeeds = this.loadFromCache()
        if (cachedFeeds) {
          this.items = cachedFeeds
          this.loading = false
          await this.checkForUpdates(sources)
        } else {
          const feedPromises = sources.map(feed => this.fetchFeed(feed))
          const results = await Promise.all(feedPromises)
          this.items = results.flat()
          this.cacheFeeds(this.items)
        }

        this.startUpdatePolling(sources)
        this.startTagPolling()
      } catch (err) {
        this.error = `Error fetching feeds: ${err.message}`
        console.error('Error fetching feeds:', err)
      } finally {
        this.loading = false
      }
    },

    // Fetch individual feed
    async fetchFeed(feed) {
      const config = useRuntimeConfig()
      const cacheKey = `feed:${feed.url}`
      const cached = localStorage.getItem(cacheKey)

      if (cached) {
        const { data, timestamp } = JSON.parse(cached)
        if (Date.now() - timestamp < this.cacheExpiration) {
          return data
        }
      }

      const response = await fetch(`${config.public.workerUrl}?url=${encodeURIComponent(feed.url)}`)
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
      
      const items = await response.json()
      const processedItems = items.map(item => ({
        ...item,
        source: feed.source,
        tags: []
      }))

      localStorage.setItem(cacheKey, JSON.stringify({
        data: processedItems,
        timestamp: Date.now()
      }))

      await this.fetchTags(feed, processedItems)
      return processedItems
    },

    // Update polling functions
    async checkForUpdates(sources) {
      for (const feed of sources) {
        try {
          const latestItems = await this.fetchLatestItems(feed)
          const newItems = this.filterNewItems(latestItems, feed.url)
          
          if (newItems.length > 0) {
            await this.updateItems(newItems, feed.url)
          }
        } catch (error) {
          console.error(`Error checking updates for ${feed.source}:`, error)
        }
      }
      this.lastUpdateTime = Date.now()
    },

    async fetchLatestItems(feed) {
      const config = useRuntimeConfig()
      const response = await fetch(`${config.public.workerUrl}?url=${encodeURIComponent(feed.url)}`)
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
      return await response.json()
    },

    filterNewItems(latestItems, feedUrl) {
      const currentItems = this.items.filter(item => item.source === new URL(feedUrl).hostname)
      const currentLinks = new Set(currentItems.map(item => item.link))
      return latestItems.filter(item => !currentLinks.has(item.link))
    },

    async updateItems(newItems, feedUrl) {
      const source = new URL(feedUrl).hostname
      const processedItems = newItems.map(item => ({
        ...item,
        source,
        tags: []
      }))

      this.items.unshift(...processedItems)
      this.updateCache(feedUrl)
      await this.fetchTagsForItems(processedItems, feedUrl)
    },

    // Tag management functions
    async fetchTags(feed, items) {
      const config = useRuntimeConfig()
      const cacheKey = `tags:${feed.url}`
      
      try {
        const response = await fetch(
          `${config.public.workerUrl}?url=${encodeURIComponent(feed.url)}&tagsOnly=true`
        )
        
        if (!response.ok) return

        const tags = await response.json()
        localStorage.setItem(cacheKey, JSON.stringify({
          data: tags,
          timestamp: Date.now()
        }))

        this.updateItemTags(tags)
      } catch (error) {
        console.error('Error fetching tags:', error)
      }
    },

    async fetchTagsForItems(items, feedUrl) {
      const config = useRuntimeConfig()
      try {
        const response = await fetch(
          `${config.public.workerUrl}?url=${encodeURIComponent(feedUrl)}&tagsOnly=true`
        )
        
        if (!response.ok) return

        const tags = await response.json()
        this.updateItemTags(tags)
      } catch (error) {
        console.error('Error fetching tags for items:', error)
      }
    },

    updateItemTags(tags) {
      this.items = this.items.map(item => {
        const matchingTags = tags.find(t => t.title === item.title)
        return matchingTags ? { ...item, tags: matchingTags.tags } : item
      })
    },

    // Cache management functions
    loadFromCache() {
      const feeds = []
      let hasValidCache = false

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key.startsWith('feed:')) {
          const cached = JSON.parse(localStorage.getItem(key))
          if (Date.now() - cached.timestamp < this.cacheExpiration) {
            feeds.push(...cached.data)
            hasValidCache = true
          }
        }
      }

      return hasValidCache ? feeds : null
    },

    cacheFeeds(feeds) {
      localStorage.setItem('feeds', JSON.stringify({
        data: feeds,
        timestamp: Date.now()
      }))
    },

    updateCache(feedUrl) {
      const cacheKey = `feed:${feedUrl}`
      const sourceItems = this.items.filter(item => item.source === new URL(feedUrl).hostname)
      
      localStorage.setItem(cacheKey, JSON.stringify({
        data: sourceItems,
        timestamp: Date.now()
      }))
    },

    clearCache() {
      const keys = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key.startsWith('feed:') || key.startsWith('tags:')) {
          keys.push(key)
        }
      }
      keys.forEach(key => localStorage.removeItem(key))
    },

    // Polling control functions
    startUpdatePolling(sources) {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval)
      }
      this.pollingInterval = setInterval(() => this.checkForUpdates(sources), this.updateInterval)
    },

    startTagPolling() {
      if (this.tagTimeoutTimer) {
        clearTimeout(this.tagTimeoutTimer)
      }

      // Set timeout for tag loading (5 minutes)
      this.tagTimeoutTimer = setTimeout(() => {
        if (this.pollingInterval) {
          clearInterval(this.pollingInterval)
          this.tagLoadingTimeout = true
        }
      }, 5 * 60 * 1000)
    },

    stopPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval)
        this.pollingInterval = null
      }
      if (this.tagTimeoutTimer) {
        clearTimeout(this.tagTimeoutTimer)
        this.tagTimeoutTimer = null
      }
    }
  }
})