(function () {
  'use strict';

  /* ---------- Theme ---------- */
  const root = document.documentElement;
  const themeToggle = document.getElementById('themeToggle');
  let savedTheme;
  try { savedTheme = localStorage.getItem('theme'); } catch (_) {}
  root.setAttribute('data-theme', savedTheme === 'dark' ? 'dark' : 'light');

  function currentTheme() {
    if (root.getAttribute('data-theme')) return root.getAttribute('data-theme');
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  themeToggle.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (_) {}
    setTileLayer(next);
  });

  /* ---------- Sidebar (mobile) ---------- */
  const sidebar = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  const sidebarToggle = document.getElementById('sidebarToggle');
  function openSidebar() { sidebar.classList.add('open'); sidebarBackdrop.classList.add('show'); sidebarToggle.setAttribute('aria-expanded', 'true'); document.getElementById('filtersToggle').setAttribute('aria-expanded', 'true'); document.getElementById('sidebarClose').focus(); }
  function closeSidebar() { sidebar.classList.remove('open'); sidebarBackdrop.classList.remove('show'); sidebarToggle.setAttribute('aria-expanded', 'false'); document.getElementById('filtersToggle').setAttribute('aria-expanded', 'false'); }
  sidebarToggle.addEventListener('click', () => sidebar.classList.contains('open') ? closeSidebar() : openSidebar());
  sidebarBackdrop.addEventListener('click', closeSidebar);
  document.getElementById('sidebarClose').addEventListener('click', () => { closeSidebar(); document.getElementById('filtersToggle').focus(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('schoolDetails').hidden) closeDetails();
      if (root.classList.contains('presentation-mode')) togglePresentation(false);
    }
    if (e.key === 'Escape' && sidebar.classList.contains('open')) { closeSidebar(); sidebarToggle.focus(); }
    if (e.key === 'Tab' && sidebar.classList.contains('open')) {
      const controls = [...sidebar.querySelectorAll('button, input, select')].filter(el => !el.hidden && el.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

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
    const variable = { 'Ավարտված': '--status-good', 'Ընթացիկ': '--status-warning', 'Նախատեսվող': '--status-info' }[status] || '--status-muted';
    return getComputedStyle(root).getPropertyValue(variable).trim() || '#87958e';
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

  let analysisOrigin = null;

  /* ---------- Map setup ---------- */
  if (!window.L || !L.markerClusterGroup) {
    document.getElementById('mapLoading').innerHTML = '<p>Քարտեզը չհաջողվեց բեռնել։ Ստուգեք ինտերնետ կապը և թարմացրեք էջը։</p>';
    return;
  }
  const markerById = new Map();
  const map = L.map('map', { zoomControl: false, minZoom: 6, maxZoom: 19 }).setView([40.2, 44.3], 10);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const tileLayers = {
    light: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19,
    }),
    dark: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19, className: 'dark-map-tiles',
    }),
  };
  let activeTileLayer = null;
  function setTileLayer(theme) {
    const layer = tileLayers[theme === 'dark' ? 'dark' : 'light'];
    if (activeTileLayer) map.removeLayer(activeTileLayer);
    layer.addTo(map);
    activeTileLayer = layer;
    // recolor markers to match theme's status ramp
    renderMarkers(false);
    if (state.all.length) { renderList(); renderAnalysis(); if (selectedSchoolId) showDetails(selectedSchoolId, false); }
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

  // Geometry is retained separately so filtering/export keep their existing schema.
  const POLYGON_ZOOM = 15;
  const geometryById = new Map();
  const polygonById = new Map();
  const polygonGroup = L.featureGroup();
  const fallbackGroup = L.layerGroup();
  let pendingFit = false;
  let selectedSchoolId = null;
  let detailsReturnFocus = null;

  function syncGeometryVisibility() {
    const detailed = map.getZoom() >= POLYGON_ZOOM;
    [[clusterGroup, !detailed], [polygonGroup, detailed], [fallbackGroup, detailed]].forEach(([layer, visible]) => {
      if (visible && !map.hasLayer(layer)) map.addLayer(layer);
      if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
    });
  }
  map.on('zoomend', syncGeometryVisibility);

  function fitResults() {
    if (document.getElementById('mapPanel').hidden) { pendingFit = true; return; }
    pendingFit = false;
    const bounds = polygonGroup.getBounds();
    markerById.forEach(marker => bounds.extend(marker.getLatLng()));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [35, 35], maxZoom: 16, animate: false });
    syncGeometryVisibility();
  }

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
    cancelAnimationFrame(el._frame);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt.format(to); el.dataset.count = to; return; }
    const from = parseFloat(el.dataset.count) || 0;
    const duration = 700;
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = Math.round(from + (to - from) * eased);
      el.textContent = fmt.format(val);
      el.dataset.count = val;
      if (t < 1) el._frame = requestAnimationFrame(step);
      else el.dataset.count = to;
    }
    el._frame = requestAnimationFrame(step);
  }

  /* ---------- Load data ---------- */
  fetch('data/schools.geojson')
    .then(r => { if (!r.ok) throw new Error('Data request failed'); return r.json(); })
    .then(geo => {
      geo.features.forEach(f => geometryById.set(String(f.properties.fid), f.geometry));
      state.all = geo.features.map(f => f.properties);
      init();
    })
    .catch(err => {
      console.error(err);
      document.getElementById('mapLoading').innerHTML = '<p>Տվյալները չհաջողվեց բեռնել։</p><button class="action-btn" onclick="location.reload()">Փորձել կրկին</button>';
      toast('Տվյալները չհաջողվեց բեռնել');
    });

  function init() {
    const provinces = [...new Set(state.all.map(f => f.province))].filter(p => p && p !== 'Անհայտ');
    const unknown = state.all.filter(f => !f.province || f.province === 'Անհայտ').length;
    document.getElementById('datasetScope').textContent = `Բազայում՝ ${state.all.length} դպրոց · ${provinces.join(', ')}${unknown ? ` · ${unknown} դպրոցի մարզը նշված չէ` : ''}։ Սա ամբողջ Հայաստանի դպրոցների հաշվառումը չէ։`;
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
    bindWorkspace();
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
      return `<button type="button" class="chip" aria-pressed="false" data-value="${escapeAttr(v)}" style="--chip-color:${color}">
        <span class="lg-dot" style="background:${color}"></span>${escapeHtml(label)}
      </button>`;
    }).join('');
    container.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const v = chip.dataset.value;
        if (targetSet.has(v)) { targetSet.delete(v); chip.classList.remove('active'); }
        else { targetSet.add(v); chip.classList.add('active'); }
        chip.setAttribute('aria-pressed', targetSet.has(v));
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
      clearTimeout(debounce); searchInput.value = ''; state.search = ''; searchClear.hidden = true; applyFilters(); searchInput.focus();
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
      if (mn > mx) { if (document.activeElement === capMinInput) mn = mx; else mx = mn; }
      capMinInput.value = mn; capMaxInput.value = mx;
      state.capMin = mn; state.capMax = mx;
      updateRangeUI();
      applyFilters();
    }
    capMinInput.addEventListener('input', onRangeInput);
    capMaxInput.addEventListener('input', onRangeInput);

    document.getElementById('resetFilters').addEventListener('click', () => {
      analysisOrigin = null;
      document.getElementById('backToAnalysis').hidden = true;
      clearTimeout(debounce);
      state.search = ''; document.getElementById('searchInput').value = ''; searchClear.hidden = true;
      state.province = ''; document.getElementById('provinceSelect').value = '';
      state.community = ''; buildCommunityOptions(); document.getElementById('communitySelect').value = '';
      state.types.clear(); state.statuses.clear(); state.sponsors.clear();
      document.querySelectorAll('.chip.active').forEach(c => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
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
    renderList();
    renderAnalysis();
    renderFilterSummary();
    if (selectedSchoolId && !state.filtered.some(f => String(f.fid) === selectedSchoolId)) closeDetails();
    document.getElementById('mapEmpty').hidden = state.filtered.length > 0;
    document.getElementById('visibleCount').textContent = `${state.filtered.length} դպրոց`;
    document.getElementById('exportCsv').disabled = !state.filtered.length;
    document.getElementById('fitBounds').disabled = !state.filtered.length;
  }

  /* ---------- Rendering ---------- */
  function renderMarkers(fitView = true) {
    clusterGroup.clearLayers();
    polygonGroup.clearLayers();
    fallbackGroup.clearLayers();
    markerById.clear();
    polygonById.clear();
    const markers = [];
    state.filtered.forEach(f => {
      const color = statusColorRaw(f.status);
      const id = String(f.fid);
      const geometry = geometryById.get(id);
      let polygon = null;
      if (geometry && ['Polygon', 'MultiPolygon'].includes(geometry.type)) {
        const normal = { color, fillColor: color, weight: 2, opacity: .95, fillOpacity: .20, className: 'school-boundary' };
        polygon = L.geoJSON({ type: 'Feature', properties: {}, geometry }, {
          style: normal,
          onEachFeature: (_, layer) => {
            layer.on('click', () => showDetails(id));
            layer.bindTooltip(escapeHtml(f.name), { sticky: true, direction: 'top', className: 'school-boundary-tooltip' });
            const highlight = () => { layer.setStyle({ weight: 3, fillOpacity: .34 }); layer.bringToFront(); };
            const restore = () => layer.setStyle(normal);
            layer.on({ mouseover: highlight, mouseout: restore });
            layer.on('add', () => {
              const element = layer.getElement();
              if (!element) return;
              element.setAttribute('tabindex', '0');
              element.setAttribute('role', 'button');
              element.setAttribute('aria-label', f.name);
              element.onfocus = highlight;
              element.onblur = restore;
              element.onkeydown = event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault(); showDetails(id);
                }
              };
            });
          },
        });
        if (polygon.getBounds().isValid()) {
          polygonGroup.addLayer(polygon);
          polygonById.set(id, polygon);
        } else polygon = null;
      }
      const position = polygon ? polygon.getBounds().getCenter() : L.latLng(f.lat, f.lon);
      const icon = L.divIcon({
        className: 'school-circle-marker',
        html: `<div class="school-circle" style="--school-color:${color}"></div>`,
        iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -12],
      });
      const marker = L.marker(position, { icon, title: f.name, alt: f.name });
      marker.on('click', () => showDetails(id));
      markerById.set(id, marker);
      markers.push(marker);
      if (!polygon) {
        L.marker(position, { icon, title: f.name, alt: f.name })
          .on('click', () => showDetails(id)).addTo(fallbackGroup);
      }
    });
    clusterGroup.addLayers(markers);
    if (fitView) fitResults();
    syncGeometryVisibility();
  }
  function buildPopup(f) {
    const color = statusColorRaw(f.status);
    const linkHtml = /^https?:\/\//i.test(f.link || '')
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
          <div><b>${numberOrMissing(f.studAll)}</b><span>Աշակերտ</span></div>
          <div><b>${numberOrMissing(f.capacity)}</b><span>Նախագծային հզորություն</span></div>
          <div><b>${numberOrMissing(f.consArea)}</b><span>մ² կառուցապատում</span></div>
          <div><b>${escapeHtml(f.sponsor)}</b><span>Ֆինանսավորող</span></div>
        </div>
        ${linkHtml}
        ${/^https?:\/\//i.test(f.emis || '') ? `<a class="popup-card__link secondary-link" href="${escapeAttr(f.emis)}" target="_blank" rel="noopener noreferrer">Կրթական տվյալներ ↗</a>` : ''}
      </div>`;
  }

  function renderStats() {
    const items = state.filtered;
    const completed = items.filter(f => f.status === 'Ավարտված').length;
    animateCount(document.getElementById('statTotal'), items.length);
    animateCount(document.getElementById('statStudents'), items.reduce((s, f) => s + (f.studAll || 0), 0));
    animateCount(document.getElementById('statCompleted'), completed);
    animateCount(document.getElementById('statOngoing'), items.filter(f => f.status === 'Ընթացիկ').length);
    document.getElementById('completionShare').textContent = items.length ? `${fmt.format(Math.round(completed / items.length * 100))}%՝ ընտրված դպրոցներից` : 'Արդյունքներ չկան';
    document.getElementById('resultsCount').textContent = `${fmt.format(items.length)} / ${fmt.format(state.all.length)} դպրոց`;
    // The overview is a distribution, not a construction-completion percentage.
    const distribution = STATUS_ORDER.map(status => ({ status, count: items.filter(f => f.status === status).length }));
    document.getElementById('portfolioOverview').innerHTML = items.length ? `<div class="portfolio-track" aria-hidden="true">${distribution.filter(row => row.count).map(row => `<span style="flex:${row.count};background:${statusColorRaw(row.status)}"></span>`).join('')}</div><div class="portfolio-legend">${distribution.map(row => `<span><i style="background:${statusColorRaw(row.status)}" aria-hidden="true"></i>${escapeHtml(STATUS_LABELS[row.status] || row.status)}<b>${fmt.format(row.count)}</b><small>${Math.round(row.count / items.length * 100)}%</small></span>`).join('')}</div>` : '<p class="insight-note">Ընտրված զտիչներով դպրոցներ չկան։</p>';
  }
  /* ---------- Utils ---------- */
  let activeView = 'map';
  let transitionTimer;
  function showView(view) {
    if (view !== activeView) {
      const overlay = document.getElementById('viewTransition');
      clearTimeout(transitionTimer);
      overlay.hidden = true;
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // Restart a short decorative transition; navigation is never delayed.
        void overlay.offsetWidth;
        overlay.hidden = false;
        transitionTimer = setTimeout(() => { overlay.hidden = true; }, 1100);
      }
      activeView = view;
    }
    document.getElementById('mapPanel').hidden = view !== 'map';
    document.getElementById('listPanel').hidden = view !== 'list';
    document.getElementById('analysisPanel').hidden = view !== 'analysis';
    if (view !== 'map') closeDetails();
    ['map', 'analysis', 'list'].forEach(v => {
      const button = document.getElementById(v + 'View');
      button.classList.toggle('selected', v === view);
      button.setAttribute('aria-pressed', String(v === view));
    });
    if (view === 'map') { map.invalidateSize(); if (pendingFit) fitResults(); }
  }

  function renderList() {
    const sort = document.getElementById('sortSchools').value;
    const items = [...state.filtered].sort((a, b) => sort === 'students' ? b.studAll - a.studAll : String(a[sort]).localeCompare(String(b[sort]), 'hy'));
    document.getElementById('schoolList').innerHTML = items.length ? items.map(f => `
      <article class="school-card">
        <div class="school-card__top"><span class="school-symbol" aria-hidden="true">▦</span><span class="school-status" style="--badge-color:${statusColorRaw(f.status)}"><i></i>${escapeHtml(STATUS_LABELS[f.status] || f.status)}</span></div>
        <h3>${escapeHtml(f.name)}</h3><p>${escapeHtml(f.province)} · ${escapeHtml(f.settlement)}</p>
        <div class="school-card__metrics"><span><b>${numberOrMissing(f.studAll)}</b> աշակերտ</span><span><b>${numberOrMissing(f.consArea)}</b> մ²</span></div>
        <button class="school-open" data-school="${escapeAttr(f.fid)}">Դիտել քարտեզի վրա <span aria-hidden="true">↗</span></button>
      </article>`).join('') : '<div class="empty-state"><span aria-hidden="true">⌕</span><h3>Դպրոցներ չեն գտնվել</h3><p>Փորձեք այլ որոնում կամ զրոյացրեք զտիչները։</p><button class="action-btn" id="emptyReset">Զրոյացնել զտիչները</button></div>';
    document.getElementById('emptyReset')?.addEventListener('click', () => document.getElementById('resetFilters').click());
  }

  // Charts use the same filtered records as the cards; no extra library or request.
  function buildListCharts(items) {
    const total = items.length;
    if (!total) return '';
    const counts = new Map(STATUS_ORDER.map(status => [status, 0]));
    const communities = new Map();
    items.forEach(f => {
      const status = counts.has(f.status) ? f.status : 'Անհայտ';
      counts.set(status, counts.get(status) + 1);
      // Province is part of the key: equal community names need not be the same place.
      const province = f.province || 'Անհայտ';
      const community = f.community || 'Անհայտ';
      const key = JSON.stringify([province, community]);
      const entry = communities.get(key) || { label: community, province, count: 0 };
      entry.count++;
      communities.set(key, entry);
    });
    let offset = 0;
    const slices = [];
    const legend = [...counts].filter(([, count]) => count).map(([status, count]) => {
      const percentage = count / total * 100;
      const color = statusColorRaw(status);
      slices.push(`${color} ${offset}% ${offset + percentage}%`);
      offset += percentage;
      return `<li><button class="chart-filter" data-status="${escapeAttr(status)}"><span class="insight-dot" style="background:${color}" aria-hidden="true"></span><span>${escapeHtml(STATUS_LABELS[status] || status)}</span><strong>${fmt.format(count)}</strong><small>${fmt.format(Math.round(percentage))}%</small><span class="chart-action">Դիտել ${fmt.format(count)} դպրոց →</span></button></li>`;
    }).join('');
    const ranked = [...communities.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'hy'));
    const rows = ranked.slice(0, 5);
    if (ranked.length > 5) rows.push({ label: 'Մնացած համայնքները', province: '', count: ranked.slice(5).reduce((sum, row) => sum + row.count, 0) });
    const max = Math.max(...rows.map(row => row.count));
    return `<section class="list-insights" aria-label="Զտված դպրոցների դիագրամներ">
      <article class="insight-card">
        <div class="insight-heading"><span class="insight-kicker">ԾՐԱԳՐԵՐԻ ՊԱՏԿԵՐԸ</span><h3>Ըստ կարգավիճակի</h3><p>Ընտրված ${fmt.format(total)} դպրոցների բաշխումը</p></div>
        <div class="insight-donut-layout"><div class="insight-donut" style="background:conic-gradient(${slices.join(',')})" aria-hidden="true"><div><b>${fmt.format(total)}</b><span>դպրոց</span></div></div><ul class="insight-legend">${legend}</ul></div>
      </article>
      <article class="insight-card">
        <div class="insight-heading"><span class="insight-kicker">ԱՇԽԱՐՀԱԳՐԱԿԱՆ ԲԱՇԽՈՒՄ</span><h3>Ըստ համայնքի</h3><p>${ranked.length > 5 ? 'Առաջատար 5 համայնքները և մնացածը' : 'Դպրոցների քանակն ըստ համայնքի'}</p></div>
        <ul class="insight-bars">${rows.map(row => `<li><div class="insight-bar-label"><span>${escapeHtml(row.label)}${row.province ? `<small>${escapeHtml(row.province)}</small>` : ''}</span><b>${fmt.format(row.count)}</b></div><div class="insight-track" aria-hidden="true"><span style="width:${row.count / max * 100}%"></span></div></li>`).join('')}</ul>
      </article>
      <p class="insight-note">Դիագրամները թարմացվում են որոնման և զտիչների հետ։ Թվերը ցույց են տալիս դպրոցների քանակը։</p>
    </section>`;
  }

  function numberOrMissing(value) {
    return typeof value === 'number' && Number.isFinite(value) ? fmt.format(Math.round(value)) : 'Տվյալ չկա';
  }

  function filterDescription() {
    const parts = [];
    if (state.search) parts.push(`Որոնում՝ «${state.search}»`);
    if (state.province) parts.push(`Մարզ՝ ${state.province}`);
    if (state.community) parts.push(`Համայնք՝ ${state.community}`);
    if (state.statuses.size) parts.push(`Կարգավիճակ՝ ${[...state.statuses].join(', ')}`);
    if (state.types.size) parts.push(`Տեսակ՝ ${[...state.types].join(', ')}`);
    if (state.sponsors.size) parts.push(`Ֆինանսավորող՝ ${[...state.sponsors].join(', ')}`);
    if (state.capMin !== state.capBounds[0] || state.capMax !== state.capBounds[1]) parts.push(`Աշակերտ՝ ${state.capMin}–${state.capMax}`);
    return parts.join(' · ') || 'Բոլոր դպրոցները · Զտիչներ կիրառված չեն';
  }

  function renderFilterSummary() {
    document.getElementById('filterSummary').textContent = filterDescription();
    const tags = [];
    const tag = (key, value, label) => tags.push(`<button class="filter-tag" data-filter-key="${key}" data-filter-value="${escapeAttr(value)}" aria-label="Հեռացնել զտիչը՝ ${escapeAttr(label)}">${escapeHtml(label)} <span aria-hidden="true">×</span></button>`);
    if (state.search) tag('search', '', `Որոնում՝ ${state.search}`);
    if (state.province) tag('province', '', state.province);
    if (state.community) tag('community', '', state.community);
    ['types', 'statuses', 'sponsors'].forEach(key => state[key].forEach(value => tag(key, value, STATUS_LABELS[value] || value)));
    if (state.capMin !== state.capBounds[0] || state.capMax !== state.capBounds[1]) tag('range', '', `Աշակերտ՝ ${state.capMin}–${state.capMax}`);
    document.getElementById('activeFilters').innerHTML = tags.join('');
    document.getElementById('activeFilters').hidden = !tags.length;
  }

  function syncFilterControls() {
    document.getElementById('searchInput').value = state.search;
    document.getElementById('searchClear').hidden = !state.search;
    document.getElementById('provinceSelect').value = state.province;
    buildCommunityOptions();
    document.getElementById('communitySelect').value = state.community;
    document.getElementById('capacityMin').value = state.capMin;
    document.getElementById('capacityMax').value = state.capMax;
    [['typeChips', 'types'], ['statusChips', 'statuses'], ['sponsorChips', 'sponsors']].forEach(([id, key]) => {
      document.querySelectorAll(`#${id} .chip`).forEach(chip => {
        const active = state[key].has(chip.dataset.value);
        chip.classList.toggle('active', active); chip.setAttribute('aria-pressed', String(active));
      });
    });
    updateRangeUI();
  }

  function showDetails(id, focus = true) {
    const f = state.filtered.find(item => String(item.fid) === String(id));
    if (!f) return;
    if (focus) detailsReturnFocus = document.activeElement;
    selectedSchoolId = String(id);
    const text = value => value && value !== 'Անհայտ' ? escapeHtml(value) : 'Տվյալ չկա';
    document.getElementById('detailsContent').innerHTML = buildPopup(f) + `
      <dl class="details-facts">
        <div><dt>Մարզ</dt><dd>${text(f.province)}</dd></div>
        <div><dt>Աշխատանքների տեսակ</dt><dd>${text(f.constInt)}</dd></div>
        <div><dt>Կառուցման տարեթիվ</dt><dd>${text(f.buildYear)}</dd></div>
        <div><dt>Կադաստրային ծածկագիր</dt><dd>${text(f.cadastre)}</dd></div>
      </dl><p class="details-disclaimer">Աղբյուր՝ schools.geojson։ Զրոները ցուցադրված են ինչպես բազայում․ դրանց լրացվածությունը պետք է ստուգել աղբյուրի հետ։ Թարմացման ամսաթիվը նշված չէ։</p>`;
    document.getElementById('schoolDetails').hidden = false;
    const content = document.getElementById('detailsContent');
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && content.animate) {
      content.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 280, easing: 'ease-out' });
    }
    root.classList.add('details-open');
    polygonById.forEach((group, key) => group.setStyle({ weight: key === selectedSchoolId ? 3 : 2, fillOpacity: key === selectedSchoolId ? .34 : .20 }));
    if (focus) document.getElementById('detailsClose').focus();
    requestAnimationFrame(() => map.invalidateSize());
  }

  function closeDetails() {
    const wasOpen = !document.getElementById('schoolDetails').hidden;
    selectedSchoolId = null;
    document.getElementById('schoolDetails').hidden = true;
    root.classList.remove('details-open');
    polygonById.forEach(group => group.setStyle({ weight: 2, fillOpacity: .20 }));
    if (wasOpen) {
      if (detailsReturnFocus?.isConnected) detailsReturnFocus.focus();
      else document.getElementById('mapView').focus();
      requestAnimationFrame(() => map.invalidateSize());
    }
  }

  function togglePresentation(enabled) {
    root.classList.toggle('presentation-mode', enabled);
    const button = document.getElementById('presentationToggle');
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? 'Ելք ներկայացումից' : 'Ներկայացման ռեժիմ';
    closeSidebar();
    requestAnimationFrame(() => map.invalidateSize());
  }

  function buildProvinceChart(items) {
    const groups = new Map();
    items.forEach(f => {
      const name = f.province || 'Անհայտ';
      if (!groups.has(name)) groups.set(name, Object.fromEntries(STATUS_ORDER.map(s => [s, 0])));
      groups.get(name)[STATUS_ORDER.includes(f.status) ? f.status : 'Անհայտ']++;
    });
    const rows = [...groups].sort(([a], [b]) => a.localeCompare(b, 'hy'));
    return `<article class="insight-card province-chart"><div class="insight-heading"><span class="insight-kicker">ՄԱՐԶԱՅԻՆ ՊԱՏԿԵՐ</span><h3>Ծրագրերն ըստ մարզի</h3><p>Յուրաքանչյուր գույնը ծրագրի կարգավիճակն է։ Մարզի անունը սեղմելիս բացվում է զտված ցանկը։</p></div>
      ${rows.map(([province, counts]) => {
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        return `<div class="province-row"><button class="province-filter" data-province="${escapeAttr(province)}">${escapeHtml(province)} <b>${total}</b></button><div class="province-stack" aria-hidden="true">${STATUS_ORDER.filter(s => counts[s]).map(s => `<span style="width:${counts[s] / total * 100}%;background:${statusColorRaw(s)}"></span>`).join('')}</div><p>${STATUS_ORDER.filter(s => counts[s]).map(s => `${STATUS_LABELS[s]}՝ ${counts[s]}`).join(' · ')}</p></div>`;
      }).join('')}</article>`;
  }

  function buildCapacityChart(items) {
    // Zero values may be placeholders in the supplied normalized dataset.
    // Compare only records with two positive, finite values; disclose the coverage.
    const valid = items.filter(f => Number.isFinite(f.studAll) && f.studAll > 0 && Number.isFinite(f.capacity) && f.capacity > 0);
    const students = valid.reduce((s, f) => s + f.studAll, 0);
    const capacity = valid.reduce((s, f) => s + f.capacity, 0);
    const max = Math.max(students, capacity, 1);
    return `<article class="insight-card capacity-chart"><div class="insight-heading"><span class="insight-kicker">ԿՐԹԱԿԱՆ ԸՆԴԳՐԿՈՒՄ</span><h3>Աշակերտներ և նախագծային հզորություն</h3><p>Համեմատելի տվյալներ՝ ${valid.length} / ${items.length} դպրոց։ Միայն երկու դրական ցուցանիշ ունեցող դպրոցներն են ներառված։</p></div>
      ${valid.length ? `<div class="capacity-row"><span>Աշակերտներ <b>${fmt.format(students)}</b></span><div class="insight-track"><span style="width:${students / max * 100}%"></span></div></div><div class="capacity-row"><span>Նախագծային հզորություն <b>${fmt.format(capacity)}</b></span><div class="insight-track"><span style="width:${capacity / max * 100}%"></span></div></div>` : '<p class="analysis-empty">Համեմատության համար բավարար տվյալներ չկան։</p>'}
      <p class="insight-note">Սա նույն դպրոցների համախմբված համեմատությունն է, ոչ շենքերի փաստացի շահագործման կամ գերբեռնվածության գնահատում։</p></article>`;
  }

  function buildQualitySummary(items) {
    const missing = value => value === null || value === undefined || value === '' || value === 'Անհայտ';
    const unknown = items.filter(f => ['province', 'community', 'status', 'type'].some(key => missing(f[key])));
    const zeroes = items.filter(f => f.studAll === 0 || f.capacity === 0 || f.consArea === 0).length;
    const years = items.filter(f => missing(f.buildYear)).length;
    return `<article class="quality-card"><h3>Տվյալների որակ և սահմանափակումներ</h3><div class="quality-counts"><span><b>${unknown.length}</b> դպրոց՝ չնշված մարզով, համայնքով, տեսակով կամ կարգավիճակով</span><span><b>${zeroes}</b> դպրոց՝ առնվազն մեկ զրոյական թվային ցուցանիշով</span><span><b>${years}</b> դպրոց՝ չնշված կառուցման տարեթվով</span></div>
      <p>Զրոյական արժեքները պահպանված են աղբյուրից և չեն համարվում հաստատված բացակայող տվյալ։ Թարմացման ամսաթիվ, ծրագրերի ժամկետներ և բյուջեներ բազայում չկան․ ուշացման կամ ֆինանսական ռիսկի գնահատում չի կատարվում։</p>
      ${unknown.length ? `<details><summary>Տեսնել չլրացված հիմնական տվյալներով դպրոցները (${unknown.length})</summary><ul>${unknown.map(f => `<li>${escapeHtml(f.name)}</li>`).join('')}</ul></details>` : ''}</article>`;
  }

  function buildProvinceComparison(items) {
    const groups = new Map();
    items.forEach(f => {
      const province = f.province || 'Անհայտ';
      if (!groups.has(province)) groups.set(province, { total: 0, counts: Object.fromEntries(STATUS_ORDER.map(s => [s, 0])) });
      const row = groups.get(province); row.total++;
      row.counts[STATUS_ORDER.includes(f.status) ? f.status : 'Անհայտ']++;
    });
    const rows = [...groups].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0], 'hy'));
    const max = Math.max(1, ...rows.map(([, row]) => row.total));
    return `<article class="insight-card province-comparison"><div class="insight-heading"><span class="insight-kicker">ԾԱՎԱԼՆԵՐԻ ՀԱՄԵՄԱՏՈՒԹՅՈՒՆ</span><h3>Դպրոցների քանակն ըստ մարզի</h3><p>Դասավորված է ըստ քանակի։ Սյունակի երկարությունը ցույց է տալիս դպրոցների թիվը, ոչ աշխատանքի կատարման աստիճանը։</p></div><div class="comparison-scroll" tabindex="0" role="region" aria-label="Մարզերի համեմատական աղյուսակ"><table><caption>Ընտրված ${items.length} դպրոցների մարզային բաշխումը</caption><thead><tr><th scope="col">Մարզ</th><th scope="col">Ընդհանուր</th>${STATUS_ORDER.map(s => `<th scope="col">${STATUS_LABELS[s]}</th>`).join('')}</tr></thead><tbody>${rows.map(([name, row]) => `<tr><th scope="row"><button class="province-filter" data-province="${escapeAttr(name)}">${escapeHtml(name)} <span class="chart-action">Դիտել →</span></button></th><td><b>${row.total}</b><div class="comparison-bar" aria-hidden="true"><span style="width:${row.total / max * 100}%"></span></div></td>${STATUS_ORDER.map(s => `<td>${row.counts[s]}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="comparison-note">${rows.length ? `Ամենաշատ գրառումներ ունեցող խումբը՝ ${escapeHtml(rows[0][0])} (${rows[0][1].total} դպրոց)։` : 'Ընտրված դպրոցներ չկան։'} Սա միայն ներկայացված բազայի համեմատությունն է։</p></article>`;
  }

  function renderAnalysis() {
    const items = state.filtered;
    document.getElementById('analysisContent').innerHTML = items.length
      ? buildListCharts(items) + buildProvinceComparison(items) + `<div class="analysis-secondary">${buildProvinceChart(items)}${buildCapacityChart(items)}</div>` + buildQualitySummary(items)
      : '<div class="empty-state"><h3>Վերլուծության համար արդյունքներ չկան</h3><p>Փոխեք կամ զրոյացրեք զտիչները։</p></div>';
  }

  function buildPrintReport() {
    const items = state.filtered;
    const created = new Intl.DateTimeFormat('hy-AM', { dateStyle: 'medium', timeZone: 'Asia/Yerevan' }).format(new Date());
    document.getElementById('printReport').innerHTML = `<h1>Դպրոցաշինության ծրագրերի ամփոփագիր</h1><p>${escapeHtml(document.getElementById('datasetScope').textContent)}</p><p>Ամփոփագրի ձևավորման ամսաթիվ՝ ${created}։ Աղբյուրի թարմացման ամսաթիվը նշված չէ։</p><p><b>Ընտրված ընդգրկում․</b> ${escapeHtml(filterDescription())}</p>
      <div class="print-kpis"><span>Դպրոցներ՝ <b>${items.length}</b></span><span>Ավարտված՝ <b>${items.filter(f => f.status === 'Ավարտված').length}</b></span><span>Ընթացիկ՝ <b>${items.filter(f => f.status === 'Ընթացիկ').length}</b></span><span>Աշակերտներ՝ <b>${fmt.format(items.reduce((s, f) => s + (f.studAll || 0), 0))}</b></span></div>
      ${items.length ? buildProvinceChart(items) + buildCapacityChart(items) : '<p>Ընտրված զտիչներով արդյունքներ չկան։</p>'}${buildQualitySummary(items)}
      <table><thead><tr><th>Դպրոց</th><th>Մարզ / համայնք</th><th>Կարգավիճակ</th><th>Աշակերտ</th><th>Հզորություն</th></tr></thead><tbody>${items.map(f => `<tr><td>${escapeHtml(f.name)}</td><td>${escapeHtml(f.province)} / ${escapeHtml(f.community)}</td><td>${escapeHtml(STATUS_LABELS[f.status] || f.status)}</td><td>${numberOrMissing(f.studAll)}</td><td>${numberOrMissing(f.capacity)}</td></tr>`).join('')}</tbody></table><p>Աղբյուր՝ data/schools.geojson։ Աշակերտների թիվը ներկայացված է ըստ բազայի, ոչ որպես հաստատված շահառուների թիվ։</p>`;
  }

  // Restore the exact analysis scope; chip listeners retain their original Sets.
  function returnToAnalysis() {
    if (analysisOrigin) {
      const saved = analysisOrigin;
      analysisOrigin = null;
      ['search', 'province', 'community', 'capMin', 'capMax'].forEach(key => { state[key] = saved[key]; });
      ['types', 'statuses', 'sponsors'].forEach(key => {
        state[key].clear(); saved[key].forEach(value => state[key].add(value));
      });
      document.getElementById('searchInput').value = state.search;
      document.getElementById('searchClear').hidden = !state.search;
      document.getElementById('provinceSelect').value = state.province;
      buildCommunityOptions();
      document.getElementById('communitySelect').value = state.community;
      document.getElementById('capacityMin').value = state.capMin;
      document.getElementById('capacityMax').value = state.capMax;
      [['typeChips', 'types'], ['statusChips', 'statuses'], ['sponsorChips', 'sponsors']].forEach(([id, key]) => {
        document.querySelectorAll(`#${id} .chip`).forEach(chip => {
          const active = state[key].has(chip.dataset.value);
          chip.classList.toggle('active', active); chip.setAttribute('aria-pressed', String(active));
        });
      });
      updateRangeUI();
      document.getElementById('backToAnalysis').hidden = true;
      applyFilters();
    }
    showView('analysis');
    document.getElementById('analysisView').focus();
  }

  function bindWorkspace() {
    document.getElementById('filtersToggle').setAttribute('aria-expanded', 'false');
    document.getElementById('overviewToggle').addEventListener('click', () => {
      const expanded = root.classList.toggle('overview-open');
      document.getElementById('overviewToggle').setAttribute('aria-expanded', String(expanded));
      requestAnimationFrame(() => map.invalidateSize());
    });
    document.getElementById('activeFilters').addEventListener('click', event => {
      const button = event.target.closest('[data-filter-key]');
      if (!button) return;
      const key = button.dataset.filterKey;
      if (['types', 'statuses', 'sponsors'].includes(key)) state[key].delete(button.dataset.filterValue);
      else if (key === 'range') { state.capMin = state.capBounds[0]; state.capMax = state.capBounds[1]; }
      else if (['search', 'province', 'community'].includes(key)) {
        state[key] = ''; if (key === 'province') state.community = '';
      } else return;
      syncFilterControls(); applyFilters();
      document.getElementById('filtersToggle').focus();
    });
    document.getElementById('mapView').addEventListener('click', () => showView('map'));
    document.getElementById('listView').addEventListener('click', () => showView('list'));
    document.getElementById('analysisView').addEventListener('click', returnToAnalysis);
    document.getElementById('backToAnalysis').addEventListener('click', returnToAnalysis);
    document.getElementById('homeMap').addEventListener('click', () => {
      closeDetails(); closeSidebar(); showView('map');
      document.getElementById('mapView').focus();
    });
    document.getElementById('detailsClose').addEventListener('click', closeDetails);
    document.getElementById('presentationToggle').addEventListener('click', () => togglePresentation(!root.classList.contains('presentation-mode')));
    document.getElementById('printSummary').addEventListener('click', () => { buildPrintReport(); window.print(); });
    window.addEventListener('beforeprint', buildPrintReport);
    document.getElementById('filtersToggle').addEventListener('click', () => {
      if (sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
    });
    document.getElementById('analysisContent').addEventListener('click', event => {
      const button = event.target.closest('[data-status], [data-province]');
      if (!button) return;
      analysisOrigin = {
        search: state.search, province: state.province, community: state.community,
        capMin: state.capMin, capMax: state.capMax,
        types: [...state.types], statuses: [...state.statuses], sponsors: [...state.sponsors],
      };
      document.getElementById('backToAnalysis').hidden = false;
      if (button.dataset.status !== undefined) {
        state.statuses.clear(); state.statuses.add(button.dataset.status);
        document.querySelectorAll('#statusChips .chip').forEach(chip => {
          const active = state.statuses.has(chip.dataset.value);
          chip.classList.toggle('active', active); chip.setAttribute('aria-pressed', String(active));
        });
      } else {
        state.province = button.dataset.province; state.community = '';
        document.getElementById('provinceSelect').value = state.province;
        buildCommunityOptions();
      }
      applyFilters(); showView('list'); document.getElementById('listView').focus();
    });
    document.getElementById('sortSchools').addEventListener('change', renderList);
    document.getElementById('fitBounds').addEventListener('click', () => {
      showView('map');
      fitResults();
    });
    document.getElementById('schoolList').addEventListener('click', e => {
      const button = e.target.closest('[data-school]');
      if (!button) return;
      showView('map'); closeSidebar();
      const polygon = polygonById.get(button.dataset.school);
      if (polygon) {
        map.fitBounds(polygon.getBounds(), { padding: [45, 45], maxZoom: 18, animate: false });
        if (map.getZoom() < POLYGON_ZOOM) map.setZoom(POLYGON_ZOOM, { animate: false });
        syncGeometryVisibility();
        showDetails(button.dataset.school);
      } else {
        const marker = markerById.get(button.dataset.school);
        if (marker) {
          map.setView(marker.getLatLng(), POLYGON_ZOOM - 1, { animate: false });
          syncGeometryVisibility();
          clusterGroup.zoomToShowLayer(marker, () => showDetails(button.dataset.school));
        }
      }
    });
    document.getElementById('exportCsv').addEventListener('click', () => {
      const columns = [['name', 'Դպրոց'], ['province', 'Մարզ'], ['community', 'Համայնք'], ['settlement', 'Բնակավայր'], ['status', 'Կարգավիճակ'], ['studAll', 'Աշակերտ'], ['capacity', 'Հզորություն'], ['consArea', 'Կառուցապատում մ²'], ['sponsor', 'Ֆինանսավորող']];
      const cell = value => { let s = String(value ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
      const rows = [columns.map(c => c[1]), ...state.filtered.map(f => columns.map(c => f[c[0]]))];
      const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a'); a.href = url; a.download = 'schools.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`${state.filtered.length} դպրոցի տվյալներ ներբեռնվեցին`);
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(str) { return escapeHtml(str); }

})();
