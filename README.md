# HLTV iCal Service

A service that converts HLTV team match schedules into subscribable iCal calendar feeds.

> **Note:** This code was generated as a one-shot from GPT-5 and may not be optimized for production use.

## Hosting with Docker

### Build and run locally
```bash
docker build -t hltv-ical .
docker run -p 3000:3000 hltv-ical
```

### Using Docker Compose (optional)
Create a `docker-compose.yml`:
```yaml
services:
  hltv-ical:
    build: .
    ports:
      - "3000:3000"
    restart: unless-stopped
```

Then run:
```bash
docker-compose up -d
```

## API Endpoints

### Health Check
```
GET /health
```
Returns service status and current time.

### Team Calendar Feed
```
GET /team/{team_id}/{team_slug}.ics
GET /team/{team_id}.ics
```

**Parameters:**
- `team_id`: HLTV team ID (required)
- `team_slug`: Team slug/name (optional)
- `duration`: Match duration in minutes (query parameter, default: 120, max: 1440)

**Example:**
```
GET /team/6667/faze.ics?duration=150
```

## Usage

1. Find your team's HLTV URL (e.g., `https://www.hltv.org/team/6667/faze`)
2. Extract the team ID (`6667`) and slug (`faze`)
3. Subscribe to `http://your-server:3000/team/6667/faze.ics` in your calendar app

**Popular Teams:**
- FaZe: `/team/6667/faze.ics`
- Astralis: `/team/6665/astralis.ics`
- Vitality: `/team/9565/vitality.ics`

The service caches responses for 60 minutes to avoid overloading HLTV.