// server/proxy.js
import express from 'express'
import cors from 'cors'
import axios from 'axios'
import { XMLParser } from 'fast-xml-parser'
import * as dotenv from 'dotenv'

dotenv.config()

const app = express()
app.use(cors())

// Global variable to store tags being processed
const tagsInProgress = new Map()
const cachedTags = new Map(); // In-memory cache for processed tags

// Middleware to check for API Key
app.use((req, res, next) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API Key is missing. Set it in your environment.' })
  }
  next()
})

const xmlParser = new XMLParser()

app.get('/rss', async (req, res) => {
  const { url, tagsOnly } = req.query
  
  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' })
  }

  // If requesting tags only, return cached tags if available
  if (tagsOnly && tagsInProgress.has(url)) {
    return res.json(tagsInProgress.get(url))
  }

  try {
    const response = await axios.get(url)
    const rssText = response.data
    const parsed = xmlParser.parse(rssText)
    
    if (!parsed.rss?.channel?.item) {
      throw new Error('Invalid RSS feed structure')
    }

    const items = Array.isArray(parsed.rss.channel.item) 
      ? parsed.rss.channel.item 
      : [parsed.rss.channel.item]

    const formattedItems = items.map(item => ({
      title: item.title,
      description: item.description,
      link: item.link || '#',
      source: new URL(url).hostname,
      tags: [], // Initially empty tags
    }))

    // Store initial items in cache
    tagsInProgress.set(url, formattedItems)

    // Process tags in background
    processTags(formattedItems, url)

    res.json(formattedItems)
  } catch (error) {
    console.error('Error fetching RSS:', error)
    res.status(500).json({ error: `Error fetching RSS: ${error.message}` })
  }
})

async function processTags(items, feedUrl) {
  const MAX_BATCH_SIZE = 10;
  const TIMEOUT = 5 * 60 * 1000; // 5 minutes

  // Prepare content array and batches for untagged items
  const contentArray = [];
  const untaggedItems = [];

  items.forEach(item => {
    const cacheKey = `${feedUrl}:${item.title}`;
    if (cachedTags.has(cacheKey)) {
      item.tags = cachedTags.get(cacheKey);
    } else {
      contentArray.push(`${item.title} ${item.description}`);
      untaggedItems.push(item);
    }
  });

  const batches = [];
  for (let i = 0; i < contentArray.length; i += MAX_BATCH_SIZE) {
    batches.push(contentArray.slice(i, i + MAX_BATCH_SIZE));
  }

  try {
    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Tag processing timed out')), TIMEOUT);
    });

    // Process batches with timeout
    const processPromise = Promise.all(
      batches.map(async (batch, batchIndex) => {
        try {
          const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
              model: 'gpt-3.5-turbo',
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
            },
            {
              headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
              }
            }
          );

          const tags = response.data.choices[0]?.message?.content
            .trim()
            .split('\n')
            .map(line => line.split(',').map(tag => tag.trim()));

          // Update tags for this batch and cache them
          const startIdx = batchIndex * MAX_BATCH_SIZE;
          tags.forEach((tagList, idx) => {
            if (untaggedItems[startIdx + idx]) {
              untaggedItems[startIdx + idx].tags = tagList;
              const cacheKey = `${feedUrl}:${untaggedItems[startIdx + idx].title}`;
              cachedTags.set(cacheKey, tagList); // Cache tags
            }
          });

          return tags;
        } catch (error) {
          console.error(`Error processing batch ${batchIndex}:`, error);
          return batch.map(() => ['Error processing tags']);
        }
      })
    );

    // Race between processing and timeout
    await Promise.race([processPromise, timeoutPromise]);

    // Merge tagged items into the original list
    const updatedItems = items.map(item => {
      if (!item.tags.length) {
        const cacheKey = `${feedUrl}:${item.title}`;
        item.tags = cachedTags.get(cacheKey) || [];
      }
      return item;
    });

    // Update the global cache
    tagsInProgress.set(feedUrl, updatedItems);

    return updatedItems;
  } catch (error) {
    console.error('Error or timeout in tag processing:', error);
    return items;
  }
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`)
})