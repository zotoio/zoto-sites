# today.zoto.io API

Location-aware backend for the **today.zoto.io** dashboard (weather, transit, Hacker News, cameras, etc.).

## Run locally

```bash
yarn --cwd backends/today.zoto.io install
cp backends/today.zoto.io/.env.example backends/today.zoto.io/.env
yarn start:today:dev   # from repo root — API :3001, static UI :8081
```

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `PORT` | No (default `3001`) | HTTP port |
| `WINDY_WEBCAMS_KEY` | No | Windy Webcams API |
| `TRANSPORT_NSW_API_KEY` | No | TfNSW Live Traffic cameras |
| `QLDTRAFFIC_API_KEY` | No | QLDTraffic v1 (ArcGIS used without key) |

**News:** Top stories come from the free [Hacker News Algolia API](https://hn.algolia.com/api) (`/api/news`). Link previews (Open Graph) are fetched server-side with timeouts and size limits. Use `?demo=1` for labelled demo headlines when testing offline.

## Docker

See `compose/projects/today.yml` — `env_file` for `.env` is optional (`required: false`).
