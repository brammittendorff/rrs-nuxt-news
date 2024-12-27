# RSS Feed Reader with AI Tagging

A modern RSS feed reader that automatically tags articles using OpenAI's GPT API. Built with Nuxt.js and Express.

## Features

- Multiple RSS feed sources (Hacker News, Security.nl, Tweakers.net)
- AI-powered automatic article tagging
- Real-time tag filtering
- Title search functionality
- Source filtering
- Responsive design
- Tag categorization (Security, Development, Hardware, etc.)
- Color-coded tags

## Prerequisites

- Node.js (v16 or higher)
- OpenAI API key

## Setup

1. Clone the repository:
```bash
git clone https://github.com/brammittendorff/rrs-nuxt-news.git
cd rrs-nuxt-news
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env
OPENAI_API_KEY="your-openai-api-key"
PROXY_URL="http://localhost:3001"
```

## Running the Application

1. Start the proxy server:
```bash
npm run proxy
```

2. In a new terminal, start the Nuxt development server:
```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## RSS Sources

Currently configured sources:
- Hacker News (https://news.ycombinator.com/rss)
- Security.nl (https://www.security.nl/rss/headlines.xml)
- Tweakers.net (https://tweakers.net/feeds/mixed.xml)

To add more sources, modify the `sources` array in `pages/index.vue`.

## Project Structure

```
├── server/
│   ├── api/
│   │   └── rss.js      # Nuxt server API endpoint
│   └── proxy.js        # Express proxy server for RSS and OpenAI
├── pages/
│   └── index.vue       # Main RSS reader component
├── nuxt.config.ts      # Nuxt configuration
└── .env               # Environment variables
```

## Features in Detail

### Automatic Tagging
- Articles are automatically tagged using OpenAI's GPT API
- Tags are categorized into groups: Security, Development, Hardware, Technology, AI & Data, etc.
- Tags are color-coded based on their category

### Filtering
- Filter articles by source
- Search articles by title
- Filter by tags (multiple tags supported)
- Real-time filtering updates

### UI Features
- Responsive design
- Loading states
- Error handling
- Tag search functionality
- Clear filters option
- Article count display