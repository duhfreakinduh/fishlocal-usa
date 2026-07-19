# FishLocal USA

A colorful, kid-friendly fishing planner for families anywhere in the United States.

## Features

- Search by U.S. city, state, or ZIP code
- Use the device's current location
- Quick TL;DR fishing report
- Weather-based bite score and bite windows
- 7-day fishing forecast
- Interactive Leaflet map
- Nearby fishing places and supply shops from OpenStreetMap
- Saved locations in local browser storage
- Installable progressive web app
- No framework, build step, paid API, or API key

## How the bite score works

The bite score is a planning estimate based on wind, gusts, atmospheric pressure, rain probability, cloud cover, temperature, severe-weather codes, and proximity to sunrise or sunset. It is not a scientific catch guarantee.

## Data sources

- Weather and geocoding: Open-Meteo
- Map tiles and place listings: OpenStreetMap contributors
- Place search: public Overpass API instances
- Map interface: Leaflet

Public data services may be incomplete, delayed, rate-limited, or temporarily unavailable. Confirm shop hours, property access, regulations, water conditions, and safety before traveling.

## Publish with GitHub Pages

1. Open **Settings → Pages** in the GitHub repository.
2. Under **Build and deployment**, choose **GitHub Actions**.
3. The included workflow deploys the site after every push to `main`.

## Run locally

Use a local web server so browser location, service workers, and API requests work correctly:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## License

The application code is MIT licensed. External data, map tiles, and libraries retain their own terms and attribution requirements.
