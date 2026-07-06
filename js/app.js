(function () {
  'use strict';

  /* ---------- Theme ---------- */
  const root = document.documentElement;
  const themeToggle = document.getElementById('themeToggle');
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) root.setAttribute('data-theme', savedTheme);

  function currentTheme() {
    if (root.getAttribute('data-theme')) return root.getAttribute('data-theme');
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  themeToggle.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    setTileLayer(next);
  });

  /* ---------- Sidebar (mobile) ---------- */
  const sidebar = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const sidebarToggle = document.getElementById('sidebarToggle');
  function openSidebar() { sidebar.classList.add('open'); sidebarBackdrop.classList.add('show'); }
  function closeSidebar() { sidebar.classList.remove('open'); sidebarBackdrop.classList.remove('show'); }
  sidebarToggle.addEventListener('click', () => sidebar.classList.contains('open') ? closeSidebar() : openSidebar());
  sidebarBackdrop.addEventListener('click', closeSidebar);

  /* ---------- Toast ---------- */
  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  /* ---------- Style config ---------- */
  const STATUS_COLORS = {
    'Ավարտված': 'var(--status-good)',
    'Ընթացիկ': 'var(--status-warning)',
    'Նախատեսվող': 'var(--status-info)',
    'Անհայտ': 'var(--status-muted)',
  };
  const STATUS_COLORS_RAW_LIGHT = {
    'Ավարտված': '#0ca30c', 'Ընթացիկ': '#c98500', 'Նախատեսվող': '#2a78d6', 'Անհայտ': '#898781',
  };
  const STATUS_COLORS_RAW_DARK = {
    'Ավարտված': '#0ca30c', 'Ընթացիկ': '#fab219', 'Նախատեսվող': '#3987e5', 'Անհայտ': '#8f8d87',
  };
  const STATUS_LABELS = {
    'Ավարտված': 'Ավարտված', 'Ընթացիկ': 'Ընթացիկ', 'Նախատեսվող': 'Նախատեսված', 'Անհայտ': 'Անհայտ',
  };
  const STATUS_ORDER = ['Ավարտված', 'Ընթացիկ', 'Նախատեսվող', 'Անհայտ'];

  const TYPE_COLORS = {
    'Միջնակարգ դպրոց': 'var(--series-blue)',
    'Հիմնական դպրոց': 'var(--series-aqua)',
    'Ավագ դպրոց': 'var(--series-yellow)',
    'Կրթահամալիր': 'var(--series-violet)',
    'Անհայտ': 'var(--status-muted)',
  };
  const SPONSOR_COLORS = {
    'Կառավարություն': 'var(--series-blue)',
    'Բարեգործական ըն': 'var(--series-magenta)',
    'Անհայտ': 'var(--status-muted)',
  };

  function statusColorRaw(status) {
    const dark = currentTheme() === 'dark';
    return (dark ? STATUS_COLORS_RAW_DARK : STATUS_COLORS_RAW_LIGHT)[status] || '#898781';
  }

  /* ---------- State ---------- */
  const state = {
    all: [],
    filtered: [],
    search: '',
    province: '',
    community: '',
    types: new Set(),
    statuses: new Set(),
    sponsors: new Set(),
    capMin: 0,
    capMax: 1000,
    capBounds: [0, 1000],
  };

  /* ---------- Map setup ---------- */
  const map = L.map('map', { zoomControl: false, minZoom: 6, maxZoom: 19 }).setView([40.2, 44.3], 10);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const tileLayers = {
    light: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19, subdomains: 'abcd',
    }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19, subdomains: 'abcd',
    }),
  };
  let activeTileLayer = null;
  function setTileLayer(theme) {
    const layer = tileLayers[theme === 'dark' ? 'dark' : 'light'];
    if (activeTileLayer) map.removeLayer(activeTileLayer);
    layer.addTo(map);
    activeTileLayer = layer;
    // recolor markers to match theme's status ramp
    renderMarkers();
  }

  const clusterGroup = L.markerClusterGroup({
    maxClusterRadius: 48,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: function (cluster) {
      const count = cluster.getChildCount();
      const size = count < 10 ? 34 : count < 25 ? 42 : 50;
      return L.divIcon({
        html: `<div style="width:${size}px;height:${size}px">${count}</div>`,
        className: 'marker-cluster-custom',
        iconSize: [size, size],
      });
    },
  });
  map.addLayer(clusterGroup);

  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = STATUS_ORDER.map(s =>
      `<div><span class="lg-dot" style="background:${STATUS_COLORS[s]}"></span>${STATUS_LABELS[s]}</div>`
    ).join('');
    return div;
  };
  legend.addTo(map);

  setTileLayer(currentTheme());

  /* ---------- Number formatting & animated counters ---------- */
  const fmt = new Intl.NumberFormat('hy-AM');
  function animateCount(el, to) {
    const from = parseFloat(el.dataset.count) || 0;
    const duration = 700;
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = Math.round(from + (to - from) * eased);
      el.textContent = fmt.format(val);
      if (t < 1) requestAnimationFrame(step);
      else el.dataset.count = to;
    }
    requestAnimationFrame(step);
  }

  /* ---------- Load data ---------- */
  fetch('data/schools.geojson')
    .then(r => r.json())
    .then(geo => {
      state.all = geo.features.map(f => f.properties);
      init();
    })
    .catch(err => {
      console.error(err);
      toast('Տվյալները չհաջողվեց բեռնել');
    });

  function init() {
    buildProvinceOptions();
    buildCommunityOptions();
    buildChips('typeChips', uniqueSorted('type'), state.types, TYPE_COLORS);
    buildChips('statusChips', STATUS_ORDER.filter(s => state.all.some(f => f.status === s)), state.statuses, STATUS_COLORS, STATUS_LABELS);
    buildChips('sponsorChips', uniqueSorted('sponsor'), state.sponsors, SPONSOR_COLORS);

    const caps = state.all.map(f => f.studAll || 0);
    state.capBounds = [0, Math.max(10, Math.max(...caps))];
    const [cmin, cmax] = state.capBounds;
    const capMinInput = document.getElementById('capacityMin');
    const capMaxInput = document.getElementById('capacityMax');
    capMinInput.min = cmin; capMinInput.max = cmax; capMinInput.value = cmin;
    capMaxInput.min = cmin; capMaxInput.max = cmax; capMaxInput.value = cmax;
    state.capMin = cmin; state.capMax = cmax;
    updateRangeUI();

    bindEvents();
    applyFilters();

    setTimeout(() => document.getElementById('mapLoading').classList.add('hide'), 350);
  }

  function uniqueSorted(key) {
    return [...new Set(state.all.map(f => f[key]))].sort((a, b) => a.localeCompare(b, 'hy'));
  }

  function buildProvinceOptions() {
    const sel = document.getElementById('provinceSelect');
    const provinces = uniqueSorted('province');
    sel.innerHTML = '<option value="">Բոլոր մարզերը</option>' +
      provinces.map(p => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join('');
  }

  function buildCommunityOptions() {
    const sel = document.getElementById('communitySelect');
    const pool = state.province ? state.all.filter(f => f.province === state.province) : state.all;
    const communities = [...new Set(pool.map(f => f.community))].sort((a, b) => a.localeCompare(b, 'hy'));
    sel.innerHTML = '<option value="">Բոլոր համայնքները</option>' +
      communities.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
  }

  function buildChips(containerId, values, targetSet, colorMap, labelMap) {
    const container = document.getElementById(containerId);
    container.innerHTML = values.map(v => {
      const color = (colorMap && colorMap[v]) || 'var(--series-blue)';
      const label = (labelMap && labelMap[v]) || v;
      return `<button type="button" class="chip" data-value="${escapeAttr(v)}" style="--chip-color:${color}">
        <span class="lg-dot" style="background:${color}"></span>${escapeHtml(label)}
      </button>`;
    }).join('');
    container.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const v = chip.dataset.value;
        if (targetSet.has(v)) { targetSet.delete(v); chip.classList.remove('active'); }
        else { targetSet.add(v); chip.classList.add('active'); }
        applyFilters();
      });
    });
  }

  function updateRangeUI() {
    const track = document.querySelector('.range-slider__range');
    const [bmin, bmax] = state.capBounds;
    const span = Math.max(1, bmax - bmin);
    const leftPct = ((state.capMin - bmin) / span) * 100;
    const rightPct = ((state.capMax - bmin) / span) * 100;
    track.style.left = leftPct + '%';
    track.style.width = (rightPct - leftPct) + '%';
    document.getElementById('capacityRangeLabel').textContent = `${fmt.format(state.capMin)} – ${fmt.format(state.capMax)}`;
  }

  function bindEvents() {
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');
    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      searchClear.hidden = !searchInput.value;
      debounce = setTimeout(() => { state.search = searchInput.value.trim().toLowerCase(); applyFilters(); }, 200);
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = ''; state.search = ''; searchClear.hidden = true; applyFilters();
    });

    document.getElementById('provinceSelect').addEventListener('change', (e) => {
      state.province = e.target.value;
      document.getElementById('communitySelect').value = '';
      state.community = '';
      buildCommunityOptions();
      applyFilters();
    });
    document.getElementById('communitySelect').addEventListener('change', (e) => {
      state.community = e.target.value;
      applyFilters();
    });

    const capMinInput = document.getElementById('capacityMin');
    const capMaxInput = document.getElementById('capacityMax');
    function onRangeInput() {
      let mn = parseInt(capMinInput.value, 10);
      let mx = parseInt(capMaxInput.value, 10);
      if (mn > mx) { [mn, mx] = [mx, mn]; }
      state.capMin = mn; state.capMax = mx;
      updateRangeUI();
      applyFilters();
    }
    capMinInput.addEventListener('input', onRangeInput);
    capMaxInput.addEventListener('input', onRangeInput);

    document.getElementById('resetFilters').addEventListener('click', () => {
      state.search = ''; document.getElementById('searchInput').value = ''; searchClear.hidden = true;
      state.province = ''; document.getElementById('provinceSelect').value = '';
      state.community = ''; buildCommunityOptions(); document.getElementById('communitySelect').value = '';
      state.types.clear(); state.statuses.clear(); state.sponsors.clear();
      document.querySelectorAll('.chip.active').forEach(c => c.classList.remove('active'));
      state.capMin = state.capBounds[0]; state.capMax = state.capBounds[1];
      capMinInput.value = state.capMin; capMaxInput.value = state.capMax;
      updateRangeUI();
      applyFilters();
      toast('Զտիչները զրոյացվեցին');
    });
  }

  /* ---------- Filtering ---------- */
  function applyFilters() {
    state.filtered = state.all.filter(f => {
      if (state.search) {
        const hay = (f.name + ' ' + f.settlement + ' ' + f.community).toLowerCase();
        if (!hay.includes(state.search)) return false;
      }
      if (state.province && f.province !== state.province) return false;
      if (state.community && f.community !== state.community) return false;
      if (state.types.size && !state.types.has(f.type)) return false;
      if (state.statuses.size && !state.statuses.has(f.status)) return false;
      if (state.sponsors.size && !state.sponsors.has(f.sponsor)) return false;
      const cap = f.studAll || 0;
      if (cap < state.capMin || cap > state.capMax) return false;
      return true;
    });
    renderMarkers();
    renderStats();
    if (state.filtered.length === 0) toast('Արդյունքներ չեն գտնվել այս զտիչներով');
  }

  /* ---------- Rendering ---------- */
  function renderMarkers() {
    clusterGroup.clearLayers();
    const markers = state.filtered.map((f, i) => {
      const color = statusColorRaw(f.status);
      const icon = L.divIcon({
        className: '',
        html: `<div class="school-pin" style="background:${color};--pd:${Math.min(i * 12, 400)}ms"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 16],
        popupAnchor: [0, -16],
      });
      const marker = L.marker([f.lat, f.lon], { icon });
      marker.bindPopup(buildPopup(f), { closeButton: true, maxWidth: 300 });
      return marker;
    });
    clusterGroup.addLayers(markers);

    if (markers.length) {
      const group = L.featureGroup(markers);
      try {
        map.flyToBounds(group.getBounds().pad(0.15), { duration: 0.7 });
      } catch (e) { /* single point or bounds error, ignore */ }
    }
  }

  function buildPopup(f) {
    const color = statusColorRaw(f.status);
    const linkHtml = f.link
      ? `<a class="popup-card__link" href="${escapeAttr(f.link)}" target="_blank" rel="noopener noreferrer">🌐 Այցելել կայք</a>`
      : '';
    return `
      <div class="popup-card">
        <div class="popup-card__badge" style="background:color-mix(in srgb, ${color} 18%, transparent); color:${color}">
          <span class="lg-dot" style="background:${color}"></span>${escapeHtml(STATUS_LABELS[f.status] || f.status)}
        </div>
        <h3 class="popup-card__title">${escapeHtml(f.name)}</h3>
        <div class="popup-card__meta">${escapeHtml(f.settlement)}, ${escapeHtml(f.community)} · ${escapeHtml(f.type)}</div>
        <div class="popup-card__grid">
          <div><b>${fmt.format(f.studAll || 0)}</b><span>Աշակերտ</span></div>
          <div><b>${fmt.format(f.capacity || 0)}</b><span>Հզորություն</span></div>
          <div><b>${f.consArea ? fmt.format(Math.round(f.consArea)) : '—'}</b><span>մ² կառուցապատում</span></div>
          <div><b>${escapeHtml(f.sponsor)}</b><span>Ֆինանսավորող</span></div>
        </div>
        ${linkHtml}
      </div>`;
  }

  function renderStats() {
    const items = state.filtered;
    animateCount(document.getElementById('statTotal'), items.length);
    animateCount(document.getElementById('statStudents'), items.reduce((s, f) => s + (f.studAll || 0), 0));
    animateCount(document.getElementById('statArea'), Math.round(items.reduce((s, f) => s + (f.consArea || 0), 0)));

    document.getElementById('resultsCount').textContent =
      `${fmt.format(items.length)} / ${fmt.format(state.all.length)} դպրոց ցուցադրված է`;

    const counts = {};
    STATUS_ORDER.forEach(s => counts[s] = 0);
    items.forEach(f => { counts[f.status] = (counts[f.status] || 0) + 1; });
    const total = Math.max(1, items.length);
    const bar = document.getElementById('statusBar');
    bar.innerHTML = STATUS_ORDER.filter(s => counts[s] > 0).map(s =>
      `<span style="width:${(counts[s] / total) * 100}%; background:${STATUS_COLORS[s]}" title="${STATUS_LABELS[s]}: ${counts[s]}"></span>`
    ).join('');
    const legendEl = document.getElementById('statusBarLegend');
    legendEl.innerHTML = STATUS_ORDER.filter(s => counts[s] > 0).map(s =>
      `<div class="lg-item"><span class="lg-dot" style="background:${STATUS_COLORS[s]}"></span>${STATUS_LABELS[s]} · ${counts[s]}</div>`
    ).join('');
  }

  /* ---------- Utils ---------- */
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(str) { return escapeHtml(str); }

})();
