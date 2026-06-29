/**
 * ui.js — CarbonGlobe
 * DOM rendering and event wiring.
 * Static buttons bound ONCE in _bindStaticEvents.
 * Dynamic lists rendered via innerHTML replacement.
 * Exposes: window.CG.ui
 */
window.CG = window.CG || {};

window.CG.ui = (function () {
  const C     = window.CG.constants;
  const team  = window.CG.team;
  const cgMap = window.CG.map;

  let _toastTimeout = null;

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  function initUI() {
    _bindStaticEvents();
    renderAll();
  }

  function _bindStaticEvents() {

    // ── Team tab ──────────────────────────────────────────────────────────
    document.getElementById('btn-add-member').addEventListener('click', _handleAddMember);
    document.getElementById('new-member-name').addEventListener('keypress', e => {
      if (e.key === 'Enter') _handleAddMember();
    });

    // ── Route tab ─────────────────────────────────────────────────────────
    document.getElementById('btn-add-route').addEventListener('click', () => {
      const input = document.getElementById('new-route-name');
      const label = input.value.trim();
      const id    = team.addRoute(label || undefined);
      input.value = '';
      team.setActiveRoute(id);
      cgMap.updateRouteLayers(team.getRoute(id));
      renderAll();
    });

    document.getElementById('new-route-name').addEventListener('keypress', e => {
      if (e.key === 'Enter') document.getElementById('btn-add-route').click();
    });

    document.getElementById('btn-search').addEventListener('click', _handleSearch);
    document.getElementById('search-input').addEventListener('keypress', e => {
      if (e.key === 'Enter') _handleSearch();
    });

    // Mode buttons — static, bound once
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = team.getActiveRoute();
        if (!r) return showToast('Bitte zuerst eine Route auswählen.');
        team.setRouteMode(r.id, btn.dataset.mode);
        cgMap.updateRouteLayers(team.getRoute(r.id));
        renderAll();
      });
    });

    // Impact factor buttons — static, bound once
    document.querySelectorAll('.impact-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = team.getActiveRoute();
        if (!r) return showToast('Bitte zuerst eine Route auswählen.');
        team.setRouteImpact(r.id, btn.dataset.impact);
        cgMap.updateRouteLayers(team.getRoute(r.id));
        renderAll();
      });
    });

    // ── Dashboard tab ─────────────────────────────────────────────────────
    document.getElementById('btn-set-budget').addEventListener('click', () => {
      const val = parseFloat(document.getElementById('budget-input').value);
      if (isNaN(val) || val <= 0) return showToast('Bitte ein gültiges Budget eingeben.');
      team.setTeamBudget(val);
      renderDashboard();
      showToast(`Budget gesetzt: ${C.formatCO2(val)}`, 'success');
    });

    // ── Settings ──────────────────────────────────────────────────────────
    document.getElementById('style-select').addEventListener('change', e => {
      cgMap.changeMapStyle(e.target.value);
    });

    document.getElementById('btn-font-larger').addEventListener('click', () => {
      _adjustFontSize(1);
    });

    document.getElementById('btn-font-smaller').addEventListener('click', () => {
      _adjustFontSize(-1);
    });

    const themeToggle = document.getElementById('theme-toggle');
    themeToggle.addEventListener('change', () => {
      document.body.classList.toggle('light-theme', themeToggle.checked);
    });

    // ── Info panel ──────────────────────────────────────────────────────────
    const infoBtn   = document.getElementById('btn-info-toggle');
    const infoPanel = document.getElementById('info-panel');

    infoBtn.addEventListener('click', () => {
      const isOpen = infoPanel.classList.toggle('open');
      infoPanel.setAttribute('aria-hidden', !isOpen);
    });

    document.addEventListener('click', e => {
      if (!infoPanel.classList.contains('open')) return;
      if (e.target === infoBtn || infoBtn.contains(e.target) || infoPanel.contains(e.target)) return;
      infoPanel.classList.remove('open');
      infoPanel.setAttribute('aria-hidden', 'true');
    });

    // ── Tabs ──────────────────────────────────────────────────────────────
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
      });
    });
  }

  function _handleAddMember() {
    const input = document.getElementById('new-member-name');
    const hoursRaw = parseFloat(document.getElementById('new-member-hours').value);
    const hours = isNaN(hoursRaw) || hoursRaw <= 0
      ? 1
      : Math.min(Math.max(Math.round(hoursRaw * 2) / 2, 0.5), 80);
    const name  = input.value.trim() || `Mitglied ${team.getMembers().length + 1}`;
    const id    = team.addMember(name, hours);
    team.setActiveMember(id);
    input.value = '';
    document.getElementById('new-member-hours').value = '';
    renderAll();
  }

  // ── Map callbacks ──────────────────────────────────────────────────────────
  function _adjustFontSize(delta) {
    const current = parseFloat(getComputedStyle(document.documentElement).fontSize.replace('px', '')) || 13;
    const next    = Math.min(18, Math.max(11, current + delta));
    document.documentElement.style.fontSize = `${next}px`;
  }
  function onMapClick(coords) {
    const r = team.getActiveRoute();
    if (!r) return showToast('Bitte zuerst eine Route auswählen oder erstellen.');
    team.addWaypoint(r.id, coords);
    cgMap.updateRouteLayers(team.getRoute(r.id));
    renderWaypointList();
    renderDashboard();
  }

  function onWaypointDragEnd() {
    renderWaypointList();
    renderDashboard();
  }

  // ── Master render ──────────────────────────────────────────────────────────

  function renderAll() {
    renderMemberList();
    renderRouteList();
    renderWaypointList();
    renderMemberAssignment();
    renderModeSwitcher();
    renderImpactSwitcher();
    renderDashboard();
  }

  // ── Member list (Team tab) ─────────────────────────────────────────────────

  function renderMemberList() {
    const el      = document.getElementById('member-list');
    const members = team.getMembers();
    const active  = team.getActiveMember();

    if (!members.length) {
      el.innerHTML = `<div class="empty-hint">Noch keine Mitglieder.</div>`;
      return;
    }

    el.innerHTML = members.map(m => {
      const hours = m.workingHours || 1;
      return `
        <div class="member-item ${m.id === active?.id ? 'active' : ''}"
             data-id="${m.id}">
          <div class="member-dot"></div>
          <div class="member-info">
            <span class="member-name js-member-name" contenteditable="true" data-id="${m.id}">${C.escHtml(m.name)}</span>
            <label class="member-hours-wrapper">
              <input type="number" class="member-hours js-member-hours" data-id="${m.id}" min="0.5" max="80" step="0.5" value="${hours.toFixed(1)}" title="Arbeitsstunden pro Woche bearbeiten" />
              <span class="member-hours-suffix">h / Woche</span>
            </label>
          </div>
          <button class="icon-btn js-del-member" data-id="${m.id}" title="Löschen">✕</button>
        </div>`;
    }).join('');

    el.querySelectorAll('.member-item').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.js-del-member') || e.target.closest('.js-member-name') || e.target.closest('.js-member-hours') || e.target.closest('.member-hours-wrapper')) return;
        team.setActiveMember(row.dataset.id);
        renderAll();
      });
    });

    el.querySelectorAll('.js-member-name').forEach(field => {
      field.addEventListener('blur', () => {
        const id = field.dataset.id;
        team.setMemberName(id, field.textContent);
        // Don't call renderAll() - only update dashboard
        renderDashboard();
      });
      field.addEventListener('keypress', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          field.blur();
        }
      });
    });

    el.querySelectorAll('.js-member-hours').forEach(field => {
      // Save to team data on every keystroke — team is the source of truth
      field.addEventListener('input', () => {
        const id    = field.dataset.id;
        const value = parseFloat(field.value);
        if (!isNaN(value) && value > 0) {
          team.setMemberHours(id, Math.min(value, 80));
        }
      });

      // Snap to nearest 0.5 and clamp to [0.5, 80] once the user is done editing
      field.addEventListener('blur', () => {
        const id    = field.dataset.id;
        const raw   = parseFloat(field.value);
        const value = isNaN(raw) || raw <= 0
          ? team.getMemberHours(id)
          : Math.min(Math.max(Math.round(raw * 2) / 2, 0.5), 80);
        team.setMemberHours(id, value);
        field.value = value.toFixed(1);
      });

      field.addEventListener('keypress', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          field.blur();
        }
      });
    });

    el.querySelectorAll('.js-del-member').forEach(btn => {
      btn.addEventListener('click', () => {
        team.removeMember(btn.dataset.id);
        // Refresh all route layers (grade/color may change)
        team.getRoutes().forEach(r => cgMap.updateRouteLayers(r));
        renderAll();
      });
    });
  }

  // ── Route list (Route tab) ─────────────────────────────────────────────────

  function renderRouteList() {
    const el            = document.getElementById('route-list');
    const activeRouteId = team.getActiveRouteId();
    const routes        = team.getRoutes();

    if (!routes.length) {
      el.innerHTML = `<div class="empty-hint">Noch keine Routen — klicke "+ Route".</div>`;
      return;
    }

    el.innerHTML = routes.map(route => {
      const s         = team.getRouteStats(route);
      const gradeInfo = team.getRouteGrade(route);
      const impact    = C.IMPACT_FACTORS[route.impactFactor];
      const memberCount = route.assignedMemberIds.length;
      const showGrade = s.co2Kg > 0 && memberCount > 0;

      return `
        <div class="route-item ${route.id === activeRouteId ? 'active' : ''}"
             data-route-id="${route.id}">
          <div class="route-header">
            <span class="route-label js-route-label"
                  contenteditable="true"
                  data-route-id="${route.id}">${C.escHtml(route.label)}</span>
            <button class="icon-btn js-del-route" data-id="${route.id}" title="Löschen">✕</button>
          </div>
          <div class="route-summary">
            <span>${impact.icon} ${impact.label}</span>
            <span>${memberCount} Person${memberCount !== 1 ? 'en' : ''}</span>
            ${showGrade
              ? `<span class="grade-badge">${gradeInfo.grade}</span>`
              : `<span class="grade-badge grade-pending">—</span>`}
          </div>
        </div>`;
    }).join('');

    el.querySelectorAll('.route-item').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.js-del-route') || e.target.classList.contains('js-route-label')) return;
        team.setActiveRoute(row.dataset.routeId);
        renderAll();
      });
    });

    el.querySelectorAll('.js-del-route').forEach(btn => {
      btn.addEventListener('click', () => {
        cgMap.removeRouteLayers(btn.dataset.id);
        team.removeRoute(btn.dataset.id);
        renderAll();
      });
    });

    el.querySelectorAll('.js-route-label').forEach(label => {
      label.addEventListener('blur', () => {
        team.setRouteLabel(label.dataset.routeId, label.textContent.trim());
        renderAll();
      });
      label.addEventListener('keypress', e => {
        if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
      });
    });
  }

  function _memberDots(memberIds) {
    return memberIds.map(id => {
      const m = team.getMember(id);
      if (!m) return '';
      return `<span class="member-dot-sm" title="${C.escHtml(m.name)}"></span>`;
    }).join('');
  }

  // ── Member assignment panel ────────────────────────────────────────────────

  function renderMemberAssignment() {
    const el      = document.getElementById('member-assignment');
    const route   = team.getActiveRoute();
    const members = team.getMembers();

    if (!route) {
      el.innerHTML = `<div class="empty-hint">Keine Route ausgewählt.</div>`;
      return;
    }
    if (!members.length) {
      el.innerHTML = `<div class="empty-hint">Erst Mitglieder im Team-Tab anlegen.</div>`;
      return;
    }

    el.innerHTML = members.map(m => {
      const assigned = route.assignedMemberIds.includes(m.id);
      return `
        <div class="assign-row ${assigned ? 'assigned' : ''}" data-member-id="${m.id}">
          <span class="member-dot" style="background:${m.color}"></span>
          <span class="assign-name">${C.escHtml(m.name)}</span>
          <button class="assign-btn ${assigned ? 'assigned' : ''}"
                  data-member-id="${m.id}"
                  title="${assigned ? 'Entfernen' : 'Hinzufügen'}">
            ${assigned ? '✓' : '+'}
          </button>
        </div>`;
    }).join('');

    el.querySelectorAll('.assign-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = team.getActiveRoute();
        if (!r) return;
        const mid      = btn.dataset.memberId;
        const assigned = r.assignedMemberIds.includes(mid);
        if (assigned) team.unassignMember(r.id, mid);
        else          team.assignMember(r.id, mid);
        cgMap.updateRouteLayers(team.getRoute(r.id));
        renderAll();
      });
    });
  }

  // ── Waypoint list ──────────────────────────────────────────────────────────

  function renderWaypointList() {
    const el    = document.getElementById('waypoint-list');
    const route = team.getActiveRoute();

    if (!route) {
      el.innerHTML = `<div class="empty-hint">Route auswählen, dann Punkte per Rechtsklick setzen.</div>`;
      return;
    }
    if (!route.waypoints.length) {
      el.innerHTML = `<div class="empty-hint">Noch keine Wegpunkte — Rechtsklick auf Karte oder Ort suchen.</div>`;
      return;
    }

    el.innerHTML = route.waypoints.map((wp, i) => {
      const name  = route.waypointNames[i] || '';
      const label = name || `${wp[0].toFixed(2)}, ${wp[1].toFixed(2)}`;
      return `
        <div class="wp-item" data-fidx="${i}" data-lidx="${i}">
          <span class="wp-num">${i + 1}</span>
          <div class="wp-info">
            <span class="wp-name">${C.escHtml(label)}</span>
            <span class="wp-coords">${wp[0].toFixed(4)}, ${wp[1].toFixed(4)}</span>
          </div>
          <button class="icon-btn wp-fly" data-lng="${wp[0]}" data-lat="${wp[1]}" title="Ansehen">⊙</button>
          <button class="icon-btn js-wp-del" data-idx="${i}" title="Entfernen">✕</button>
        </div>`;
    }).join('');

    el.querySelectorAll('.wp-item').forEach(row => {
      const fIdx = +row.dataset.fidx;
      row.addEventListener('mouseenter', () => cgMap.setPointHover(route.id, fIdx, true));
      row.addEventListener('mouseleave', () => cgMap.setPointHover(route.id, fIdx, false));
    });

    el.querySelectorAll('.wp-fly').forEach(btn => {
      btn.addEventListener('click', () => cgMap.flyTo([+btn.dataset.lng, +btn.dataset.lat], 6));
    });

    el.querySelectorAll('.js-wp-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = team.getActiveRoute();
        if (!r) return;
        team.removeWaypoint(r.id, +btn.dataset.idx);
        cgMap.updateRouteLayers(team.getRoute(r.id));
        renderAll();
      });
    });
  }

  // ── Mode switcher (static buttons, only class update) ─────────────────────

  function renderModeSwitcher() {
    const route   = team.getActiveRoute();
    const current = route?.mode ?? 'plane';
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === current);
    });
  }

  // ── Impact switcher (static buttons, only class update) ───────────────────

  function renderImpactSwitcher() {
    const route   = team.getActiveRoute();
    const current = route?.impactFactor ?? 2;
    document.querySelectorAll('.impact-btn').forEach(btn => {
      btn.classList.toggle('active', +btn.dataset.impact === current);
    });
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────

  /** Formats kg as tons without trailing ".0", e.g. 5000 -> "5t", 5400 -> "5.4t" */
  function _formatTons(kg) {
    const tons = kg / 1000;
    const rounded = Math.round(tons * 10) / 10;
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}t`;
  }

  function renderDashboard() {
    const members = team.getMembers();
    const routes  = team.getRoutes();
    const teamCO2 = team.getTeamCO2();
    const budget  = team.getTeamBudget();

    document.getElementById('team-co2-total').textContent =
      budget > 0 ? `${_formatTons(teamCO2)} / ${_formatTons(budget)}` : _formatTons(teamCO2);

    const bar = document.getElementById('team-budget-bar');
    if (budget > 0) {
      const pct = Math.min((teamCO2 / budget) * 100, 100);
      bar.style.width = `${pct}%`;
      bar.style.background = 'var(--hero-accent)';
    } else {
      bar.style.width = '0%';
      bar.style.background = 'rgba(255,255,255,0.08)';
    }

    const gradeBadge = document.getElementById('team-grade-badge');
    const teamGrade  = team.getTeamGrade();
    if (teamGrade) {
      gradeBadge.textContent = teamGrade.grade;
      gradeBadge.style.color = teamGrade.color;
    } else {
      gradeBadge.textContent = '—';
      gradeBadge.style.color = 'var(--text-1)';
    }

    document.getElementById('team-impact-badge').textContent =
      Math.round(team.getTeamImpact()).toLocaleString('de');

    // Route breakdown
    const routeContainer = document.getElementById('dashboard-routes');
    if (!routes.length) {
      routeContainer.innerHTML = `<div class="empty-hint">Noch keine Routen.</div>`;
    } else {
      routeContainer.innerHTML = routes.map(r => {
        const s           = team.getRouteStats(r);
        const gradeInfo   = team.getRouteGrade(r);
        const impact      = C.IMPACT_FACTORS[r.impactFactor];
        const memberCount = r.assignedMemberIds.length;
        const icon        = C.CO2_FACTORS[r.mode]?.icon ?? '✈️';
        const showGrade   = s.co2Kg > 0 && memberCount > 0;

        return `
          <div class="dash-route">
            <div class="dash-route-header">
              <span>${icon} ${C.escHtml(r.label)}</span>
              <div style="display:flex;gap:6px;align-items:center;">
                <span class="impact-chip">${impact.icon}</span>
                ${showGrade
                  ? `<span class="grade-badge">${gradeInfo.grade}</span>`
                  : `<span class="grade-badge grade-pending">—</span>`}
              </div>
            </div>
            <div class="stat-row">
              <div class="stat-cell">
                <div class="stat-label">Distanz</div>
                <div class="stat-value">${Math.round(s.distanceKm).toLocaleString('de')} km</div>
              </div>
              <div class="stat-cell">
                <div class="stat-label">CO₂ / Person</div>
                <div class="stat-value co2">${C.formatCO2(s.co2Kg)}</div>
              </div>
              <div class="stat-cell">
                <div class="stat-label">Personen</div>
                <div class="stat-value">${memberCount}</div>
              </div>
              <div class="stat-cell">
                <div class="stat-label">Reisezeit</div>
                <div class="stat-value">${C.formatTime(s.timeHours)}</div>
              </div>
            </div>
            <div class="dash-trips" style="margin-top:10px;">${_memberDots(r.assignedMemberIds)}</div>
          </div>`;
      }).join('');
    }

    const memberContainer = document.getElementById('dashboard-members');
    if (!members.length) {
      memberContainer.innerHTML = `<div class="empty-hint">Noch keine Mitglieder.</div>`;
      return;
    }

    const totalHours = members.reduce((sum, m) => sum + (m.workingHours || 1), 0) || 1;
    const totalFTE   = members.reduce((sum, m) => sum + ((m.workingHours || 1) / 40), 0) || 1;
    const maxCO2     = Math.max(...members.map(m => team.getMemberCO2(m.id)), 0.001);

    memberContainer.innerHTML = members.map(m => {
      const co2         = team.getMemberCO2(m.id);
      const hours       = m.workingHours || 1;
      const fte         = hours / 40;
      const budgetShare = budget > 0 ? (fte / totalFTE) * 100 : 0;
      const budgetAlloc = budget > 0 ? team.getMemberBudgetAllocation(m.id, budget) : 0;
      const usagePct    = budget > 0 ? (budgetAlloc > 0 ? (co2 / budgetAlloc) * 100 : 0) : (co2 / maxCO2) * 100;
      const barPct      = Math.min(usagePct, 100);
      const label       = budget > 0
        ? `${hours}h · ${Math.round(budgetShare)}% Budget · ${Math.round(usagePct)}% Auslastung`
        : `${Math.round(barPct)}% CO₂`;
      const overBudget  = budget > 0 && usagePct > 100;

      const chips = routes
        .filter(route => route.assignedMemberIds.includes(m.id))
        .map(route => {
          const s    = team.getRouteStats(route);
          const icon = C.CO2_FACTORS[route.mode]?.icon ?? '✈️';
          return `<span class="dash-trip-chip">${icon} ${C.escHtml(route.label)} · ${C.formatCO2(s.co2Kg)}</span>`;
        }).join('');

      return `
        <div class="dash-member">
          <div class="dash-member-header">
            <span class="member-dot"></span>
            <span class="dash-name">${C.escHtml(m.name)}</span>
            <span class="dash-co2">${C.formatCO2(co2)}${budget > 0 ? ` · ${C.formatCO2(budgetAlloc)} Budget` : ''}</span>
          </div>
          <div class="dash-bar-track ${overBudget ? 'over-budget' : ''}">
            <div class="dash-bar" style="width:${barPct}%"></div>
            ${overBudget ? `<div class="dash-overflow" style="width:${Math.min(usagePct - 100, 100)}%"></div>` : ''}
          </div>
          <div class="dash-bar-label">${label}</div>
          ${chips ? `<div class="dash-trips">${chips}</div>` : '<div class="empty-hint" style="padding:4px 0;">Keiner Route zugewiesen.</div>'}
        </div>`;
    }).join('');
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  async function _handleSearch() {
    const input = document.getElementById('search-input');
    const query = input.value.trim();
    if (!query) return;

    const r = team.getActiveRoute();
    if (!r) return showToast('Bitte zuerst eine Route auswählen oder erstellen.');

    try {
      const res  = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
      const data = await res.json();
      if (!data.length) return showToast('Ort nicht gefunden.');
      const coords = [parseFloat(data[0].lon), parseFloat(data[0].lat)];
      const name   = data[0].display_name.split(',')[0];
      team.addWaypoint(r.id, coords, name);
      cgMap.updateRouteLayers(team.getRoute(r.id));
      cgMap.flyTo(coords, 5);
      input.value = '';
      renderWaypointList();
      renderDashboard();
    } catch (_) {
      showToast('Suchdienst nicht erreichbar.');
    }
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

  function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className   = `toast show ${type ?? 'error'}`;
    clearTimeout(_toastTimeout);
    _toastTimeout = setTimeout(() => { t.className = 'toast'; }, 3200);
  }

  return { initUI, onMapClick, onWaypointDragEnd, renderAll, showToast };
})();