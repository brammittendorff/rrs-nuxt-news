import TAG_CATEGORIES from './tagCategories.js';

// Simple XML parser function
function parseRSS(xmlText) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title>(.*?)<\/title>/;
    const descriptionRegex = /<description>(.*?)<\/description>/;
    const linkRegex = /<link>(.*?)<\/link>/;

    let match;
    while ((match = itemRegex.exec(xmlText)) !== null) {
        const itemContent = match[1];
        const title = (itemContent.match(titleRegex) || [])[1] || 'No Title';
        const description = (itemContent.match(descriptionRegex) || [])[1] || '';
        const link = (itemContent.match(linkRegex) || [])[1] || '#';

        // Basic HTML entity decoding
        const decodeHTML = (str) => str
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");

        items.push({
            title: decodeHTML(title),
            description: decodeHTML(description),
            link: decodeHTML(link),
            tags: []
        });
    }

    return items;
}

export default {
    async fetch(request, env, ctx) {
        const corsHeaders = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        };

        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const feedUrl = url.searchParams.get('url');
        const tagsOnly = url.searchParams.get('tagsOnly') === 'true';

        // Add dev cache clear route
        if (request.method === 'DELETE' && url.pathname === '/clear-cache') {
            if (feedUrl) {
                await clearCachedItemsByUrl(feedUrl, env);

                return new Response('Cache cleared', {
                    status: 200,
                    headers: corsHeaders
                });
            }

            return new Response('Missing URL parameter', {
                status: 400,
                headers: corsHeaders
            });
        }

        if (!feedUrl) {
            return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
                status: 400,
                headers: {
                    "Content-Type": "application/json",
                    ...corsHeaders
                }
            });
        }

        try {
            // Get items from cache if available
            const cacheKey = `feed:${feedUrl}`;
            let items;

            if (tagsOnly) {
                const cachedItems = await env.RSS_CACHE.get(cacheKey);
                if (cachedItems) {
                    console.log(`[Backend] Cached items retrieved for ${cacheKey}:`); // Debug log
                    const parsedItems = JSON.parse(cachedItems);
                    return new Response(cachedItems, {
                        headers: {
                            "Content-Type": "application/json",
                            ...corsHeaders
                        }
                    });
                }
                console.log(`[Backend] No cached items found for ${cacheKey}`);
                return new Response(JSON.stringify([]), {
                    headers: {
                        "Content-Type": "application/json",
                        ...corsHeaders
                    }
                });
            }

            // Fetch and parse RSS
            const response = await fetch(feedUrl);
            const rssText = await response.text();
            items = parseRSS(rssText);

            // Add source to items
            items = items.map(item => ({
                ...item,
                source: new URL(feedUrl).hostname
            }));

            // Start tag processing in the background
            ctx.waitUntil(processTagsAndCache(items, feedUrl, env));

            // Store initial items in cache
            await env.RSS_CACHE.put(cacheKey, JSON.stringify(items), {
                expirationTtl: 3600 // 1 hour
            });

            return new Response(JSON.stringify(items), {
                headers: {
                    "Content-Type": "application/json",
                    ...corsHeaders
                }
            });

        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: {
                    "Content-Type": "application/json",
                    ...corsHeaders
                }
            });
        }
    }
};

async function clearCachedItemsByUrl(url, env) {
    const cacheKey = `feed:${url}`;
    const tagCachePrefix = `tags:`;
    const urlCachePrefix = `feed:`; // Prefix for all feed-related caches

    // Log the clearing process
    console.log(`[Backend] Clearing cache for ${url}`);

    // Delete feed-specific cache
    await env.RSS_CACHE.delete(cacheKey);

    // Delete all individual item tag caches
    const tagKeys = await env.RSS_CACHE.list({
        prefix: tagCachePrefix
    });

    for (const key of tagKeys.keys) {
        await env.RSS_CACHE.delete(key.name);
        console.log(`[Backend] Deleted tag cache: ${key.name}`);
    }

    // Delete all feed-related caches (for all URLs)
    const urlKeys = await env.RSS_CACHE.list({
        prefix: urlCachePrefix
    });

    for (const key of urlKeys.keys) {
        await env.RSS_CACHE.delete(key.name);
        console.log(`[Backend] Deleted feed cache: ${key.name}`);
    }

    console.log(`[Backend] Cache cleared for URL: ${url} and all related tags/feeds.`);
}

/**
 * Filters tags to ensure they meet the constraints: 
 * - Each tag must be 1–2 words.
 * - Tags should be unique and trimmed.
 * 
 * @param {string[]} tags - Array of tags to filter.
 * @returns {string[]} Filtered array of tags.
 */
function filterTags(tags) {
    return [...new Set(
        tags
            .map(tag => tag.trim()) // Remove extra spaces
            .filter(tag => tag.split(' ').length <= 2 && tag.trim().length > 0)
    )];
}

/**
 * Maps tags to their respective subcategories.
 *
 * @param {string[]} tags - Array of tags to categorize.
 * @param {object} tagCategories - Mapping of main categories to subcategories.
 * @returns {object} Subcategories mapped to their respective tags.
 */
function mapTagsToSubcategories(tags, tagCategories) {
    const subCategories = {};

    tags.forEach(tag => {
        const matchingCategory = Object.entries(tagCategories).find(([_, subKeywords]) =>
            subKeywords.some(keyword => tag.includes(keyword))
        );

        if (matchingCategory) {
            const [, subKeywords] = matchingCategory;
            subKeywords.forEach(subcategory => {
                if (tag.includes(subcategory)) {
                    if (!subCategories[subcategory]) {
                        subCategories[subcategory] = [];
                    }
                    subCategories[subcategory].push(tag);
                }
            });
        } else {
            // If no match, categorize as "Uncategorized"
            if (!subCategories['Uncategorized']) {
                subCategories['Uncategorized'] = [];
            }
            subCategories['Uncategorized'].push(tag);
        }
    });

    return subCategories;
}

async function processTagsAndCache(items, feedUrl, env) {
    console.log("[Backend] Starting processTagsAndCache for feed:", feedUrl);

    // Array to store updated items
    const updatedItems = await Promise.all(
        items.map(async (item) => {
            const itemHash = await sha256(`${item.title}${item.description}`);
            const tagCacheKey = `tags:${itemHash}`;

            // Check if tags are already cached
            const cachedTags = await env.RSS_CACHE.get(tagCacheKey);
            if (cachedTags) {
                const cachedData = JSON.parse(cachedTags);
                console.log(`[Backend] Cached tags for "${item.title}":`, cachedData.tags);
                
                // Return item with cached tags and subcategories
                return {
                    ...item,
                    tags: cachedData.tags || [],
                    subcategories: cachedData.subcategories || {},
                };
            }

            // If no cache, return item with empty tags (to be processed later)
            console.log(`[Backend] No cached tags for "${item.title}". Processing...`);
            return {
                ...item,
                tags: [],
                subcategories: {},
            };
        })
    );

    // Process only untagged items
    const untaggedItems = updatedItems.filter((item) => item.tags.length === 0);
    for (const item of untaggedItems) {
        try {
            // Generate tags using OpenAI API
            const tagCategoriesString = Object.values(TAG_CATEGORIES).flat().join(", ");
            const response = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: `Generate up to 12 relevant tags (1-2 words each) for the article based on its title and description. Focus exclusively on these subcategories: ${tagCategoriesString}. Return tags as comma-separated values. Do not include empty or invalid tags.`,
                        },
                        {
                            role: "user",
                            content: `Title: ${item.title}\n\nDescription: ${item.description}`,
                        },
                    ],
                    max_tokens: 300,
                }),
            });

            if (!response.ok) {
                console.error(`[Backend] OpenAI API error for item: ${item.title}`);
                continue;
            }

            const data = await response.json();
            const rawTags = data.choices[0]?.message?.content.trim() || '';
            let tags = filterTags(rawTags.split(",").map((tag) => tag.trim()));

            // Fallback to keyword matching if less than 2 tags are generated
            if (tags.length < 2) {
                console.warn(`[Backend] Insufficient tags generated for "${item.title}". Falling back to keyword matching.`);
                tags = generateFallbackTags(item.title + " " + item.description, TAG_CATEGORIES, 12);
                console.log(`[Backend] Fallback tags generated for "${item.title}":`, tags);
            }

            // Ensure tags meet constraints
            tags = tags.filter((tag) => tag && tag.trim().length > 0).slice(0, 12);

            // Map tags to subcategories
            const subcategories = mapTagsToSubcategories(tags, TAG_CATEGORIES);

            console.log(`[Backend] Generated tags for "${item.title}":`, tags);
            console.log(`[Backend] Subcategories for "${item.title}":`, subcategories);

            // Cache the tags and subcategories
            if (tags.length > 0) {
                await env.RSS_CACHE.put(
                    `tags:${await sha256(`${item.title}${item.description}`)}`,
                    JSON.stringify({
                        tags: tags,
                        subcategories: subcategories,
                        timestamp: Date.now(),
                    }),
                    { expirationTtl: 86400 } // Cache for 24 hours
                );
            }

            // Update item with tags and subcategories
            item.tags = tags;
            item.subcategories = subcategories;

            // Avoid rate limits
            await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
            console.error(`[Backend] Error tagging item: ${item.title}`, error);
        }
    }

    // Update the feed cache with all processed items
    await env.RSS_CACHE.put(
        `feed:${feedUrl}`,
        JSON.stringify(updatedItems),
        { expirationTtl: 3600 } // Cache feed for 1 hour
    );

    console.log("[Backend] Processed tags and updated cache for feed:", feedUrl);
    return updatedItems;
}

/**
 * Generates fallback tags based on keywords from TAG_CATEGORIES.
 *
 * @param {string} text - The text to analyze for keywords.
 * @param {object} tagCategories - Mapping of categories to keywords.
 * @param {number} maxTags - Maximum number of tags to generate.
 * @returns {string[]} Array of fallback tags.
 */
function generateFallbackTags(text, tagCategories, maxTags = 12) {
    const textLower = text.toLowerCase();
    const tags = [];

    for (const [category, keywords] of Object.entries(tagCategories)) {
        for (const keyword of keywords) {
            if (textLower.includes(keyword) && !tags.includes(keyword)) {
                tags.push(keyword);
                if (tags.length >= maxTags) break;
            }
        }
        if (tags.length >= maxTags) break;
    }

    // If no keywords matched, add a generic fallback
    if (tags.length === 0) {
        tags.push('General');
    }

    return tags.slice(0, maxTags); // Limit tags to maxTags
}

/**
 * Creates a SHA-256 hash of a given string.
 *
 * @param {string} text - The input text to hash.
 * @returns {Promise<string>} The resulting hash as a hexadecimal string.
 */
async function sha256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
