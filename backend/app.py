from flask import Flask, request, jsonify
from flask_cors import CORS
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import requests
from dotenv import load_dotenv
from bs4 import BeautifulSoup
import os

app = Flask(__name__)
CORS(app)

# Load environment variables
load_dotenv()

@app.route("/getRating")
def get_rating():
    imdb_id = request.args.get('imdbID')
    if imdb_id:
        rating = get_imdb_rating(imdb_id)
        if rating:
            return jsonify({'rating': rating})
    return jsonify({'rating': None})

def get_imdb_rating(imdb_id):
    url = f'https://www.imdb.com/title/{imdb_id}/'
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        soup = BeautifulSoup(response.content, 'html.parser')
        rating_tag = soup.find('span', class_='sc-eb51e184-1 cxhhrI')
        if rating_tag:
            print(f"Found rating for {imdb_id}: {rating_tag.text}")
            return rating_tag.text
        else:
            print(f"No rating found for {imdb_id}")
        if rating_tag:
            return rating_tag.text
    else:
        print(f"Failed to fetch IMDb page for {imdb_id}: {response.status_code}")
    return None

if __name__ == '__main__':
    app.run(debug=True)
