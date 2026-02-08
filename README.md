# Transcript App

## Discord Bot

Standalone Discord bot that exposes `/pdc` to query the search API and respond with a rich embed.

### Requirements
- `DISCORD_BOT_TOKEN`
- `DISCORD_APP_ID`
- `DISCORD_GUILD_ID` (optional, for faster per-guild command registration)
- `DISCORD_SEARCH_BASE_URL` (optional, defaults to `NEXT_PUBLIC_BASE_URL` or `http://localhost:3000`)

### Setup
1) Install dependencies
```
npm install
```

2) Register the slash command
```
npm run discord:register
```

3) Start the bot
```
npm run discord:bot
```

### Notes
- The bot calls `/api/search` and `/api/share` on `DISCORD_SEARCH_BASE_URL`.
- Results are cached in memory for 15 minutes to support button actions.

## Warmup Endpoint

To reduce cold-start latency, warm the vector store and BM25 index:

```
GET /api/warmup?token=YOUR_TOKEN
```

Set `WARMUP_TOKEN` in the environment to protect the endpoint.

### Scheduled Warmup (GitHub Actions)

Configure repo secrets:
- `WARMUP_URL` (e.g. `https://your-app.vercel.app/api/warmup`)
- `WARMUP_TOKEN` (optional, must match the env var if set)
