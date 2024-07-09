from flask import Flask
from flask_cors import CORS
import os
import requests
from dotenv import load_dotenv

app = Flask(__name__)
cors = CORS(app, origins='*')

# Load environment variables
load_dotenv()

OMDB_API_KEY = os.getenv('OMDB_API_KEY')

@app.route("/members")
def members():
    return {'members': ["member1", "member2", "member3"]}

@app.route("/ap")

if __name__ == '__main__':
    app.run(debug=True)
