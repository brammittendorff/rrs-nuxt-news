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

    const updatedItems = [];
    const untaggedItems = [];

    // Check cache and prepare untagged items
    for (const item of items) {
        const itemHash = await sha256(`${item.title}${item.description}`);
        const tagCacheKey = `tags:${itemHash}`;

        const cachedTags = await env.RSS_CACHE.get(tagCacheKey);
        if (cachedTags) {
            const cachedData = JSON.parse(cachedTags);
            console.log(`[Backend] Cached tags for "${item.title}":`, cachedData.tags);

            updatedItems.push({
                ...item,
                tags: cachedData.tags || [],
                subcategories: cachedData.subcategories || {},
            });
        } else {
            untaggedItems.push(item);
        }
    }

    if (untaggedItems.length === 0) {
        console.log("[Backend] No untagged items to process.");
        return updatedItems;
    }

    console.log(`[Backend] Processing ${untaggedItems.length} untagged items.`);

    try {
        // Prepare batch payload for OpenAI
        const payload = untaggedItems.map(item => ({
            title: item.title,
            description: item.description,
        }));

        const tagCategoriesString = Object.values(TAG_CATEGORIES).flat().join(", ");

        // Send bulk request to OpenAI
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
                        content: `Generate up to 12 relevant tags (1-2 words each) for each article based on its title and description. Focus exclusively on these subcategories: ${tagCategoriesString}. Return tags as JSON with an array of objects where each object contains "title", "tags", and "subcategories".`,
                    },
                    {
                        role: "user",
                        content: JSON.stringify(payload),
                    },
                ],
                max_tokens: 1000,
            }),
        });

        if (!response.ok) {
            console.error(`[Backend] OpenAI API error: ${response.statusText}`);
            throw new Error("Failed to fetch tags from OpenAI API");
        }

        const data = await response.json();
        const generatedTags = JSON.parse(data.choices[0]?.message?.content || "[]");

        // Update items with tags and subcategories
        for (const item of untaggedItems) {
            const generatedItem = generatedTags.find(
                (genItem) => genItem.title === item.title
            );

            if (generatedItem) {
                const tags = filterTags(generatedItem.tags || []);
                const subcategories = mapTagsToSubcategories(tags, TAG_CATEGORIES);

                // Cache the tags and subcategories
                const itemHash = await sha256(`${item.title}${item.description}`);
                await env.RSS_CACHE.put(
                    `tags:${itemHash}`,
                    JSON.stringify({ tags, subcategories, timestamp: Date.now() }),
                    { expirationTtl: 86400 } // Cache for 24 hours
                );

                updatedItems.push({
                    ...item,
                    tags,
                    subcategories,
                });
            } else {
                updatedItems.push({ ...item, tags: [], subcategories: {} });
            }
        }

        // Update the feed cache
        await env.RSS_CACHE.put(
            `feed:${feedUrl}`,
            JSON.stringify(updatedItems),
            { expirationTtl: 3600 } // Cache feed for 1 hour
        );

        console.log("[Backend] Processed tags and updated cache for feed:", feedUrl);
        return updatedItems;

    } catch (error) {
        console.error("[Backend] Error processing tags:", error);
        return items; // Return original items in case of an error
    }
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
