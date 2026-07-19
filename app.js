"use strict";

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
const FAVORITES_KEY = "fishlocal-favorites-v1";
const LAST_LOCATION_KEY = "fishlocal-last-location-v1";

const state = {
  location: null,
  weather: null,
  map: null,
  userMarker: null,
  spotLayer: null,
  shopLayer: null,
  spots: [],
  shops: [],
  activeNearbyTab: "spots",
  deferredInstallPrompt: null
};

const dom = {
  searchForm: document.querySelector("#searchForm"),
  locationSearch: document.querySelector("#locationSearch"),
  searchResults: document.querySelector("#searchResults"),
  locationButton: document.querySelector("#locationButton"),
  favoriteButton: document.querySelector("#favoriteButton"),
  installButton: document.querySelector("#installButton"),
  statusMessage: document.querySelector("#statusMessage"),
  locationBadge: document.querySelector("#locationBadge"),
  scoreRing: document.querySelector("#scoreRing"),
  biteScore: document.querySelector("#biteScore"),
  biteLabel: document.querySelector("#biteLabel"),
  biteReason: document.querySelector("#biteReason"),
  tldrText: document.querySelector("#tldrText"),
  weatherCards: document.querySelector("#weatherCards"),
  moonBadge: document.querySelector("#moonBadge"),
  biteWindows: document.querySelector("#biteWindows"),
  forecastCards: document.querySelector("#forecastCards"),
  spotsTab: document.querySelector("#spotsTab"),
  shopsTab: document.querySelector("#shopsTab"),
  nearbyList: document.querySelector("#nearbyList"),
  showAllButton: document.querySelector("#showAllButton"),
  showSpotsButton: document.querySelector("#showSpotsButton"),
  showShopsButton: document.querySelector("#showShopsButton"),
  favoritesList: document.querySelector("#favoritesList")
};

function initMap() {
  if (!window.L) {
    dom.statusMessage.textContent = "The map library could not load. Weather tools can still work.";
    return;
  }
  state.map = L.map("map", { zoomControl: true }).setView([39.8283, -98.5795], 4);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(state.map);
  state.spotLayer = L.layerGroup().addTo(state.map);
  state.shopLayer = L.layerGroup().addTo(state.map);
}

function markerIcon(type, emoji) {
  return L.divIcon({
    className: "cartoon-marker",
    html: `<div class="marker-bubble marker-${type}"><span>${emoji}</span></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 38],
    popupAnchor: [0, -36]
  });
}

function setStatus(message, kind = "info") {
  dom.statusMessage.textContent = message;
  dom.statusMessage.dataset.kind = kind;
}

function cleanText(value) {
  return String(value || "").replace(/[<>]/g, "");
}

function locationName(location) {
  const parts = [location.name, location.admin1].filter(Boolean);
  return [...new Set(parts)].join(", ") || "Selected location";
}

async function searchLocations(query) {
  const url = new URL(GEOCODING_URL);
  url.searchParams.set("name", query);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  url.searchParams.set("countryCode", "US");

  const response = await fetch(url);
  if (!response.ok) throw new Error("Location search failed");
  const data = await response.json();
  return (data.results || []).filter((item) => item.country_code === "US");
}

function renderSearchResults(results) {
  if (!results.length) {
    dom.searchResults.innerHTML = '<p class="helper-text" style="padding:.75rem">No U.S. locations found. Try a nearby city or add the state.</p>';
    dom.searchResults.classList.remove("hidden");
    return;
  }
  dom.searchResults.innerHTML = results.map((result, index) => {
    const label = [result.name, result.admin1, result.postcodes?.[0]].filter(Boolean).join(", ");
    return `<button class="search-result-button" type="button" data-result-index="${index}"><strong>${cleanText(label)}</strong><br><small>${cleanText(result.country || "United States")}</small></button>`;
  }).join("");
  dom.searchResults.classList.remove("hidden");
  dom.searchResults.querySelectorAll("[data-result-index]").forEach((button) => {
    button.addEventListener("click", () => selectLocation(results[Number(button.dataset.resultIndex)]));
  });
}

async function reverseGeocode(latitude, longitude) {
  return {
    name: "My location",
    admin1: `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
    latitude,
    longitude,
    country_code: "US"
  };
}

async function fetchWeather(location) {
  const url = new URL(WEATHER_URL);
  url.searchParams.set("latitude", location.latitude);
  url.searchParams.set("longitude", location.longitude);
  url.searchParams.set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_gusts_10m");
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,weather_code,pressure_msl,wind_speed_10m,wind_gusts_10m,cloud_cover");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "7");

  const response = await fetch(url);
  if (!response.ok) throw new Error("Weather forecast failed");
  return response.json();
}

function findHourlyIndex(weather, time = weather.current.time) {
  const exact = weather.hourly.time.indexOf(time.slice(0, 13) + ":00");
  if (exact >= 0) return exact;
  const target = new Date(time).getTime();
  let bestIndex = 0;
  let bestDistance = Infinity;
  weather.hourly.time.forEach((value, index) => {
    const distance = Math.abs(new Date(value).getTime() - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function minutesFromDate(value) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

function circularMinuteDistance(a, b) {
  const diff = Math.abs(a - b);
  return Math.min(diff, 1440 - diff);
}

function calculateHourScore({ wind, gust, pressure, rainChance, cloud, weatherCode, temperature, hourTime, sunrise, sunset, pressureTrend = 0 }) {
  let score = 48;
  const reasons = [];

  if (wind >= 4 && wind <= 12) { score += 16; reasons.push("comfortable wind"); }
  else if (wind < 4) { score += 8; reasons.push("calm water"); }
  else if (wind <= 18) { score += 4; }
  else if (wind > 25) { score -= 24; reasons.push("strong wind"); }
  else { score -= 9; }

  if (gust > 30) score -= 12;
  if (pressure >= 1008 && pressure <= 1022) { score += 12; reasons.push("steady pressure"); }
  else if (pressure >= 996 && pressure < 1008) score += 5;
  else if (pressure > 1030 || pressure < 990) score -= 9;

  if (pressureTrend < -0.4 && pressureTrend > -3) { score += 7; reasons.push("a gentle pressure drop"); }
  if (rainChance >= 15 && rainChance <= 55) score += 5;
  if (rainChance >= 75) { score -= 8; reasons.push("a high rain chance"); }
  if (cloud >= 30 && cloud <= 85) { score += 8; reasons.push("helpful cloud cover"); }
  if (temperature >= 45 && temperature <= 85) score += 5;

  const timeMinutes = minutesFromDate(hourTime);
  const sunriseDistance = circularMinuteDistance(timeMinutes, minutesFromDate(sunrise));
  const sunsetDistance = circularMinuteDistance(timeMinutes, minutesFromDate(sunset));
  if (Math.min(sunriseDistance, sunsetDistance) <= 90) {
    score += 17;
    reasons.push("dawn or dusk timing");
  } else if (Math.min(sunriseDistance, sunsetDistance) <= 150) {
    score += 8;
  }

  if (weatherCode >= 95) { score -= 42; reasons.push("thunderstorm risk"); }
  else if (weatherCode >= 80) score -= 8;

  return { score: Math.max(8, Math.min(96, Math.round(score))), reasons };
}

function calculateCurrentScore(weather) {
  const index = findHourlyIndex(weather);
  const previousPressure = weather.hourly.pressure_msl[Math.max(0, index - 3)] ?? weather.current.pressure_msl;
  return calculateHourScore({
    wind: weather.current.wind_speed_10m,
    gust: weather.current.wind_gusts_10m,
    pressure: weather.current.pressure_msl,
    pressureTrend: weather.current.pressure_msl - previousPressure,
    rainChance: weather.hourly.precipitation_probability[index] ?? 0,
    cloud: weather.current.cloud_cover,
    weatherCode: weather.current.weather_code,
    temperature: weather.current.temperature_2m,
    hourTime: weather.current.time,
    sunrise: weather.daily.sunrise[0],
    sunset: weather.daily.sunset[0]
  });
}

function scoreLabel(score) {
  if (score >= 82) return "Fin-tastic!";
  if (score >= 68) return "Good bite chance";
  if (score >= 52) return "Worth a try";
  if (score >= 36) return "A little tricky";
  return "Better to plan ahead";
}

function weatherEmoji(code) {
  if (code === 0) return "☀️";
  if (code <= 3) return "⛅";
  if (code <= 48) return "🌫️";
  if (code <= 57) return "🌦️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "🌨️";
  if (code <= 82) return "🌦️";
  if (code <= 86) return "❄️";
  return "⛈️";
}

function moonPhase(date = new Date()) {
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
  const synodicMonth = 29.53058867;
  const days = (date.getTime() - knownNewMoon) / 86400000;
  const phase = ((days % synodicMonth) + synodicMonth) % synodicMonth / synodicMonth;
  const phases = [
    [0.0625, "New Moon", "🌑"],
    [0.1875, "Waxing Crescent", "🌒"],
    [0.3125, "First Quarter", "🌓"],
    [0.4375, "Waxing Gibbous", "🌔"],
    [0.5625, "Full Moon", "🌕"],
    [0.6875, "Waning Gibbous", "🌖"],
    [0.8125, "Last Quarter", "🌗"],
    [0.9375, "Waning Crescent", "🌘"],
    [1.01, "New Moon", "🌑"]
  ];
  const match = phases.find(([limit]) => phase < limit);
  return { name: match[1], emoji: match[2], phase };
}

function formatTime(value) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function renderCurrentReport(weather) {
  const currentResult = calculateCurrentScore(weather);
  const index = findHourlyIndex(weather);
  const rainChance = weather.hourly.precipitation_probability[index] ?? 0;
  const label = scoreLabel(currentResult.score);
  const topReasons = currentResult.reasons.filter((value, i, arr) => arr.indexOf(value) === i).slice(0, 3);

  dom.scoreRing.style.setProperty("--score", currentResult.score);
  dom.scoreRing.setAttribute("aria-label", `Fishing score ${currentResult.score} out of 100`);
  dom.biteScore.textContent = currentResult.score;
  dom.biteLabel.textContent = label;
  dom.biteReason.textContent = topReasons.length
    ? `The big helpers are ${topReasons.join(", ")}.`
    : "Conditions are mixed, so try structure, shade, and a patient retrieve.";

  const windWord = weather.current.wind_speed_10m <= 12 ? "manageable" : weather.current.wind_speed_10m <= 20 ? "breezy" : "strong";
  const safetyText = weather.current.weather_code >= 95 ? " Thunderstorms are possible, so stay off the water." : "";
  dom.tldrText.textContent = `${label} Best around sunrise or sunset. Wind is ${windWord} at ${Math.round(weather.current.wind_speed_10m)} mph, with a ${Math.round(rainChance)}% rain chance.${safetyText}`;

  dom.weatherCards.innerHTML = `
    <article class="weather-chip"><span>${weatherEmoji(weather.current.weather_code)}</span><div><small>Temperature</small><strong>${Math.round(weather.current.temperature_2m)}°F</strong></div></article>
    <article class="weather-chip"><span>💨</span><div><small>Wind / gusts</small><strong>${Math.round(weather.current.wind_speed_10m)} / ${Math.round(weather.current.wind_gusts_10m)} mph</strong></div></article>
    <article class="weather-chip"><span>☔</span><div><small>Rain chance</small><strong>${Math.round(rainChance)}%</strong></div></article>
    <article class="weather-chip"><span>🧭</span><div><small>Pressure</small><strong>${Math.round(weather.current.pressure_msl)} hPa</strong></div></article>`;

  const moon = moonPhase(new Date());
  dom.moonBadge.textContent = `${moon.emoji} Moon: ${moon.name}`;
  renderBiteWindows(weather);
  renderForecast(weather);
}

function getHourlyScores(weather, startIndex = findHourlyIndex(weather), count = 30) {
  const end = Math.min(weather.hourly.time.length, startIndex + count);
  const scores = [];
  for (let index = startIndex; index < end; index += 1) {
    const dayIndex = Math.min(weather.daily.time.length - 1, Math.floor(index / 24));
    const previousPressure = weather.hourly.pressure_msl[Math.max(0, index - 3)] ?? weather.hourly.pressure_msl[index];
    const result = calculateHourScore({
      wind: weather.hourly.wind_speed_10m[index],
      gust: weather.hourly.wind_gusts_10m[index],
      pressure: weather.hourly.pressure_msl[index],
      pressureTrend: weather.hourly.pressure_msl[index] - previousPressure,
      rainChance: weather.hourly.precipitation_probability[index],
      cloud: weather.hourly.cloud_cover[index],
      weatherCode: weather.hourly.weather_code[index],
      temperature: weather.hourly.temperature_2m[index],
      hourTime: weather.hourly.time[index],
      sunrise: weather.daily.sunrise[dayIndex],
      sunset: weather.daily.sunset[dayIndex]
    });
    scores.push({ index, time: weather.hourly.time[index], ...result });
  }
  return scores;
}

function renderBiteWindows(weather) {
  const scores = getHourlyScores(weather, findHourlyIndex(weather), 30);
  const sunrise = new Date(weather.daily.sunrise[0]);
  const sunset = new Date(weather.daily.sunset[0]);
  const morning = {
    label: "Morning",
    emoji: "🌅",
    start: new Date(sunrise.getTime() - 60 * 60000),
    end: new Date(sunrise.getTime() + 90 * 60000)
  };
  const evening = {
    label: "Evening",
    emoji: "🌇",
    start: new Date(sunset.getTime() - 90 * 60000),
    end: new Date(sunset.getTime() + 60 * 60000)
  };
  const blockedHours = [sunrise.getHours(), sunset.getHours()];
  const bonus = scores
    .filter((entry) => blockedHours.every((hour) => Math.abs(new Date(entry.time).getHours() - hour) > 2))
    .sort((a, b) => b.score - a.score)[0] || scores[0];
  const windows = [
    { ...morning, score: averageScoresBetween(scores, morning.start, morning.end) },
    { label: "Bonus window", emoji: "☀️", start: new Date(bonus.time), end: new Date(new Date(bonus.time).getTime() + 2 * 3600000), score: bonus.score },
    { ...evening, score: averageScoresBetween(scores, evening.start, evening.end) }
  ];
  dom.biteWindows.innerHTML = windows.map((window) => `
    <article class="time-card cartoon-card">
      <span>${window.emoji}</span>
      <h3>${window.label}</h3>
      <p class="time-range">${formatTime(window.start)}–${formatTime(window.end)}</p>
      <p class="mini-score">Bite score: ${window.score}/100</p>
      <small>${window.score >= 70 ? "Pack the tackle box!" : window.score >= 52 ? "A solid family option." : "Keep expectations playful."}</small>
    </article>`).join("");
}

function averageScoresBetween(scores, start, end) {
  const values = scores.filter((entry) => {
    const time = new Date(entry.time);
    return time >= start && time <= end;
  }).map((entry) => entry.score);
  if (!values.length) return 55;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function renderForecast(weather) {
  dom.forecastCards.innerHTML = weather.daily.time.map((date, index) => {
    const dayName = index === 0 ? "Today" : new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(`${date}T12:00`));
    const approximateScore = dailyScore(weather, index);
    return `<article class="forecast-card">
      <strong>${dayName}</strong>
      <span>${weatherEmoji(weather.daily.weather_code[index])}</span>
      <p>${Math.round(weather.daily.temperature_2m_max[index])}° / ${Math.round(weather.daily.temperature_2m_min[index])}°</p>
      <small>Rain ${Math.round(weather.daily.precipitation_probability_max[index])}%</small>
      <span class="day-score">🎣 ${approximateScore}/100</span>
    </article>`;
  }).join("");
}

function dailyScore(weather, dayIndex) {
  let score = 60;
  const wind = weather.daily.wind_speed_10m_max[dayIndex];
  const gust = weather.daily.wind_gusts_10m_max[dayIndex];
  const rain = weather.daily.precipitation_probability_max[dayIndex];
  const code = weather.daily.weather_code[dayIndex];
  if (wind <= 12) score += 12;
  else if (wind > 22) score -= 18;
  if (gust > 30) score -= 8;
  if (rain >= 15 && rain <= 55) score += 4;
  if (rain > 75) score -= 8;
  if (code >= 95) score -= 35;
  return Math.max(12, Math.min(92, Math.round(score)));
}

function overpassElementPoint(element) {
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const radius = 3958.8;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchOverpass(query) {
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 14000);
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`Map service returned ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Map service unavailable");
}

function buildSpotQuery(latitude, longitude) {
  return `[out:json][timeout:18];(
    nwr(around:25000,${latitude},${longitude})["leisure"="fishing"];
    nwr(around:25000,${latitude},${longitude})["man_made"="pier"]["fishing"!="no"];
    nwr(around:25000,${latitude},${longitude})["leisure"="marina"];
    nwr(around:18000,${latitude},${longitude})["natural"="water"]["name"];
    nwr(around:18000,${latitude},${longitude})["waterway"~"river|stream|canal"]["name"];
  );out center 80;`;
}

function buildShopQuery(latitude, longitude) {
  return `[out:json][timeout:18];(
    nwr(around:35000,${latitude},${longitude})["shop"="fishing"];
    nwr(around:25000,${latitude},${longitude})["shop"="outdoor"];
    nwr(around:25000,${latitude},${longitude})["shop"="sports"]["sport"~"fishing",i];
    nwr(around:25000,${latitude},${longitude})["amenity"="vending_machine"]["vending"~"fishing_bait|fishing_tackle",i];
  );out center 60;`;
}

function normalizePlaces(elements, type, location) {
  const seen = new Set();
  return elements.map((element) => {
    const point = overpassElementPoint(element);
    if (!point) return null;
    const tags = element.tags || {};
    const name = tags.name || (type === "shop" ? "Fishing supply stop" : tags.leisure === "marina" ? "Local marina" : tags.natural === "water" ? "Named water" : "Fishing place");
    const key = `${name.toLowerCase()}-${point.latitude.toFixed(4)}-${point.longitude.toFixed(4)}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return {
      id: `${element.type}-${element.id}`,
      type,
      name,
      latitude: point.latitude,
      longitude: point.longitude,
      distance: haversineMiles(location.latitude, location.longitude, point.latitude, point.longitude),
      details: type === "shop"
        ? (tags.shop === "fishing" ? "Fishing and tackle shop" : tags.shop === "outdoor" ? "Outdoor supply shop" : "Fishing supplies")
        : (tags.leisure === "fishing" ? "Mapped fishing area" : tags.leisure === "marina" ? "Marina or boat access" : tags.man_made === "pier" ? "Pier" : tags.waterway ? "River or stream" : "Lake or water area"),
      tags
    };
  }).filter(Boolean).sort((a, b) => a.distance - b.distance);
}

async function loadNearby(location) {
  state.spots = [];
  state.shops = [];
  renderNearbyList();
  clearMapPlaces();

  const [spotResult, shopResult] = await Promise.allSettled([
    fetchOverpass(buildSpotQuery(location.latitude, location.longitude)),
    fetchOverpass(buildShopQuery(location.latitude, location.longitude))
  ]);

  if (spotResult.status === "fulfilled") state.spots = normalizePlaces(spotResult.value.elements || [], "spot", location).slice(0, 28);
  if (shopResult.status === "fulfilled") state.shops = normalizePlaces(shopResult.value.elements || [], "shop", location).slice(0, 20);

  addPlacesToMap();
  renderNearbyList();

  if (spotResult.status === "rejected" && shopResult.status === "rejected") {
    setStatus("Weather is ready, but the community map service is busy. Try the map again later.", "warning");
  }
}

function clearMapPlaces() {
  state.spotLayer?.clearLayers();
  state.shopLayer?.clearLayers();
}

function addPlacesToMap() {
  if (!state.map) return;
  state.spots.forEach((place) => addPlaceMarker(place, state.spotLayer, "spot", "🐠"));
  state.shops.forEach((place) => addPlaceMarker(place, state.shopLayer, "shop", "🪱"));
}

function addPlaceMarker(place, layer, type, emoji) {
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;
  const popup = `<strong>${cleanText(place.name)}</strong><br>${cleanText(place.details)} · ${place.distance.toFixed(1)} mi<br><a href="${mapsUrl}" target="_blank" rel="noopener">Directions</a>`;
  L.marker([place.latitude, place.longitude], { icon: markerIcon(type, emoji) }).bindPopup(popup).addTo(layer);
}

function renderNearbyList() {
  const places = state.activeNearbyTab === "spots" ? state.spots : state.shops;
  const emptyMessage = state.location
    ? (state.activeNearbyTab === "spots" ? "No mapped fishing places appeared nearby. Zoom the map and explore named water." : "No specialty supply shops appeared nearby. Try searching maps for bait and tackle.")
    : "Choose a location to find nearby places.";
  if (!places.length) {
    dom.nearbyList.innerHTML = `<div class="empty-state"><span>${state.activeNearbyTab === "spots" ? "🐠" : "🪱"}</span><p>${emptyMessage}</p></div>`;
    return;
  }
  dom.nearbyList.innerHTML = places.slice(0, 15).map((place, index) => {
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;
    return `<article class="nearby-item">
      <h3>${index + 1}. ${cleanText(place.name)}</h3>
      <p>${cleanText(place.details)} · ${place.distance.toFixed(1)} miles away</p>
      <button type="button" data-focus-place="${cleanText(place.id)}">Show on map</button>
      <a href="${mapsUrl}" target="_blank" rel="noopener">Directions</a>
    </article>`;
  }).join("");
  dom.nearbyList.querySelectorAll("[data-focus-place]").forEach((button) => {
    button.addEventListener("click", () => focusPlace(button.dataset.focusPlace));
  });
}

function focusPlace(id) {
  const place = [...state.spots, ...state.shops].find((item) => item.id === id);
  if (!place || !state.map) return;
  state.map.setView([place.latitude, place.longitude], 14);
  window.scrollTo({ top: document.querySelector("#map").getBoundingClientRect().top + window.scrollY - 90, behavior: "smooth" });
}

function updateLocationMap(location) {
  if (!state.map) return;
  state.map.setView([location.latitude, location.longitude], 11);
  if (state.userMarker) state.userMarker.remove();
  state.userMarker = L.marker([location.latitude, location.longitude], { icon: markerIcon("user", "📍") })
    .bindPopup(`<strong>${cleanText(locationName(location))}</strong><br>Your search center`)
    .addTo(state.map);
}

async function selectLocation(location) {
  state.location = {
    name: location.name,
    admin1: location.admin1,
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    timezone: location.timezone || null,
    country_code: location.country_code || "US"
  };
  localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(state.location));
  dom.searchResults.classList.add("hidden");
  dom.locationSearch.value = locationName(state.location);
  dom.locationBadge.textContent = `📍 ${locationName(state.location)}`;
  dom.favoriteButton.disabled = false;
  updateFavoriteButton();
  updateLocationMap(state.location);
  setStatus("Finn is checking the weather and nearby map…");

  try {
    const weather = await fetchWeather(state.location);
    state.weather = weather;
    renderCurrentReport(weather);
    setStatus(`Report ready for ${locationName(state.location)}. Nearby places are still loading…`, "success");
  } catch (error) {
    console.error(error);
    setStatus("The weather service did not answer. Please try again in a moment.", "error");
    return;
  }

  try {
    await loadNearby(state.location);
    setStatus(`Adventure report ready for ${locationName(state.location)}!`, "success");
  } catch (error) {
    console.error(error);
  }
}

function setNearbyTab(tab) {
  state.activeNearbyTab = tab;
  const spotsActive = tab === "spots";
  dom.spotsTab.classList.toggle("active", spotsActive);
  dom.shopsTab.classList.toggle("active", !spotsActive);
  dom.spotsTab.setAttribute("aria-selected", String(spotsActive));
  dom.shopsTab.setAttribute("aria-selected", String(!spotsActive));
  renderNearbyList();
}

function setMapFilter(filter) {
  [dom.showAllButton, dom.showSpotsButton, dom.showShopsButton].forEach((button) => button.classList.remove("active"));
  if (filter === "all") {
    dom.showAllButton.classList.add("active");
    if (state.map && state.spotLayer && !state.map.hasLayer(state.spotLayer)) state.map.addLayer(state.spotLayer);
    if (state.map && state.shopLayer && !state.map.hasLayer(state.shopLayer)) state.map.addLayer(state.shopLayer);
  } else if (filter === "spots") {
    dom.showSpotsButton.classList.add("active");
    if (state.map && state.spotLayer && !state.map.hasLayer(state.spotLayer)) state.map.addLayer(state.spotLayer);
    if (state.map && state.shopLayer && state.map.hasLayer(state.shopLayer)) state.map.removeLayer(state.shopLayer);
  } else {
    dom.showShopsButton.classList.add("active");
    if (state.map && state.shopLayer && !state.map.hasLayer(state.shopLayer)) state.map.addLayer(state.shopLayer);
    if (state.map && state.spotLayer && state.map.hasLayer(state.spotLayer)) state.map.removeLayer(state.spotLayer);
  }
}

function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"); }
  catch { return []; }
}

function saveFavorites(favorites) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  renderFavorites();
  updateFavoriteButton();
}

function isCurrentFavorite() {
  if (!state.location) return false;
  return getFavorites().some((item) => Math.abs(item.latitude - state.location.latitude) < 0.001 && Math.abs(item.longitude - state.location.longitude) < 0.001);
}

function toggleFavorite() {
  if (!state.location) return;
  const favorites = getFavorites();
  const index = favorites.findIndex((item) => Math.abs(item.latitude - state.location.latitude) < 0.001 && Math.abs(item.longitude - state.location.longitude) < 0.001);
  if (index >= 0) favorites.splice(index, 1);
  else favorites.push(state.location);
  saveFavorites(favorites.slice(-8));
}

function updateFavoriteButton() {
  if (!state.location) return;
  dom.favoriteButton.textContent = isCurrentFavorite() ? "★ Saved spot" : "☆ Save this spot";
}

function renderFavorites() {
  const favorites = getFavorites();
  if (!favorites.length) {
    dom.favoritesList.innerHTML = '<p class="helper-text">Save a location and it will appear here on this device.</p>';
    return;
  }
  dom.favoritesList.innerHTML = favorites.map((favorite, index) => `
    <span class="favorite-pill">
      <button type="button" data-load-favorite="${index}">🎣 ${cleanText(locationName(favorite))}</button>
      <button type="button" data-remove-favorite="${index}" aria-label="Remove ${cleanText(locationName(favorite))}">✕</button>
    </span>`).join("");
  dom.favoritesList.querySelectorAll("[data-load-favorite]").forEach((button) => {
    button.addEventListener("click", () => selectLocation(favorites[Number(button.dataset.loadFavorite)]));
  });
  dom.favoritesList.querySelectorAll("[data-remove-favorite]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = getFavorites();
      next.splice(Number(button.dataset.removeFavorite), 1);
      saveFavorites(next);
    });
  });
}

function registerPwa() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.warn));
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    dom.installButton.classList.remove("hidden");
  });
  dom.installButton.addEventListener("click", async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    dom.installButton.classList.add("hidden");
  });
}

dom.searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = dom.locationSearch.value.trim();
  if (query.length < 2) {
    setStatus("Type a city, state, or ZIP code first.", "warning");
    return;
  }
  setStatus("Searching across the USA…");
  dom.searchResults.classList.add("hidden");
  try {
    const results = await searchLocations(query);
    renderSearchResults(results);
    setStatus(results.length ? "Tap the location that looks right." : "No matches yet—try adding a state.");
  } catch (error) {
    console.error(error);
    setStatus("Location search is taking a break. Please try again.", "error");
  }
});

dom.locationButton.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus("This browser cannot share its location. Search by city or ZIP instead.", "warning");
    return;
  }
  setStatus("Asking your device for its location…");
  navigator.geolocation.getCurrentPosition(async (position) => {
    const location = await reverseGeocode(position.coords.latitude, position.coords.longitude);
    selectLocation(location);
  }, (error) => {
    console.warn(error);
    setStatus("Location permission was not available. Search by city or ZIP instead.", "warning");
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 });
});

dom.favoriteButton.addEventListener("click", toggleFavorite);
dom.spotsTab.addEventListener("click", () => setNearbyTab("spots"));
dom.shopsTab.addEventListener("click", () => setNearbyTab("shops"));
dom.showAllButton.addEventListener("click", () => setMapFilter("all"));
dom.showSpotsButton.addEventListener("click", () => setMapFilter("spots"));
dom.showShopsButton.addEventListener("click", () => setMapFilter("shops"));

initMap();
renderFavorites();
registerPwa();

const lastLocation = (() => {
  try { return JSON.parse(localStorage.getItem(LAST_LOCATION_KEY) || "null"); }
  catch { return null; }
})();
if (lastLocation?.latitude && lastLocation?.longitude) {
  selectLocation(lastLocation);
}
