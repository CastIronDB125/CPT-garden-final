
const state = {
  config:null,
  plants:[],
  logs:{daily:[],dwc:[]},
  weather:null,
  selectedId:null,
  currentTab:'overview',
  currentFilter:'All',
  weatherMode:'auto',
  manualProfile:'general'
};
const LS_KEY='gpt-garden-final-v1';
const WEATHER_TIMEOUT_MS=8000;
const TABS_BASE=['overview','grow log','feed','light'];
const STAGES=[
  'Seeds — not yet sown','Seeds — sown, not sprouted','Just germinated / sprouted','Seedling (cotyledons)',
  'Seedling (true leaves emerging)','Early vegetative','Vegetative','Pre-flowering','Flowering','Fruiting',
  'Ready to harvest','Hardening off','Transplanted outdoors','DWC — net pot placed','DWC — roots reaching water','DWC — established'
];
const HARDEN_SCHEDULE=[
  {day:1,hours:1,notes:'Dappled shade only. No direct sun.'},{day:2,hours:2,notes:'Shade and low wind.'},
  {day:3,hours:3,notes:'Morning sun is okay.'},{day:4,hours:4,notes:'Add a bit more direct sun.'},
  {day:5,hours:5,notes:'Half day exposure.'},{day:6,hours:6,notes:'Longer outdoor block.'},
  {day:7,hours:8,notes:'Near full day if nights are safe.'},{day:8,hours:10,notes:'Almost full outdoor exposure.'},
  {day:9,hours:12,notes:'Full day, watch lows.'},{day:10,hours:14,notes:'Ready for outdoor life if forecast behaves.'}
];
const PROFILE_SETTINGS={
  general:{label:'General', minTemp:45, maxTemp:88, maxWind:16, maxRainProb:45, maxUV:8, bringInTemp:42},
  lettuce:{label:'Lettuce / cool crops', minTemp:36, maxTemp:75, maxWind:18, maxRainProb:55, maxUV:7, bringInTemp:32},
  tomato:{label:'Tomatoes', minTemp:50, maxTemp:90, maxWind:14, maxRainProb:40, maxUV:8, bringInTemp:48},
  pepper:{label:'Peppers', minTemp:55, maxTemp:92, maxWind:12, maxRainProb:35, maxUV:8, bringInTemp:53},
  superhot:{label:'Superhots', minTemp:60, maxTemp:95, maxWind:10, maxRainProb:30, maxUV:8, bringInTemp:58},
  bonsai:{label:'Bonsai seedlings', minTemp:40, maxTemp:82, maxWind:12, maxRainProb:50, maxUV:7, bringInTemp:36}
};

function $(id){ return document.getElementById(id); }
function isoToday(){ return new Date().toISOString().slice(0,10); }
function nowISO(){ return new Date().toISOString(); }
function parseDate(s){ return s?new Date(s+'T12:00:00'):null; }
function fmtDate(s){ const d = typeof s === 'string' && s.length <=10 ? new Date(s+'T12:00:00') : new Date(s); return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function fmtShort(d){ return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
function daysSince(s){ if(!s) return null; return Math.floor((startOfDay(new Date()) - startOfDay(parseDate(s)))/86400000); }
function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function daysUntil(d){ return Math.ceil((startOfDay(d)-startOfDay(new Date()))/86400000); }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function escapeHtml(s){ return String(s??'').replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
function cat(p){ if(p.system==='DWC') return 'DWC'; if(p.category==='Bonsai') return 'Bonsai'; if(p.category==='Uncertain Seed') return 'Uncertain'; return 'Soil'; }
function isPermanentIndoor(p){ return !!p._permanentIndoor || /permanent indoor/i.test(p.destination||'') || p.system==='DWC' || p.category==='Herb'; }
function requiresHardening(p){ return !isPermanentIndoor(p) && !!p.hardeningRequired; }
function defaultLight(p){ if(p.system==='DWC') return 18; if(p.category==='Lettuce') return 14; if(p.category==='Herb') return 16; if(p.category==='Bonsai') return 14; return 16; }
function profileForPlant(p){ return p.profile || (p.category==='Lettuce'?'lettuce':p.category==='Tomato'?'tomato':p.category==='Bonsai'?'bonsai':p.category==='Pepper' && (p.group||'').includes('superhot')?'superhot':p.category==='Pepper'?'pepper':'general'); }
function frostDate(){ const f=state.config.frost; const now=new Date(); let d=new Date(now.getFullYear(), f.conservativeLastFrostMonth-1, f.conservativeLastFrostDay); if(now>d) d=new Date(now.getFullYear()+1, f.conservativeLastFrostMonth-1, f.conservativeLastFrostDay); return d; }
function safePlantDate(){ const f=state.config.frost; const now=new Date(); let d=new Date(now.getFullYear(), f.safePlantMonth-1, f.safePlantDay); if(now>d) d=new Date(now.getFullYear()+1, f.safePlantMonth-1, f.safePlantDay); return d; }

function flashSave(){ const el=$('save-msg'); el.classList.add('show'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'), 1200); }
function saveState(){
  const payload={
    logs:state.logs,
    weatherMode:state.weatherMode,
    manualProfile:state.manualProfile,
    plantMutables: state.plants.map(p=>({
      id:p.id,_stage:p._stage,_lightHours:p._lightHours,_feeds:p._feeds,_notes:p._notes,_phLog:p._phLog,_ecLog:p._ecLog,
      _lastWatered:p._lastWatered,_lastDryCheck:p._lastDryCheck,_lastMetricCheck:p._lastMetricCheck,_hardenStart:p._hardenStart
    }))
  };
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
  flashSave();
}
function loadState(){
  try{ const raw=localStorage.getItem(LS_KEY); if(!raw) return; const data=JSON.parse(raw); state.logs=data.logs||{daily:[],dwc:[]}; state.weatherMode=data.weatherMode||'auto'; state.manualProfile=data.manualProfile||'general';
    (data.plantMutables||[]).forEach(m=>{ const p=state.plants.find(x=>x.id===m.id); if(p) Object.assign(p,m); });
  }catch(err){ console.warn('Load state failed', err); }
}
function normalizePlants(){
  state.plants.forEach(p=>{
    p._stage = p._stage || p.status || 'Seedling (true leaves emerging)';
    p._lightHours = p._lightHours || defaultLight(p);
    p._feeds = Array.isArray(p._feeds)?p._feeds:[];
    p._notes = Array.isArray(p._notes)?p._notes:[];
    p._phLog = Array.isArray(p._phLog)?p._phLog:[];
    p._ecLog = Array.isArray(p._ecLog)?p._ecLog:[];
    p._permanentIndoor = isPermanentIndoor(p);
    p._lastWatered = p._lastWatered || null;
    p._lastDryCheck = p._lastDryCheck || null;
    p._lastMetricCheck = p._lastMetricCheck || null;
    p._hardenStart = p._hardenStart || null;
  });
}

async function init(){
  const [cfgRes, plantsRes] = await Promise.all([fetch('data/config.json'), fetch('data/plants.json')]);
  state.config = await cfgRes.json();
  state.plants = await plantsRes.json();
  normalizePlants();
  loadState();
  if(!state.selectedId && state.plants.length) state.selectedId = state.plants[0].id;
  bindEvents();
  renderFilters(); renderPlantList(); renderDetail();
  fetchWeather();
}
function bindEvents(){
  $('export-btn').addEventListener('click', exportData);
  $('import-file').addEventListener('change', importData);
}

async function fetchWeather(){
  const c=state.config;
  const params=new URLSearchParams({
    latitude:c.latitude, longitude:c.longitude, timezone:c.timezone,
    temperature_unit:'fahrenheit', wind_speed_unit:'mph', precipitation_unit:'inch',
    current:['temperature_2m','relative_humidity_2m','apparent_temperature','wind_speed_10m','wind_gusts_10m','weather_code','is_day'].join(','),
    daily:['temperature_2m_max','temperature_2m_min','precipitation_probability_max','precipitation_sum','uv_index_max','sunrise','sunset','daylight_duration','weather_code'].join(','),
    hourly:['temperature_2m','relative_humidity_2m','apparent_temperature','wind_speed_10m','wind_gusts_10m','precipitation_probability','precipitation','uv_index','weather_code','is_day'].join(',')
  });
  const ctrl = new AbortController(); const t=setTimeout(()=>ctrl.abort(), WEATHER_TIMEOUT_MS);
  try{
    renderWeatherLoading();
    const res=await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {signal:ctrl.signal});
    if(!res.ok) throw new Error('Weather fetch failed');
    const data=await res.json();
    state.weather=data; renderWeather();
  }catch(err){ console.warn(err); state.weather=null; renderWeatherFallback(err.name==='AbortError' ? 'Weather request timed out.' : 'Weather unavailable right now.'); }
  finally{ clearTimeout(t); }
}
function weatherText(code){ const map={0:'Clear',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',80:'Rain showers',81:'Showers',82:'Heavy showers',95:'Thunderstorm'}; return map[code]||`Code ${code}`; }
function pickSelectedPlant(){ return state.plants.find(p=>p.id===state.selectedId) || state.plants[0] || null; }
function effectiveProfile(){
  if(state.weatherMode==='manual') return state.manualProfile;
  const p=pickSelectedPlant();
  return p ? profileForPlant(p) : 'general';
}
function outdoorEligibility(p){
  if(!p) return {kind:'default'};
  if(isPermanentIndoor(p)) return {kind:'indoor', note:'Permanent indoor plant — outdoor timing not applicable.'};
  if(!requiresHardening(p)) return {kind:'indoor', note:'No hardening schedule needed for this plant.'};
  return {kind:'outdoor'};
}
function analyzeHour(hour, profileKey){
  const prof=PROFILE_SETTINGS[profileKey] || PROFILE_SETTINGS.general;
  let score='good'; const issues=[];
  if(hour.temp < prof.minTemp){ score='bad'; issues.push('too cold'); }
  else if(hour.temp < prof.minTemp+4){ score=score==='bad'?'bad':'okay'; issues.push('cool edge'); }
  if(hour.temp > prof.maxTemp){ score='bad'; issues.push('too hot'); }
  else if(hour.temp > prof.maxTemp-6){ score=score==='bad'?'bad':'okay'; issues.push('warm edge'); }
  if(hour.wind > prof.maxWind){ score='bad'; issues.push('too windy'); }
  else if(hour.wind > prof.maxWind-3){ score=score==='bad'?'bad':'okay'; issues.push('windy'); }
  if(hour.rainProb > prof.maxRainProb || hour.rain > 0.1){ score='bad'; issues.push('rain risk'); }
  if(hour.uv > prof.maxUV){ score=score==='bad'?'bad':'okay'; issues.push('high UV'); }
  if(hour.isDay===0){ score='bad'; issues.push('dark'); }
  let action='Good outdoor hour.';
  if(score==='okay') action='Usable with caution.';
  if(score==='bad') action='Keep it brief or keep it inside.';
  return {...hour, score, action, issues};
}
function buildHourlyWindow(profileKey){
  if(!state.weather?.hourly) return null;
  const h=state.weather.hourly; const now=new Date();
  const hours=[];
  for(let i=0;i<h.time.length;i++){
    const dt=new Date(h.time[i]);
    if(dt < now) continue;
    hours.push({time:dt,temp:Math.round(h.temperature_2m[i]),feels:Math.round(h.apparent_temperature[i]),humidity:h.relative_humidity_2m[i],wind:Math.round(h.wind_speed_10m[i]),gust:Math.round(h.wind_gusts_10m[i]||0),rainProb:h.precipitation_probability[i]||0,rain:h.precipitation[i]||0,uv:Math.round((h.uv_index[i]||0)*10)/10,code:h.weather_code[i],isDay:h.is_day[i]});
    if(hours.length===12) break;
  }
  const scored=hours.map(x=>analyzeHour(x, profileKey));
  return scored;
}
function bestWindow(hours, want='good'){ const matches=hours.filter(h=>h.score===want); if(!matches.length) return null; return `${formatHour(matches[0].time)}–${formatHour(matches[matches.length-1].time)}`; }
function formatHour(d){ return d.toLocaleTimeString('en-US',{hour:'numeric'}).replace(':00',''); }
function formatDuration(seconds){ const h=Math.floor(seconds/3600); const m=Math.round((seconds%3600)/60); return `${h}h ${m}m`; }
function renderWeatherLoading(){ $('weather-panel').innerHTML = `<div class="wx-hero"><div class="kicker">Daily weather briefing</div><div class="muted">Loading Bella Vista forecast… crunching the weather goblins.</div></div>`; }
function renderWeatherFallback(msg){
  const selected=pickSelectedPlant(); const elig=outdoorEligibility(selected); const profile=effectiveProfile();
  $('weather-panel').innerHTML = `<div class="wx-hero"><div class="kicker">Daily weather briefing</div><h2 style="margin:0 0 6px;font-family:var(--serif)">${escapeHtml(state.config.locationName)}</h2><div class="alert warn">${escapeHtml(msg)} The tracker still works; live forecast just took a coffee break.</div></div>${renderWeatherOperations(selected, elig, profile, null)}`;
}
function buildSynopsis(selected, elig, profileKey, hours){
  const prof = PROFILE_SETTINGS[profileKey] || PROFILE_SETTINGS.general;
  const low = state.weather?.daily?.temperature_2m_min?.[0];
  const high = state.weather?.daily?.temperature_2m_max?.[0];
  const label = prof.label;
  if(state.weatherMode==='manual'){
    if(!hours || !hours.length) return `Manual preview for ${label}: waiting on hourly weather.`;
    const good = hours.filter(h=>h.score==='good').length;
    const okay = hours.filter(h=>h.score==='okay').length;
    const firstGood = hours.find(h=>h.score==='good');
    const coldTonight = low != null && low < prof.bringInTemp;
    if(coldTonight){
      return `${label} preview: ${firstGood ? `usable around ${formatHour(firstGood.time)}` : 'thin outdoor options'} today, but tonight drops near ${Math.round(low)}°, so keep it brief and bring them back in.`;
    }
    return `${label} preview: ${good} good and ${okay} okay hours in the next block. ${high != null ? `High near ${Math.round(high)}°.` : ''}`.trim();
  }
  if(elig.kind==='indoor'){
    return `${selected?.plant || 'Selected plant'} is flagged indoor, so outdoor timing is bypassed and the panel switches to indoor care logic.`;
  }
  if(!hours || !hours.length){
    return `${selected?.plant || label} is waiting on hourly weather data before making outdoor recommendations.`;
  }
  const good = hours.filter(h=>h.score==='good').length;
  const okay = hours.filter(h=>h.score==='okay').length;
  const firstGood = hours.find(h=>h.score==='good');
  const firstBadCold = hours.find(h=>h.score==='bad' && h.issues.includes('too cold'));
  if(profileKey==='lettuce' || profileKey==='bonsai'){
    if(good || okay) return `Reasonable day for ${label.toLowerCase()} exposure${firstGood ? ` starting around ${formatHour(firstGood.time)}` : ''}, but still watch the wind and evening lows.`;
    return `${label} can tolerate more than peppers, but this forecast is still stingy. Keep exposure brief.`;
  }
  if(firstBadCold || (low != null && low < prof.bringInTemp)){
    return `${selected?.plant || label} gets some daytime potential${firstGood ? ` around ${formatHour(firstGood.time)}` : ''}, but tonight bottoms near ${Math.round(low)}°, so the hardening math should obey reality, not optimism.`;
  }
  return `${selected?.plant || label} has ${good} good and ${okay} okay outdoor hours in the next block. Still check wind, UV, and your plant's current mood.`;
}

function renderWeather(){
  const wx=state.weather, current=wx.current, daily=wx.daily, selected=pickSelectedPlant(), elig=outdoorEligibility(selected), profileKey=effectiveProfile(), profile=PROFILE_SETTINGS[profileKey], hours=buildHourlyWindow(profileKey);
  const sunRise=new Date(daily.sunrise[0]), sunSet=new Date(daily.sunset[0]);
  const synopsis = buildSynopsis(selected, elig, profileKey, hours);
  $('weather-panel').innerHTML = `
    <div class="wx-hero">
      <div class="kicker">Daily weather briefing</div>
      <div style="font-family:var(--serif);font-size:clamp(18px,2vw,28px);margin-bottom:8px">${escapeHtml(state.config.locationName)} · Zone ${escapeHtml(state.config.zone)}</div>
      <div class="alert info" style="margin-bottom:12px">${escapeHtml(synopsis)}</div>
      <div class="wx-grid">
        <div class="wx-card wx-big">
          <div class="metric-label">Current</div>
          <div class="wx-temp">${Math.round(current.temperature_2m)}°F</div>
          <div class="wx-desc">${weatherText(current.weather_code)}</div>
          <div class="wx-sub">Feels like ${Math.round(current.apparent_temperature)}° · RH ${current.relative_humidity_2m}%</div>
        </div>
        <div class="wx-card">
          <div class="metric-label">Today</div>
          <div class="metric-value">${Math.round(daily.temperature_2m_max[0])}° / ${Math.round(daily.temperature_2m_min[0])}°</div>
          <div class="muted">Rain ${daily.precipitation_probability_max[0]||0}% · ${(daily.precipitation_sum[0]||0).toFixed(2)} in</div>
          <div class="muted">Wind ${Math.round(current.wind_speed_10m)} mph · gust ${Math.round(current.wind_gusts_10m||0)}</div>
          <div class="muted">UV max ${Math.round((daily.uv_index_max[0]||0)*10)/10}</div>
        </div>
        <div class="wx-card">
          <div class="metric-label">Sun</div>
          <div class="metric-value">${sunRise.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>
          <div class="muted">Sunrise</div>
          <div class="metric-value" style="margin-top:8px">${sunSet.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>
          <div class="muted">Sunset · daylight ${formatDuration(daily.daylight_duration[0])}</div>
        </div>
        <div class="wx-card">
          <div class="metric-label">Frost-safe target</div>
          <div class="metric-value">${fmtShort(frostDate())}</div>
          <div class="muted">Last frost range ${escapeHtml(state.config.frost.avgLastFrostRange)}</div>
          <div class="metric-value" style="margin-top:8px">${fmtShort(safePlantDate())}</div>
          <div class="muted">Conservative safe-out date</div>
        </div>
      </div>
    </div>
    ${renderWeatherOperations(selected, elig, profileKey, hours)}
    <div class="forecast-strip">${daily.time.slice(0,7).map((t,i)=>`<div class="forecast-card"><div class="metric-label">${new Date(t).toLocaleDateString('en-US',{weekday:'short'})}</div><div class="metric-value">${Math.round(daily.temperature_2m_max[i])}° / ${Math.round(daily.temperature_2m_min[i])}°</div><div class="muted">${weatherText(daily.weather_code[i])}</div><div class="muted">Rain ${daily.precipitation_probability_max[i]||0}% · ${(daily.precipitation_sum[i]||0).toFixed(2)} in</div><div class="muted">UV ${Math.round((daily.uv_index_max[i]||0)*10)/10}</div></div>`).join('')}</div>`;
}
function renderWeatherOperations(selected, elig, profileKey, hours){
  const autoText = state.weatherMode==='auto' ? (selected ? `Auto from ${escapeHtml(selected.plant)}` : 'Auto default') : `Manual override · ${PROFILE_SETTINGS[state.manualProfile].label}`;
  const ops = buildOpsQueue().slice(0,4);
  const showOutdoor = state.weatherMode === 'manual' || elig.kind === 'outdoor';
  return `<div class="info-strip">
    <div class="info-box">
      <div class="window-head"><h3>Outdoor readiness</h3><div class="toggle-row">${Object.entries(PROFILE_SETTINGS).map(([k,v])=>`<button class="toggle ${((state.weatherMode==='manual'&&state.manualProfile===k)||(state.weatherMode==='auto'&&profileKey===k))?'active':''}" onclick="setProfileMode('${k}')">${escapeHtml(v.label)}</button>`).join('')}<button class="toggle ${state.weatherMode==='auto'?'active':''}" onclick="setAutoMode()">Auto</button></div></div>
      <div class="muted" style="margin-bottom:8px">${autoText}</div>
      ${showOutdoor ? renderReadinessSummary(hours, selected) : renderIndoorSummary(selected)}
    </div>
    <div class="info-box">
      <h3>Grow room constants</h3>
      <div class="list">
        <div class="list-item"><span>Lights</span><span>${escapeHtml(state.config.lights.on)}–${escapeHtml(state.config.lights.off)}</span></div>
        <div class="list-item"><span>Temp</span><span>${escapeHtml(state.config.environment.tempF)}°F</span></div>
        <div class="list-item"><span>RH</span><span>${escapeHtml(state.config.environment.rh)}</span></div>
        <div class="list-item"><span>Soil</span><span>${escapeHtml(state.config.environment.soil)}</span></div>
        <div class="list-item"><span>Feed</span><span>${escapeHtml(state.config.environment.feed)}</span></div>
      </div>
    </div>
    <div class="info-box">
      <h3>Ops queue</h3>
      ${ops.length ? `<div class="list">${ops.map(x=>`<div class="list-item"><span>${escapeHtml(x.title)}</span><span class="muted">${escapeHtml(x.meta)}</span></div>`).join('')}</div>` : '<div class="muted">No urgent goblins right now.</div>'}
    </div>
  </div>
  <div class="outdoor-window-wrap">
    <div class="outdoor-window-header">
      <div>
        <h3>Today outdoors window</h3>
        <div class="muted">Hour-by-hour timing for hardening, watering, and hauling the green weirdos back inside. ${state.weatherMode==='manual' ? `Manual preview: ${PROFILE_SETTINGS[state.manualProfile].label}.` : (selected ? `Auto profile: ${PROFILE_SETTINGS[profileKey].label} for ${escapeHtml(selected.plant)}.` : `Auto profile: ${PROFILE_SETTINGS[profileKey].label}.`)}</div>
      </div>
      <div class="legend"><span class="pill good">GOOD</span><span class="pill okay">OKAY</span><span class="pill bad">BAD</span></div>
    </div>
    ${showOutdoor ? renderOutdoorWindow(hours) : renderIndoorWindow(selected)}
  </div>`;
}
function renderReadinessSummary(hours, selected){
  if(!hours) return '<div class="window-grid compact"><div class="window-card"><div class="metric-label">Status</div><div class="metric-value">Waiting on weather</div><div class="muted">Hourly forecast not available yet.</div></div></div>';
  const harden=bestWindow(hours,'good') || bestWindow(hours,'okay') || 'No clean window';
  const wateringHour = hours.find(h=>h.score!=='bad' && h.temp<78);
  const bringIn = hours.find(h=>h.score==='bad' && h.issues.some(i=>i==='too cold' || i==='dark' || i==='rain risk'));
  const good=hours.filter(h=>h.score==='good').length, okay=hours.filter(h=>h.score==='okay').length, bad=hours.filter(h=>h.score==='bad').length;
  const modeLabel = state.weatherMode==='manual' ? `${PROFILE_SETTINGS[state.manualProfile].label} preview` : (selected ? `${selected.plant}` : 'Selected profile');
  return `<div class="window-grid compact"><div class="window-card"><div class="metric-label">Hardening</div><div class="metric-value">${harden}</div><div class="muted">${escapeHtml(modeLabel)} · ${good} good / ${okay} okay / ${bad} bad hours.</div></div><div class="window-card"><div class="metric-label">Watering</div><div class="metric-value">${wateringHour ? formatHour(wateringHour.time) : 'Use judgment'}</div><div class="muted">Aim for lower wind and milder temps.</div></div><div class="window-card"><div class="metric-label">Bring-back-in</div><div class="metric-value">${bringIn ? formatHour(bringIn.time) : 'Watch sunset'}</div><div class="muted">Bring in before forecast turns feral.</div></div></div>`;
}
function renderOutdoorWindow(hours){
  if(!hours) return '<div class="muted">Hourly forecast not available yet.</div>';
  return `<div class="hourly-strip">${hours.map(h=>`<div class="hour-card ${h.score}"><div class="hour-time">${formatHour(h.time)}</div><div>${h.temp}° · feels ${h.feels}°</div><div class="hour-small">RH ${h.humidity}% · wind ${h.wind}${h.gust ? ` · gust ${h.gust}` : ''}</div><div class="hour-small">Rain ${h.rainProb}% · ${h.rain.toFixed ? h.rain.toFixed(2) : h.rain} in · UV ${h.uv}</div><div class="hour-note">${escapeHtml(h.action)}</div></div>`).join('')}</div>`;
}
function renderIndoorSummary(selected){
  if(!selected) return '<div class="window-grid compact"><div class="window-card"><div class="metric-label">Status</div><div class="metric-value">Select a plant</div><div class="muted">Indoor guidance appears when a plant is selected.</div></div></div>';
  let harden='Not applicable', watering='Check by root zone', bring='Stay inside', note='';
  if(selected.system==='DWC'){
    watering='Check AM / PM';
    note='Watch water level, bubbles, pH, EC/PPM, and solution temp.';
  } else if(selected.category==='Herb'){
    const herb=selected.plant.toLowerCase();
    watering = herb.includes('basil') ? 'Keep evenly moist' : herb.includes('rosemary') ? 'Barely moist' : herb.includes('thyme') ? 'Lean dry' : 'Light watering';
    note='Indoor herb logic beats weather logic here.';
  } else if(selected.category==='Bonsai'){
    watering='Even moisture, sharp drainage';
    note='Conifers hate boggy martyrdom.';
  } else {
    note='Use pot weight, top-inch dryness, and targeted root-zone watering.';
  }
  const status=getWateringStatus(selected);
  const profileNote = 'Auto mode sees this plant as indoor, so hardening timing is bypassed.';
  return `<div class="window-grid compact"><div class="window-card"><div class="metric-label">Hardening</div><div class="metric-value">${harden}</div><div class="muted">${profileNote}</div></div><div class="window-card"><div class="metric-label">Watering</div><div class="metric-value">${watering}</div><div class="muted">${status.next}</div></div><div class="window-card"><div class="metric-label">Bring-back-in</div><div class="metric-value">${bring}</div><div class="muted">${note}</div></div></div>`;
}
function renderIndoorWindow(selected){
  if(!selected) return '<div class="muted">Select a plant for indoor guidance.</div>';
  let note='';
  if(selected.system==='DWC') note='Indoor DWC logic is active. Manual override only changes the weather profile, not the fact that this plant lives inside.';
  else if(selected.category==='Herb') note='Permanent indoor herb. Use this panel for indoor watering guidance, not hardening.';
  else if(selected.category==='Bonsai') note='Indoor or training-start bonsai. Keep drainage sharp and avoid overwatering.';
  else note='Indoor plant selected. Manual override can still preview outdoor timing if you want it.';
  return `<div class="window-grid compact" style="margin-bottom:12px"><div class="window-card"><div class="metric-label">Indoor note</div><div class="metric-value">Stay inside</div><div class="muted">${note}</div></div></div>` + renderOutdoorWindow(buildHourlyWindow(state.manualProfile || 'general'));
}
function renderFilters(){
  const filters=['All','DWC','Soil','Bonsai','Uncertain','Harden Off','Permanent Indoor'];
  $('filter-bar').innerHTML = filters.map(f=>`<button class="filter-btn ${state.currentFilter===f?'active':''}" onclick="setFilter('${f.replace(/'/g,"\'")}')">${f}</button>`).join('');
}
function filterPlants(){
  if(state.currentFilter==='All') return state.plants;
  if(state.currentFilter==='Harden Off') return state.plants.filter(requiresHardening);
  if(state.currentFilter==='Permanent Indoor') return state.plants.filter(isPermanentIndoor);
  return state.plants.filter(p=>cat(p)===state.currentFilter);
}
function renderPlantList(){
  const list=filterPlants();
  $('plant-list').innerHTML = list.map(p=>{
    const badges=[`<span class="badge ${cat(p).toLowerCase()}">${cat(p)}</span>`];
    if(isPermanentIndoor(p)) badges.push('<span class="badge indoor">indoor</span>');
    if(requiresHardening(p)) badges.push('<span class="badge harden">harden</span>');
    if(p.viability) badges.push('<span class="badge low">low viability</span>');
    return `<div class="plant-item ${state.selectedId===p.id?'active':''}" onclick="selectPlant('${p.id.replace(/'/g,"\'")}')"><div class="plant-name">${escapeHtml(p.plant)}</div><div class="plant-stage">${escapeHtml(p._stage)}</div><div class="badge-row">${badges.join('')}</div></div>`;
  }).join('') || '<div class="empty">No plants in this view.</div>';
}
function tabsFor(p){ const tabs=[...TABS_BASE]; if(p.system==='DWC') tabs.splice(1,0,'dwc'); if(requiresHardening(p)) tabs.push('hardening'); return tabs; }
function renderDetail(){
  const p=pickSelectedPlant(); if(!p){ $('detail').innerHTML='<div class="detail-header"><div class="detail-title">No plants</div></div>'; return; }
  const badges=[`<span class="badge ${cat(p).toLowerCase()}">${cat(p)}</span>`]; if(isPermanentIndoor(p)) badges.push('<span class="badge indoor">permanent indoor</span>'); if(requiresHardening(p)) badges.push('<span class="badge harden">harden off</span>');
  $('detail').innerHTML = `<div class="detail-header"><div class="detail-title">${escapeHtml(p.plant)}</div><div class="detail-sub">${escapeHtml(p.variety||'')}</div><div class="badge-row" style="margin-top:10px">${badges.join('')}</div><div class="detail-meta">${escapeHtml(p.destination||'')} · Sown ${fmtDate(p.sowDate)} · Day ${daysSince(p.sowDate) ?? '—'}</div></div><div class="tabbar">${tabsFor(p).map(t=>`<button class="tab ${state.currentTab===t?'active':''}" onclick="setTab('${t}')">${t}</button>`).join('')}</div><div class="tab-content">${renderTabContent(p)}</div>`;
  if(state.weather) renderWeather(); else renderWeatherFallback('Weather unavailable right now.');
}
function renderTabContent(p){
  switch(state.currentTab){
    case 'overview': return renderOverview(p);
    case 'dwc': return renderDwc(p);
    case 'grow log': return renderGrowLog(p);
    case 'feed': return renderFeed(p);
    case 'light': return renderLight(p);
    case 'hardening': return renderHardening(p);
    default: return renderOverview(p);
  }
}
function getLast(arr){ return arr && arr.length ? arr[arr.length-1] : null; }
function getWateringStatus(p){
  const lastWater = p._lastWatered ? new Date(p._lastWatered) : null;
  const lastCheck = p._lastDryCheck ? new Date(p._lastDryCheck) : null;
  const now=new Date();
  let next='Check today';
  if(lastWater){ const hrs=(now-lastWater)/36e5; if(hrs < 16) next='Recently watered — leave it alone'; else if(hrs < 36) next='Check later today'; else next='Check now'; }
  return {lastWater,lastCheck,next};
}
function renderOverview(p){
  const days=daysSince(p.sowDate), lastPH=getLast(p._phLog), lastEC=getLast(p._ecLog), water=getWateringStatus(p);
  return `<div class="metrics"><div class="metric"><div class="metric-label">Age</div><div class="metric-value">${days ?? '—'}</div></div><div class="metric"><div class="metric-label">Light / day</div><div class="metric-value">${p._lightHours}<span class="small">h</span></div></div><div class="metric"><div class="metric-label">Last watered</div><div class="metric-value small">${water.lastWater ? fmtDate(water.lastWater.toISOString()) : '—'}</div><div class="muted">${escapeHtml(water.next)}</div></div><div class="metric"><div class="metric-label">Last DWC metrics</div><div class="metric-value small">${p.system==='DWC' ? `${lastPH?lastPH.value:'—'} pH / ${lastEC?lastEC.value:'—'} EC` : cat(p)}</div></div></div>
  <div class="cols2"><div class="card"><h3>Stage</h3><select onchange="updateStage('${p.id}', this.value)">${STAGES.map(s=>`<option ${p._stage===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}</select><div class="row" style="margin-top:12px"><button class="btn btn-green" onclick="logWatered('${p.id}')">Log watered</button><button class="btn" onclick="logDryCheck('${p.id}')">Log dry check</button></div></div><div class="card"><h3>Plant notes</h3><div>${escapeHtml(p.info||'No notes yet.')}</div><div class="muted" style="margin-top:8px">${escapeHtml(p.destination||'')}</div></div></div>
  <div class="card"><h3>Recent notes</h3>${p._notes.length ? `<div class="list">${p._notes.slice(-6).reverse().map(n=>`<div class="list-item"><span>${escapeHtml(n.text)}</span><span class="muted">${fmtDate(n.date)}</span></div>`).join('')}</div>` : '<div class="empty">No notes logged yet.</div>'}</div>`;
}
function renderDwc(p){
  const lastPH=getLast(p._phLog), lastEC=getLast(p._ecLog);
  const logs=state.logs.dwc.filter(x=>x.plantId===p.id).slice(-10).reverse();
  return `<div class="alert warn"><strong>Reminder:</strong> Big Bloom alone is not a complete DWC base feed. Track pH, EC/PPM, and water temp or hydro turns into chaos soup.</div>
  <div class="metrics"><div class="metric"><div class="metric-label">Last pH</div><div class="metric-value">${lastPH?lastPH.value:'—'}</div></div><div class="metric"><div class="metric-label">Last EC</div><div class="metric-value">${lastEC?lastEC.value:'—'}</div></div><div class="metric"><div class="metric-label">Bucket</div><div class="metric-value small">${escapeHtml(p.bucket||'—')}</div></div><div class="metric"><div class="metric-label">Metric check</div><div class="metric-value small">${p._lastMetricCheck ? fmtDate(p._lastMetricCheck) : 'none'}</div></div></div>
  <div class="cols2"><div class="card"><h3>Quick metric log</h3><div class="form-grid"><label>pH<input id="dwc-ph" type="number" step="0.1" placeholder="5.9"></label><label>EC<input id="dwc-ec" type="number" step="0.01" placeholder="1.20"></label><label>PPM<input id="dwc-ppm" type="number" step="1" placeholder="700"></label><label>Water temp °F<input id="dwc-temp" type="number" step="0.1" placeholder="68"></label><label>Top off<select id="dwc-topoff"><option value="">No</option><option>Yes</option></select></label><label>Full change<select id="dwc-change"><option value="">No</option><option>Yes</option></select></label></div><div class="row" style="margin-top:12px"><button class="btn btn-green" onclick="saveDwcLog('${p.id}')">Save DWC log</button><button class="btn" onclick="logMetricCheck('${p.id}')">Log check only</button></div></div><div class="card"><h3>Recent DWC logs</h3>${logs.length?`<div class="list">${logs.map(l=>`<div class="list-item"><span>${escapeHtml(l.date || '')} · pH ${l.ph ?? '—'} · EC ${l.ec ?? '—'} · ${l.waterTemp ?? '—'}°F</span><span class="muted">${l.change?'change':''} ${l.topOff?'topoff':''}</span></div>`).join('')}</div>`:'<div class="empty">No DWC logs yet.</div>'}</div></div>`;
}
function renderGrowLog(p){
  const logs=state.logs.daily.filter(x=>x.plantId===p.id).slice(-12).reverse();
  return `<div class="cols2"><div class="card"><h3>New grow log</h3><div class="form-grid"><label>Date<input id="gl-date" type="date" value="${isoToday()}"></label><label>Height in<input id="gl-height" type="number" step="0.1"></label><label>Leaf count<input id="gl-leaf" type="number" step="1"></label><label>Condition<select id="gl-condition"><option>Strong</option><option>Fine</option><option>Leggy</option><option>Droopy</option><option>Stressed</option></select></label><label>Watered<select id="gl-water"><option value="">No</option><option>Yes</option></select></label><label>Outside minutes<input id="gl-outside" type="number" step="1"></label></div><label style="display:block;margin-top:12px">Notes<textarea id="gl-notes" rows="4"></textarea></label><div class="row" style="margin-top:12px"><button class="btn btn-green" onclick="saveGrowLog('${p.id}')">Save grow log</button></div></div><div class="card"><h3>Recent grow logs</h3>${logs.length?`<div class="list">${logs.map(l=>`<div class="list-item"><span>${escapeHtml(l.date)} · ${escapeHtml(l.condition || '')}${l.height?` · ${l.height}"`:''}${l.leafCount?` · ${l.leafCount} leaves`:''}</span><span class="muted">${escapeHtml(l.notes || '')}</span></div>`).join('')}</div>`:'<div class="empty">No daily logs yet.</div>'}</div></div>`;
}
function renderFeed(p){
  return `<div class="card"><h3>Feed log</h3><div class="row"><input id="feed-input" placeholder="e.g. Big Bloom 1 tsp/gal"><button class="btn btn-green" onclick="addFeed('${p.id}')">Add feed</button></div><div style="margin-top:12px">${p._feeds.length?`<div class="list">${p._feeds.slice(-12).reverse().map(f=>`<div class="list-item"><span>${escapeHtml(f.text)}</span><span class="muted">${fmtDate(f.date)}</span></div>`).join('')}</div>`:'<div class="empty">No feed records yet.</div>'}</div></div>`;
}
function renderLight(p){
  return `<div class="cols2"><div class="card"><h3>Daily light hours</h3><input type="range" min="12" max="20" step="1" value="${p._lightHours}" oninput="previewLight(this.value)" onchange="saveLight('${p.id}',this.value)"><div id="light-preview" class="metric-value">${p._lightHours}h</div><div class="muted">Current schedule globally runs ${state.config.lights.on}–${state.config.lights.off}. This setting is a plant target, not a magic second universe.</div></div><div class="card"><h3>Light notes</h3><div class="list"><div class="list-item"><span>Barrina T5 strips</span><span class="muted">~2–6 in above canopy</span></div><div class="list-item"><span>Spider Farmer SF300</span><span class="muted">~8 in above DWC</span></div><div class="list-item"><span>Spider Farmer SF600</span><span class="muted">~12 in</span></div></div></div></div>`;
}
function renderHardening(p){
  const start = p._hardenStart ? new Date(p._hardenStart) : null;
  const day = start ? Math.max(1, Math.floor((startOfDay(new Date()) - startOfDay(start))/86400000) + 1) : 0;
  const safe=safePlantDate();
  const resetBtn = start ? `<button class="btn btn-red" onclick="resetHardening('${p.id}')">Reset</button>` : '';
  const statusText = start ? `Started ${fmtDate(start.toISOString())} · Day ${day}` : `Not started · ideal around ${fmtShort(addDays(safe,-10))}`;
  return `<div class="alert info"><strong>Hardening logic:</strong> ${escapeHtml(p.plant)} is tracked as an outdoor container plant. Use the weather strip above and this 10-day ramp together instead of just yeeting it into Arkansas spring nonsense.</div><div class="row"><button class="btn btn-green" onclick="startHardening('${p.id}')">${start?'Restart':'Start'} hardening today</button>${resetBtn}</div><div class="card"><h3>Status</h3><div>${statusText}</div></div><div class="table-wrap"><table class="table"><thead><tr><th>Day</th><th>Hours</th><th>Guidance</th></tr></thead><tbody>${HARDEN_SCHEDULE.map(s=>`<tr><td>${s.day}</td><td>${s.hours}h</td><td>${escapeHtml(s.notes)}</td></tr>`).join('')}</tbody></table></div>`;
}
function buildOpsQueue(){
  const ops=[]; const now=new Date();
  state.plants.forEach(p=>{
    if(p.system==='DWC'){
      const lastMetric = p._lastMetricCheck ? new Date(p._lastMetricCheck) : null;
      const stale = !lastMetric || (now-lastMetric)/86400000 >= 2;
      if(stale) ops.push({title:`${p.plant}: DWC metrics stale`, meta:'Log pH / EC / water temp'});
    } else {
      const lw = p._lastWatered ? new Date(p._lastWatered) : null;
      if(!lw || (now-lw)/86400000 >= 2) ops.push({title:`${p.plant}: dry-back check due`, meta:isPermanentIndoor(p)?'Indoor root-zone check':'Watch forecast + pot weight'});
    }
    if(p.viability && /not sprouted/i.test(p._stage)) ops.push({title:`${p.plant}: old seed patience`, meta:'Do not declare them dead too early'});
  });
  return ops;
}

function setFilter(f){ state.currentFilter=f; renderFilters(); renderPlantList(); }
function selectPlant(id){ state.selectedId=id; state.currentTab='overview'; renderPlantList(); renderDetail(); }
function setTab(tab){ state.currentTab=tab; renderDetail(); }
function setProfileMode(profile){ state.weatherMode='manual'; state.manualProfile=profile; saveState(); if(state.weather) renderWeather(); }
function setAutoMode(){ state.weatherMode='auto'; saveState(); if(state.weather) renderWeather(); }
function previewLight(v){ const el=$('light-preview'); if(el) el.textContent=`${v}h`; }
function saveLight(id,v){ const p=state.plants.find(x=>x.id===id); if(!p) return; p._lightHours=Number(v); saveState(); renderDetail(); }
function updateStage(id,val){ const p=state.plants.find(x=>x.id===id); if(!p) return; p._stage=val; saveState(); renderPlantList(); renderDetail(); }
function addFeed(id){ const p=state.plants.find(x=>x.id===id), inp=$('feed-input'); if(!p || !inp.value.trim()) return; p._feeds.push({text:inp.value.trim(), date:nowISO()}); inp.value=''; saveState(); renderDetail(); }
function logWatered(id){ const p=state.plants.find(x=>x.id===id); if(!p) return; p._lastWatered=nowISO(); p._notes.push({text:'Watered', date:nowISO()}); saveState(); renderDetail(); }
function logDryCheck(id){ const p=state.plants.find(x=>x.id===id); if(!p) return; p._lastDryCheck=nowISO(); p._notes.push({text:'Dry-back check', date:nowISO()}); saveState(); renderDetail(); }
function logMetricCheck(id){ const p=state.plants.find(x=>x.id===id); if(!p) return; p._lastMetricCheck=nowISO(); p._notes.push({text:'DWC metric check', date:nowISO()}); saveState(); renderDetail(); }
function saveDwcLog(id){
  const p=state.plants.find(x=>x.id===id); if(!p) return;
  const entry={plantId:id,date:isoToday(),ph:parseFloat(($('dwc-ph').value||'').trim())||'',ec:parseFloat(($('dwc-ec').value||'').trim())||'',ppm:parseFloat(($('dwc-ppm').value||'').trim())||'',waterTemp:parseFloat(($('dwc-temp').value||'').trim())||'',topOff:$('dwc-topoff').value,change:$('dwc-change').value};
  state.logs.dwc.push(entry); if(entry.ph!=='') p._phLog.push({value:entry.ph,date:nowISO()}); if(entry.ec!=='') p._ecLog.push({value:entry.ec,date:nowISO()}); p._lastMetricCheck=nowISO(); saveState(); renderDetail();
}
function saveGrowLog(id){
  const entry={plantId:id,date:$('gl-date').value,height:parseFloat(($('gl-height').value||'').trim())||'',leafCount:parseInt(($('gl-leaf').value||'').trim())||'',condition:$('gl-condition').value,watered:$('gl-water').value,outsideMinutes:parseInt(($('gl-outside').value||'').trim())||'',notes:$('gl-notes').value||''};
  state.logs.daily.push(entry); if(entry.watered) logWatered(id); else { saveState(); renderDetail(); }
}
function startHardening(id){ const p=state.plants.find(x=>x.id===id); if(!p) return; p._hardenStart=isoToday(); p._notes.push({text:'Started hardening off', date:nowISO()}); saveState(); renderDetail(); }
function resetHardening(id){ const p=state.plants.find(x=>x.id===id); if(!p) return; p._hardenStart=null; saveState(); renderDetail(); }
function exportData(){
  const payload={exportedAt:nowISO(),logs:state.logs,weatherMode:state.weatherMode,manualProfile:state.manualProfile,plantMutables:state.plants.map(p=>({id:p.id,_stage:p._stage,_lightHours:p._lightHours,_feeds:p._feeds,_notes:p._notes,_phLog:p._phLog,_ecLog:p._ecLog,_lastWatered:p._lastWatered,_lastDryCheck:p._lastDryCheck,_lastMetricCheck:p._lastMetricCheck,_hardenStart:p._hardenStart}))};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`gpt-garden-final-backup-${isoToday()}.json`; a.click(); URL.revokeObjectURL(a.href);
}
function importData(event){ const file=event.target.files[0]; if(!file) return; const reader=new FileReader(); reader.onload=e=>{ try{ const data=JSON.parse(e.target.result); if(data.logs) state.logs=data.logs; if(data.weatherMode) state.weatherMode=data.weatherMode; if(data.manualProfile) state.manualProfile=data.manualProfile; (data.plantMutables||[]).forEach(m=>{ const p=state.plants.find(x=>x.id===m.id); if(p) Object.assign(p,m); }); normalizePlants(); saveState(); renderFilters(); renderPlantList(); renderDetail(); alert('Import complete.'); }catch(err){ console.error(err); alert('Import failed — invalid JSON.'); } }; reader.readAsText(file); }

document.addEventListener('DOMContentLoaded', init);
