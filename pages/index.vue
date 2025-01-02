<template>
  <div class="container mt-4">
    <h1 class="text-center mb-5">RSS Feeds</h1>

    <!-- Search Bars Row -->
    <div class="row mb-4 g-3 align-items-center">

      <!-- Clicked Filter -->
      <div class="col-12 col-sm-6 col-md-3 col-lg-2">
        <div class="input-group">
          <span class="input-group-text">
            <i class="bi bi-eye"></i>
          </span>
          <select class="form-select" v-model="clickedFilter">
            <option value="">All Articles</option>
            <option value="clicked">Clicked</option>
            <option value="notClicked">Not Clicked</option>
          </select>
        </div>
      </div>

      <!-- Source Filter -->
      <div class="col-12 col-sm-6 col-md-3 col-lg-2">
        <div class="input-group">
          <span class="input-group-text">
            <i class="bi bi-funnel"></i>
          </span>
          <select class="form-select" v-model="selectedSource" @change="handleSourceChange">
            <option value="">All Sources</option>
            <option v-for="source in uniqueSources" :key="source" :value="source">
              {{ source }}
            </option>
          </select>
        </div>
      </div>

      <!-- Title Search -->
      <div class="col-12 col-md-6 col-lg-4">
        <div class="input-group">
          <span class="input-group-text">
            <i class="bi bi-search"></i>
          </span>
          <input type="text" class="form-control" v-model="searchQuery" placeholder="Search in titles...">
        </div>
      </div>

      <!-- Tag Search with Dropdown -->
      <div class="col-12 col-lg-4">
        <div class="position-relative">
          <div class="input-group">
            <span class="input-group-text">
              <i class="bi bi-tags"></i>
            </span>
            <input type="text" class="form-control" v-model="tagSearchQuery" placeholder="Search tags..."
              @focus="showTagDropdown = true" @click="showTagDropdown = true" ref="tagInput">
            <button v-if="selectedTags.length" class="btn btn-outline-secondary" @click="clearFilters" type="button">
              Clear
            </button>
          </div>

          <!-- Tag Dropdown -->
          <div v-show="showTagDropdown" class="tag-dropdown card" ref="tagDropdown" @click="handleDropdownClick">
            <div class="card-body p-0">
              <div v-for="(tags, category) in groupedTags" :key="category" class="p-2 border-bottom">
                <div class="category-header mb-2 d-flex justify-content-between align-items-center"
                  @click="toggleCategory(category)" style="cursor: pointer;">
                  <span>{{ category }}</span>
                  <span class="badge bg-secondary ms-2" style="font-size: 0.75rem;">
                    {{ isCategorySelected(category) ? 'Deselect All' : 'Select All' }}
                  </span>
                </div>
                <div class="d-flex flex-wrap gap-1">
                  <span v-for="tag in filterTagsBySearch(tags)" :key="tag" :style="getTagStyle(tag)"
                    class="badge tag-item" :class="{ 'selected': selectedTags.includes(tag) }"
                    @click="handleTagClick($event, tag)">
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


    <!-- Selected Tags Display (unchanged) -->
    <div v-if="selectedTags.length" class="mb-4">
      <div class="d-flex flex-wrap gap-2">
        <span v-for="tag in selectedTags" :key="tag" :style="getTagStyle(tag)" class="badge selected-tag">
          {{ tag }}
          <span class="ms-1" @click.stop="toggleTagFilter(tag)">&times;</span>
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
    <div v-if="!loading && filteredItems.length > 0" class="d-flex justify-content-between align-items-center mb-3">
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
          <tr v-for="(item, index) in filteredItems" :key="index"
            :class="{ 'table-active': clickedArticles.includes(item.link) }">
            <td>{{ item.title }}</td>
            <td>
              <span class="badge bg-secondary">{{ item.source }}</span>
            </td>
            <td>
              <div class="d-flex flex-wrap gap-1">
                <template v-if="item.tags && item.tags.length">
                  <span v-for="(tag, tagIndex) in item.tags" :key="tagIndex" class="badge" :style="getTagStyle(tag)"
                    @click="toggleTagFilter(tag)">
                    {{ tag }}
                  </span>
                </template>
                <span v-else-if="!tagLoadingTimeout" class="badge bg-light text-dark">
                  <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                  Loading tags...
                </span>
                <span v-else class="badge bg-light text-danger">
                  No tags available
                </span>
              </div>
            </td>

            <td>
              <a :href="item.link" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-primary"
                @click="trackArticleClick(item)">
                View Article
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- No Results Message (unchanged) -->
    <div v-if="!loading && filteredItems.length === 0 && rssItems.length > 0" class="alert alert-info text-center">
      No items match the current filters and search criteria.
      <button @click="clearFilters" class="btn btn-link">Clear all filters</button>
    </div>
  </div>
</template>

<script>
import { useFeedStore } from '~/stores/feed'
import TAG_CATEGORIES from '~/worker/tagCategories';

export default {
  name: 'IndexPage',


  setup() {
    const store = useFeedStore()
    const sources = [
      { url: 'https://news.ycombinator.com/rss', source: 'Hacker News' },
      { url: 'https://www.security.nl/rss/headlines.xml', source: 'Security.nl' },
      { url: 'https://tweakers.net/feeds/mixed.xml', source: 'Tweakers.net' }
    ]

    onMounted(async () => {
      await store.fetchFeeds(sources)
    })

    onBeforeUnmount(() => {
      store.stopPolling()
    })

    return {
      store,
    }
  },

  directives: {
    clickOutside: {
      mounted(el, binding) {
        el._clickOutside = function (event) {
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
      clickedFilter: '', // Default to showing all articles
      selectedSource: '', // Define with a default value
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
    clickedArticles() {
      return JSON.parse(sessionStorage.getItem('clickedArticles') || '[]');
    },
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
      let items = this.rssItems;

      // Apply source filter
      if (this.selectedSource) {
        items = items.filter(item => item.source === this.selectedSource);
      }

      // Apply tag filters using OR logic
      if (this.selectedTags.length) {
        items = items.filter(item => {
          if (!item.tags) return false;
          return item.tags.some(itemTag =>
            this.selectedTags.some(selectedTag =>
              itemTag.toLowerCase() === selectedTag.toLowerCase()
            )
          );
        });
      }

      // Apply search filter
      if (this.searchQuery.trim()) {
        const query = this.searchQuery.toLowerCase().trim();
        items = items.filter(item =>
          item.title.toLowerCase().includes(query)
        );
      }

      // Apply clicked filter
      const clickedArticles = JSON.parse(sessionStorage.getItem('clickedArticles') || '[]');
      if (this.clickedFilter === 'clicked') {
        items = items.filter(item => clickedArticles.includes(item.link));
      } else if (this.clickedFilter === 'notClicked') {
        items = items.filter(item => !clickedArticles.includes(item.link));
      }

      return items;
    },
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
    trackArticleClick(item) {
      // Get the existing clicked articles from session storage
      const clickedArticles = JSON.parse(sessionStorage.getItem('clickedArticles') || '[]');

      // Check if the current article is already clicked
      if (!clickedArticles.includes(item.link)) {
        clickedArticles.push(item.link);
        sessionStorage.setItem('clickedArticles', JSON.stringify(clickedArticles));
      }

      // Optional: Log to the backend
      this.logArticleClick(item);
    },

    async logArticleClick(item) {
      try {
        // Replace with your API endpoint
        await fetch('/api/log-click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: item.title,
            link: item.link,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch (error) {
        console.error('Error logging article click:', error);
      }
    },

    normalizeTag(tag) {
      const tagLower = tag.toLowerCase();
      for (const [category, keywords] of Object.entries(TAG_CATEGORIES)) {
        if (keywords.some((keyword) => tagLower.includes(keyword))) {
          return category; // Return the category name if the tag matches
        }
      }
      return tag; // Return the original tag if no category matches
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

    // Add these new methods
    isCategorySelected(category) {
      const categoryTags = this.groupedTags[category] || []
      return categoryTags.length > 0 &&
        categoryTags.every(tag => this.selectedTags.includes(tag))
    },

    toggleCategory(category) {
      const categoryTags = this.groupedTags[category] || []
      const isSelected = this.isCategorySelected(category)

      if (isSelected) {
        // Remove all tags in this category
        this.selectedTags = this.selectedTags.filter(tag =>
          !categoryTags.includes(tag)
        )
      } else {
        // Add all tags in this category that aren't already selected
        categoryTags.forEach(tag => {
          if (!this.selectedTags.includes(tag)) {
            this.selectedTags.push(tag)
          }
        })
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
      const index = this.selectedTags.indexOf(tag)
      if (index === -1) {
        this.selectedTags.push(tag)
      } else {
        // Only remove if clicking the exact same tag
        if (this.selectedTags[index] === tag) {
          this.selectedTags.splice(index, 1)
        }
      }
    },

    async fetchAllFeeds() {
      this.loading = true;
      this.error = null;
      this.rssItems = [];
      try {
        const feedPromises = this.sources.map(feed => this.fetchFeed(feed));
        const results = await Promise.all(feedPromises);
        this.rssItems = results.flat();
      } catch (err) {
        this.error = `Error fetching feeds: ${err.message}`;
        console.error('Error fetching feeds:', err);
      } finally {
        this.loading = false;
      }
    },

    async fetchFeed(feed) {
      const config = useRuntimeConfig();
      const workerUrl = config.public.workerUrl;

      try {
        const response = await fetch(`${workerUrl}?url=${encodeURIComponent(feed.url)}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const items = await response.json();

        // Fetch cached tags for the items
        const tagResponse = await fetch(`${workerUrl}?url=${encodeURIComponent(feed.url)}&tagsOnly=true`);
        const cachedTags = tagResponse.ok ? await tagResponse.json() : [];

        // Attach tags to the feed items
        return items.map(item => {
          const cachedItem = cachedTags.find(cached => cached.title === item.title);
          return {
            ...item,
            source: feed.source,
            tags: cachedItem ? cachedItem.tags || [] : [],
          };
        });
      } catch (error) {
        console.error(`Error fetching ${feed.source}:`, error);
        throw error;
      }
    },

    startPollingForTags() {
      let attempts = 0;
      const maxAttempts = 60;

      // Poll every 5 seconds
      this.pollingInterval = setInterval(async () => {
        attempts++;
        if (attempts >= maxAttempts) {
          clearInterval(this.pollingInterval);
          this.tagLoadingTimeout = true;
          console.log('[Frontend] Tag polling timed out.');
          return;
        }

        const config = useRuntimeConfig();
        const workerUrl = config.public.workerUrl;

        const untaggedItems = this.rssItems.filter(item =>
          !item.tags || item.tags.length === 0
        );

        console.log('[Frontend] Untagged Items:', untaggedItems.length);

        if (untaggedItems.length === 0) {
          console.log('[Frontend] All items tagged. Stopping polling.');
          clearInterval(this.pollingInterval);
          this.tagLoadingTimeout = false;
          return;
        }

        try {
          // Fetch updated tags for each feed
          for (const feed of this.sources) {
            const response = await fetch(
              `${workerUrl}?url=${encodeURIComponent(feed.url)}&tagsOnly=true`
            );

            if (!response.ok) {
              console.warn(`[Frontend] Failed to fetch tags for ${feed.url}`);
              continue;
            }

            const updatedItems = await response.json();
            console.log(`[Frontend] Updated items for ${feed.url}:`, updatedItems);

            // Update RSS items with cached tags
            this.rssItems = this.rssItems.map(item => {
              const updatedItem = updatedItems.find(u => u.title === item.title);
              return updatedItem
                ? { ...item, tags: updatedItem.tags || [] }
                : item;
            });

            // Update UI immediately with available tags
            this.$forceUpdate();
          }
        } catch (error) {
          console.error('[Frontend] Error polling tags:', error);
        }
      }, 5000); // Adjust interval as necessary
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

.gap-1 {
  gap: 0.25rem;
}

.gap-2 {
  gap: 0.5rem;
}

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

.category-header {
  user-select: none;
  transition: opacity 0.2s;
}

.category-header:hover {
  opacity: 0.7;
}

.table-active {
  background-color: #e9ecef !important;
}
</style>