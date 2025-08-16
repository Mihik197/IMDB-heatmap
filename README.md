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
echo VITE_API_KEY=YOUR_OMDB_KEY > .env
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

Required: `VITE_API_KEY` (OMDb API key) in `backend/.env`.
Optional: `FAST_INGEST=1` for two-phase load; `ENABLE_SCRAPE_CACHE=1` to cache scraped ratings.

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