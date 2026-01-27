<h1 align="center">IMDB Heatmap</h1>

Visual heatmap of episode ratings for TV series. OMDb supplies baseline metadata; optional lightweight IMDb scraping fills gaps (votes, air dates, missing ratings, early episode placeholders). Built for quick visual insight into when a show peaks or dips.

## Features

- Interactive D3 heatmap (hover, IMDb deep links)
- Autocomplete search (OMDb proxy)
- Optional fast ingest: instant baseline + background enrichment
- Refresh endpoints (missing-only or full)
- Local persistence (SQLite) with simple runtime migrations

## Stack

Frontend: React, Vite, D3  
Backend: Python (Flask, SQLAlchemy, BeautifulSoup)  
DB: SQLite (file)  
Tests: pytest (backend)

## Quick Start

Clone:
```powershell
git clone https://github.com/Mihik197/IMDB-heatmap.git
cd IMDB-heatmap
```

Backend:
```powershell
cd backend
python -m venv venv
./venv/Scripts/Activate.ps1
pip install -r requirements.txt
echo OMDB_API_KEY=YOUR_OMDB_KEY > .env
# optional fast ingest
echo FAST_INGEST=1 >> .env
python app.py
```

Frontend (new terminal):
```powershell
cd imdb-heatmap-app
npm install
npm run dev
```
Open the Vite dev URL (e.g. http://localhost:5173) while backend runs on port 5000.

## Minimal Configuration

Required: `OMDB_API_KEY` (OMDb API key) in `backend/.env`.
Optional: `FAST_INGEST=1` for two-phase load; `ENABLE_SCRAPE_CACHE=1` to cache scraped ratings.

## Free Deployment Guide (Recommended)

Use Cloudflare Pages (frontend) + Render Free Web Service (backend).

### 1) Backend on Render (Free)
1. Create a new Render Web Service and connect this repo.
2. Render detects [render.yaml](render.yaml) automatically. If it doesn’t:
	- Root Directory: `backend`
	- Build Command: `pip install -r requirements.txt`
	- Start Command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
3. Add environment variables:
	- `OMDB_API_KEY` (required)
	- `DATABASE_URL` (Postgres URL from Render’s free database)
	- `CORS_ALLOW_ORIGINS` (comma-separated, e.g. `https://your-site.pages.dev`)
4. Deploy. Copy the public API URL (e.g., `https://imdb-heatmap-api.onrender.com`).

### 2) Frontend on Cloudflare Pages (Free)
1. Create a new Pages project from this repo.
2. Build settings:
	- Root directory: `imdb-heatmap-app`
	- Build command: `npm install && npm run build`
	- Output directory: `dist`
3. Add environment variable:
	- `VITE_API_URL` = your Render API URL
4. Deploy.

### 3) After Deploy
- Verify API access in browser: `https://<render-url>/search?q=breaking`.
- If requests fail, set `CORS_ALLOW_ORIGINS` to your Cloudflare Pages URL.

## Fast Ingest (Summary)

If enabled: backend returns OMDb-only data immediately, then a thread enriches with IMDb season pages. Frontend shows an “Enriching…” badge and auto-polls until complete. Disable by omitting the variable.

## Project Structure

```
backend/        Flask API, scraping, persistence
imdb-heatmap-app/  React client
```

## Contributing

Small focused PRs welcome. Keep style consistent, add tests when altering backend logic.

## License

MIT (see LICENSE if present).

## Disclaimer

Uses OMDb API and light parsing of IMDb pages for educational purposes. Not affiliated with or endorsed by IMDb or OMDb. Respect rate limits.