// ─── Config ───────────────────────────────────────────────────────────────────
const API_URL    = 'https://api.peatus.ee/routing/v1/routers/estonia/index/graphql';
const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';
const PELIAS_URL  = 'https://api.peatus.ee/geocoding/v1/autocomplete';
const OSRM_URL    = 'https://router.project-osrm.org/route/v1/driving';

// Mode display config
const MODES = {
  WALK:   { icon: '🚶', label: 'Kõnni',  color: '#8B8FA8', line: '#8B8FA8' },
  RAIL:   { icon: '🚂', label: 'Rong',   color: '#4FC3F7', line: '#4FC3F7' },
  BUS:    { icon: '🚌', label: 'Buss',   color: '#2BC48A', line: '#2BC48A' },
  TRAM:   { icon: '🚊', label: 'Tramm',  color: '#FFA726', line: '#FFA726' },
  SUBWAY: { icon: '🚇', label: 'Metro',  color: '#AB47BC', line: '#AB47BC' },
  FERRY:  { icon: '⛴',  label: 'Laev',   color: '#26C6DA', line: '#26C6DA' },
};

// ─── Storage ──────────────────────────────────────────────────────────────────
function getPlace(key) {
  return JSON.parse(localStorage.getItem('place_' + key) || 'null');
}
function savePlace(key, data) {
  localStorage.setItem('place_' + key, JSON.stringify(data));
}
function cacheRoute(key, data) {
  localStorage.setItem('route_cache_' + key, JSON.stringify({ data, ts: Date.now() }));
}
function getCachedRoute(key) {
  const item = JSON.parse(localStorage.getItem('route_cache_' + key) || 'null');
  if (!item) return null;
  // Cache valid for 2 hours
  if (Date.now() - item.ts > 7200000) return null;
  return item.data;
}

// ─── Drive time ───────────────────────────────────────────────────────────────
async function fetchDriveTime(from, to) {
  const url = `${OSRM_URL}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.code !== 'Ok') return null;
  return Math.round(json.routes[0].duration / 60); // minutes
}

// ─── Prediction learning (Option A) ───────────────────────────────────────────
function logPrediction(key, minutes) {
  const slot = `pred_${key}_${new Date().getDay()}_${new Date().getHours()}`;
  const history = JSON.parse(localStorage.getItem(slot) || '[]');
  history.push(minutes);
  localStorage.setItem(slot, JSON.stringify(history.slice(-10)));
}
function getAvgPrediction(key) {
  const h = new Date().getHours();
  const d = new Date().getDay();
  // Check nearby hour slots too (±1h)
  const slots = [d + '_' + (h - 1), d + '_' + h, d + '_' + (h + 1)];
  const all = slots.flatMap(s => JSON.parse(localStorage.getItem(`pred_${key}_${s}`) || '[]'));
  if (all.length < 3) return null;
  return Math.round(all.reduce((a, b) => a + b, 0) / all.length);
}

// ─── Screens ──────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(ms) {
  return new Date(ms).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' });
}
function formatDuration(seconds) {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} t ${m % 60} min`;
}
function formatDist(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}
function greeting() {
  const h = new Date().getHours();
  if (h < 5)  return 'Tere öist!';
  if (h < 12) return 'Tere hommikust!';
  if (h < 18) return 'Tere päevast!';
  return 'Tere õhtust!';
}

// ─── Distance helper ──────────────────────────────────────────────────────────
function getDistanceMeters(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// ─── GPS ──────────────────────────────────────────────────────────────────────
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('GPS pole saadaval')); return; }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      e => reject(e),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function fetchRoute(from, to) {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yyyy = now.getFullYear();
  const date = `${mm}-${dd}-${yyyy}`; // OTP1 expects MM-DD-YYYY
  const time = now.toTimeString().slice(0, 8);

  const query = `{
    plan(
      from: { lat: ${from.lat}, lon: ${from.lon} }
      to:   { lat: ${to.lat},   lon: ${to.lon}   }
      date: "${date}"
      time: "${time}"
      numItineraries: 3
    ) {
      itineraries {
        duration
        startTime
        endTime
        legs {
          mode
          startTime
          endTime
          duration
          distance
          realTime
          departureDelay
          from { name lat lon }
          to   { name lat lon }
          trip { routeShortName }
        }
      }
    }
  }`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API viga ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data.plan.itineraries;
}

// ─── Real-time badge ──────────────────────────────────────────────────────────
function realtimeBadge(leg) {
  if (!leg.realTime) return '';
  const delayMin = Math.round((leg.departureDelay || 0) / 60);
  if (delayMin <= 1)  return '<span style="color:#2BC48A;font-size:10px">● õigeaegselt</span>';
  if (delayMin <= 5)  return `<span style="color:#FFA726;font-size:10px">● +${delayMin} min</span>`;
  return `<span style="color:#EF5350;font-size:10px">● +${delayMin} min hilja</span>`;
}

// ─── Render route ─────────────────────────────────────────────────────────────
function renderItinerary(it, destName) {
  const legs = it.legs;
  const walkLegs = legs.filter(l => l.mode === 'WALK');
  const totalWalkDist = Math.round(walkLegs.reduce((s, l) => s + (l.distance || 0), 0));
  const totalWalkMins = Math.round(walkLegs.reduce((s, l) => s + l.duration, 0) / 60);

  // Build timeline items
  const items = [];
  items.push({ type: 'depart', leg: legs[0], isFirst: true });

  legs.forEach((leg, i) => {
    const nextLeg = legs[i + 1];
    items.push({ type: 'leg', leg });

    if (!nextLeg) {
      const name = leg.to.name === 'Destination' ? destName : leg.to.name;
      items.push({ type: 'arrive', time: leg.endTime, name, color: (MODES[leg.mode] || MODES.BUS).color, isLast: true });
    } else {
      const waitMin = Math.round((nextLeg.startTime - leg.endTime) / 60000);
      if (waitMin >= 1) {
        items.push({ type: 'arrive', time: leg.endTime, name: leg.to.name, color: (MODES[leg.mode] || MODES.BUS).color, isLast: false });
        items.push({ type: 'wait', minutes: waitMin });
        items.push({ type: 'depart', leg: nextLeg, isFirst: false });
      }
    }
  });

  // Header
  let html = `
    <div class="flex justify-between items-start mb-4">
      <span class="text-2xl font-bold">${formatDuration(it.duration)}</span>
      <div class="text-right">
        <div class="text-sm">Kohal kell <span class="font-bold">${formatTime(it.endTime)}</span></div>
        <div class="text-[#8B8FA8] text-xs mt-0.5">🚶 ${totalWalkMins} min · ${formatDist(totalWalkDist)}</div>
      </div>
    </div><div>`;

  // Render items
  items.forEach(item => {
    if (item.type === 'depart') {
      const m = MODES[item.leg.mode] || MODES.BUS;
      const name = item.isFirst && item.leg.from.name === 'Origin' ? '📍 Sinu asukoht' : item.leg.from.name;
      html += `
        <div class="leg-row">
          <div class="leg-line-col">
            <div class="leg-dot" style="background:${m.color}"></div>
            <div class="leg-vert-line" style="background:${m.color}44"></div>
          </div>
          <div class="leg-content">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-sm font-bold text-[#8B8FA8] min-w-[44px]">${formatTime(item.leg.startTime)}</span>
              <span class="text-sm font-medium">${name}</span>
              ${!item.isFirst ? '<span class="text-xs text-[#8B8FA8]">lahkub</span>' : ''}
            </div>
          </div>
        </div>`;
    }

    else if (item.type === 'leg') {
      const leg = item.leg;
      const m = MODES[leg.mode] || MODES.BUS;
      const operator = '';
      html += `
        <div class="leg-row">
          <div class="leg-line-col">
            <div class="leg-vert-line" style="background:${m.color}44"></div>
          </div>
          <div class="leg-content">
            <div class="inline-flex flex-wrap items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium mb-2" style="background:${m.color}15; color:${m.color}">
              <span>${m.icon}</span>
              ${leg.mode === 'WALK'
                ? `<span>Kõnni ${formatDuration(leg.duration)} · ${formatDist(leg.distance)}</span>`
                : `<span>${leg.trip?.routeShortName || m.label} → ${leg.to.name}</span>
                   <span style="opacity:0.7">saabub ${formatTime(leg.endTime)}</span>
                   ${operator ? `<span style="opacity:0.5">· ${operator}</span>` : ''}
                   ${realtimeBadge(leg)}`
              }
            </div>
          </div>
        </div>`;
    }

    else if (item.type === 'arrive') {
      html += `
        <div class="leg-row">
          <div class="leg-line-col">
            <div class="leg-dot" style="background:${item.color}${item.isLast ? ';box-shadow:0 0 0 4px ' + item.color + '33;width:16px;height:16px' : ''}"></div>
            ${!item.isLast ? '' : ''}
          </div>
          <div class="leg-content pb-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold text-[#8B8FA8] min-w-[44px]">${formatTime(item.time)}</span>
              <span class="text-sm ${item.isLast ? 'font-bold' : ''}">${item.name}</span>
              ${item.isLast ? '<span class="text-[#2BC48A]">✓</span>' : '<span class="text-xs text-[#8B8FA8]">saabus</span>'}
            </div>
          </div>
        </div>`;
    }

    else if (item.type === 'wait') {
      html += `
        <div class="leg-row" style="min-height:32px">
          <div class="leg-line-col">
            <div style="width:2px;flex:1;margin:2px auto;background:repeating-linear-gradient(to bottom,#8B8FA855 0,#8B8FA855 4px,transparent 4px,transparent 8px)"></div>
          </div>
          <div class="leg-content flex items-center" style="padding-bottom:6px">
            <span class="text-xs px-2 py-1 rounded-full" style="background:#FFA72618;color:#FFA726">⏳ Oota ${item.minutes} min</span>
          </div>
        </div>`;
    }
  });

  html += '</div>';
  return html;
}

// ─── Navigate ─────────────────────────────────────────────────────────────────
async function navigate(key) {
  const dest = getPlace(key);
  if (!dest) { openSetup(); return; }

  showScreen('screen-loading');
  document.getElementById('loading-text').textContent = 'Tuvastame asukohta...';

  let from;
  try {
    from = await getLocation();
  } catch (e) {
    const cached = getCachedRoute(key);
    if (cached) { showRoute(key, cached, true); return; }
    alert('GPS ei tööta. Kontrolli rakenduse asukoaluba (Settings → Safari → Location).');
    showScreen('screen-main');
    return;
  }

  document.getElementById('loading-text').textContent = 'Otsin parimat marsruuti...';

  let itineraries, driveMin;
  try {
    [itineraries, driveMin] = await Promise.all([
      fetchRoute(from, dest),
      fetchDriveTime(from, dest).catch(() => null)
    ]);
  } catch (e) {
    console.error('API error:', e);
    const cached = getCachedRoute(key);
    if (cached) { showRoute(key, cached, true, null, null); return; }
    alert(`Marsruudi otsimine ebaõnnestus:\n${e.message}\n\nKontrolli internetiühendust.`);
    showScreen('screen-main');
    return;
  }

  if (!itineraries || itineraries.length === 0) {
    alert('Marsruuti ei leitud. Proovi hiljem uuesti.');
    showScreen('screen-main');
    return;
  }

  // Log prediction for learning
  if (key) logPrediction(key, Math.round(itineraries[0].duration / 60));

  _currentRouteKey = key;
  cacheRoute(key, itineraries);
  showRoute(key, itineraries, false, null, driveMin, dest);
}

function showRoute(key, itineraries, fromCache, overrideTitle, driveMin, destObj) {
  const dest = destObj || (key ? getPlace(key) : null);
  const title = overrideTitle
    ? '📍 ' + overrideTitle
    : key === 'work' ? '🏢 ' + dest.name : '🏠 ' + dest.name;
  document.getElementById('route-title').textContent = title;

  // Drive time + Waze button
  const driveEl = document.getElementById('route-drive-info');
  if (dest && (driveMin || true)) {
    const wazeUrl = `waze://?ll=${dest.lat},${dest.lon}&navigate=yes`;
    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lon}&travelmode=driving`;
    driveEl.innerHTML = `
      <div class="flex items-center gap-3 px-6 py-3 border-t border-[#252838]">
        ${driveMin ? `<span class="text-xs text-[#8B8FA8]">🚗 ~${driveMin} min autoga</span>` : ''}
        <a href="${wazeUrl}" onclick="if(!navigator.userAgent.includes('iPhone')){window.open('${gmapsUrl}');return false;}"
          class="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold"
          style="background:#33CCFF18;color:#33CCFF">
          Ava Waze →
        </a>
      </div>`;
    driveEl.classList.remove('hidden');
  } else {
    driveEl.classList.add('hidden');
  }
  document.getElementById('route-cache-badge').classList.toggle('hidden', !fromCache);

  const container = document.getElementById('route-itineraries');
  container.innerHTML = '';

  itineraries.slice(0, 3).forEach((it, i) => {
    const card = document.createElement('div');
    card.className = 'route-card' + (i > 0 ? ' route-card-alt mt-2' : '');
    if (i > 0) {
      const destLabel = overrideTitle || (dest ? dest.name : '');
    card.innerHTML = `
        <p class="text-xs text-[#8B8FA8] mb-3 font-medium">Valik ${i + 1}</p>
        ${renderItinerary(it, destLabel)}`;
    } else {
      const dLabel = overrideTitle || (dest ? dest.name : '');
      card.innerHTML = `
        <p class="text-xs text-[#3D9CF0] mb-3 font-medium">⚡ KIIREIM</p>
        ${renderItinerary(it, dLabel)}`;
    }
    container.appendChild(card);
  });

  showScreen('screen-route');
}

// ─── Search history ───────────────────────────────────────────────────────────
function getHistory() {
  return JSON.parse(localStorage.getItem('search_history') || '[]');
}
function addToHistory(place) {
  let h = getHistory().filter(p => p.name !== place.name);
  h.unshift(place);
  localStorage.setItem('search_history', JSON.stringify(h.slice(0, 5)));
}

// ─── Main screen search ───────────────────────────────────────────────────────
let _searchTimer = null;

function onMainSearchFocus() {
  const input = document.getElementById('main-search-input');
  if (!input.value.trim()) showSearchHistory();
}

function onMainSearch(value) {
  document.getElementById('main-search-clear').classList.toggle('hidden', !value);
  clearTimeout(_searchTimer);
  if (!value.trim()) { showSearchHistory(); return; }
  _searchTimer = setTimeout(() => runMainSearch(value), 350);
}

function clearMainSearch() {
  document.getElementById('main-search-input').value = '';
  document.getElementById('main-search-clear').classList.add('hidden');
  showSearchHistory();
}

function showSearchHistory() {
  const history = getHistory();
  const el = document.getElementById('main-search-results');
  if (!history.length) { el.classList.add('hidden'); return; }

  el.innerHTML = `
    <p class="text-[#8B8FA8] text-xs px-4 pt-3 pb-1 font-medium">VIIMASED OTSINGUD</p>
    ${history.map((p, i) => `
      <button onclick="navigateTo(${i}, 'history')"
        class="w-full text-left px-4 py-3 text-sm flex items-center gap-3 border-t border-[#252838] first:border-0 active:bg-[#252838]">
        <span class="text-[#8B8FA8]">🕐</span>
        <span class="truncate">${p.name}</span>
      </button>`).join('')}`;
  el.classList.remove('hidden');
}

async function geocodeQuery(query) {
  // Try Pelias (peatus.ee) first — knows Estonian landmarks, stops, malls
  try {
    const params = new URLSearchParams({ text: query, lang: 'et', size: 5 });
    // Bias results toward Estonia if we have a recent location
    if (_quickInfoFrom) {
      params.set('focus.point.lat', _quickInfoFrom.lat);
      params.set('focus.point.lon', _quickInfoFrom.lon);
    }
    const res = await fetch(`${PELIAS_URL}?${params}`);
    const json = await res.json();
    if (json.features && json.features.length) {
      return json.features.map(f => ({
        name: f.properties.label || f.properties.name,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0]
      }));
    }
  } catch (e) { /* fall through to Nominatim */ }

  // Fallback: Nominatim
  const params = new URLSearchParams({ q: query, format: 'json', countrycodes: 'ee', limit: 5 });
  const res = await fetch(`${GEOCODE_URL}?${params}`, {
    headers: { 'Accept-Language': 'et', 'User-Agent': 'ReisiApp/1.0' }
  });
  const results = await res.json();
  return results.map(r => ({
    name: r.display_name.split(',').slice(0, 3).join(', '),
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon)
  }));
}

async function runMainSearch(query) {
  const el = document.getElementById('main-search-results');
  el.innerHTML = '<p class="text-[#8B8FA8] text-xs px-4 py-3">Otsin...</p>';
  el.classList.remove('hidden');

  try {
    const results = await geocodeQuery(query);
    if (!results.length) {
      el.innerHTML = '<p class="text-[#8B8FA8] text-xs px-4 py-3">Tulemusi ei leitud.</p>';
      return;
    }
    window._searchResults = results;
    el.innerHTML = results.map((r, i) => `
      <button onclick="navigateTo(${i}, 'search')"
        class="w-full text-left px-4 py-3 text-sm flex items-center gap-3 border-t border-[#252838] first:border-0 active:bg-[#252838]">
        <span class="text-[#8B8FA8]">📍</span>
        <span class="truncate">${r.name}</span>
      </button>`).join('');
  } catch (e) {
    el.innerHTML = '<p class="text-[#8B8FA8] text-xs px-4 py-3">Viga otsingus.</p>';
  }
}

async function navigateTo(idx, source) {
  const place = source === 'history' ? getHistory()[idx] : window._searchResults[idx];
  if (!place) return;

  // Save to history
  addToHistory(place);

  // Close search UI
  document.getElementById('main-search-input').value = '';
  document.getElementById('main-search-clear').classList.add('hidden');
  document.getElementById('main-search-results').classList.add('hidden');

  // Navigate
  showScreen('screen-loading');
  document.getElementById('loading-text').textContent = 'Tuvastame asukohta...';

  let from;
  try {
    from = await getLocation();
  } catch (e) {
    alert('GPS ei tööta. Kontrolli asukoaluba.');
    showScreen('screen-main');
    return;
  }

  document.getElementById('loading-text').textContent = 'Otsin marsruuti...';

  let itineraries, driveMin;
  try {
    [itineraries, driveMin] = await Promise.all([
      fetchRoute(from, place),
      fetchDriveTime(from, place).catch(() => null)
    ]);
  } catch (e) {
    alert(`Marsruudi otsimine ebaõnnestus:\n${e.message}`);
    showScreen('screen-main');
    return;
  }

  if (!itineraries || !itineraries.length) {
    alert('Marsruuti ei leitud.');
    showScreen('screen-main');
    return;
  }

  _currentRouteKey = null;
  showRoute(null, itineraries, false, place.name, driveMin, place);
}

// ─── Geocoding ────────────────────────────────────────────────────────────────
async function searchPlace(key) {
  const input = document.getElementById(key + '-search');
  const query = input.value.trim();
  if (!query) return;

  const resultsEl = document.getElementById(key + '-results');
  resultsEl.innerHTML = '<p class="text-[#8B8FA8] text-xs px-1 py-2">Otsin...</p>';

  try {
    const results = await geocodeQuery(query);

    if (!results.length) {
      resultsEl.innerHTML = '<p class="text-[#8B8FA8] text-xs px-1 py-2">Tulemusi ei leitud. Proovi täpsema nimega.</p>';
      return;
    }

    resultsEl.innerHTML = results.map((r, i) => `
      <button onclick="selectPlace('${key}', ${i})" data-result='${JSON.stringify(r).replace(/'/g, '&#39;')}'
        class="w-full text-left bg-[#13141F] border border-[#252838] rounded-xl px-4 py-3 text-sm hover:border-[#3D9CF0] transition-colors">
        <span class="block font-medium truncate">${r.name}</span>
      </button>`).join('');

  } catch (e) {
    resultsEl.innerHTML = '<p class="text-[#8B8FA8] text-xs px-1 py-2">Viga otsingus. Kontrolli internetiühendust.</p>';
  }
}

function selectPlace(key, idx) {
  const btn = document.querySelectorAll(`#${key}-results button`)[idx];
  const data = JSON.parse(btn.getAttribute('data-result'));

  savePlace(key, data);

  // Show selected state
  document.getElementById(`${key}-selected-name`).textContent = data.name;
  document.getElementById(`${key}-selected`).classList.remove('hidden');
  document.getElementById(`${key}-search-area`).classList.add('hidden');

  checkBothSelected();
}

function clearPlace(key) {
  document.getElementById(`${key}-selected`).classList.add('hidden');
  document.getElementById(`${key}-search-area`).classList.remove('hidden');
  document.getElementById(`${key}-search`).value = '';
  document.getElementById(`${key}-results`).innerHTML = '';
  document.getElementById('setup-save-btn').classList.add('hidden');
}

function checkBothSelected() {
  const home = getPlace('home');
  const work = getPlace('work');
  document.getElementById('setup-save-btn').classList.toggle('hidden', !home || !work);
}

// ─── Setup ────────────────────────────────────────────────────────────────────
function openSetup() {
  const home = getPlace('home');
  const work = getPlace('work');
  const fromMain = !!(home || work);

  // Show back button only if already configured
  document.getElementById('setup-back-btn').classList.toggle('hidden', !fromMain);

  // Show existing selections if any
  for (const key of ['home', 'work']) {
    const place = getPlace(key);
    if (place) {
      document.getElementById(`${key}-selected-name`).textContent = place.name;
      document.getElementById(`${key}-selected`).classList.remove('hidden');
      document.getElementById(`${key}-search-area`).classList.add('hidden');
    } else {
      document.getElementById(`${key}-selected`).classList.add('hidden');
      document.getElementById(`${key}-search-area`).classList.remove('hidden');
      document.getElementById(`${key}-results`).innerHTML = '';
      document.getElementById(`${key}-search`).value = '';
    }
  }

  checkBothSelected();
  showScreen('screen-setup');
}

function saveSetup() {
  const home = getPlace('home');
  const work = getPlace('work');
  if (!home) { alert('Vali kodu asukoht'); return; }
  if (!work)  { alert('Vali töö asukoht');  return; }
  updateMainScreen();
  showScreen('screen-main');
}

async function useGPS(key, btn) {
  btn.textContent = '⏳ Tuvastame...';
  try {
    const pos = await getLocation();
    // Reverse geocode to get a name
    const params = new URLSearchParams({ lat: pos.lat, lon: pos.lon, format: 'json', zoom: 17, addressdetails: 1 });
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { 'Accept-Language': 'et', 'User-Agent': 'ReisiApp/1.0' }
    });
    const data = await res.json();
    const name = data.display_name ? data.display_name.split(',').slice(0, 2).join(', ') : 'GPS asukoht';
    savePlace(key, { name, lat: pos.lat, lon: pos.lon });
    document.getElementById(`${key}-selected-name`).textContent = name;
    document.getElementById(`${key}-selected`).classList.remove('hidden');
    document.getElementById(`${key}-search-area`).classList.add('hidden');
    checkBothSelected();
  } catch (e) {
    btn.textContent = key === 'home' ? '📍 Kasuta praegust asukohta' : '📍 Kasuta praegust asukohta';
    alert('GPS ei tööta. Proovi uuesti.');
  }
}

// ─── Quick info (main screen cards) ──────────────────────────────────────────
let _quickInfoFrom = null;
let _quickInfoInterval = null;
let _currentRouteKey = null;

async function loadQuickInfo() {
  const home = getPlace('home');
  const work = getPlace('work');
  if (!home || !work) return;

  document.getElementById('work-quick').textContent = '⏳ Laen...';
  document.getElementById('home-quick').textContent = '⏳ Laen...';

  try {
    _quickInfoFrom = await getLocation();
  } catch (e) {
    showCachedQuickInfo('work');
    showCachedQuickInfo('home');
    return;
  }

  await Promise.allSettled([
    updateCardQuickInfo('work', _quickInfoFrom),
    updateCardQuickInfo('home', _quickInfoFrom)
  ]);
}

function showCachedQuickInfo(key) {
  const cached = getCachedRoute(key);
  const el = document.getElementById(`${key}-quick`);
  if (cached && cached.length) {
    el.textContent = buildQuickText(cached[0]) + ' 📵';
  } else {
    el.textContent = 'Puudutage marsruudi nägemiseks';
  }
}

function buildQuickText(itinerary) {
  const firstTransit = itinerary.legs.find(l => l.mode !== 'WALK');
  const firstWalk = itinerary.legs[0];
  if (!firstTransit) return `🚶 Kõnd ${formatDuration(itinerary.duration)}`;

  const walkMins = Math.round((firstWalk?.mode === 'WALK' ? firstWalk.duration : 0) / 60);
  const leaveInMins = Math.round((firstTransit.startTime - Date.now()) / 60000) - walkMins;
  const routeName = firstTransit.trip?.routeShortName || firstTransit.mode;
  const arriveTime = formatTime(itinerary.endTime);

  const leaveText = leaveInMins <= 1
    ? '⚡ Lahku kohe!'
    : `Lahku ${leaveInMins} min pärast`;

  return `${leaveText} · ${routeName} → kohal ${arriveTime}`;
}

async function updateCardQuickInfo(key, from) {
  const dest = getPlace(key);
  const el = document.getElementById(`${key}-quick`);

  // Check if already at destination (~200m radius)
  const dist = getDistanceMeters(from, dest);
  if (dist < 200) { el.textContent = '✓ Oled juba siin'; return; }

  try {
    const itineraries = await fetchRoute(from, dest);
    if (!itineraries || !itineraries.length) { el.textContent = 'Marsruuti ei leitud'; return; }
    cacheRoute(key, itineraries);
    logPrediction(key, Math.round(itineraries[0].duration / 60));
    const avg = getAvgPrediction(key);
    const avgText = avg ? ` · tavaliselt ~${avg} min` : '';
    el.textContent = buildQuickText(itineraries[0]) + avgText;
  } catch (e) {
    showCachedQuickInfo(key);
  }
}

// ─── Refresh current route ────────────────────────────────────────────────────
async function refreshRoute() {
  const btn = document.getElementById('route-refresh-btn');
  btn.style.opacity = '0.4';
  btn.style.pointerEvents = 'none';
  if (_currentRouteKey) await navigate(_currentRouteKey);
  btn.style.opacity = '1';
  btn.style.pointerEvents = 'auto';
}

// ─── Main screen update ───────────────────────────────────────────────────────
function updateMainScreen() {
  const home = getPlace('home');
  const work = getPlace('work');

  document.getElementById('main-greeting').textContent = greeting();
  document.getElementById('main-time').textContent = new Date().toLocaleString('et-EE', {
    weekday: 'long', hour: '2-digit', minute: '2-digit'
  });

  document.getElementById('home-name').textContent = home ? home.name : 'Seadistamata';
  document.getElementById('work-name').textContent = work ? work.name : 'Seadistamata';

  if (home && work) loadQuickInfo();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  }

  const home = getPlace('home');
  const work = getPlace('work');

  if (!home || !work) {
    openSetup();
  } else {
    updateMainScreen();
    showScreen('screen-main');
  }

  // Refresh time + quick info every 60 seconds
  setInterval(() => {
    document.getElementById('main-time').textContent = new Date().toLocaleString('et-EE', {
      weekday: 'long', hour: '2-digit', minute: '2-digit'
    });
    if (document.getElementById('screen-main').classList.contains('active')) {
      updateMainScreen();
    }
  }, 60000);
});
