"use strict";

// Resilient nearby search patch: one broader Overpass request, backup servers,
// richer fishing tags, useful retries, and a map-search fallback.
OVERPASS_ENDPOINTS.splice(0, OVERPASS_ENDPOINTS.length,
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
);
state.nearbyLoading = false;
state.nearbyError = null;

const nearbyPatchStyle = document.createElement("style");
nearbyPatchStyle.textContent = `
.empty-state .secondary-button{justify-self:center;margin-top:.75rem}
.external-search-link{display:inline-block;justify-self:center;margin-top:.75rem;padding:.62rem .85rem;border:2px solid var(--ink);border-radius:12px;background:#fff;color:var(--ink);font-weight:900;text-decoration:none;box-shadow:0 4px 0 rgba(23,50,77,.22)}
.list-search-link{display:block;text-align:center;margin:.8rem .15rem .2rem}
.loading-fish{display:inline-block;animation:fish-swim 1.2s ease-in-out infinite alternate}
@keyframes fish-swim{from{transform:translateX(-14px) rotate(-4deg)}to{transform:translateX(14px) rotate(4deg)}}
`;
document.head.appendChild(nearbyPatchStyle);

fetchOverpass = async function fetchOverpassPatched(query) {
  let lastError = null;
  const body = new URLSearchParams({ data: query }).toString();

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 26000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body,
        signal: controller.signal,
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Map service returned ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.elements)) throw new Error("Map service returned an incomplete response");
      return data;
    } catch (error) {
      lastError = error;
      console.warn(`Nearby search failed at ${endpoint}`, error);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("Map service unavailable");
};

function buildNearbyQueryPatched(latitude, longitude) {
  return `[out:json][timeout:25];(
    nwr(around:50000,${latitude},${longitude})["leisure"="fishing"];
    nwr(around:50000,${latitude},${longitude})["fishing"~"yes|designated|permissive",i];
    nwr(around:50000,${latitude},${longitude})["man_made"="fishing_peg"];
    nwr(around:50000,${latitude},${longitude})["man_made"="pier"]["fishing"!="no"];
    nwr(around:50000,${latitude},${longitude})["leisure"="marina"];
    nwr(around:50000,${latitude},${longitude})["leisure"="slipway"];
    nwr(around:42000,${latitude},${longitude})["natural"="water"]["name"];
    nwr(around:42000,${latitude},${longitude})["water"~"lake|reservoir|pond|basin",i]["name"];
    nwr(around:42000,${latitude},${longitude})["waterway"~"river|stream|canal",i]["name"];
    nwr(around:65000,${latitude},${longitude})["shop"="fishing"];
    nwr(around:50000,${latitude},${longitude})["shop"="outdoor"];
    nwr(around:50000,${latitude},${longitude})["shop"="sports"]["sport"~"fishing",i];
    nwr(around:65000,${latitude},${longitude})["shop"]["name"~"bait|tackle|fishing|outdoor|bass pro|cabela|academy sports|sporting goods",i];
    nwr(around:65000,${latitude},${longitude})["amenity"="outfitter"]["fishing"~"yes|only",i];
    nwr(around:50000,${latitude},${longitude})["amenity"="vending_machine"]["vending"~"fishing_bait|fishing_tackle",i];
  );out center 240;`;
}

function isSupplyPlacePatched(element) {
  const tags = element.tags || {};
  return Boolean(
    tags.shop === "fishing" ||
    tags.shop === "outdoor" ||
    (tags.shop === "sports" && /fishing/i.test(tags.sport || "")) ||
    (tags.shop && /bait|tackle|fishing|outdoor|bass pro|cabela|academy sports|sporting goods/i.test(tags.name || "")) ||
    (tags.amenity === "outfitter" && /yes|only/i.test(tags.fishing || "")) ||
    (tags.amenity === "vending_machine" && /fishing_bait|fishing_tackle/i.test(tags.vending || ""))
  );
}

function fishingPlacePriorityPatched(tags) {
  if (tags.leisure === "fishing" || /yes|designated|permissive/i.test(tags.fishing || "")) return 0;
  if (tags.man_made === "fishing_peg" || tags.man_made === "pier") return 1;
  if (tags.leisure === "marina" || tags.leisure === "slipway") return 2;
  if (/lake|reservoir|pond|basin/i.test(tags.water || "") || tags.natural === "water") return 3;
  return 4;
}

normalizePlaces = function normalizePlacesPatched(elements, type, location) {
  const seen = new Set();
  return elements.map((element) => {
    const point = overpassElementPoint(element);
    if (!point) return null;
    const tags = element.tags || {};
    const supply = isSupplyPlacePatched(element);
    if ((type === "shop") !== supply) return null;

    let fallbackName = "Fishing place";
    if (type === "shop") fallbackName = tags.amenity === "vending_machine" ? "Bait vending machine" : "Fishing supply stop";
    else if (tags.man_made === "fishing_peg") fallbackName = "Fishing access";
    else if (tags.man_made === "pier") fallbackName = "Fishing pier";
    else if (tags.leisure === "slipway") fallbackName = "Boat ramp";
    else if (tags.leisure === "marina") fallbackName = "Local marina";
    else if (tags.natural === "water" || tags.water) fallbackName = "Nearby water";

    const name = tags.name || fallbackName;
    const key = `${name.toLowerCase()}-${point.latitude.toFixed(4)}-${point.longitude.toFixed(4)}`;
    if (seen.has(key)) return null;
    seen.add(key);

    let details;
    if (type === "shop") {
      details = tags.shop === "fishing" ? "Bait and tackle shop"
        : tags.amenity === "vending_machine" ? "Bait or tackle vending"
        : tags.amenity === "outfitter" ? "Fishing outfitter"
        : tags.shop === "outdoor" ? "Outdoor supply shop"
        : "Sporting goods and fishing supplies";
    } else {
      details = tags.leisure === "fishing" ? "Mapped fishing area"
        : /yes|designated|permissive/i.test(tags.fishing || "") ? "Fishing is mapped here"
        : tags.man_made === "fishing_peg" ? "Fishing access point"
        : tags.man_made === "pier" ? "Pier or fishing platform"
        : tags.leisure === "marina" ? "Marina or boat access"
        : tags.leisure === "slipway" ? "Boat ramp or launch"
        : tags.waterway ? "River, creek, or canal"
        : "Lake, reservoir, or pond";
    }

    const distance = haversineMiles(location.latitude, location.longitude, point.latitude, point.longitude);
    return {
      id: `${element.type}-${element.id}`,
      type,
      name,
      latitude: point.latitude,
      longitude: point.longitude,
      distance,
      rank: type === "spot" ? distance + fishingPlacePriorityPatched(tags) * 1.75 : distance,
      details,
      tags
    };
  }).filter(Boolean).sort((a, b) => a.rank - b.rank);
};

function fitNearbyPlacesPatched() {
  if (!state.map || !state.location) return;
  const nearby = [...state.spots, ...state.shops]
    .filter((place) => place.distance <= 25)
    .slice(0, 24);
  if (!nearby.length) return;
  const bounds = L.latLngBounds([
    [state.location.latitude, state.location.longitude],
    ...nearby.map((place) => [place.latitude, place.longitude])
  ]);
  state.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 11 });
}

loadNearby = async function loadNearbyPatched(location) {
  state.spots = [];
  state.shops = [];
  state.nearbyLoading = true;
  state.nearbyError = null;
  renderNearbyList();
  clearMapPlaces();

  try {
    const result = await fetchOverpass(buildNearbyQueryPatched(location.latitude, location.longitude));
    const elements = result.elements || [];
    state.spots = normalizePlaces(elements, "spot", location).slice(0, 35);
    state.shops = normalizePlaces(elements, "shop", location).slice(0, 25);
    addPlacesToMap();
    fitNearbyPlacesPatched();
    return state.spots.length + state.shops.length;
  } catch (error) {
    state.nearbyError = error;
    console.error(error);
    setTimeout(() => setStatus("Weather is ready. The community place search is busy, so use the wider map-search button below.", "warning"), 0);
    return 0;
  } finally {
    state.nearbyLoading = false;
    renderNearbyList();
  }
};

function nearbyMapsSearchUrlPatched(kind) {
  if (!state.location) return "#";
  const query = kind === "spots" ? "fishing spots and public fishing access" : "bait and tackle fishing supplies";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${query} near ${state.location.latitude},${state.location.longitude}`)}`;
}

renderNearbyList = function renderNearbyListPatched() {
  if (state.nearbyLoading) {
    dom.nearbyList.innerHTML = '<div class="empty-state"><span class="loading-fish">🐟</span><p>Finn is searching lakes, piers, boat ramps, and tackle shops…</p></div>';
    return;
  }

  const places = state.activeNearbyTab === "spots" ? state.spots : state.shops;
  if (!places.length) {
    const isSpots = state.activeNearbyTab === "spots";
    const message = state.nearbyError
      ? "The community map search is busy right now. Your weather report still works."
      : isSpots
        ? "No tagged places were returned here, even though nearby water may still allow fishing."
        : "No tagged supply shops were returned in this search.";
    dom.nearbyList.innerHTML = `<div class="empty-state">
      <span>${isSpots ? "🐠" : "🪱"}</span>
      <p>${message}</p>
      <button class="secondary-button" type="button" data-retry-nearby>🔄 Search nearby again</button>
      <a class="external-search-link" href="${nearbyMapsSearchUrlPatched(state.activeNearbyTab)}" target="_blank" rel="noopener">Open a wider map search</a>
    </div>`;
    dom.nearbyList.querySelector("[data-retry-nearby]")?.addEventListener("click", async () => {
      if (!state.location) return;
      setStatus("Searching nearby places again…");
      const count = await loadNearby(state.location);
      setStatus(count ? `Found ${state.spots.length} fishing places and ${state.shops.length} supply stops.` : "Nearby search is still unavailable. Try the wider map search.", count ? "success" : "warning");
    });
    return;
  }

  dom.nearbyList.innerHTML = places.slice(0, 18).map((place, index) => {
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;
    const access = place.tags.access && place.tags.access !== "yes" ? ` · Access: ${cleanText(place.tags.access)}` : "";
    return `<article class="nearby-item">
      <h3>${index + 1}. ${cleanText(place.name)}</h3>
      <p>${cleanText(place.details)} · ${place.distance.toFixed(1)} miles away${access}</p>
      <button type="button" data-focus-place="${cleanText(place.id)}">Show on map</button>
      <a href="${mapsUrl}" target="_blank" rel="noopener">Directions</a>
    </article>`;
  }).join("") + `<a class="external-search-link list-search-link" href="${nearbyMapsSearchUrlPatched(state.activeNearbyTab)}" target="_blank" rel="noopener">See even more in map search</a>`;

  dom.nearbyList.querySelectorAll("[data-focus-place]").forEach((button) => {
    button.addEventListener("click", () => focusPlace(button.dataset.focusPlace));
  });
};
