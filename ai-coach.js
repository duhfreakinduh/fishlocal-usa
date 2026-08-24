"use strict";

/* FishLocal Ask Finn AI — reliability-first v2
   Live facts always come from FishLocal/Open-Meteo/OpenStreetMap.
   A local Hugging Face embedding model improves intent matching when it is ready.
   The user never waits on the model: a grounded built-in answer renders instantly.
*/

(() => {
  const HF_IMPORT = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";
  const MODEL_CANDIDATES = ["Xenova/bge-small-en-v1.5", "Xenova/all-MiniLM-L6-v2"];
  const AI_WAIT_MS = 15000;
  const PLAYBOOK = [
    { title:"Largemouth bass", text:"largemouth bass bass pond lake reservoir weeds grass docks timber shade points creek channel structure spinnerbait chatterbait plastic worm senko jig topwater crankbait", bait:"Start with a Texas-rigged worm or weightless stick bait around cover. Add a moving bait if wind puts a ripple on the water.", location:"Prioritize shade, grass edges, docks, points, laydowns, and transitions from shallow to deeper water." },
    { title:"Catfish", text:"catfish channel cat blue cat flathead bank fishing river lake reservoir creek channel deep hole current bait cut bait shad chicken liver stink bait circle hook", bait:"Use a simple bottom rig with a circle hook and fresh cut bait, prepared bait, or another legal local favorite.", location:"Look for creek channels, deeper holes, current seams, wind-blown banks, and areas where food collects." },
    { title:"Crappie", text:"crappie slabs panfish brush pile timber docks bridge pilings minnows jigs small jig vertical fishing suspended fish spring fall", bait:"Try a small jig or minnow and change depth before changing spots. Slow presentations usually beat constant movement.", location:"Target brush, standing timber, docks, bridge pilings, and depth changes close to cover." },
    { title:"Bluegill / sunfish", text:"bluegill sunfish bream panfish kids family easy fishing bobber worm nightcrawler small hook dock bank shallow cover", bait:"Use a small hook, a tiny piece of worm, and a bobber. Keep the bait compact so small fish can take it cleanly.", location:"Fish close to docks, shade, reeds, rocks, and other shallow cover where kids can cast safely." },
    { title:"Trout", text:"trout rainbow brown stocked stream river lake cold water inline spinner spoon powerbait salmon eggs fly current seam pool riffle", bait:"For stocked water, try a small spinner, spoon, or legal scented bait. In moving water, work current seams and pool edges.", location:"Favor cooler water, current breaks, deeper pools, shade, and areas near stocking/access points when applicable." },
    { title:"Family / anything biting", text:"family kids beginner easy catch anything biting simple bank fishing fun nearby safe bobber worm small hook panfish catfish", bait:"Keep it simple: one rod with a bobber and small worm for panfish, plus one bottom rig if catfish are possible.", location:"Choose easy bank access, visible cover, a pier, or a calm protected shoreline before chasing a perfect species spot." },
    { title:"Windy-day adjustment", text:"wind windy gust strong wind rough water protected cove bank safety casting difficult", bait:"Use slightly heavier tackle so you can feel the lure or bait, and slow down if wave action makes bite detection harder.", location:"Pick a protected bank or cove. If conditions feel unsafe, skip the water and use the forecast to plan the next window." },
    { title:"Rain / changing pressure", text:"rain storm pressure falling pressure clouds cloudy front overcast precipitation drizzle before storm after storm", bait:"Before a safe light-rain period or gentle pressure drop, try moving baits first; after a hard front, slow down and fish tighter to cover.", location:"Focus on runoff edges only when safe, wind-blown food zones, and nearby cover. Never fish through lightning." }
  ];

  let embedder = null;
  let loading = null;
  let activeModel = null;
  let requestId = 0;

  const esc = (value="") => String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const delayReject = (ms, message) => new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
  const waitFor = (promise, ms, message) => Promise.race([promise, delayReject(ms, message)]);

  function installUI() {
    if (document.querySelector("#askFinnAI")) return;
    const anchor = document.querySelector(".times-zone") || document.querySelector(".report-zone");
    if (!anchor) return;
    const section = document.createElement("section");
    section.id = "askFinnAI";
    section.className = "ai-coach-zone section-shell";
    section.innerHTML = `
      <div class="section-heading"><div><p class="eyebrow">Hugging Face • grounded AI</p><h2>Ask Finn AI</h2></div><span class="ai-live-badge" id="finnAiBadge">Instant + AI upgrade</span></div>
      <article class="ai-coach-card cartoon-card">
        <div class="ai-coach-copy"><h3>Tell Finn what you want to catch or how you want to fish.</h3><p>Finn answers immediately from live conditions, then improves the match with local Hugging Face AI when the model is ready.</p></div>
        <div class="ai-query-row"><textarea id="finnAiQuestion" rows="3" maxlength="320" placeholder="Examples: What should we throw for bass after work? • Best easy plan for kids? • It is windy — where should I start?"></textarea><button id="finnAiAsk" class="primary-button" type="button">✨ Build my plan</button></div>
        <div id="finnAiStatus" class="ai-coach-status" role="status">Choose a location first so the answer can use current conditions.</div>
        <div id="finnAiAnswer" class="ai-coach-answer" hidden></div>
      </article>`;
    anchor.insertAdjacentElement("afterend", section);
    document.querySelector("#finnAiAsk")?.addEventListener("click", runCoach);
  }

  function currentSnapshot() {
    if (typeof state === "undefined" || !state.location || !state.weather) return null;
    const weather = state.weather;
    const score = calculateCurrentScore(weather);
    const hourly = getHourlyScores(weather, findHourlyIndex(weather), 30).sort((a,b)=>b.score-a.score).slice(0,3);
    const index = findHourlyIndex(weather);
    return {
      location: locationName(state.location), score: score.score, temp: Math.round(weather.current.temperature_2m),
      wind: Math.round(weather.current.wind_speed_10m), gust: Math.round(weather.current.wind_gusts_10m),
      pressure: Math.round(weather.current.pressure_msl), rain: Math.round(weather.hourly.precipitation_probability[index] ?? 0),
      weatherCode: weather.current.weather_code, observedAt: weather.current.time, topHours: hourly, spots: (state.spots || []).slice(0,5)
    };
  }

  function startEmbedder(status) {
    if (embedder) return Promise.resolve(embedder);
    if (loading) return loading;
    loading = (async () => {
      status.textContent = "Smart answer ready • Hugging Face AI is loading in the background…";
      const { pipeline, env } = await import(HF_IMPORT);
      if (env) {
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;
      }
      let lastError = null;
      for (const model of MODEL_CANDIDATES) {
        try {
          const pipe = await pipeline("feature-extraction", model);
          await pipe("family fishing", { pooling:"mean", normalize:true });
          embedder = pipe;
          activeModel = model;
          return pipe;
        } catch (error) {
          lastError = error;
          try { await embedder?.dispose?.(); } catch {}
          embedder = null;
        }
      }
      throw lastError || new Error("No embedding model loaded");
    })().catch(error => {
      loading = null;
      throw error;
    });
    return loading;
  }

  function dot(a,b){ let total=0; for(let i=0;i<Math.min(a.length,b.length);i++) total+=a[i]*b[i]; return total; }
  function lexicalRank(query) {
    const terms=query.toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2);
    return PLAYBOOK.map(item=>{ const hay=`${item.title} ${item.text}`.toLowerCase(); const score=terms.reduce((n,t)=>n+(hay.includes(t)?1:0),0)/Math.max(1,terms.length); return {item,score}; }).sort((a,b)=>b.score-a.score);
  }
  async function semanticRank(query,status) {
    const pipe=await startEmbedder(status);
    const out=await pipe([query,...PLAYBOOK.map(item=>`${item.title}. ${item.text}`)],{pooling:"mean",normalize:true});
    const rows=out.tolist();
    return PLAYBOOK.map((item,i)=>({item,score:dot(rows[0],rows[i+1])})).sort((a,b)=>b.score-a.score);
  }

  function weatherAdjustment(s) {
    const notes=[];
    if(s.weatherCode>=95) notes.push("Thunderstorms are possible: do not fish during lightning or unsafe storms.");
    if(s.wind>=18||s.gust>=28) notes.push("Wind is strong enough that a protected bank/cove is the smarter starting point.");
    else if(s.wind>=7) notes.push("The breeze can help break up the surface; a moving bait is worth trying before slowing down.");
    else notes.push("Wind is light, so quieter presentations and shade/cover may matter more.");
    if(s.rain>=65) notes.push("Rain odds are high; keep a dry backup plan and watch radar/alerts before leaving.");
    if(s.temp>=88) notes.push("It is hot: favor early/late windows, shade, deeper nearby water, hydration, and short family sessions.");
    return notes;
  }

  function renderPlan(query,s,ranked,mode) {
    const best=ranked[0]?.item||PLAYBOOK[5], second=ranked[1]?.item;
    const bestHours=s.topHours.map(h=>`${formatTime(h.time)} (${h.score}/100)`).join(", ");
    const spots=s.spots.length?`<ol>${s.spots.slice(0,3).map(place=>`<li><strong>${esc(place.name)}</strong> — ${Number(place.distance||0).toFixed(1)} mi • ${esc(place.details||"")}</li>`).join("")}</ol>`:`<p>No mapped fishing places have loaded yet. Use the map to choose accessible named water and confirm legal access.</p>`;
    let sourceTime=s.observedAt; try{sourceTime=new Date(s.observedAt).toLocaleString();}catch{}
    return `<div class="ai-plan-head"><div><span class="ai-live-badge">${esc(mode)}</span><h3>${esc(best.title)} plan</h3></div><strong>${s.score}/100 bite score</strong></div><p><strong>Your question:</strong> ${esc(query)}</p><div class="ai-plan-grid"><div><h4>🎣 Start with</h4><p>${esc(best.bait)}</p></div><div><h4>📍 Look for</h4><p>${esc(best.location)}</p></div></div>${second?`<p class="ai-small">Backup pattern: <strong>${esc(second.title)}</strong>.</p>`:""}<h4>⏰ Best upcoming windows</h4><p>${esc(bestHours||"Use the bite windows above.")}</p><h4>🌦️ Live adjustment</h4><ul>${weatherAdjustment(s).map(n=>`<li>${esc(n)}</li>`).join("")}</ul><h4>🗺️ Closest mapped options</h4>${spots}<div class="ai-grounding"><strong>Grounded facts:</strong> ${esc(s.location)} • ${s.temp}°F • wind ${s.wind} mph, gusts ${s.gust} • rain ${s.rain}% • pressure ${s.pressure} hPa. Forecast timestamp: ${esc(sourceTime)}.</div>`;
  }

  async function runCoach() {
    const question=String(document.querySelector("#finnAiQuestion")?.value||"").trim();
    const status=document.querySelector("#finnAiStatus"), answer=document.querySelector("#finnAiAnswer");
    const snapshot=currentSnapshot();
    if(!snapshot){status.textContent="Choose a location first. Finn needs the live forecast before building a grounded plan.";answer.hidden=true;return;}
    if(question.length<3){status.textContent="Ask what you want to catch, who is fishing, or what conditions you are worried about.";return;}

    const id=++requestId;
    const initial=lexicalRank(question);
    answer.innerHTML=renderPlan(question,snapshot,initial,"Instant grounded match");
    answer.hidden=false;
    status.textContent="Answer ready • Hugging Face AI is improving the match in the background…";

    try {
      const ranked=await waitFor(semanticRank(`${question}. Current conditions: ${snapshot.temp} F, wind ${snapshot.wind} mph, rain ${snapshot.rain} percent.`,status),AI_WAIT_MS,"AI startup timed out");
      if(id!==requestId) return;
      answer.innerHTML=renderPlan(question,snapshot,ranked,"Hugging Face semantic match");
      status.textContent=`AI ready • ${activeModel} • live facts preserved`;
    } catch(error) {
      if(id!==requestId) return;
      console.warn("Ask Finn AI unavailable; instant grounded match remains active.",error);
      status.textContent="Smart answer is active. Hugging Face AI did not finish in time, so Finn kept the instant live-data answer instead of hanging.";
    }
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",installUI,{once:true}); else installUI();
})();
