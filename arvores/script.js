/* =========================================================
   BIOMAP CAMPUS v2 — script.js
   ========================================================= */

// ─── STATE ───────────────────────────────────────────────
let allPlants    = [];
let mapInstance  = null;
let clusterGroup = null;
let allMarkers   = {};        // id → L.marker
let addLatLng    = null;
let addModeActive= false;
let cropperInst  = null;
let croppedDataURL = null;
let userLatLng   = null;
let proximityActive = false;
let proximityRadius = 200;
let chartInstances  = {};
let prevPage        = 'home';
let currentPage     = 'home';
let mapInitialized  = false;

const mapFilters    = { search:'', type:'all', tag:'all', loc:'all' };
const catFilters    = { search:'', type:'all', tag:'all' };
let favs = JSON.parse(localStorage.getItem('bm-favs')||'[]');

// ─── DEBOUNCE ─────────────────────────────────────────────
function debounce(fn, ms=300) {
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); };
}
const debounceMapSearch  = debounce(v=>{ mapFilters.search=v; document.getElementById('clearSearch').style.display=v?'block':'none'; applyMapFilters(); }, 280);
const debounceCatalog    = debounce(()=>renderCatalog(), 280);

// ─── LOADING BAR ──────────────────────────────────────────
function loadStart() { const b=document.getElementById('loadingBar'); b.className='loading-bar active'; }
function loadDone()  { const b=document.getElementById('loadingBar'); b.className='loading-bar done'; setTimeout(()=>b.className='loading-bar',500); }

// ─── TOAST ────────────────────────────────────────────────
function showToast(msg, type='', ms=2800) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast '+(type||''); t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), ms);
}

// ─── THEME ────────────────────────────────────────────────
function toggleTheme() {
  const dark = document.documentElement.getAttribute('data-theme')==='dark';
  document.documentElement.setAttribute('data-theme', dark?'light':'dark');
  document.getElementById('themeBtn').innerHTML = dark ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
  localStorage.setItem('bm-theme', dark?'light':'dark');
  if(mapInstance) mapInstance.invalidateSize();
}

// ─── NAV ──────────────────────────────────────────────────
function toggleMenu() { document.getElementById('navLinks').classList.toggle('open'); }

function navigate(page) {
  prevPage = currentPage;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  document.querySelectorAll('.nav-links a').forEach(a=>{
    a.classList.toggle('active', a.dataset.page===page);
  });
  currentPage = page;
  window.scrollTo({top:0,behavior:'smooth'});
  document.getElementById('navLinks').classList.remove('open');

  if(page==='map' && !mapInitialized)   { initMap(); mapInitialized=true; }
  else if(page==='map')                 { setTimeout(()=>mapInstance?.invalidateSize(),200); }
  if(page==='catalog')   renderCatalog();
  if(page==='favorites') renderFavs();
  if(page==='dashboard') renderDashboard();
  updateFavBadge();
}

function goBack() { navigate(prevPage===currentPage?'catalog':prevPage); }

// ─── DATA ─────────────────────────────────────────────────
async function loadData() {
  loadStart();
  try {
    const res = await fetch('plants.json');
    allPlants  = await res.json();
    // Merge saved plants from localStorage
    const saved = JSON.parse(localStorage.getItem('bm-custom-plants')||'[]');
    allPlants = [...allPlants, ...saved];
  } catch(e) {
    showToast('Erro ao carregar dados.','error');
    allPlants = [];
  }
  loadDone();
  fillHomeStats();
  fillHeroCards();
  buildLocChips();
}

function savePlantLocally(plant) {
  const saved = JSON.parse(localStorage.getItem('bm-custom-plants')||'[]');
  saved.push(plant);
  localStorage.setItem('bm-custom-plants', JSON.stringify(saved));
}

// ─── HOME ─────────────────────────────────────────────────
function fillHomeStats() {
  document.getElementById('statTotal').textContent = allPlants.length;
  document.getElementById('statLocs').textContent  = [...new Set(allPlants.map(p=>p.loc))].length;
  document.getElementById('statTypes').textContent = [...new Set(allPlants.map(p=>p.type))].length;
}
function fillHeroCards() {
  const picks = allPlants.filter(p=>p.img).slice(0,3);
  const wrap  = document.getElementById('heroCards');
  if(!wrap) return;
  wrap.innerHTML = picks.map(p=>`
    <div class="hcard" onclick="showDetails(${p.id})">
      <img src="${p.img}" alt="${p.nome}" loading="lazy"/>
      <span>${p.emoji||''} ${p.nome}</span>
    </div>
  `).join('');
}

// ─── MAP ──────────────────────────────────────────────────
function initMap() {
  mapInstance = L.map('map', {zoomControl:false}).setView([-20.8028,-41.1545],17);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© OpenStreetMap contributors', maxZoom:20
  }).addTo(mapInstance);
  L.control.zoom({position:'topright'}).addTo(mapInstance);

  clusterGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 50,
    iconCreateFunction: c => L.divIcon({
      html:`<div style="background:var(--g500);color:#fff;font-family:Syne,sans-serif;font-weight:700;font-size:.85rem;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 12px rgba(45,106,79,.4);border:3px solid #fff;">${c.getChildCount()}</div>`,
      className:'', iconSize:[40,40], iconAnchor:[20,20]
    })
  });
  mapInstance.addLayer(clusterGroup);

  applyMapFilters();
  buildMapLocChips();

  mapInstance.on('click', e => {
    if(addModeActive) placeNewMarker(e.latlng);
  });
}

function makeIcon(emoji='🌿') {
  return L.divIcon({
    html:`<div style="background:var(--g700);color:#fff;width:38px;height:38px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 3px 12px rgba(0,0,0,.25);border:3px solid #fff;"><span style="transform:rotate(45deg);font-size:16px;">${emoji}</span></div>`,
    className:'', iconSize:[38,38], iconAnchor:[19,38], popupAnchor:[0,-40]
  });
}

function makePopup(p) {
  return `<div class="popup-card">
    <img src="${p.img||'fotos/goiaba.jpg'}" alt="${p.nome}" loading="lazy"/>
    <div class="popup-body">
      <h4>${p.nome}</h4>
      <div class="popup-sci">${p.sciName||''}</div>
      <p>${p.info||''}</p>
      <div class="popup-actions">
        <button class="popup-btn p" onclick="showDetails(${p.id})">Ver detalhes</button>
        <button class="popup-btn g" onclick="window.open('https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}','_blank')"><i class="fas fa-route"></i> Rota</button>
      </div>
    </div>
  </div>`;
}

function applyMapFilters() {
  if(!mapInstance) return;
  clusterGroup.clearLayers();
  allMarkers = {};

  const filtered = filterPlants(allPlants, mapFilters);
  document.getElementById('mapListCount').textContent = `${filtered.length} planta${filtered.length!==1?'s':''}`;

  filtered.forEach(p => {
    const m = L.marker([p.lat,p.lon], {icon:makeIcon(p.emoji), draggable:true});
    m.bindPopup(makePopup(p), {maxWidth:240, className:''});
    m.on('mouseover', function(){ this.openPopup(); });
    m.on('dragend', e => { p.lat=e.target.getLatLng().lat; p.lon=e.target.getLatLng().lng; showToast('Posição atualizada ✓','success'); });
    clusterGroup.addLayer(m);
    allMarkers[p.id] = m;
  });

  renderMapList(filtered);
}

function renderMapList(plants) {
  const el = document.getElementById('mapList');
  el.innerHTML = plants.map(p=>`
    <div class="map-item" onclick="flyTo(${p.id})">
      <img src="${p.img||'fotos/goiaba.jpg'}" alt="${p.nome}" loading="lazy"/>
      <div><strong>${p.emoji||''} ${p.nome}</strong><span>${p.loc}</span></div>
    </div>
  `).join('') || '<p style="padding:12px;color:var(--tx3);font-size:.82rem">Nenhuma planta encontrada.</p>';
}

function flyTo(id) {
  const p = allPlants.find(x=>x.id===id);
  if(!p||!mapInstance) return;
  mapInstance.flyTo([p.lat,p.lon], 19, {animate:true,duration:.9});
  setTimeout(()=>{ if(allMarkers[id]) allMarkers[id].openPopup(); }, 1000);
}

function setMapFilter(key, val, btn) {
  mapFilters[key] = val;
  const group = key==='type' ? document.getElementById('mapTypeChips') : document.getElementById('mapTagChips');
  group.querySelectorAll('.chip').forEach(c=>c.classList.toggle('active', c.dataset.val===val));
  applyMapFilters();
}

function buildMapLocChips() {
  const locs = ['all', ...new Set(allPlants.map(p=>p.loc))];
  document.getElementById('mapLocChips').innerHTML = locs.map(l=>`
    <button class="chip ${l==='all'?'active':''}" data-val="${l}"
      onclick="setMapLocFilter('${l}',this)">${l==='all'?'Todos':l}</button>
  `).join('');
}
function setMapLocFilter(val, btn) {
  mapFilters.loc = val;
  document.querySelectorAll('#mapLocChips .chip').forEach(c=>c.classList.toggle('active', c.dataset.val===val));
  applyMapFilters();
}

function buildLocChips() { buildMapLocChips(); }

function clearMapSearch() {
  document.getElementById('mapSearch').value='';
  document.getElementById('clearSearch').style.display='none';
  mapFilters.search='';
  applyMapFilters();
}
function resetMapFilters() {
  mapFilters.search=''; mapFilters.type='all'; mapFilters.tag='all'; mapFilters.loc='all';
  document.getElementById('mapSearch').value='';
  document.getElementById('clearSearch').style.display='none';
  document.querySelectorAll('#mapTypeChips .chip, #mapTagChips .chip').forEach(c=>c.classList.toggle('active', c.dataset.val==='all'));
  document.querySelectorAll('#mapLocChips .chip').forEach(c=>c.classList.toggle('active', c.dataset.val==='all'));
  if(proximityActive) toggleProximity();
  applyMapFilters();
}

function toggleSidebar() {
  document.getElementById('mapSidebar').classList.toggle('collapsed');
  setTimeout(()=>mapInstance?.invalidateSize(),310);
}

// My location
function goToMyLocation() {
  if(!navigator.geolocation) { showToast('Geolocalização não disponível','error'); return; }
  navigator.geolocation.getCurrentPosition(pos=>{
    userLatLng = [pos.coords.latitude, pos.coords.longitude];
    mapInstance.flyTo(userLatLng, 18, {animate:true,duration:1});
    L.circleMarker(userLatLng,{radius:10,color:'#3b82f6',fillColor:'#3b82f6',fillOpacity:.35,weight:2}).addTo(mapInstance)
     .bindPopup('<b>Você está aqui</b>').openPopup();
  }, ()=>showToast('Não foi possível obter localização','error'));
}

// Proximity filter
function toggleProximity() {
  proximityActive = !proximityActive;
  document.getElementById('proximityControls').style.display = proximityActive?'block':'none';
  document.getElementById('proximityBtn').classList.toggle('active-chip', proximityActive);
  if(proximityActive) {
    if(!userLatLng) { navigator.geolocation.getCurrentPosition(p=>{ userLatLng=[p.coords.latitude,p.coords.longitude]; applyMapFilters(); }, ()=>showToast('Habilite a localização','error')); }
    else applyMapFilters();
  } else { applyMapFilters(); }
}
function updateProximity(v) {
  proximityRadius=+v;
  document.getElementById('proximityLabel').textContent=`Raio: ${v}m`;
  if(proximityActive) applyMapFilters();
}

// Add mode
function enterAddMode() {
  addModeActive=true;
  document.getElementById('addModeBar').style.display='flex';
  document.getElementById('addBtn').style.display='none';
  mapInstance.getContainer().style.cursor='crosshair';
}
function exitAddMode() {
  addModeActive=false;
  document.getElementById('addModeBar').style.display='none';
  document.getElementById('addBtn').style.display='flex';
  mapInstance.getContainer().style.cursor='';
  addLatLng=null;
}
function placeNewMarker(latlng) {
  addLatLng=latlng;
  document.getElementById('addLatLon').textContent=`${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
  exitAddMode();
  openModal('addModal');
}

// ─── CATALOG ──────────────────────────────────────────────
let catType='all', catTag='all';

function setCatFilter(key, val, btn) {
  if(key==='type') catType=val;
  if(key==='tag')  catTag=val;
  const groupId = key==='type'?'catTypeChips':'catTagChips';
  document.getElementById(groupId).querySelectorAll('.chip').forEach(c=>c.classList.toggle('active',c.dataset.val===val));
  renderCatalog();
}

function filterPlants(list, f) {
  return list.filter(p=>{
    const q = (f.search||'').toLowerCase();
    const matchSearch = !q ||
      p.nome.toLowerCase().includes(q) ||
      (p.sciName||'').toLowerCase().includes(q) ||
      (p.desc||'').toLowerCase().includes(q) ||
      (p.tags||[]).some(t=>t.includes(q));
    const matchType = !f.type || f.type==='all' || p.type===f.type;
    const matchTag  = !f.tag  || f.tag==='all'  || (p.tags||[]).includes(f.tag);
    const matchLoc  = !f.loc  || f.loc==='all'  || p.loc===f.loc;
    let matchProx = true;
    if(proximityActive && userLatLng) {
      const d = distMeters(userLatLng[0],userLatLng[1],p.lat,p.lon);
      matchProx = d <= proximityRadius;
    }
    return matchSearch && matchType && matchTag && matchLoc && matchProx;
  });
}

function renderCatalog() {
  const q = document.getElementById('catalogSearch').value;
  const filtered = filterPlants(allPlants, {search:q, type:catType, tag:catTag});
  document.getElementById('catalogCount').textContent = `${filtered.length} planta${filtered.length!==1?'s':''} encontrada${filtered.length!==1?'s':''}`;
  const grid = document.getElementById('catalogGrid');
  if(!filtered.length) { grid.innerHTML='<p style="grid-column:1/-1;text-align:center;padding:60px;color:var(--tx3)"><i class="fas fa-search" style="font-size:2rem;margin-bottom:12px;display:block;opacity:.25"></i>Nenhuma planta encontrada.</p>'; return; }
  grid.innerHTML = filtered.map((p,i)=>plantCard(p,i)).join('');
}

function plantCard(p, i=0) {
  const fav = favs.includes(p.id);
  const tags = (p.tags||[]).map(t=>`<span class="tag-pill ${t}">${t}</span>`).join('');
  return `<div class="plant-card" style="animation-delay:${i*.04}s" onclick="showDetails(${p.id})">
    <div class="card-img-wrap">
      <img class="card-img" src="${p.img||'fotos/goiaba.jpg'}" alt="${p.nome}" loading="lazy"/>
      <span class="card-type">${typeLabel(p.type)}</span>
      <button class="card-fav ${fav?'on':''}" data-fid="${p.id}"
        onclick="event.stopPropagation();toggleFav(${p.id})">
        ${fav?'❤️':'🤍'}
      </button>
      <div class="card-tags">${tags}</div>
    </div>
    <div class="card-body">
      <h3>${p.nome}</h3>
      <div class="card-sci">${p.sciName||''}</div>
      <p>${p.info||''}</p>
      <div class="card-loc"><i class="fas fa-map-marker-alt"></i>${p.loc}</div>
    </div>
  </div>`;
}

// ─── DETAILS ──────────────────────────────────────────────
function showDetails(id) {
  const p = allPlants.find(x=>x.id===id);
  if(!p) return;
  prevPage = currentPage;
  const fav = favs.includes(p.id);
  const tags = (p.tags||[]).map(t=>`<span class="tag-pill ${t}" style="font-size:.72rem;padding:3px 10px;">${t}</span>`).join('');
  document.getElementById('detailsContent').innerHTML=`
    <div class="det-gallery">
      <img id="detMainImg" src="${p.img||'fotos/goiaba.jpg'}" alt="${p.nome}"/>
    </div>
    <div class="det-info">
      <span class="pill">${typeLabel(p.type)} · ${p.loc}</span>
      <h2>${p.nome}</h2>
      <div class="sci">${p.sciName||''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">${tags}</div>
      <p>${p.desc||p.info||''}</p>
      <div class="det-meta">
        <div class="meta-chip"><label>Colheita</label><span>${p.colheita||'–'}</span></div>
        <div class="meta-chip"><label>Porte</label><span>${p.porte||'–'}</span></div>
        <div class="meta-chip"><label>Tipo</label><span>${typeLabel(p.type)}</span></div>
        <div class="meta-chip"><label>Local</label><span>${p.loc}</span></div>
      </div>
      <div class="det-actions">
        <button class="btn-primary" onclick="navigate('map');setTimeout(()=>flyTo(${p.id}),600)">
          <i class="fas fa-map-marker-alt"></i> Ver no Mapa
        </button>
        <button class="btn-ghost card-fav ${fav?'on':''}" id="detFavBtn" data-fid="${p.id}"
          onclick="toggleFav(${p.id});this.innerHTML=favs.includes(${p.id})?'❤️ Salvo':'🤍 Favoritar';this.classList.toggle('on',favs.includes(${p.id}))">
          ${fav?'❤️ Salvo':'🤍 Favoritar'}
        </button>
        <button class="btn-ghost" onclick="window.open('https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}','_blank')">
          <i class="fas fa-route"></i> Rota
        </button>
      </div>
    </div>`;
  navigate('details');
}

// ─── FAVORITES ────────────────────────────────────────────
function toggleFav(id) {
  const idx = favs.indexOf(id);
  if(idx===-1) { favs.push(id); showToast('Adicionado aos favoritos ❤️','success'); }
  else         { favs.splice(idx,1); showToast('Removido dos favoritos'); }
  localStorage.setItem('bm-favs', JSON.stringify(favs));
  updateFavBadge();
  document.querySelectorAll(`[data-fid="${id}"]`).forEach(b=>{
    b.classList.toggle('on', favs.includes(id));
    if(b.tagName==='BUTTON' && !b.classList.contains('det-info')) {
      b.innerHTML = favs.includes(id)?'❤️':'🤍';
    }
  });
}
function updateFavBadge() { document.getElementById('favBadge').textContent=favs.length; }
function renderFavs() {
  const list = allPlants.filter(p=>favs.includes(p.id));
  const grid = document.getElementById('favsGrid');
  const empty = document.getElementById('favsEmpty');
  if(!list.length) { grid.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  grid.innerHTML = list.map((p,i)=>plantCard(p,i)).join('');
}

// ─── DASHBOARD ────────────────────────────────────────────
function renderDashboard() {
  if(!allPlants.length) return;
  // KPIs
  const locs  = [...new Set(allPlants.map(p=>p.loc))];
  const types = [...new Set(allPlants.map(p=>p.type))];
  const tags  = allPlants.flatMap(p=>p.tags||[]);
  const medCount = tags.filter(t=>t==='medicinal').length;
  document.getElementById('kpi1').innerHTML=`<span class="kpi-n">${allPlants.length}</span><span class="kpi-l">Total de Plantas</span>`;
  document.getElementById('kpi2').innerHTML=`<span class="kpi-n">${locs.length}</span><span class="kpi-l">Locais Mapeados</span>`;
  document.getElementById('kpi3').innerHTML=`<span class="kpi-n">${types.length}</span><span class="kpi-l">Tipos Diferentes</span>`;
  document.getElementById('kpi4').innerHTML=`<span class="kpi-n">${medCount}</span><span class="kpi-l">Plantas Medicinais</span>`;

  const GREEN = ['#2d6a4f','#52b788','#95d5b2','#d8f3dc','#1b4332','#40916c','#74c69d','#b7e4c7','#c8a94b','#f0e0a0'];

  // By type
  const typeCount={};
  allPlants.forEach(p=>typeCount[p.type]=(typeCount[p.type]||0)+1);
  destroyChart('chartType');
  chartInstances['chartType'] = new Chart(document.getElementById('chartType'),{
    type:'doughnut',
    data:{ labels:Object.keys(typeCount).map(typeLabel), datasets:[{data:Object.values(typeCount),backgroundColor:GREEN, borderWidth:2, borderColor: getComputedStyle(document.documentElement).getPropertyValue('--cream').trim()||'#fff'}]},
    options:{responsive:true,plugins:{legend:{position:'bottom',labels:{font:{family:'Syne',size:11}}}}}
  });

  // By location
  const locCount={};
  allPlants.forEach(p=>locCount[p.loc]=(locCount[p.loc]||0)+1);
  const locLabels = Object.keys(locCount); const locVals = Object.values(locCount);
  destroyChart('chartLoc');
  chartInstances['chartLoc'] = new Chart(document.getElementById('chartLoc'),{
    type:'bar',
    data:{ labels:locLabels, datasets:[{label:'Plantas',data:locVals,backgroundColor:GREEN[1],borderRadius:8}]},
    options:{responsive:true,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{grid:{display:false}},y:{ticks:{font:{family:'Syne',size:10}}}}}
  });

  // By tags
  const tagCount={frutífera:0,ornamental:0,medicinal:0};
  allPlants.forEach(p=>(p.tags||[]).forEach(t=>{if(tagCount[t]!==undefined)tagCount[t]++;}));
  destroyChart('chartTags');
  chartInstances['chartTags'] = new Chart(document.getElementById('chartTags'),{
    type:'polarArea',
    data:{ labels:['Frutífera','Ornamental','Medicinal'], datasets:[{data:Object.values(tagCount),backgroundColor:['rgba(200,169,75,.7)','rgba(82,183,136,.7)','rgba(99,179,237,.7)']}]},
    options:{responsive:true,plugins:{legend:{position:'bottom',labels:{font:{family:'Syne',size:11}}}}}
  });

  // Rank
  const nameCount={};
  allPlants.forEach(p=>{ const k=p.sciName||p.nome; nameCount[k]=(nameCount[k]||0)+1; });
  const sorted=Object.entries(nameCount).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const maxV=sorted[0]?.[1]||1;
  document.getElementById('rankList').innerHTML=sorted.map(([name,cnt],i)=>`
    <div class="rank-item">
      <span class="rank-n">${i+1}</span>
      <div class="rank-bar-wrap">
        <div class="rank-label">${name}</div>
        <div class="rank-bar"><div class="rank-fill" style="width:${(cnt/maxV*100).toFixed(0)}%"></div></div>
      </div>
      <span class="rank-count">${cnt} planta${cnt>1?'s':''}</span>
    </div>`).join('');
}

function destroyChart(id) {
  if(chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

// ─── ADD PLANT ────────────────────────────────────────────
function saveNewPlant() {
  const nome = document.getElementById('addNome').value.trim();
  const sci  = document.getElementById('addSci').value.trim();
  const type = document.getElementById('addType').value;
  const desc = document.getElementById('addDesc').value.trim();
  const col  = document.getElementById('addColheita').value.trim();
  const tags = [...document.querySelectorAll('.add-tag:checked')].map(x=>x.value);

  if(!nome) { showToast('Informe o nome da planta','error'); return; }
  if(!addLatLng) { showToast('Clique no mapa para definir a posição','error'); return; }

  const emojiMap={arvore:'🌳',palmeira:'🌴',herbacia:'🌿',trepadeira:'🍇',cacto:'🌵'};
  const newPlant = {
    id: Date.now(),
    nome, sciName:sci, loc:'Adicionado pelo usuário', type, tags,
    lat:addLatLng.lat, lon:addLatLng.lng,
    info: desc.slice(0,80)+'…', desc,
    img: croppedDataURL || 'fotos/goiaba.jpg',
    colheita:col||'–', porte:'–', emoji:emojiMap[type]||'🌱'
  };

  allPlants.push(newPlant);
  savePlantLocally(newPlant);
  closeAllModals();
  fillHomeStats();
  applyMapFilters();
  showToast(`"${nome}" adicionada com sucesso! 🌱`,'success');
  resetAddForm();
}

function resetAddForm() {
  ['addNome','addSci','addDesc','addColheita'].forEach(id=>document.getElementById(id).value='');
  document.querySelectorAll('.add-tag').forEach(c=>c.checked=false);
  document.getElementById('addLatLon').textContent='Clique no mapa primeiro';
  addLatLng=null; croppedDataURL=null; resetCrop();
}

// ─── IMAGE CROP ───────────────────────────────────────────
function onImageSelected(input) {
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('cropperWrap').style.display='block';
    document.getElementById('uploadZone').style.display='none';
    const img = document.getElementById('cropperImg');
    img.src = e.target.result;
    if(cropperInst) cropperInst.destroy();
    cropperInst = new Cropper(img, {aspectRatio:4/3, viewMode:1, guides:true, autoCropArea:.85});
  };
  reader.readAsDataURL(file);
}
function confirmCrop() {
  if(!cropperInst) return;
  const canvas = cropperInst.getCroppedCanvas({width:800,height:600,imageSmoothingQuality:'high'});
  croppedDataURL = canvas.toDataURL('image/webp',.82);
  document.getElementById('cropperWrap').style.display='none';
  document.getElementById('imgPreviewWrap').style.display='block';
  document.getElementById('imgPreview').src = croppedDataURL;
  cropperInst.destroy(); cropperInst=null;
}
function resetCrop() {
  if(cropperInst) { cropperInst.destroy(); cropperInst=null; }
  document.getElementById('cropperWrap').style.display='none';
  document.getElementById('imgPreviewWrap').style.display='none';
  document.getElementById('uploadZone').style.display='block';
  document.getElementById('imgInput').value='';
  croppedDataURL=null;
}

// ─── IDENTIFY (mock AI) ───────────────────────────────────
function onIdentifyImage(input) {
  const file=input.files[0]; if(!file) return;
  const r=new FileReader();
  r.onload=e=>{
    document.getElementById('identImg').src=e.target.result;
    document.getElementById('identPreview').style.display='block';
    document.getElementById('identZone').style.display='none';
    document.getElementById('identResult').style.display='none';
  };
  r.readAsDataURL(file);
}
function runIdentify() {
  document.getElementById('identResult').style.display='none';
  const btn = document.querySelector('#identifyModal .btn-primary');
  if(btn){ btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Analisando...'; btn.disabled=true; }

  // Mock AI: pick a random plant from the database
  setTimeout(()=>{
    const pick = allPlants[Math.floor(Math.random()*allPlants.length)];
    const conf = Math.floor(72+Math.random()*24);
    const res = document.getElementById('identResult');
    res.style.display='block';
    res.innerHTML=`<div class="ident-result">
      <h4>🌿 ${pick.nome}</h4>
      <p style="font-size:.75rem;font-style:italic;color:var(--tx3);margin:3px 0 8px">${pick.sciName||''}</p>
      <p>${pick.info||''}</p>
      <div class="ident-confidence">
        <div class="ident-bar-wrap"><div class="ident-bar-fill" style="width:0%" id="identBar"></div></div>
        <span class="ident-pct">${conf}%</span>
      </div>
      <button class="btn-primary sm" style="margin-top:12px;width:100%" onclick="showDetails(${pick.id});closeAllModals()">Ver ficha completa</button>
    </div>`;
    setTimeout(()=>{ const b=document.getElementById('identBar'); if(b)b.style.width=conf+'%'; },50);
    if(btn){ btn.innerHTML='<i class="fas fa-magic"></i> Identificar Espécie'; btn.disabled=false; }
  }, 2000);
}

// ─── MODALS ───────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.getElementById('overlay').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m=>m.classList.remove('open'));
  document.getElementById('overlay').classList.remove('open');
  document.body.style.overflow='';
  document.getElementById('identZone').style.display='block';
  document.getElementById('identPreview').style.display='none';
  document.getElementById('identResult').style.display='none';
}

// ─── HELPERS ──────────────────────────────────────────────
function typeLabel(t) {
  return {arvore:'🌳 Árvore',palmeira:'🌴 Palmeira',herbacia:'🌿 Herbácea',trepadeira:'🍇 Trepadeira',cacto:'🌵 Cacto'}[t]||t;
}
function distMeters(lat1,lon1,lat2,lon2) {
  const R=6371000, dL=((lat2-lat1)*Math.PI/180), dl=((lon2-lon1)*Math.PI/180);
  const a=Math.sin(dL/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dl/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// ─── INIT ─────────────────────────────────────────────────
(async function init() {
  // Theme
  const t=localStorage.getItem('bm-theme')||'light';
  document.documentElement.setAttribute('data-theme',t);
  document.getElementById('themeBtn').innerHTML=t==='dark'?'<i class="fas fa-sun"></i>':'<i class="fas fa-moon"></i>';

  // Scroll
  window.addEventListener('scroll',()=>document.getElementById('navbar').classList.toggle('scrolled',scrollY>20));

  // Load data then boot
  await loadData();
  updateFavBadge();
  navigate('home');

  // PWA service worker
  if('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
})();