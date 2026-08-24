"use strict";

/* FishLocal Ask Finn AI
   - Uses live weather/map state already loaded by FishLocal.
   - Uses a small Hugging Face embedding model only to understand the user's intent
     and choose the most relevant fishing playbook.
   - Never invents live conditions: current facts come from Open-Meteo + the app's
     current OpenStreetMap results.
   - Falls back to a deterministic keyword matcher if the model cannot load.
*/

(() => {
  const HF_IMPORT = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";
  const MODEL_CANDIDATES = ["Xenova/bge-small-en-v1.5", "Xenova/all-MiniLM-L6-v2"];
  const PLAYBOOK = [
    {
      title: "Largemouth bass",
      text: "largemouth bass bass pond lake reservoir weeds grass docks timber shade points creek channel structure spinnerbait chatterbait plastic worm senko jig topwater crankbait",
      bait: "Start with a Texas-rigged worm or weightless stick bait around cover. Add a moving bait if wind puts a ripple on the water.",
      location: "Prioritize shade, grass edges, docks, points, laydowns, and transitions from shallow to deeper water."
    },
    {
      title: "Catfish",
      text: "catfish channel cat blue cat flathead bank fishing river lake reservoir creek channel deep hole current bait cut bait shad chicken liver stink bait circle hook",
      bait: "Use a simple bottom rig with a circle hook and fresh cut bait, prepared bait, or another legal local favorite.",
      location: "Look for creek channels, deeper holes, current seams, wind-blown banks, and areas where food collects."
    },
    {
      title: "Crappie",
      text: "crappie slabs panfish brush pile timber docks bridge pilings minnows jigs small jig vertical fishing suspended fish spring fall",
      bait: "Try a small jig or minnow and change depth before changing spots. Slow presentations usually beat constant movement.",
      location: "Target brush, standing timber, docks, bridge pilings, and depth changes close to cover."
    },
    {
      title: "Bluegill / sunfish",
      text: "bluegill sunfish bream panfish kids family easy fishing bobber worm nightcrawler small hook dock bank shallow cover",
      bait: "Use a small hook, a tiny piece of worm, and a bobber. Keep the bait compact so small fish can take it cleanly.",
      location: "Fish close to docks, shade, reeds, rocks, and other shallow cover where kids can cast safely."
    },
    {
      title: "Trout",
      text: "trout rainbow brown stocked stream river lake cold water inline spinner spoon powerbait salmon eggs fly current seam pool riffle",
      bait: "For stocked water, try a small spinner, spoon, or legal scented bait. In moving water, work current seams and pool edges.",
      location: "Favor cooler water, current breaks, deeper pools, shade, and areas near stocking/access points when applicable."
    },
    {
      title: "Family / anything biting",
      text: "family kids beginner easy catch anything biting simple bank fishing fun nearby safe bobber worm small hook panfish catfish",
      bait: "Keep it simple: one rod with a bobber and small worm for panfish, plus one bottom rig if catfish are possible.",
      location: "Choose easy bank access, visible cover, a pier, or a calm protected shoreline before chasing a perfect species spot."
    },
    {
      title: "Windy-day adjustment",
      text: "wind windy gust strong wind rough water protected cove bank safety casting difficult",
      bait: "Use slightly heavier tackle so you can feel the lure or bait, and slow down if wave action makes bite detection harder.",
      location: "Pick a protected bank or cove. If conditions feel unsafe, skip the water and use the forecast to plan the next window."
    },
    {
      title: "Rain / changing pressure",
      text: "rain storm pressure falling pressure clouds cloudy front overcast precipitation drizzle before storm after storm",
      bait: "Before a safe light-rain period or gentle pressure drop, try moving baits first; after a hard front, slow down and fish tighter to cover.",
      location: "Focus on runoff edges only when safe, wind-blown food zones, and nearby cover. Never fish through lightning."
    }
  ];

  let embedder = null;
  let loading = null;
  let activeModel = null;

  function escapeAI(value = "") {
    return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function installUI() {
    if (document.querySelector("#askFinnAI")) return;
    const anchor = document.querySelector(".times-zone") || document.querySelector(".report-zone");
    if (!anchor) return;
    const section = document.createElement("section");
    section.id = "askFinnAI";
    section.className = "ai-coach-zone section-shell";
    section.innerHTML = `
      <div class="section-heading">
        <div><p class="eyebrow">Hugging Face • grounded AI</p><h2>Ask Finn AI</h2></div>
        <span class="ai-live-badge" id="finnAiBadge">Live-data coach</span>
      </div>
      <article class="ai-coach-card cartoon-card">
        <div class="ai-coach-copy">
          <h3>Tell Finn what you want to catch or how you want to fish.</h3>
          <p>Finn combines your question with the live forecast, bite windows, and nearby places already loaded in FishLocal. The model chooses tactics; it does not make up current weather or map facts.</p>
        </div>
        <div class="ai-query-row">
          <textarea id="finnAiQuestion" rows="3" maxlength="320" placeholder="Examples: What should we throw for bass after work? • Best easy plan for kids? • It is windy — where should I start?"></textarea>
          <button id="finnAiAsk" class="primary-button" type="button">✨ Build my plan</button>
        </div>
        <div id="finnAiStatus" class="ai-coach-status" role="status">Choose a location first so the answer can use current conditions.</div>
        <div id="finnAiAnswer" class="ai-coach-answer" hidden></div>
      </article>`;
    anchor.insertAdjacentElement("afterend", section);
    document.querySelector("#finnAiAsk")?.addEventListener("click", runCoach);
  }

  function currentSnapshot() {
    if (!state?.location || !state?.weather) return null;
    const weather = state.weather;
    const score = calculateCurrentScore(weather);
    const hourly = getHourlyScores(weather, findHourlyIndex(weather), 30)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const index = findHourlyIndex(weather);
    const rain = weather.hourly.precipitation_probability[index] ?? 0;
    const spots = (state.spots || []).slice(0, 5);
    return {
      location: locationName(state.location),
      score: score.score,
      scoreReasons: score.reasons || [],
      temp: Math.round(weather.current.temperature_2m),
      wind: Math.round(weather.current.wind_speed_10m),
      gust: Math.round(weather.current.wind_gusts_10m),
      pressure: Math.round(weather.current.pressure_msl),
      rain: Math.round(rain),
      weatherCode: weather.current.weather_code,
      observedAt: weather.current.time,
      topHours: hourly,
      spots
    };
  }

  async function ensureEmbedder(status) {
    if (embedder) return embedder;
    if (loading) return loading;
    loading = (async () => {
      status.textContent = "Loading lightweight Hugging Face AI… first use downloads the model.";
      const { pipeline, env } = await import(HF_IMPORT);
      if (env) {
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;
      }
      let lastError = null;
      for (const model of MODEL_CANDIDATES) {
        try {
          const pipe = await pipeline("feature-extraction", model, { dtype: "q8" });
          await pipe("family fishing", { pooling: "mean", normalize: true });
          embedder = pipe;
          activeModel = model;
          return pipe;
        } catch (error) {
          lastError = error;
          try { await embedder?.dispose?.(); } catch {}
          embedder = null;
        }
      }
      throw lastError || new Error("No local embedding model loaded");
    })().finally(() => { loading = null; });
    return loading;
  }

  function dot(a, b) {
    let total = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) total += a[i] * b[i];
    return total;
  }

  function lexicalRank(query) {
    const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 2);
    return PLAYBOOK.map(item => {
      const hay = `${item.title} ${item.text}`.toLowerCase();
      const score = terms.reduce((n, term) => n + (hay.includes(term) ? 1 : 0), 0) / Math.max(1, terms.length);
      return { item, score };
    }).sort((a, b) => b.score - a.score);
  }

  async function semanticRank(query, status) {
    const pipe = await ensureEmbedder(status);
    const texts = [query, ...PLAYBOOK.map(item => `${item.title}. ${item.text}`)];
    const out = await pipe(texts, { pooling: "mean", normalize: true });
    const rows = out.tolist();
    return PLAYBOOK.map((item, i) => ({ item, score: dot(rows[0], rows[i + 1]) })).sort((a, b) => b.score - a.score);
  }

  function weatherAdjustment(snapshot) {
    const notes = [];
    if (snapshot.weatherCode >= 95) notes.push("Thunderstorms are possible: do not fish during lightning or unsafe storms.");
    if (snapshot.wind >= 18 || snapshot.gust >= 28) notes.push("Wind is strong enough that a protected bank/cove is the smarter starting point.");
    else if (snapshot.wind >= 7) notes.push("The breeze can help break up the surface; a moving bait is worth trying before slowing down.");
    else notes.push("Wind is light, so quieter presentations and shade/cover may matter more.");
    if (snapshot.rain >= 65) notes.push("Rain odds are high; keep a dry backup plan and watch radar/alerts before leaving.");
    if (snapshot.temp >= 88) notes.push("It is hot: favor early/late windows, shade, deeper nearby water, hydration, and short family sessions.");
    return notes;
  }

  function renderPlan(query, snapshot, ranked, mode) {
    const best = ranked[0]?.item || PLAYBOOK[5];
    const second = ranked[1]?.item;
    const weatherNotes = weatherAdjustment(snapshot);
    const bestHours = snapshot.topHours.map(h => `${formatTime(h.time)} (${h.score}/100)`).join(", ");
    const spotHtml = snapshot.spots.length
      ? `<ol>${snapshot.spots.slice(0, 3).map(place => `<li><strong>${escapeAI(place.name)}</strong> — ${place.distance.toFixed(1)} mi • ${escapeAI(place.details)}</li>`).join("")}</ol>`
      : `<p>No mapped fishing places have loaded yet. Use the map to choose accessible named water and confirm legal access.</p>`;
    const sourceTime = (() => {
      try { return new Date(snapshot.observedAt).toLocaleString(); } catch { return snapshot.observedAt; }
    })();

    return `
      <div class="ai-plan-head"><div><span class="ai-live-badge">${escapeAI(mode)}</span><h3>${escapeAI(best.title)} plan</h3></div><strong>${snapshot.score}/100 bite score</strong></div>
      <p><strong>Your question:</strong> ${escapeAI(query)}</p>
      <div class="ai-plan-grid">
        <div><h4>🎣 Start with</h4><p>${escapeAI(best.bait)}</p></div>
        <div><h4>📍 Look for</h4><p>${escapeAI(best.location)}</p></div>
      </div>
      ${second ? `<p class="ai-small">Backup pattern: <strong>${escapeAI(second.title)}</strong>.</p>` : ""}
      <h4>⏰ Best upcoming windows</h4><p>${escapeAI(bestHours || "Use the bite windows above.")}</p>
      <h4>🌦️ Live adjustment</h4><ul>${weatherNotes.map(note => `<li>${escapeAI(note)}</li>`).join("")}</ul>
      <h4>🗺️ Closest mapped options</h4>${spotHtml}
      <div class="ai-grounding"><strong>Grounded facts:</strong> ${escapeAI(snapshot.location)} • ${snapshot.temp}°F • wind ${snapshot.wind} mph, gusts ${snapshot.gust} • rain ${snapshot.rain}% • pressure ${snapshot.pressure} hPa. Forecast timestamp: ${escapeAI(sourceTime)}. Map results are current to this app session and may be incomplete.</div>`;
  }

  async function runCoach() {
    const question = String(document.querySelector("#finnAiQuestion")?.value || "").trim();
    const status = document.querySelector("#finnAiStatus");
    const answer = document.querySelector("#finnAiAnswer");
    const button = document.querySelector("#finnAiAsk");
    const snapshot = currentSnapshot();
    if (!snapshot) {
      status.textContent = "Choose a location first. Finn needs the live forecast before building a grounded plan.";
      answer.hidden = true;
      return;
    }
    if (question.length < 3) {
      status.textContent = "Ask what you want to catch, who is fishing, or what conditions you are worried about.";
      return;
    }

    button.disabled = true;
    answer.hidden = true;
    let ranked;
    let mode = "AI semantic match";
    try {
      ranked = await semanticRank(`${question}. Current conditions: ${snapshot.temp} F, wind ${snapshot.wind} mph, rain ${snapshot.rain} percent.`, status);
      status.textContent = `AI ready • ${activeModel}`;
    } catch (error) {
      console.warn("Ask Finn AI unavailable; using offline playbook matcher.", error);
      ranked = lexicalRank(question);
      mode = "Offline smart fallback";
      status.textContent = "Hugging Face AI could not load, so Finn used the built-in fishing playbook with the same live weather.";
    } finally {
      button.disabled = false;
    }

    answer.innerHTML = renderPlan(question, snapshot, ranked, mode);
    answer.hidden = false;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installUI, { once: true });
  else installUI();
})();
