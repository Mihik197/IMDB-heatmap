# IMDB-heatmap


## Features (in progress)

- **Data Fetching**: loads TV show data from the OMDB API and scrapes additional information as needed.
- **Interactive Visualization**: Users can hover and click on heatmap cells to be linked to IMDB pages for each episode
- **Backend Support**: flask is used for web scraping and managing API requests, with a SQLite database for data storage.

## Installing

### Clone the repo

```bash
  git clone https://github.com/Mihik197/IMDB-heatmap.git
  cd heatmap-visualization
```
### Install dependencies

```bash
  npm install
```


For the backend, navigate to the backend folder and install the required Python packages:
```bash
pip install -r requirements.txt
```

### Set up environment variables

Create a `.env` and update the VITE_API_KEY with your OMDB API key

### Run the application

```bash
  npm run dev
```

```bash
flask run
```

### Built With

[React.js](https://reactjs.org/) - web framework used  
[D3.js](https://d3js.org/) - library for producing dynamic, interactive data visualizations  
[Vite](https://vitejs.dev/) - frontend tooling  
[Flask](https://flask.palletsprojects.com/) - backend framework
[SQLite](https://www.sqlite.org/) - database


### License

MIT
