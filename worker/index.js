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
                    return new Response(cachedItems, {
                        headers: {
                            "Content-Type": "application/json",
                            ...corsHeaders
                        }
                    });
                }
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

async function processTagsAndCache(items, feedUrl, env) {
    const MAX_BATCH_SIZE = 10;
    const TIMEOUT = 5 * 60 * 1000; // 5 minutes

    const untaggedItems = [];
    const contentArray = [];
    const processedItems = new Set();

    // Check which items need tags
    for (const item of items) {
        const itemHash = await sha256(`${item.title}${item.description}`);
        const tagCacheKey = `tags:${itemHash}`;
        const cachedTags = await env.RSS_CACHE.get(tagCacheKey);

        if (cachedTags) {
            item.tags = JSON.parse(cachedTags);
            processedItems.add(itemHash);
        } else {
            untaggedItems.push({ ...item, hash: itemHash });
            contentArray.push(`${item.title} ${item.description}`);
        }
    }

    // Clean up old cached tags that are no longer in the feed
    const cacheKeys = await env.RSS_CACHE.list({ prefix: `tags:` });
    for (const key of cacheKeys.keys) {
        const itemHash = key.name.replace('tags:', '');
        if (!processedItems.has(itemHash)) {
            await env.RSS_CACHE.delete(key.name);
        }
    }

    // Process in batches
    const batches = [];
    for (let i = 0; i < contentArray.length; i += MAX_BATCH_SIZE) {
        batches.push(contentArray.slice(i, i + MAX_BATCH_SIZE));
    }

    try {
        const startTime = Date.now();

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            // Check timeout
            if (Date.now() - startTime > TIMEOUT) {
                break;
            }

            const batch = batches[batchIndex];
            console.log(`[OpenAI] Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} items`);
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: 'Generate 3-5 relevant tags for each article. Return tags as comma-separated values, one line per article.'
                        },
                        {
                            role: 'user',
                            content: `Tag these articles:\n\n${batch.join('\n\n')}`
                        }
                    ],
                    max_tokens: 1000
                })
            });

            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.status}`);
            }

            const data = await response.json();
            const tags = data.choices[0]?.message?.content
                .trim()
                .split('\n')
                .map(line => line.split(',').map(tag => tag.trim()));

            // Update items and cache
            const startIdx = batchIndex * MAX_BATCH_SIZE;
            for (let i = 0; i < tags.length; i++) {
                const item = untaggedItems[startIdx + i];
                if (item && tags[i]) {
                    // Update the item in the main items array
                    const originalItem = items.find(original =>
                        original.title === item.title &&
                        original.description === item.description
                    );
                    if (originalItem) {
                        originalItem.tags = tags[i];
                    }

                    // Cache the tags with the content hash as key
                    const tagCacheKey = `tags:${item.hash}`;
                    await env.RSS_CACHE.put(tagCacheKey, JSON.stringify(tags[i]), {
                        expirationTtl: 86400 // 24 hours
                    });
                }
            }

            // Update feed cache with latest items
            await env.RSS_CACHE.put(`feed:${feedUrl}`, JSON.stringify(items), {
                expirationTtl: 3600 // 1 hour
            });

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } catch (error) {
        console.error('Error processing tags:', error);
        // Don't throw the error - just let some items remain untagged
    }
}

// Helper function to create SHA-256 hash
async function sha256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}