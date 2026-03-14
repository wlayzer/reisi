// ─── Config ───────────────────────────────────────────────────────────────────
const API_URL = 'https://api.peatus.ee/routing/v1/routers/estonia/index/graphql';
const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';

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
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().slice(0, 8);

  const query = `{
    plan(
      from: { lat: ${from.lat}, lon: ${from.lon} }
      to:   { lat: ${to.lat},   lon: ${to.lon}   }
      date: "${date}"
      time: "${time}"
      numItineraries: 3
      transportModes: [
        { mode: WALK }
        { mode: RAIL }
        { mode: BUS }
        { mode: TRAM }
        { mode: FERRY }
      ]
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
          from { name lat lon }
          to   { name lat lon }
          trip { routeShortName routeLongName }
        }
      }
    }
  }`;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  if (!res.ok) throw new Error(`API viga ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data.plan.itineraries;
}

// ─── Render route ─────────────────────────────────────────────────────────────
function renderItinerary(it) {
  const legs = it.legs;
  let html = `
    <div class="flex justify-between items-baseline mb-4">
      <span class="text-2xl font-bold">${formatDuration(it.duration)}</span>
      <span class="text-[#8B8FA8] text-sm">Kohal kell <span class="text-white font-semibold">${formatTime(it.endTime)}</span></span>
    </div>
    <div>`;

  legs.forEach((leg, i) => {
    const m = MODES[leg.mode] || MODES.BUS;
    const isLast = i === legs.length - 1;

    // Stop row
    html += `
      <div class="leg-row">
        <div class="leg-line-col">
          <div class="leg-dot" style="background:${m.color}"></div>
          ${!isLast ? `<div class="leg-vert-line" style="background:${m.line}33"></div>` : ''}
        </div>
        <div class="leg-content">
          <div class="flex items-baseline gap-2 mb-1">
            <span class="text-sm font-semibold text-[#8B8FA8]">${formatTime(leg.startTime)}</span>
            <span class="text-sm font-medium truncate">${leg.from.name}</span>
          </div>
          <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium mb-1"
               style="background:${m.color}18; color:${m.color}">
            <span>${m.icon}</span>
            <span>${leg.mode === 'WALK'
              ? `Kõnni ${formatDuration(leg.duration)} · ${formatDist(leg.distance)}`
              : `${leg.trip?.routeShortName || m.label}  →  ${leg.to.name}`
            }</span>
          </div>
        </div>
      </div>`;

    // Final stop
    if (isLast) {
      html += `
        <div class="leg-row">
          <div class="leg-line-col">
            <div class="leg-dot" style="background:${m.color}; box-shadow:0 0 0 3px ${m.color}33"></div>
          </div>
          <div class="leg-content">
            <div class="flex items-baseline gap-2">
              <span class="text-sm font-semibold text-[#8B8FA8]">${formatTime(leg.endTime)}</span>
              <span class="text-sm font-bold">${leg.to.name}</span>
              <span class="text-green-400 text-xs">✓</span>
            </div>
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

  let itineraries;
  try {
    itineraries = await fetchRoute(from, dest);
  } catch (e) {
    console.error('API error:', e);
    const cached = getCachedRoute(key);
    if (cached) { showRoute(key, cached, true); return; }
    alert(`Marsruudi otsimine ebaõnnestus:\n${e.message}\n\nKontrolli internetiühendust.`);
    showScreen('screen-main');
    return;
  }

  if (!itineraries || itineraries.length === 0) {
    alert('Marsruuti ei leitud. Proovi hiljem uuesti.');
    showScreen('screen-main');
    return;
  }

  cacheRoute(key, itineraries);
  showRoute(key, itineraries, false);
}

function showRoute(key, itineraries, fromCache) {
  const dest = getPlace(key);
  document.getElementById('route-title').textContent = key === 'work' ? '🏢 ' + dest.name : '🏠 ' + dest.name;
  document.getElementById('route-cache-badge').classList.toggle('hidden', !fromCache);

  const container = document.getElementById('route-itineraries');
  container.innerHTML = '';

  itineraries.slice(0, 3).forEach((it, i) => {
    const card = document.createElement('div');
    card.className = 'route-card' + (i > 0 ? ' route-card-alt mt-2' : '');
    if (i > 0) {
      card.innerHTML = `
        <p class="text-xs text-[#8B8FA8] mb-3 font-medium">Valik ${i + 1}</p>
        ${renderItinerary(it)}`;
    } else {
      card.innerHTML = `
        <p class="text-xs text-[#3D9CF0] mb-3 font-medium">⚡ KIIREIM</p>
        ${renderItinerary(it)}`;
    }
    container.appendChild(card);
  });

  showScreen('screen-route');
}

// ─── Geocoding ────────────────────────────────────────────────────────────────
async function searchPlace(key) {
  const input = document.getElementById(key + '-search');
  const query = input.value.trim();
  if (!query) return;

  const resultsEl = document.getElementById(key + '-results');
  resultsEl.innerHTML = '<p class="text-[#8B8FA8] text-xs px-1 py-2">Otsin...</p>';

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      countrycodes: 'ee',
      limit: 5,
      addressdetails: 1
    });
    const res = await fetch(`${GEOCODE_URL}?${params}`, {
      headers: { 'Accept-Language': 'et', 'User-Agent': 'ReisiApp/1.0' }
    });
    const results = await res.json();

    if (!results.length) {
      resultsEl.innerHTML = '<p class="text-[#8B8FA8] text-xs px-1 py-2">Tulemusi ei leitud. Proovi täpsema nimega.</p>';
      return;
    }

    resultsEl.innerHTML = results.map((r, i) => {
      const displayName = r.display_name.split(',').slice(0, 3).join(', ');
      return `<button onclick="selectPlace('${key}', ${i})" data-result='${JSON.stringify({
        name: displayName,
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon)
      }).replace(/'/g, '&#39;')}'
        class="w-full text-left bg-[#13141F] border border-[#252838] rounded-xl px-4 py-3 text-sm hover:border-[#3D9CF0] transition-colors">
        <span class="block font-medium truncate">${displayName}</span>
      </button>`;
    }).join('');

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

  // Refresh time every minute
  setInterval(() => {
    document.getElementById('main-time').textContent = new Date().toLocaleString('et-EE', {
      weekday: 'long', hour: '2-digit', minute: '2-digit'
    });
  }, 60000);
});
