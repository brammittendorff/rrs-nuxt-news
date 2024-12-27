<template>
  <div class="container mt-4">
    <h1 class="text-center mb-5">RSS Feeds</h1>
    
    <!-- Search Bars Row -->
    <div class="row mb-4 g-3">
        <!-- Source Filter -->
        <div class="col-md-2">
            <div class="input-group">
            <span class="input-group-text">
                <i class="bi bi-funnel"></i>
            </span>
            <select 
                class="form-select" 
                v-model="selectedSource"
                @change="handleSourceChange"
            >
                <option value="">All Sources</option>
                <option 
                v-for="source in uniqueSources" 
                :key="source" 
                :value="source"
                >
                {{ source }}
                </option>
            </select>
            </div>
        </div>

        <!-- Title Search -->
        <div class="col-md-4">
            <div class="input-group">
            <span class="input-group-text">
                <i class="bi bi-search"></i>
            </span>
            <input 
                type="text" 
                class="form-control" 
                v-model="searchQuery" 
                placeholder="Search in titles..."
            >
            </div>
        </div>

        <!-- Tag Search with Dropdown -->
        <div class="col-md-6">
            <div class="position-relative">
            <div class="input-group">
                <span class="input-group-text">
                <i class="bi bi-tags"></i>
                </span>
                <input 
                type="text" 
                class="form-control" 
                v-model="tagSearchQuery" 
                placeholder="Search tags..."
                @focus="showTagDropdown = true"
                @click="showTagDropdown = true"
                ref="tagInput"
                >
                <button 
                v-if="selectedTags.length" 
                class="btn btn-outline-secondary" 
                @click="clearFilters"
                type="button"
                >
                Clear
                </button>
            </div>

            <!-- Tag Dropdown -->
            <div 
                v-show="showTagDropdown" 
                class="tag-dropdown card"
                ref="tagDropdown"
                @click="handleDropdownClick"
            >
                <div class="card-body p-0">
                <div v-for="(tags, category) in groupedTags" 
                    :key="category" 
                    class="p-2 border-bottom">
                    <div class="category-header mb-2">{{ category }}</div>
                    <div class="d-flex flex-wrap gap-1">
                    <span
                        v-for="tag in filterTagsBySearch(tags)"
                        :key="tag"
                        :style="getTagStyle(tag)"
                        class="badge tag-item"
                        :class="{ 'selected': selectedTags.includes(tag) }"
                        @click="handleTagClick($event, tag)"
                    >
                        {{ tag }}
                        <span v-if="selectedTags.includes(tag)" class="ms-1">&times;</span>
                    </span>
                    </div>
                </div>
                </div>
            </div>
            </div>
        </div>
    </div>

    <!-- Selected Tags Display -->
    <div v-if="selectedTags.length" class="mb-4">
      <div class="d-flex flex-wrap gap-2">
        <span 
          v-for="tag in selectedTags" 
          :key="tag"
          :style="getTagStyle(tag)"
          class="badge selected-tag"
        >
          {{ tag }}
          <span 
            class="ms-1" 
            @click.stop="toggleTagFilter(tag)"
          >&times;</span>
        </span>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="text-center">
      <div class="spinner-border" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    </div>

    <!-- Error State -->
    <div v-if="error" class="alert alert-danger" role="alert">
      {{ error }}
    </div>

    <!-- Results Count -->
    <div v-if="!loading && filteredItems.length > 0" 
         class="d-flex justify-content-between align-items-center mb-3">
      <div class="text-muted">
        Showing {{ filteredItems.length }} of {{ rssItems.length }} items
      </div>
      <div v-if="tagLoadingTimeout" class="text-warning">
        <i class="bi bi-exclamation-triangle me-2"></i>
        Tag loading timed out
      </div>
    </div>

    <!-- Results Table -->
    <div v-if="!loading && filteredItems.length > 0" class="table-responsive">
      <table class="table table-hover">
        <thead class="table-light">
          <tr>
            <th>Title</th>
            <th>Source</th>
            <th>Tags</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in filteredItems" :key="index">
            <td>{{ item.title }}</td>
            <td>
              <span class="badge bg-secondary">{{ item.source }}</span>
            </td>
            <td>
              <div class="d-flex flex-wrap gap-1">
                <template v-if="item.tags && item.tags.length">
                  <span 
                    v-for="(tag, tagIndex) in item.tags" 
                    :key="tagIndex"
                    class="badge"
                    :style="getTagStyle(tag)"
                    @click="toggleTagFilter(tag)"
                  >
                    {{ tag }}
                  </span>
                </template>
                <span v-else class="badge bg-light text-dark">
                  <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                  Loading tags...
                </span>
              </div>
            </td>
            <td>
              <a :href="item.link" 
                 target="_blank" 
                 rel="noopener noreferrer" 
                 class="btn btn-sm btn-outline-primary">
                View Article
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- No Results Message -->
    <div v-if="!loading && filteredItems.length === 0 && rssItems.length > 0" 
         class="alert alert-info text-center">
      No items match the current filters and search criteria.
      <button @click="clearFilters" class="btn btn-link">Clear all filters</button>
    </div>
  </div>
</template>

<script>
const TAG_CATEGORIES = {
  'Security': ['security', 'vulnerability', 'hack', 'malware', 'privacy', 'encryption', 'cyber'],
  'Development': ['programming', 'software', 'code', 'development', 'api', 'web'],
  'Hardware': ['hardware', 'chip', 'computer', 'device', 'server', 'network', 'router', 'iot'],
  'Technology': ['tech', 'digital', 'mobile', 'app'],
  'AI & Data': ['ai', 'machine learning', 'data', 'analytics', 'model'],
  'Business': ['business', 'company', 'market', 'startup', 'industry'],
  'Legal & Policy': ['law', 'policy', 'regulation', 'compliance', 'legal'],
  'Research': ['research', 'study', 'analysis', 'paper', 'science']
}

export default {
  name: 'IndexPage',
  
  directives: {
    clickOutside: {
      mounted(el, binding) {
        el._clickOutside = function(event) {
          if (!(el === event.target || el.contains(event.target))) {
            binding.value(event)
          }
        }
        document.addEventListener('click', el._clickOutside)
      },
      unmounted(el) {
        document.removeEventListener('click', el._clickOutside)
      }
    }
  },

  data() {
    return {
      rssItems: [],
      loading: true,
      error: null,
      pollingInterval: null,
      tagLoadingTimeout: false,
      tagTimeoutTimer: null,
      selectedTags: [],
      searchQuery: '',
      tagSearchQuery: '',
      showTagDropdown: false,
      sources: [
        { url: 'https://news.ycombinator.com/rss', source: 'Hacker News' },
        { url: 'https://www.security.nl/rss/headlines.xml', source: 'Security.nl' },
        { url: 'https://tweakers.net/feeds/mixed.xml', source: 'Tweakers.net' }
    ]
    }
  },
  
  computed: {
    availableTags() {
      const tagSet = new Set()
      this.rssItems.forEach(item => {
        if (item.tags && item.tags.length) {
          item.tags.forEach(tag => tagSet.add(tag))
        }
      })
      return Array.from(tagSet).sort()
    },

    groupedTags() {
      const groups = {}
      const handledTags = new Set()

      // Group tags by category
      Object.entries(TAG_CATEGORIES).forEach(([category, keywords]) => {
        const categoryTags = this.availableTags.filter(tag => {
          const tagLower = tag.toLowerCase()
          return keywords.some(keyword => tagLower.includes(keyword))
        })

        if (categoryTags.length > 0) {
          groups[category] = categoryTags
          categoryTags.forEach(tag => handledTags.add(tag))
        }
      })

      // Add uncategorized tags to "Other"
      const otherTags = this.availableTags.filter(tag => !handledTags.has(tag))
      if (otherTags.length > 0) {
        groups['Other'] = otherTags
      }

      return groups
    },

    uniqueSources() {
        return [...new Set(this.rssItems.map(item => item.source))].sort()
    },

    filteredItems() {
        let items = this.rssItems

        // Apply source filter
        if (this.selectedSource) {
        items = items.filter(item => item.source === this.selectedSource)
        }

        // Apply tag filters using OR logic
        if (this.selectedTags.length) {
        items = items.filter(item => {
            if (!item.tags) return false
            return item.tags.some(itemTag => 
            this.selectedTags.some(selectedTag => 
                itemTag.toLowerCase() === selectedTag.toLowerCase()
            )
            )
        })
        }

        // Apply search filter
        if (this.searchQuery.trim()) {
        const query = this.searchQuery.toLowerCase().trim()
        items = items.filter(item => 
            item.title.toLowerCase().includes(query)
        )
        }

        return items
    }
  },
  async mounted() {
    await this.fetchAllFeeds()
    this.startPollingForTags()
    
    document.addEventListener('keydown', this.handleEscape)
    document.addEventListener('click', this.handleClickOutside)

    // Set timeout for tag loading (5 minutes)
    this.tagTimeoutTimer = setTimeout(() => {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval)
        this.tagLoadingTimeout = true
      }
    }, 5 * 60 * 1000)
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.handleEscape)
    document.removeEventListener('click', this.handleClickOutside)

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
    }
    if (this.tagTimeoutTimer) {
      clearTimeout(this.tagTimeoutTimer)
    }
  },

  methods: {
    normalizeTag(tag) {
        const tagLower = tag.toLowerCase()
        for (const [category, config] of Object.entries(TAG_CATEGORIES)) {
            if (config.aliases && config.aliases[tagLower]) {
                return config.aliases[tagLower]
            }
            if (config.keywords && config.keywords.some(k => tagLower.includes(k))) {
                return config.keywords.find(k => tagLower.includes(k))
            }
        }
        return tag
    },

    filterTagsBySearch(tags) {
        if (!this.tagSearchQuery.trim()) return tags
        const query = this.tagSearchQuery.toLowerCase().trim()
        return tags.filter(tag => this.normalizeTag(tag).toLowerCase().includes(query))
    },

    generateColorFromString(str) {
        let hash = 0
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash)
        }
        const hue = Math.abs(hash % 360)
        return `hsl(${hue}, 65%, 45%)`
    },

    getTagStyle(tag) {
        const backgroundColor = this.generateColorFromString(this.normalizeTag(tag))
        return {
            backgroundColor,
            color: '#ffffff',
            transition: 'opacity 0.2s'
        }
    },

    handleTagClick(event, tag) {
        event.stopPropagation()
        this.toggleTagFilter(tag)
    },

    handleDropdownClick(event) {
        event.stopPropagation()
    },

    handleEscape(event) {
        if (event.key === 'Escape') {
            this.showTagDropdown = false
        }
    },

    handleClickOutside(event) {
        const dropdown = this.$refs.tagDropdown
        const input = this.$refs.tagInput
        if (!dropdown?.contains(event.target) && !input?.contains(event.target)) {
            this.showTagDropdown = false
        }
    },

    clearFilters() {
        this.selectedTags = []
        this.searchQuery = ''
        this.tagSearchQuery = ''
        this.selectedSource = ''
    },

    toggleTagFilter(tag) {
        const normalizedTag = this.normalizeTag(tag)
        const index = this.selectedTags.findIndex(t => this.normalizeTag(t) === normalizedTag)
        if (index === -1) {
            this.selectedTags.push(tag)
        } else {
            this.selectedTags.splice(index, 1)
        }
    },

    async fetchAllFeeds() {
        this.loading = true
        this.error = null
        this.rssItems = []
        try {
            const feedPromises = this.sources.map(feed => this.fetchFeed(feed))
            const results = await Promise.all(feedPromises)
            this.rssItems = results.flat()
        } catch (err) {
            this.error = `Error fetching feeds: ${err.message}`
            console.error('Error fetching feeds:', err)
        } finally {
            this.loading = false
        }
    },

    async fetchFeed(feed) {
        const proxyUrl = `${process.env.PROXY_URL || 'http://localhost:3001'}/rss`
        try {
            const response = await fetch(`${proxyUrl}?url=${encodeURIComponent(feed.url)}`)
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
            const items = await response.json()
            return items.map(item => ({
                ...item,
                source: feed.source,
                tags: item.tags?.map(tag => this.normalizeTag(tag)) || []
            }))
        } catch (error) {
            console.error(`Error fetching ${feed.source}:`, error)
            throw error
        }
    },

    startPollingForTags() {
        let attempts = 0
        const maxAttempts = 60

        this.pollingInterval = setInterval(async () => {
            attempts++
            if (attempts >= maxAttempts) {
                clearInterval(this.pollingInterval)
                this.tagLoadingTimeout = true
                return
            }

            const proxyUrl = `${process.env.PROXY_URL || 'http://localhost:3001'}/rss`
            
            for (const feed of this.sources) {
                try {
                    const response = await fetch(`${proxyUrl}?url=${encodeURIComponent(feed.url)}&tagsOnly=true`)
                    if (!response.ok) continue

                    const updatedItems = await response.json()
                    
                    this.rssItems = this.rssItems.map(item => {
                        const updatedItem = updatedItems.find(u => u.title === item.title)
                        return updatedItem ? { 
                            ...item, 
                            tags: updatedItem.tags?.map(tag => this.normalizeTag(tag)) || [] 
                        } : item
                    })

                    if (this.rssItems.every(item => item.tags && item.tags.length > 0)) {
                        clearInterval(this.pollingInterval)
                        if (this.tagTimeoutTimer) {
                            clearTimeout(this.tagTimeoutTimer)
                        }
                    }
                } catch (error) {
                    console.error('Error polling for tags:', error)
                }
            }
        }, 5000)
    }
}

}
</script>

<style scoped>
.tag-dropdown {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  right: 0;
  z-index: 1000;
  max-height: 400px;
  overflow-y: auto;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.category-header {
  font-weight: 600;
  font-size: 0.9rem;
  color: #6c757d;
}

.tag-item {
  cursor: pointer;
  transition: all 0.2s;
}

.tag-item:hover {
  opacity: 0.9;
}

.tag-item.selected {
  border: 2px solid white;
}

.selected-tag {
  cursor: default;
}

.selected-tag span {
  cursor: pointer;
}

.table-responsive {
  margin-top: 2rem;
}

.badge {
  font-size: 0.8rem;
  user-select: none;
}

.gap-1 { gap: 0.25rem; }
.gap-2 { gap: 0.5rem; }

/* Search bar styles */
.input-group-text {
  background-color: white;
  border-right: none;
}

.form-control:focus {
  border-color: #ced4da;
  box-shadow: none;
}

.form-control {
  border-left: none;
}

.form-select {
  border-left: none;
  padding-left: 0.5rem;
}

.form-select:focus {
  border-color: #ced4da;
  box-shadow: none;
}
</style>