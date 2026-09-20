import './style.css';

(function(){
"use strict";

/* ======================= DATA LAYER ======================= */
const PRIORITY_COLORS = { CRITICAL:'#e5484d', HIGH:'#f2874e', MODERATE:'#f0c94a', LOW:'#59c9a5' };
const PRIORITY_LABELS = { CRITICAL:'Critical', HIGH:'High', MODERATE:'Moderate', LOW:'Monitor' };

const CONTROL_PRACTICE_KEYS = ['larviciding','sourceReduction','adulticiding','biological','publicEducation','surveillance','aerial','ground','otherInnovative'];
const CONTROL_COLORS = { ACTIVE:'#59c9a5', NONE:'#e5484d', UNKNOWN:'#8a9a8f' };
const CONTROL_LABELS = { ACTIVE:'Active control program', NONE:'No current control recorded', UNKNOWN:'No data' };

let REGIONS = [];
let REGION_BY_ID = {};
let PRACTICES_BY_ID = {};

async function loadRegions(){
  const res = await fetch('/api/regions');
  REGIONS = await res.json();
  REGION_BY_ID = Object.fromEntries(REGIONS.map(r=>[r.id, r]));
}

async function loadTreatmentPractices(){
  const res = await fetch('/api/treatment-practices');
  const practices = await res.json();
  PRACTICES_BY_ID = Object.fromEntries(practices.map(p=>[p.id, p]));
}

function controlStatus(region){
  const p = PRACTICES_BY_ID[region.id];
  if(!p) return 'UNKNOWN';
  return CONTROL_PRACTICE_KEYS.some(key=>p[key]) ? 'ACTIVE' : 'NONE';
}

/* ======================= STATE ======================= */
const state = {
  activeLayer: 'control',
  selectedId: null,
  panelCollapsed: false,
  activeTab: 'skeeter',
  priorityFilter: new Set(),
  chatHistory: [],
};

/* ======================= HELPERS ======================= */
function lerpColor(a,b,t){
  const pa=hexToRgb(a), pb=hexToRgb(b);
  const r=Math.round(pa.r+(pb.r-pa.r)*t), g=Math.round(pa.g+(pb.g-pa.g)*t), bl=Math.round(pa.b+(pb.b-pa.b)*t);
  return `rgb(${r},${g},${bl})`;
}
function hexToRgb(hex){
  const h=hex.replace('#','');
  return { r:parseInt(h.substring(0,2),16), g:parseInt(h.substring(2,4),16), b:parseInt(h.substring(4,6),16) };
}
function colorForLayer(region, layer){
  if(layer==='control') return CONTROL_COLORS[controlStatus(region)];
  if(layer==='mosquito'){
    const t = Math.min(1, region.mosquitoActivity/100);
    return lerpColor('#f7d98a','#c92b30', t);
  }
  if(layer==='weather'){
    const t = Math.min(1, region.rainfall/4);
    return lerpColor('#bfe6fb','#0f3d7a', t);
  }
  return '#93e35c';
}
function radiusForLayer(region, layer){
  if(layer==='control'){
    return { ACTIVE:7, NONE:5, UNKNOWN:4 }[controlStatus(region)];
  }
  if(layer==='mosquito') return 4 + (region.mosquitoActivity/100)*5;
  if(layer==='weather') return 4 + (region.rainfall/4)*5;
  return 6;
}
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.classList.add('show');
  clearTimeout(showToast._h);
  showToast._h=setTimeout(()=>t.classList.remove('show'), 2600);
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ======================= MAP RENDER ======================= */
const dotsGroup = document.getElementById('countyDots');

function renderMap(){
  dotsGroup.innerHTML = '';
  REGIONS.forEach(region=>{
    const color = colorForLayer(region, state.activeLayer);
    const r = radiusForLayer(region, state.activeLayer);
    const circle = document.createElementNS('http://www.w3.org/2000/svg','circle');
    circle.setAttribute('cx', region.x);
    circle.setAttribute('cy', region.y);
    circle.setAttribute('r', r);
    circle.setAttribute('fill', color);
    circle.classList.add('county-dot');
    circle.dataset.id = region.id;
    if(state.priorityFilter.size>0 && !state.priorityFilter.has(region.priority)){
      circle.classList.add('dimmed');
    }
    if(state.selectedId===region.id) circle.classList.add('selected');
    circle.addEventListener('click', ()=>selectCounty(region.id));
    circle.addEventListener('mouseenter', (e)=>showCountyTip(region, e));
    circle.addEventListener('mouseleave', hideCountyTip);
    dotsGroup.appendChild(circle);
  });
}

let tipEl = null;
function showCountyTip(region, e){
  hideCountyTip();
  tipEl = document.createElementNS('http://www.w3.org/2000/svg','text');
  tipEl.setAttribute('x', region.x+10);
  tipEl.setAttribute('y', region.y-8);
  tipEl.classList.add('county-label-tip');
  tipEl.textContent = region.county.toUpperCase();
  dotsGroup.appendChild(tipEl);
}
function hideCountyTip(){
  if(tipEl){ tipEl.remove(); tipEl=null; }
}

/* ======================= LEGEND ======================= */
function renderLegend(){
  const el = document.getElementById('legendCard');
  if(state.activeLayer==='control'){
    el.innerHTML = `
      <p class="legend-title">CURRENT MOSQUITO CONTROL</p>
      <div class="legend-row"><span class="legend-swatch" style="background:${CONTROL_COLORS.ACTIVE}"></span>${CONTROL_LABELS.ACTIVE}</div>
      <div class="legend-row"><span class="legend-swatch" style="background:${CONTROL_COLORS.NONE}"></span>${CONTROL_LABELS.NONE}</div>
      <div class="legend-row"><span class="legend-swatch" style="background:${CONTROL_COLORS.UNKNOWN}"></span>${CONTROL_LABELS.UNKNOWN}</div>`;
  } else if(state.activeLayer==='mosquito'){
    el.innerHTML = `
      <p class="legend-title">MOSQUITO ACTIVITY</p>
      <div class="legend-gradient" style="background:linear-gradient(90deg, #f7d98a, #c92b30)"></div>
      <div class="legend-row" style="justify-content:space-between;"><span>Low</span><span>High</span></div>`;
  } else {
    el.innerHTML = `
      <p class="legend-title">RECENT RAINFALL</p>
      <div class="legend-gradient" style="background:linear-gradient(90deg, #bfe6fb, #0f3d7a)"></div>
      <div class="legend-row" style="justify-content:space-between;"><span>Dry</span><span>Saturated</span></div>`;
  }
}

/* ======================= SUMMARY CARD ======================= */
function renderSummary(){
  const counts = { CRITICAL:0, HIGH:0, MODERATE:0, LOW:0 };
  REGIONS.forEach(r=>counts[r.priority]++);
  const order = ['CRITICAL','HIGH','MODERATE','LOW'];
  const grid = document.getElementById('summaryGrid');
  grid.innerHTML = order.map(p=>{
    const active = state.priorityFilter.has(p) ? 'filter-active' : '';
    return `<button class="summary-item ${active}" data-priority="${p}" style="color:${PRIORITY_COLORS[p]}">
      <span class="summary-dot" style="background:${PRIORITY_COLORS[p]}"></span>
      <span class="summary-count">${counts[p]}</span>
      <span style="color:var(--ink); font-family:var(--font-sans); font-weight:500;">${PRIORITY_LABELS[p]}</span>
    </button>`;
  }).join('');
  grid.querySelectorAll('.summary-item').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const p = btn.dataset.priority;
      if(state.priorityFilter.has(p)) state.priorityFilter.delete(p);
      else state.priorityFilter.add(p);
      renderMap();
      renderSummary();
    });
  });
}

/* ======================= LAYER TOGGLES ======================= */
document.getElementById('layerList').addEventListener('click', (e)=>{
  const btn = e.target.closest('.layer-btn');
  if(!btn) return;
  state.activeLayer = btn.dataset.layer;
  document.querySelectorAll('.layer-btn').forEach(b=>b.setAttribute('aria-pressed', b===btn ? 'true':'false'));
  renderMap();
  renderLegend();
});

/* ======================= SEARCH ======================= */
const searchToggleBtn = document.getElementById('searchToggleBtn');
const searchWrap = document.getElementById('searchWrap');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

searchToggleBtn.addEventListener('click', ()=>{
  const open = searchWrap.style.display !== 'none';
  searchWrap.style.display = open ? 'none' : 'block';
  searchToggleBtn.setAttribute('aria-pressed', open ? 'false':'true');
  searchToggleBtn.classList.toggle('active-state', !open);
  if(!open){ searchInput.focus(); }
  else { searchResults.classList.remove('open'); }
});

searchInput.addEventListener('input', ()=>{
  const q = searchInput.value.trim().toLowerCase();
  if(!q){ searchResults.classList.remove('open'); searchResults.innerHTML=''; return; }
  const matches = REGIONS.filter(r=>r.county.toLowerCase().includes(q)).slice(0,8);
  if(matches.length===0){
    searchResults.innerHTML = `<div class="search-result-item" style="color:#8a9a8f;">No counties match “${escapeHtml(searchInput.value)}”</div>`;
  } else {
    searchResults.innerHTML = matches.map(r=>`
      <div class="search-result-item" data-id="${r.id}">
        <span>${r.county}</span>
        <span class="mini-badge" style="background:${PRIORITY_COLORS[r.priority]}">${PRIORITY_LABELS[r.priority].toUpperCase()}</span>
      </div>`).join('');
  }
  searchResults.classList.add('open');
});
searchResults.addEventListener('click', (e)=>{
  const item = e.target.closest('.search-result-item');
  if(!item || !item.dataset.id) return;
  selectCounty(item.dataset.id);
  searchWrap.style.display='none';
  searchToggleBtn.setAttribute('aria-pressed','false');
  searchToggleBtn.classList.remove('active-state');
  searchInput.value='';
  searchResults.classList.remove('open');
});
document.addEventListener('click',(e)=>{
  if(!searchWrap.contains(e.target) && e.target!==searchToggleBtn && !searchToggleBtn.contains(e.target)){
    searchResults.classList.remove('open');
  }
});

/* ======================= PANEL TABS / COLLAPSE ======================= */
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>setActiveTab(btn.dataset.tab));
});
function setActiveTab(tab){
  state.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.panel-body').forEach(b=>b.classList.toggle('active', b.dataset.tabbody===tab));
  if(state.panelCollapsed) togglePanel(false);
}
const panelShell = document.getElementById('panelShell');
document.getElementById('collapseToggle').addEventListener('click', ()=>togglePanel());
function togglePanel(forceOpen){
  state.panelCollapsed = forceOpen===false ? false : !state.panelCollapsed;
  panelShell.classList.toggle('collapsed', state.panelCollapsed);
  document.getElementById('collapseToggle').title = state.panelCollapsed ? 'Expand panel' : 'Collapse panel';
}

/* ======================= SELECT COUNTY / DETAILS ======================= */
function selectCounty(id){
  state.selectedId = id;
  renderMap();
  renderDetails();
  updateSkeeterContextBar();
  setActiveTab('details');
  if(state.panelCollapsed) togglePanel(false);
}

function renderDetails(){
  const empty = document.getElementById('detailEmpty');
  const content = document.getElementById('detailContent');
  const region = REGION_BY_ID[state.selectedId];
  if(!region){
    empty.style.display='flex';
    content.style.display='none';
    return;
  }
  empty.style.display='none';
  content.style.display='flex';
  content.innerHTML = `
    <div class="detail-header">
      <span class="detail-eyebrow">AREA</span>
      <span class="detail-county">${region.county} County</span>
      <span class="priority-tag" style="background:${PRIORITY_COLORS[region.priority]}">${PRIORITY_LABELS[region.priority].toUpperCase()} PRIORITY</span>
    </div>

    ${region.changeNote ? `<div class="change-note">${escapeHtml(region.changeNote)}</div>` : ''}

    <div class="section-block">
      <span class="section-label">WHY?</span>
      <ul class="reason-list">${region.reasons.map(r=>`<li>${escapeHtml(r)}</li>`).join('')}</ul>
    </div>

    <div class="stat-grid">
      <div class="stat-box"><div class="k">MOSQUITO ACTIVITY</div><div class="v">${region.mosquitoActivity}/100</div></div>
      <div class="stat-box"><div class="k">HABITAT RISK</div><div class="v">${region.habitatRisk}/100</div></div>
      <div class="stat-box"><div class="k">RECENT RAINFALL</div><div class="v">${region.rainfall}"</div></div>
      <div class="stat-box"><div class="k">TEMPERATURE</div><div class="v">${region.temperature}°F</div></div>
    </div>

    <div class="status-line">
      <span class="section-label" style="margin:0;">STATUS</span>
      <strong>${region.treatmentStatus}</strong>
    </div>

    <div class="accordion" id="forecastAccordion">
      <button class="accordion-head" id="forecastAccordionHead">
        TREATMENT FORECAST
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="accordion-content">
        <div class="forecast-hero">
          <span class="big">${region.treatmentEffectiveness}%</span>
          <span class="lbl">Expected effectiveness</span>
        </div>
        <div class="stat-grid" style="margin-bottom:10px;">
          <div class="stat-box"><div class="k">RISK REDUCTION</div><div class="v">${Math.max(5,region.treatmentEffectiveness-18)}–${Math.min(95,region.treatmentEffectiveness-4)}%</div></div>
          <div class="stat-box"><div class="k">CONFIDENCE</div><div class="v"><span class="confidence-badge">${region.confidence}</span></div></div>
        </div>
        <span class="section-label">KEY FACTORS</span>
        <ul class="reason-list" style="margin-top:6px;">
          <li>Mosquito activity</li><li>Breeding habitat</li><li>Recent rainfall</li><li>Temperature / environmental conditions</li>
          ${region.treatmentStatus.includes('Recommended')||region.treatmentStatus.includes('Scheduled') ? '<li>Previous treatment outcomes</li>':''}
        </ul>
        <p class="disclaimer">Model / demo estimate — not a guaranteed outcome.</p>
      </div>
    </div>

    <div class="btn-row">
      <button class="btn btn-primary" id="askSkeeterFromDetail">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
        Ask Skeeter
      </button>
      <button class="btn btn-ghost" id="clearSelectionBtn">Return to full map</button>
    </div>
  `;

  document.getElementById('forecastAccordionHead').addEventListener('click', ()=>{
    document.getElementById('forecastAccordion').classList.toggle('open');
  });
  document.getElementById('askSkeeterFromDetail').addEventListener('click', ()=>{
    setActiveTab('skeeter');
    askSkeeterAboutSelected();
  });
  document.getElementById('clearSelectionBtn').addEventListener('click', ()=>{
    state.selectedId = null;
    renderMap();
    renderDetails();
    updateSkeeterContextBar();
  });
}

/* ======================= FORECAST BUTTON (sidebar) ======================= */
document.getElementById('forecastBtn').addEventListener('click', ()=>{
  if(!state.selectedId){
    showToast('Select a county on the map first');
    return;
  }
  setActiveTab('details');
  if(state.panelCollapsed) togglePanel(false);
  const acc = document.getElementById('forecastAccordion');
  if(acc){ acc.classList.add('open'); acc.scrollIntoView({behavior:'smooth', block:'nearest'}); }
});

/* ======================= HOME BUTTON ======================= */
document.getElementById('homeBtn').addEventListener('click', ()=>{
  state.selectedId = null;
  state.priorityFilter.clear();
  state.activeLayer = 'control';
  document.querySelectorAll('.layer-btn').forEach(b=>b.setAttribute('aria-pressed', b.dataset.layer==='control' ? 'true':'false'));
  renderMap(); renderLegend(); renderSummary(); renderDetails(); updateSkeeterContextBar();
  showToast('Back to statewide view');
});

/* ======================= SKEETER CHATBOT ======================= */
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const contextBar = document.getElementById('skeeterContextBar');

const DEFAULT_PROMPTS = [
  'Which areas currently need treatment?',
  'Which counties have the highest treatment priority?',
  'Show me high priority areas with no treatment recorded',
  'What changed recently?',
];

let apiHistory = []; // [{role:'user'|'model', content:string}, ...] sent to /api/skeeter

function updateSkeeterContextBar(){
  const region = REGION_BY_ID[state.selectedId];
  if(region){
    contextBar.style.display='flex';
    contextBar.innerHTML = `\ud83d\udccd Viewing <strong>${region.county} County</strong> \u2014 <span style="color:${PRIORITY_COLORS[region.priority]}; font-weight:700;">${PRIORITY_LABELS[region.priority]}</span>`;
    renderSuggestedPrompts([
      'Why is this area a priority?',
      'What is driving the treatment forecast?',
      'What treatment status does this area have?',
    ]);
  } else {
    contextBar.style.display='none';
    renderSuggestedPrompts(DEFAULT_PROMPTS);
  }
}

function renderSuggestedPrompts(list){
  const el = document.getElementById('suggestedPrompts');
  el.innerHTML = list.map(p=>`<button class="suggest-chip">${escapeHtml(p)}</button>`).join('');
  el.querySelectorAll('.suggest-chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      chatInput.value = chip.textContent;
      sendMessage();
    });
  });
}

function appendMessage(role, text){
  const div = document.createElement('div');
  div.className = 'msg ' + (role==='user' ? 'user':'bot');
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

function greetSkeeter(){
  chatLog.innerHTML='';
  apiHistory = [];
  appendMessage('bot', "Hi, I'm Skeeter \ud83e\udd9f \u2014 ask me anything about Florida's mosquito treatment data. Try one of the prompts below, or type your own question.");
}

function askSkeeterAboutSelected(){
  const region = REGION_BY_ID[state.selectedId];
  if(!region) return;
  appendMessage('bot', `You're looking at ${region.county} County. What would you like to know?`);
}

async function sendMessage(){
  const val = chatInput.value.trim();
  if(!val) return;
  appendMessage('user', val);
  apiHistory.push({ role:'user', content: val });
  chatInput.value='';

  const botEl = appendMessage('bot', '');
  const cursor = document.createElement('span');
  cursor.className = 'typing-dots';
  cursor.innerHTML = '<span></span><span></span><span></span>';
  botEl.appendChild(cursor);
  chatLog.scrollTop = chatLog.scrollHeight;

  let fullReply = '';
  let cursorRemoved = false;
  try {
    const res = await fetch('/api/skeeter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: apiHistory, selectedId: state.selectedId }),
    });

    if(!res.ok || !res.body){
      const errText = await res.text();
      throw new Error(errText || 'Request failed');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while(true){
      const { done, value } = await reader.read();
      if(done) break;
      if(!cursorRemoved){ cursor.remove(); cursorRemoved = true; }
      fullReply += decoder.decode(value, { stream:true });
      botEl.textContent = fullReply;
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  } catch(err){
    if(!cursorRemoved) cursor.remove();
    fullReply = fullReply || `Skeeter couldn't reach the server: ${err.message}. Is app.py running with GEMINI_API_KEY set?`;
    botEl.textContent = fullReply;
  }

  apiHistory.push({ role:'model', content: fullReply });
}

document.getElementById('sendBtn').addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') sendMessage(); });
document.getElementById('clearChatBtn').addEventListener('click', ()=>{
  greetSkeeter();
  updateSkeeterContextBar();
});

/* ======================= INIT ======================= */
async function init(){
  await Promise.all([loadRegions(), loadTreatmentPractices()]);
  renderMap();
  renderLegend();
  renderSummary();
  renderDetails();
  greetSkeeter();
  updateSkeeterContextBar();
}
init();

})();
