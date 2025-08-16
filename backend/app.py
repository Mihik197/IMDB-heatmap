from flask import Flask, request, jsonify
from flask_cors import CORS
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, func
from sqlalchemy.orm import declarative_base 
from sqlalchemy.orm import sessionmaker
import requests
from dotenv import load_dotenv
from bs4 import BeautifulSoup
import os

app = Flask(__name__)
CORS(app)

# Load environment variables
load_dotenv()


# database setup
DATABASE_URL = "sqlite:///shows.db"
engine = create_engine(DATABASE_URL)
Base = declarative_base()
Session = sessionmaker(bind=engine)
session = Session()

class Show(Base):
    __tablename__ = 'shows'
    id = Column(Integer, primary_key=True, autoincrement=True)
    imdb_id = Column(String, unique=True, nullable=False)
    title = Column(String)
    total_seasons = Column(Integer)
    last_updated = Column(DateTime, default=func.now(), onupdate=func.now())

class Episode(Base):
    __tablename__ = 'episodes'
    id = Column(Integer, primary_key=True, autoincrement=True)
    show_id = Column(Integer)
    season = Column(Integer)
    episode = Column(Integer)
    title = Column(String)
    rating = Column(Float)
    imdb_id = Column(String)

Base.metadata.create_all(engine)  # creates the tables


@app.route("/getShowByTitle")
def get_show_by_title():
    title = request.args.get('title')
    if title:
        apiKey = os.getenv('VITE_API_KEY')
        url = f'http://www.omdbapi.com/?apikey={apiKey}&t={title}'
        response = requests.get(url)
        if response.status_code == 200:
            data = response.json()
            if data.get('Response') == 'True':
                return jsonify(data)
            else:
                return jsonify({'error': data.get('Error', 'Failed to fetch show data')}), 500
    return jsonify({'error': 'Title not provided'}), 400


@app.route("/getShow")
def get_show():
    imdb_id = request.args.get('imdbID')
    if imdb_id:
        show = session.query(Show).filter_by(imdb_id=imdb_id).first()
        if show:
            episodes = session.query(Episode).filter_by(show_id=show.id).all()
            return jsonify({
                'title': show.title,
                'totalSeasons': show.total_seasons,
                'episodes': [{
                    'season': ep.season,
                    'episode': ep.episode,
                    'title': ep.title,
                    'rating': ep.rating,
                    'imdb_id': ep.imdb_id,
                } for ep in episodes]
            })
        else:
            # fetch from OMDB and IMDB if not found in the database
            return fetch_and_store_show(imdb_id)
    return jsonify({'error': 'IMDB ID not provided'}), 400


def fetch_and_store_show(imdb_id):
    apiKey = os.getenv('VITE_API_KEY')
    url = f'http://www.omdbapi.com/?apikey={apiKey}&i={imdb_id}'
    response = requests.get(url)
    if response.status_code == 200:
        data = response.json()
        if data.get('Response') == 'True':
            show = Show(imdb_id=imdb_id, title=data['Title'], total_seasons=int(data['totalSeasons']))
            session.add(show)
            session.commit()

            # fetch data for each season
            for season in range(1, show.total_seasons + 1):
                season_url = f'http://www.omdbapi.com/?apikey={apiKey}&i={imdb_id}&season={season}'
                season_response = requests.get(season_url)
                if season_response.status_code == 200:
                    season_data = season_response.json()
                    for ep_data in season_data.get('Episodes', []):  # if the 'Episodes' key does not exist, it returns an empty list []
                        # Try OMDB rating first
                        rating = parse_float(ep_data.get('imdbRating'))
                        if rating is None:  # fallback to scraping
                            scraped = fetch_rating_from_imdb(ep_data['imdbID'])
                            rating = parse_float(scraped)
                        episode = Episode(
                            show_id=show.id,
                            season=season,
                            episode=int(ep_data.get('Episode', 0)),
                            title=ep_data.get('Title', 'No Title'),
                            rating=rating,  # can be None; stored as NULL in DB
                            imdb_id=ep_data.get('imdbID', 'No IMDb ID'),
                        )
                        session.add(episode)
            session.commit()
            return get_show()
    return jsonify({'error': 'Failed to fetch show data'}), 500


# fetch ratings for the episodes which have missing ratings in OMDB API
def fetch_rating_from_imdb(imdb_id):
    url = f'https://www.imdb.com/title/{imdb_id}/'
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        soup = BeautifulSoup(response.content, 'html.parser')
        rating_tag = soup.find('span', class_='sc-eb51e184-1 ljxVSS')
        if rating_tag:
            text = rating_tag.text.strip()
            print(f"Found rating for {imdb_id}: {text}")
            return text
        else:
            print(f"No rating found for {imdb_id}")
    else:
        print(f"Failed to fetch IMDb page for {imdb_id}: {response.status_code}")
    # Return None so caller can decide how to handle missing rating
    return None


def parse_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

if __name__ == '__main__':
    app.run(debug=True)
