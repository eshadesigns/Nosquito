import './style.css';
import * as d3 from 'd3';

(function () {
  "use strict";

  /* =========================================================
     DATA
  ========================================================= */

  const PRIORITY_COLORS = {
    CRITICAL: '#e5484d',
    HIGH: '#f2874e',
    MODERATE: '#f0c94a',
    LOW: '#59c9a5'
  };

  const PRIORITY_LABELS = {
    CRITICAL: 'Critical',
    HIGH: 'High',
    MODERATE: 'Moderate',
    LOW: 'Monitor'
  };

  // Eight of the nine CSV practices get their own validated hue (checked
  // with the dataviz skill's validator against this app's dark map surface,
  // #0a2618 — all adjacent-pair CVD/contrast checks pass). The ninth,
  // "Other / innovative", is a genuine catch-all bucket, so per the skill's
  // rule ("a 9th series is never a generated hue") it isn't given a hue at
  // all — it's shown as a dashed ring around the county instead.
  const PRACTICE_COLORS = {
    larviciding:     '#3987e5', // blue
    sourceReduction: '#d95926', // orange
    adulticiding:    '#199e70', // aqua
    biological:      '#c98500', // yellow
    publicEducation: '#d55181', // magenta
    surveillance:    '#008300', // green
    aerial:          '#9085e9', // violet
    ground:          '#e66767', // red
  };
  const CONTROL_PRACTICE_KEYS = Object.keys(PRACTICE_COLORS).concat('otherInnovative');
  const PRACTICE_LABELS = {
    larviciding:     'Larviciding',
    sourceReduction: 'Source reduction',
    adulticiding:    'Adulticiding',
    biological:      'Biological control',
    publicEducation: 'Public education',
    surveillance:    'Surveillance',
    aerial:          'Aerial treatment',
    ground:          'Ground treatment',
    otherInnovative: 'Other / innovative',
  };
  const CONTROL_NONE_COLOR = '#898781';    // has data, no practice active
  const CONTROL_UNKNOWN_COLOR = '#4a4a47'; // no CSV data for this county

  let REGIONS = [];
  let REGION_BY_ID = {};
  let REGION_BY_COUNTY = {};
  let PRACTICES_BY_ID = {};

  let FLORIDA_GEOJSON = null;
  


  /* =========================================================
     STATE
  ========================================================= */

  const state = {
    activeLayer: 'control',
    selectedId: null,
    panelCollapsed: false,
    activeTab: 'skeeter',
    priorityFilter: new Set(),
    chatHistory: []
  };


  /* =========================================================
     LOAD DATA
  ========================================================= */

  async function loadRegions() {
    const res = await fetch('/api/regions');

    if (!res.ok) {
      throw new Error('Could not load /api/regions');
    }

    REGIONS = await res.json();

      

    REGION_BY_ID = Object.fromEntries(
      REGIONS.map(region => [region.id, region])
    );

    REGION_BY_COUNTY = Object.fromEntries(
      REGIONS.map(region => [
        normalizeCountyName(region.county),
        region
      ])
    );
  }


  async function loadTreatmentPractices() {
    const res = await fetch('/api/treatment-practices');

    if (!res.ok) {
      throw new Error('Could not load /api/treatment-practices');
    }

    const practices = await res.json();

    PRACTICES_BY_ID = Object.fromEntries(
      practices.map(p => [p.id, p])
    );
  }


  async function loadCountyGeoJSON() {
    const geoUrl = new URL(
      './data/us-counties.geojson',
      import.meta.url
    );

    const res = await fetch(geoUrl);

    if (!res.ok) {
      throw new Error('Could not load county GeoJSON');
    }

    const usa = await res.json();

    const floridaFeatures = usa.features.filter(feature => {
      const fips = String(feature.id || '').padStart(5, '0');

      return fips.startsWith('12');
    });

    FLORIDA_GEOJSON = {
      type: 'FeatureCollection',
      features: floridaFeatures
    };

    console.log(
      `Loaded ${FLORIDA_GEOJSON.features.length} Florida counties`
    );
  }


  /* =========================================================
     HELPERS
  ========================================================= */

  function normalizeCountyName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/\bcounty\b/g, '')
      .replace(/[^a-z0-9]/g, '');
  }


  function regionForFeature(feature) {
    const countyName =
      feature?.properties?.NAME ||
      feature?.properties?.name ||
      '';

    return REGION_BY_COUNTY[
      normalizeCountyName(countyName)
    ] || null;
  }


  function lerpColor(a, b, t) {
    const pa = hexToRgb(a);
    const pb = hexToRgb(b);

    const r = Math.round(
      pa.r + (pb.r - pa.r) * t
    );

    const g = Math.round(
      pa.g + (pb.g - pa.g) * t
    );

    const bl = Math.round(
      pa.b + (pb.b - pa.b) * t
    );

    return `rgb(${r},${g},${bl})`;
  }


  function hexToRgb(hex) {
    const h = hex.replace('#', '');

    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16)
    };
  }


  // Active practice keys for a region, in fixed display order (or null if
  // the county isn't in the treatment-practices CSV at all).
  function activePractices(region) {
    const p = PRACTICES_BY_ID[region.id];

    if (!p) {
      return null;
    }

    return CONTROL_PRACTICE_KEYS.filter(key => p[key]);
  }


  function blendColors(hexColors) {
    if (hexColors.length === 0) {
      return null;
    }

    const rgbs = hexColors.map(hexToRgb);

    const avg = channel => Math.round(
      rgbs.reduce((sum, c) => sum + c[channel], 0) / rgbs.length
    );

    return `rgb(${avg('r')},${avg('g')},${avg('b')})`;
  }


  // The composite "overlay" color for a county: the average of every active
  // practice's hue. "Other / innovative" carries no hue of its own (see
  // PRACTICE_COLORS above) so it never enters the blend — it's surfaced as a
  // ring in renderMap() instead, and always by name in the hover tooltip and
  // legend, so identity is never carried by color alone.
  function controlColor(region) {
    const active = activePractices(region);

    if (active === null) {
      return CONTROL_UNKNOWN_COLOR;
    }

    const hues = active.map(key => PRACTICE_COLORS[key]).filter(Boolean);

    return blendColors(hues) || CONTROL_NONE_COLOR;
  }


  function colorForLayer(region, layer) {
    if (!region) {
      return '#173a2a';
    }

    if (layer === 'control') {
      return controlColor(region);
    }

    if (layer === 'priority') {
      return PRIORITY_COLORS[region.priority];
    }

    if (layer === 'mosquito') {
      const t = Math.min(
        1,
        region.mosquitoActivity / 100
      );

      return lerpColor(
        '#f7d98a',
        '#c92b30',
        t
      );
    }

    if (layer === 'weather') {
      const t = Math.min(
        1,
        region.rainfall / 4
      );

      return lerpColor(
        '#bfe6fb',
        '#0f3d7a',
        t
      );
    }

    return '#93e35c';
  }


  function showToast(msg) {
    const toast = document.getElementById('toast');

    toast.textContent = msg;
    toast.classList.add('show');

    clearTimeout(showToast._h);

    showToast._h = setTimeout(() => {
      toast.classList.remove('show');
    }, 2600);
  }


  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]
    );
  }


  /* =========================================================
     REAL FLORIDA COUNTY MAP
  ========================================================= */

  const floridaSvg =
    d3.select('#floridaSvg');

  const countyMap =
    floridaSvg.select('#countyMap');


  function renderMap() {
    if (!FLORIDA_GEOJSON) {
      return;
    }

    const width = 800;
    const height = 700;

    /*
      D3 automatically scales and positions the real
      Florida county boundaries inside our SVG.
    */

    const projection = d3.geoMercator()
  .fitExtent(
    [
      [165, 115],
      [width - 65, height - 55]
    ],
    FLORIDA_GEOJSON
  );

    const path =
      d3.geoPath(projection);


    countyMap
      .selectAll('path')
      .data(
        FLORIDA_GEOJSON.features,
        feature => feature.id
      )
      .join('path')

      .attr('d', path)

      .attr('class', feature => {
        const region =
          regionForFeature(feature);

        const classes = [
          'county-shape'
        ];

        if (
          region &&
          state.priorityFilter.size > 0 &&
          !state.priorityFilter.has(region.priority)
        ) {
          classes.push('dimmed');
        }

        if (
          region &&
          state.selectedId === region.id
        ) {
          classes.push('selected');
        }

        return classes.join(' ');
      })

      .attr('fill', feature => {
        const region =
          regionForFeature(feature);

        return colorForLayer(
          region,
          state.activeLayer
        );
      })

      // "Other / innovative" has no hue of its own, so on the control
      // layer it's marked with a dashed ring instead of a blended fill.
      .attr('stroke', feature => {
        if (state.activeLayer !== 'control') return null;
        const region = regionForFeature(feature);
        const active = region && activePractices(region);
        return active && active.includes('otherInnovative') ? '#ffffff' : null;
      })
      .attr('stroke-width', feature => {
        if (state.activeLayer !== 'control') return null;
        const region = regionForFeature(feature);
        const active = region && activePractices(region);
        return active && active.includes('otherInnovative') ? 2.5 : null;
      })
      .attr('stroke-dasharray', feature => {
        if (state.activeLayer !== 'control') return null;
        const region = regionForFeature(feature);
        const active = region && activePractices(region);
        return active && active.includes('otherInnovative') ? '6,4' : null;
      })

      .attr('data-county', feature =>
        feature.properties?.NAME || ''
      )

      .style(
        'cursor',
        feature =>
          regionForFeature(feature)
            ? 'pointer'
            : 'default'
      )

      .on('click', function (event, feature) {
        const region =
          regionForFeature(feature);

        if (!region) {
          return;
        }

        selectCounty(region.id);
      })

      .on('mouseenter', function (event, feature) {
        const region =
          regionForFeature(feature);

        if (!region) {
          return;
        }

        d3.select(this)
          .raise();

        showCountyTip(
          region,
          event
        );
      })

      .on('mousemove', function (event, feature) {
        const region =
          regionForFeature(feature);

        if (!region) {
          return;
        }

        moveCountyTip(event);
      })

      .on('mouseleave', function () {
        hideCountyTip();
      });
  }


  /* =========================================================
     COUNTY TOOLTIP
  ========================================================= */

  let tipEl = null;


  function showCountyTip(region, event) {
    hideCountyTip();

    const mapArea =
      document.getElementById('mapArea');

    tipEl =
      document.createElement('div');

    tipEl.className =
      'county-hover-tooltip';

    // The composite fill on the control layer is a blend of every active
    // practice's hue, so it can't be decoded by eye alone — list the
    // practices by name too.
    const subline = state.activeLayer === 'control'
      ? (() => {
          const active = activePractices(region);
          if (active === null) return 'No data';
          if (active.length === 0) return 'No current control recorded';
          return active.map(key => escapeHtml(PRACTICE_LABELS[key])).join(', ');
        })()
      : `${escapeHtml(PRIORITY_LABELS[region.priority])} Priority`;

    tipEl.innerHTML = `
      <strong>${escapeHtml(region.county)} County</strong>
      <span>${subline}</span>
    `;

    mapArea.appendChild(tipEl);

    moveCountyTip(event);
  }


  function moveCountyTip(event) {
    if (!tipEl) {
      return;
    }

    const mapArea =
      document.getElementById('mapArea');

    const rect =
      mapArea.getBoundingClientRect();

    tipEl.style.left =
      `${event.clientX - rect.left + 14}px`;

    tipEl.style.top =
      `${event.clientY - rect.top + 14}px`;
  }


  function hideCountyTip() {
    if (tipEl) {
      tipEl.remove();
      tipEl = null;
    }
  }


  /* =========================================================
     LEGEND
  ========================================================= */

  function renderLegend() {
    const el =
      document.getElementById('legendCard');

    if (state.activeLayer === 'control') {

      const practiceRows = Object.keys(PRACTICE_COLORS).map(key => `
        <div class="legend-row">
          <span class="legend-swatch" style="background:${PRACTICE_COLORS[key]}"></span>
          ${PRACTICE_LABELS[key]}
        </div>
      `).join('');

      el.innerHTML = `
        <p class="legend-title">MOSQUITO CONTROL PRACTICES</p>
        <p class="legend-note">County color blends every active practice below</p>
        ${practiceRows}
        <div class="legend-row">
          <span class="legend-swatch" style="background:transparent; border:2px dashed #fff;"></span>
          ${PRACTICE_LABELS.otherInnovative}
        </div>
        <div class="legend-row">
          <span class="legend-swatch" style="background:${CONTROL_NONE_COLOR}"></span>
          No current control recorded
        </div>
        <div class="legend-row">
          <span class="legend-swatch" style="background:${CONTROL_UNKNOWN_COLOR}"></span>
          No data
        </div>
      `;

    } else if (state.activeLayer === 'priority') {

      el.innerHTML = `
        <p class="legend-title">
          TREATMENT PRIORITY
        </p>

        <div class="legend-row">
          <span
            class="legend-swatch"
            style="background:${PRIORITY_COLORS.CRITICAL}"
          ></span>
          Critical — immediate attention
        </div>

        <div class="legend-row">
          <span
            class="legend-swatch"
            style="background:${PRIORITY_COLORS.HIGH}"
          ></span>
          High — treatment recommended
        </div>

        <div class="legend-row">
          <span
            class="legend-swatch"
            style="background:${PRIORITY_COLORS.MODERATE}"
          ></span>
          Moderate — investigate / monitor
        </div>

        <div class="legend-row">
          <span
            class="legend-swatch"
            style="background:${PRIORITY_COLORS.LOW}"
          ></span>
          Low — monitor
        </div>
      `;

    } else if (
      state.activeLayer === 'mosquito'
    ) {

      el.innerHTML = `
        <p class="legend-title">
          MOSQUITO ACTIVITY
        </p>

        <div
          class="legend-gradient"
          style="
            background:
            linear-gradient(
              90deg,
              #f7d98a,
              #c92b30
            );
          "
        ></div>

        <div
          class="legend-row"
          style="justify-content:space-between;"
        >
          <span>Low</span>
          <span>High</span>
        </div>
      `;

    } else {

      el.innerHTML = `
        <p class="legend-title">
          RECENT RAINFALL
        </p>

        <div
          class="legend-gradient"
          style="
            background:
            linear-gradient(
              90deg,
              #bfe6fb,
              #0f3d7a
            );
          "
        ></div>

        <div
          class="legend-row"
          style="justify-content:space-between;"
        >
          <span>Dry</span>
          <span>Saturated</span>
        </div>
      `;
    }
  }


  /* =========================================================
     SUMMARY
  ========================================================= */

  // The overview card counts the mock treatment-priority tiers, which the
  // control layer doesn't use — hide it there so it can't be misread as a
  // summary of current mosquito control.
  function updateSummaryVisibility() {
    document.querySelector('.summary-card').style.display =
      state.activeLayer === 'control' ? 'none' : '';
  }


  function renderSummary() {
    const counts = {
      CRITICAL: 0,
      HIGH: 0,
      MODERATE: 0,
      LOW: 0
    };

    REGIONS.forEach(region => {
      counts[region.priority]++;
    });

    const order = [
      'CRITICAL',
      'HIGH',
      'MODERATE',
      'LOW'
    ];

    const grid =
      document.getElementById('summaryGrid');

    grid.innerHTML =
      order.map(priority => {

        const active =
          state.priorityFilter.has(priority)
            ? 'filter-active'
            : '';

        return `
          <button
            class="summary-item ${active}"
            data-priority="${priority}"
            style="
              color:
              ${PRIORITY_COLORS[priority]}
            "
          >

            <span
              class="summary-dot"
              style="
                background:
                ${PRIORITY_COLORS[priority]}
              "
            ></span>

            <span class="summary-count">
              ${counts[priority]}
            </span>

            <span
              style="
                color:var(--ink);
                font-family:var(--font-sans);
                font-weight:500;
              "
            >
              ${PRIORITY_LABELS[priority]}
            </span>

          </button>
        `;
      }).join('');


    grid
      .querySelectorAll('.summary-item')
      .forEach(button => {

        button.addEventListener(
          'click',
          () => {

            const priority =
              button.dataset.priority;

            if (
              state.priorityFilter.has(priority)
            ) {
              state.priorityFilter.delete(
                priority
              );
            } else {
              state.priorityFilter.add(
                priority
              );
            }

            renderMap();
            renderSummary();
          }
        );

      });
  }


  /* =========================================================
     MAP LAYERS
  ========================================================= */

  document
    .getElementById('layerList')
    .addEventListener('click', event => {

      const button =
        event.target.closest('.layer-btn');

      if (!button) {
        return;
      }

      state.activeLayer =
        button.dataset.layer;

      document
        .querySelectorAll('.layer-btn')
        .forEach(layerButton => {

          layerButton.setAttribute(
            'aria-pressed',
            layerButton === button
              ? 'true'
              : 'false'
          );

        });

      renderMap();
      renderLegend();
      updateSummaryVisibility();
    });


  /* =========================================================
     SEARCH
  ========================================================= */

  const searchToggleBtn =
    document.getElementById(
      'searchToggleBtn'
    );

  const searchWrap =
    document.getElementById(
      'searchWrap'
    );

  const searchInput =
    document.getElementById(
      'searchInput'
    );

  const searchResults =
    document.getElementById(
      'searchResults'
    );


  searchToggleBtn.addEventListener(
    'click',
    () => {

      const open =
        searchWrap.style.display !==
        'none';

      searchWrap.style.display =
        open ? 'none' : 'block';

      searchToggleBtn.setAttribute(
        'aria-pressed',
        open ? 'false' : 'true'
      );

      searchToggleBtn.classList.toggle(
        'active-state',
        !open
      );

      if (!open) {
        searchInput.focus();
      } else {
        searchResults.classList.remove(
          'open'
        );
      }
    }
  );


  searchInput.addEventListener(
    'input',
    () => {

      const query =
        searchInput.value
          .trim()
          .toLowerCase();

      if (!query) {

        searchResults.classList.remove(
          'open'
        );

        searchResults.innerHTML = '';

        return;
      }

      const matches =
        REGIONS
          .filter(region =>
            region.county
              .toLowerCase()
              .includes(query)
          )
          .slice(0, 8);


      if (matches.length === 0) {

        searchResults.innerHTML = `
          <div
            class="search-result-item"
            style="color:#8a9a8f;"
          >
            No counties match
            “${escapeHtml(
              searchInput.value
            )}”
          </div>
        `;

      } else {

        searchResults.innerHTML =
          matches.map(region => `
            <div
              class="search-result-item"
              data-id="${region.id}"
            >

              <span>
                ${escapeHtml(
                  region.county
                )}
              </span>

              <span
                class="mini-badge"
                style="
                  background:
                  ${PRIORITY_COLORS[
                    region.priority
                  ]}
                "
              >
                ${PRIORITY_LABELS[
                  region.priority
                ].toUpperCase()}
              </span>

            </div>
          `).join('');
      }

      searchResults.classList.add(
        'open'
      );
    }
  );


  searchResults.addEventListener(
    'click',
    event => {

      const item =
        event.target.closest(
          '.search-result-item'
        );

      if (
        !item ||
        !item.dataset.id
      ) {
        return;
      }

      selectCounty(
        item.dataset.id
      );

      searchWrap.style.display =
        'none';

      searchToggleBtn.setAttribute(
        'aria-pressed',
        'false'
      );

      searchToggleBtn.classList.remove(
        'active-state'
      );

      searchInput.value = '';

      searchResults.classList.remove(
        'open'
      );
    }
  );


  document.addEventListener(
    'click',
    event => {

      if (
        !searchWrap.contains(
          event.target
        ) &&
        event.target !==
          searchToggleBtn &&
        !searchToggleBtn.contains(
          event.target
        )
      ) {
        searchResults.classList.remove(
          'open'
        );
      }
    }
  );


  /* =========================================================
     PANEL
  ========================================================= */

  document
    .querySelectorAll('.tab-btn')
    .forEach(button => {

      button.addEventListener(
        'click',
        () =>
          setActiveTab(
            button.dataset.tab
          )
      );

    });


  function setActiveTab(tab) {
    state.activeTab = tab;

    document
      .querySelectorAll('.tab-btn')
      .forEach(button => {

        button.classList.toggle(
          'active',
          button.dataset.tab === tab
        );

      });

    document
      .querySelectorAll('.panel-body')
      .forEach(body => {

        body.classList.toggle(
          'active',
          body.dataset.tabbody === tab
        );

      });

    if (state.panelCollapsed) {
      togglePanel(false);
    }
  }


  const panelShell =
    document.getElementById(
      'panelShell'
    );


  document
    .getElementById('collapseToggle')
    .addEventListener(
      'click',
      () => togglePanel()
    );


  function togglePanel(forceOpen) {
    state.panelCollapsed =
      forceOpen === false
        ? false
        : !state.panelCollapsed;

    panelShell.classList.toggle(
      'collapsed',
      state.panelCollapsed
    );

    document
      .getElementById(
        'collapseToggle'
      )
      .title =
        state.panelCollapsed
          ? 'Expand panel'
          : 'Collapse panel';
  }


  /* =========================================================
     SELECT COUNTY
  ========================================================= */

  function selectCounty(id) {
    state.selectedId = id;

    renderMap();
    renderDetails();
    updateSkeeterContextBar();

    setActiveTab('details');

    if (state.panelCollapsed) {
      togglePanel(false);
    }
  }


  /* =========================================================
     DETAILS
  ========================================================= */

  function renderDetails() {
    const empty =
      document.getElementById(
        'detailEmpty'
      );

    const content =
      document.getElementById(
        'detailContent'
      );

    const region =
      REGION_BY_ID[
        state.selectedId
      ];


    if (!region) {

      empty.style.display =
        'flex';

      content.style.display =
        'none';

      return;
    }


    empty.style.display =
      'none';

    content.style.display =
      'flex';


    content.innerHTML = `
      <div class="detail-header">

        <span class="detail-eyebrow">
          AREA
        </span>

        <span class="detail-county">
          ${escapeHtml(region.county)}
          County
        </span>

        <span
          class="priority-tag"
          style="
            background:
            ${PRIORITY_COLORS[
              region.priority
            ]}
          "
        >
          ${PRIORITY_LABELS[
            region.priority
          ].toUpperCase()}
          PRIORITY
        </span>

      </div>


      ${
        region.changeNote
          ? `
            <div class="change-note">
              ${escapeHtml(
                region.changeNote
              )}
            </div>
          `
          : ''
      }


      <div class="section-block">

        <span class="section-label">
          WHY?
        </span>

        <ul class="reason-list">
          ${region.reasons
            .map(reason => `
              <li>
                ${escapeHtml(reason)}
              </li>
            `)
            .join('')}
        </ul>

      </div>


      <div class="stat-grid">

        <div class="stat-box">
          <div class="k">
            MOSQUITO ACTIVITY
          </div>
          <div class="v">
            ${region.mosquitoActivity}/100
          </div>
        </div>

        <div class="stat-box">
          <div class="k">
            HABITAT RISK
          </div>
          <div class="v">
            ${region.habitatRisk}/100
          </div>
        </div>

        <div class="stat-box">
          <div class="k">
            RECENT RAINFALL
          </div>
          <div class="v">
            ${region.rainfall}"
          </div>
        </div>

        <div class="stat-box">
          <div class="k">
            TEMPERATURE
          </div>
          <div class="v">
            ${region.temperature}°F
          </div>
        </div>

      </div>


      <div class="status-line">

        <span
          class="section-label"
          style="margin:0;"
        >
          STATUS
        </span>

        <strong>
          ${escapeHtml(
            region.treatmentStatus
          )}
        </strong>

      </div>


      <div
        class="accordion"
        id="forecastAccordion"
      >

        <button
          class="accordion-head"
          id="forecastAccordionHead"
        >
          TREATMENT FORECAST

          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
          >
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>


        <div class="accordion-content">

          <div class="forecast-hero">

            <span class="big">
              ${region.treatmentEffectiveness}%
            </span>

            <span class="lbl">
              Expected effectiveness
            </span>

          </div>


          <div
            class="stat-grid"
            style="margin-bottom:10px;"
          >

            <div class="stat-box">

              <div class="k">
                RISK REDUCTION
              </div>

              <div class="v">
                ${Math.max(
                  5,
                  region.treatmentEffectiveness -
                    18
                )}–${Math.min(
                  95,
                  region.treatmentEffectiveness -
                    4
                )}%
              </div>

            </div>


            <div class="stat-box">

              <div class="k">
                CONFIDENCE
              </div>

              <div class="v">
                <span class="confidence-badge">
                  ${escapeHtml(
                    region.confidence
                  )}
                </span>
              </div>

            </div>

          </div>


          <span class="section-label">
            KEY FACTORS
          </span>


          <ul
            class="reason-list"
            style="margin-top:6px;"
          >
            <li>Mosquito activity</li>
            <li>Breeding habitat</li>
            <li>Recent rainfall</li>
            <li>
              Temperature /
              environmental conditions
            </li>

            ${
              region.treatmentStatus
                .includes('Recommended') ||
              region.treatmentStatus
                .includes('Scheduled')
                ? `
                  <li>
                    Previous treatment
                    outcomes
                  </li>
                `
                : ''
            }
          </ul>


          <p class="disclaimer">
            Model / demo estimate —
            not a guaranteed outcome.
          </p>

        </div>

      </div>


      <div class="btn-row">

        <button
          class="btn btn-primary"
          id="askSkeeterFromDetail"
        >

          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
          >
            <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>
          </svg>

          Ask Skeeter

        </button>


        <button
          class="btn btn-ghost"
          id="clearSelectionBtn"
        >
          Return to full map
        </button>

      </div>
    `;


    document
      .getElementById(
        'forecastAccordionHead'
      )
      .addEventListener(
        'click',
        () => {

          document
            .getElementById(
              'forecastAccordion'
            )
            .classList.toggle('open');

        }
      );


    document
      .getElementById(
        'askSkeeterFromDetail'
      )
      .addEventListener(
        'click',
        () => {

          setActiveTab('skeeter');
          askSkeeterAboutSelected();

        }
      );


    document
      .getElementById(
        'clearSelectionBtn'
      )
      .addEventListener(
        'click',
        () => {

          state.selectedId = null;

          renderMap();
          renderDetails();
          updateSkeeterContextBar();

        }
      );
  }


  /* =========================================================
     FORECAST BUTTON
  ========================================================= */

  document
    .getElementById('forecastBtn')
    .addEventListener(
      'click',
      () => {

        if (!state.selectedId) {

          showToast(
            'Select a county on the map first'
          );

          return;
        }

        setActiveTab('details');

        if (state.panelCollapsed) {
          togglePanel(false);
        }

        const accordion =
          document.getElementById(
            'forecastAccordion'
          );

        if (accordion) {

          accordion.classList.add(
            'open'
          );

          accordion.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
          });
        }
      }
    );


  /* =========================================================
     HOME
  ========================================================= */

  document
    .getElementById('homeBtn')
    .addEventListener(
      'click',
      () => {

        state.selectedId = null;

        state.priorityFilter.clear();

        state.activeLayer =
          'control';

        document
          .querySelectorAll(
            '.layer-btn'
          )
          .forEach(button => {

            button.setAttribute(
              'aria-pressed',
              button.dataset.layer ===
                'control'
                ? 'true'
                : 'false'
            );

          });

        renderMap();
        renderLegend();
        renderSummary();
        updateSummaryVisibility();
        renderDetails();
        updateSkeeterContextBar();

        showToast(
          'Back to statewide view'
        );
      }
    );


  /* =========================================================
     SKEETER CHATBOT
  ========================================================= */

  const chatLog =
    document.getElementById(
      'chatLog'
    );

  const chatInput =
    document.getElementById(
      'chatInput'
    );

  const contextBar =
    document.getElementById(
      'skeeterContextBar'
    );


  const DEFAULT_PROMPTS = [
    'Which areas currently need treatment?',
    'Which counties have the highest treatment priority?',
    'Show me high priority areas with no treatment recorded',
    'What changed recently?'
  ];


  let apiHistory = [];


  function updateSkeeterContextBar() {
    const region =
      REGION_BY_ID[
        state.selectedId
      ];

    if (region) {

      contextBar.style.display =
        'flex';

      contextBar.innerHTML = `
        📍 Viewing
        <strong>
          ${escapeHtml(region.county)}
          County
        </strong>
        —
        <span
          style="
            color:
            ${PRIORITY_COLORS[
              region.priority
            ]};
            font-weight:700;
          "
        >
          ${PRIORITY_LABELS[
            region.priority
          ]}
        </span>
      `;


      renderSuggestedPrompts([
        'Why is this area a priority?',
        'What is driving the treatment forecast?',
        'What treatment status does this area have?'
      ]);

    } else {

      contextBar.style.display =
        'none';

      renderSuggestedPrompts(
        DEFAULT_PROMPTS
      );
    }
  }


  function renderSuggestedPrompts(list) {
    const el =
      document.getElementById(
        'suggestedPrompts'
      );

    el.innerHTML =
      list.map(prompt => `
        <button class="suggest-chip">
          ${escapeHtml(prompt)}
        </button>
      `).join('');


    el
      .querySelectorAll(
        '.suggest-chip'
      )
      .forEach(chip => {

        chip.addEventListener(
          'click',
          () => {

            chatInput.value =
              chip.textContent.trim();

            sendMessage();

          }
        );

      });
  }


  function appendMessage(role, text) {
    const div =
      document.createElement('div');

    div.className =
      'msg ' +
      (
        role === 'user'
          ? 'user'
          : 'bot'
      );

    div.textContent = text;

    chatLog.appendChild(div);

    chatLog.scrollTop =
      chatLog.scrollHeight;

    return div;
  }


  function greetSkeeter() {
    chatLog.innerHTML = '';

    apiHistory = [];

    appendMessage(
      'bot',
      "Hi, I'm Skeeter 🦟 — ask me anything about Florida's mosquito treatment data. Try one of the prompts below, or type your own question."
    );
  }


  function askSkeeterAboutSelected() {
    const region =
      REGION_BY_ID[
        state.selectedId
      ];

    if (!region) {
      return;
    }

    appendMessage(
      'bot',
      `You're looking at ${region.county} County. What would you like to know?`
    );
  }


  async function sendMessage() {
    const value =
      chatInput.value.trim();

    if (!value) {
      return;
    }

    appendMessage(
      'user',
      value
    );

    apiHistory.push({
      role: 'user',
      content: value
    });

    chatInput.value = '';


    const botEl =
      appendMessage(
        'bot',
        ''
      );

    const cursor =
      document.createElement(
        'span'
      );

    cursor.className =
      'typing-dots';

    cursor.innerHTML =
      '<span></span><span></span><span></span>';

    botEl.appendChild(cursor);

    chatLog.scrollTop =
      chatLog.scrollHeight;


    let fullReply = '';

    let cursorRemoved =
      false;


    try {

      const res =
        await fetch(
          '/api/skeeter',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body: JSON.stringify({
              messages:
                apiHistory,

              selectedId:
                state.selectedId
            })
          }
        );


      if (
        !res.ok ||
        !res.body
      ) {

        const errText =
          await res.text();

        throw new Error(
          errText ||
          'Request failed'
        );
      }


      const reader =
        res.body.getReader();

      const decoder =
        new TextDecoder();


      while (true) {

        const {
          done,
          value
        } =
          await reader.read();

        if (done) {
          break;
        }

        if (!cursorRemoved) {

          cursor.remove();

          cursorRemoved =
            true;
        }

        fullReply +=
          decoder.decode(
            value,
            {
              stream: true
            }
          );

        botEl.textContent =
          fullReply;

        chatLog.scrollTop =
          chatLog.scrollHeight;
      }

    } catch (error) {

      if (!cursorRemoved) {
        cursor.remove();
      }

      fullReply =
        fullReply ||
        `Skeeter couldn't reach the server: ${error.message}. Is app.py running with GEMINI_API_KEY set?`;

      botEl.textContent =
        fullReply;
    }


    apiHistory.push({
      role: 'model',
      content: fullReply
    });
  }


  document
    .getElementById('sendBtn')
    .addEventListener(
      'click',
      sendMessage
    );


  chatInput.addEventListener(
    'keydown',
    event => {

      if (event.key === 'Enter') {
        sendMessage();
      }

    }
  );


  document
    .getElementById(
      'clearChatBtn'
    )
    .addEventListener(
      'click',
      () => {

        greetSkeeter();
        updateSkeeterContextBar();

      }
    );


  /* =========================================================
     INITIALIZE APP
  ========================================================= */

  async function init() {
    try {

      await Promise.all([
        loadRegions(),
        loadTreatmentPractices(),
        loadCountyGeoJSON()
      ]);

      console.log(
        `Backend regions: ${REGIONS.length}`
      );

      console.log(
        `Florida map counties: ${FLORIDA_GEOJSON.features.length}`
      );


      const unmatched =
        FLORIDA_GEOJSON.features
          .filter(feature =>
            !regionForFeature(feature)
          )
          .map(feature =>
            feature.properties?.NAME
          );


      if (unmatched.length) {

        console.warn(
          'Unmatched counties:',
          unmatched
        );

      } else {

        console.log(
          'All 67 Florida counties matched successfully!'
        );
      }


      renderMap();
      renderLegend();
      renderSummary();
      updateSummaryVisibility();
      renderDetails();
      greetSkeeter();
      updateSkeeterContextBar();

    } catch (error) {

      console.error(
        'NoSquito failed to initialize:',
        error
      );

      showToast(
        'Could not load map data'
      );
    }
  }


  init();

})();