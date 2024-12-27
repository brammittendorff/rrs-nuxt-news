// server/api/rss.js
import { getQuery, createError } from 'h3'
import axios from 'axios'
import { XMLParser } from 'fast-xml-parser'

const xmlParser = new XMLParser()

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const { url } = query

  if (!url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing url parameter'
    })
  }

  try {
    // Fetch RSS feed
    const response = await axios.get(url)
    const rssText = response.data
    
    // Parse XML
    const parsed = xmlParser.parse(rssText)
    
    // Extract items
    const items = parsed.rss.channel.item
    
    // Map to desired format
    const formattedItems = Array.isArray(items) ? items.map(item => ({
      title: item.title || 'No Title',
      link: item.link || '#',
      description: item.description || '',
      tags: [] // Tags will be added later
    })) : []

    return formattedItems
  } catch (error) {
    console.error('Error fetching RSS:', error)
    throw createError({
      statusCode: 500,
      statusMessage: `Error fetching RSS feed: ${error.message}`
    })
  }
})