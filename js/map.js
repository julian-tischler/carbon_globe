/**
 * map.js — CarbonGlobe
 * MapLibre GL JS wrapper. Layers keyed by route ID, colour from grade.
 *
 * Per route: solid line (ground legs), dashed line (flights), direction
 * arrows, a mode icon at each leg's midpoint, and the waypoint circles.
 * The active route is drawn on top at full strength; others are dimmed.
 *
 * Waypoint interaction: mousedown on a point of the active route disables
 * pan; moving more than CLICK_TOLERANCE px turns it into a drag, otherwise
 * the release counts as a click (→ onWaypointClick). mouseup always
 * re-enables pan.
 * Exposes: window.CG.map
 */
window.CG = window.CG || {};

window.CG.map = (function () {
  const C = window.CG.constants;

  let _map        = null;
  let _handlers   = {};     // { onRightClick, onWaypointMove, onWaypointClick }
  let _popup      = null;
  // True between 'style.load' and the next setStyle. isStyleLoaded() is not
  // used for this: it stays false while tiles load, even though layers can
  // already be added.
  let _styleReady = false;

  // Pointer state — all null when idle.
  // _pending: mousedown landed on a point, not yet known if click or drag.
  // _drag:    pointer moved past the tolerance, waypoint is being moved.
  // _clicked: released without moving; handled in the following 'click'.
  let _pending = null;  // { routeId, localIdx, start, draggable }
  let _drag    = null;  // { routeId, localIdx }
  let _clicked = null;  // { routeId, localIdx }

  const DEFAULT_COLOR   = '#60a5fa';
  const CLICK_TOLERANCE = 4;  // px

  // ── Init ──────────────────────────────────────────────────────────────────

  function initMap(containerId, handlers) {
    _handlers = handlers;

    _map = new maplibregl.Map({
      container: containerId,
      style: 'https://tiles.openfreemap.org/styles/bright',
      center: [15, 45],
      zoom: 2,
    });

    _map.on('style.load', () => {
      _styleReady = true;
      refreshAllLayers();
    });

    // Right-click → let the UI offer travel modes for a new waypoint
    _map.on('contextmenu', e => {
      e.originalEvent.preventDefault();
      _handlers.onRightClick?.([e.lngLat.lng, e.lngLat.lat]);
    });

    _map.on('mousedown', e => {
      if (e.originalEvent.button !== 0) return;  // left button only
      const hit = _pointAt(e.point);
      if (!hit) return;

      const draggable = hit.routeId === window.CG.team.getActiveRouteId();
      if (draggable) {
        // Suppress pan so MapLibre never treats the drag as a pan gesture.
        e.preventDefault();
        _map.dragPan.disable();
      }
      _pending = { ...hit, start: e.point, draggable };
    });

    _map.on('mousemove', e => {
      if (_pending?.draggable && _pending.start.dist(e.point) > CLICK_TOLERANCE) {
        _drag    = { routeId: _pending.routeId, localIdx: _pending.localIdx };
        _pending = null;
        closePopup();
        _map.getCanvas().style.cursor = 'grabbing';
      }

      if (_drag) {
        window.CG.team.moveWaypoint(_drag.routeId, _drag.localIdx, [e.lngLat.lng, e.lngLat.lat]);
        const route = window.CG.team.getRoute(_drag.routeId);
        if (route) _updateRouteData(route);
        return;
      }

      if (!_pending) _map.getCanvas().style.cursor = _pointAt(e.point) ? 'pointer' : '';
    });

    _map.on('mouseup', e => {
      if (_drag) {
        _handlers.onWaypointMove?.();
      } else if (_pending && _pending.start.dist(e.point) <= CLICK_TOLERANCE) {
        _clicked = { routeId: _pending.routeId, localIdx: _pending.localIdx };
      }
      _pending = null;
      _drag    = null;
      _map.dragPan.enable();
      _map.getCanvas().style.cursor = '';
    });

    // Popups are opened from 'click' (not mouseup) so the same click
    // doesn't immediately close them again.
    _map.on('click', () => {
      if (_clicked) {
        _handlers.onWaypointClick?.(_clicked.routeId, _clicked.localIdx);
        _clicked = null;
      } else {
        closePopup();
      }
    });

    return _map;
  }

  function changeMapStyle(url) {
    if (!_map) return;
    _styleReady = false;
    closePopup();
    _map.setStyle(url);
  }

  function flyTo(coords, zoom) {
    if (_map) _map.flyTo({ center: coords, zoom: zoom ?? 4, duration: 1200, essential: true });
  }

  // ── Popup ─────────────────────────────────────────────────────────────────

  function openPopup(coords, element) {
    closePopup();
    _popup = new maplibregl.Popup({ className: 'cg-popup', closeOnClick: false, maxWidth: 'none', offset: 12 })
      .setLngLat(coords)
      .setDOMContent(element)
      .addTo(_map);
  }

  function closePopup() {
    _popup?.remove();
    _popup = null;
  }

  // ── ID helpers ────────────────────────────────────────────────────────────

  const _ids = rid => ({
    lineSrc: `cg-line-src-${rid}`,
    ptSrc:   `cg-pts-src-${rid}`,
    midSrc:  `cg-mid-src-${rid}`,
    line:    `cg-line-${rid}`,
    dash:    `cg-dash-${rid}`,
    arrow:   `cg-arrow-${rid}`,
    mode:    `cg-mode-${rid}`,
    pts:     `cg-pts-${rid}`,
  });

  function _emptyFC() { return { type: 'FeatureCollection', features: [] }; }

  /** Waypoint under a screen point, across all routes. */
  function _pointAt(point) {
    const layers = window.CG.team.getRoutes()
      .map(r => _ids(r.id).pts)
      .filter(id => _map.getLayer(id));
    if (!layers.length) return null;
    const f = _map.queryRenderedFeatures(point, { layers })[0];
    if (!f || typeof f.id !== 'number') return null;
    return { routeId: f.properties.routeId, localIdx: f.id };
  }

  // ── Images (drawn once per style; setStyle drops them) ────────────────────

  function _canvasImage(width, height, draw) {
    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    draw(ctx);
    return ctx.getImageData(0, 0, width, height);
  }

  function _ensureImages() {
    // Chevron pointing along the line direction (SDF so it takes the route colour)
    if (!_map.hasImage('cg-arrow')) {
      _map.addImage('cg-arrow', _canvasImage(24, 24, ctx => {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 4;
        ctx.lineCap     = ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(8, 5); ctx.lineTo(16, 12); ctx.lineTo(8, 19);
        ctx.stroke();
      }), { sdf: true, pixelRatio: 2 });
    }

    // Double-headed arrow for round trips
    if (!_map.hasImage('cg-arrow-both')) {
      _map.addImage('cg-arrow-both', _canvasImage(36, 24, ctx => {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 4;
        ctx.lineCap     = ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(11, 5); ctx.lineTo(4, 12);  ctx.lineTo(11, 19);
        ctx.moveTo(25, 5); ctx.lineTo(32, 12); ctx.lineTo(25, 19);
        ctx.stroke();
      }), { sdf: true, pixelRatio: 2 });
    }

    // Mode badges: emoji on a white disc
    Object.entries(C.CO2_FACTORS).forEach(([mode, f]) => {
      const id = `cg-mode-${mode}`;
      if (_map.hasImage(id)) return;
      _map.addImage(id, _canvasImage(44, 44, ctx => {
        ctx.fillStyle   = '#ffffff';
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.25)';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.arc(22, 22, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.font         = '22px sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.icon, 22, 24);
      }), { pixelRatio: 2 });
    });
  }

  // ── Colour ────────────────────────────────────────────────────────────────

  function _routeColor(route) {
    const { co2Kg } = window.CG.team.getRouteStats(route);
    if (co2Kg === 0) return DEFAULT_COLOR;
    return window.CG.team.getRouteGrade(route).color;
  }

  // ── Layer management ──────────────────────────────────────────────────────

  function _ensureLayers(route) {
    const id = _ids(route.id);

    [id.lineSrc, id.ptSrc, id.midSrc].forEach(src => {
      if (!_map.getSource(src)) _map.addSource(src, { type: 'geojson', data: _emptyFC() });
    });

    const isPlane = ['==', ['get', 'mode'], 'plane'];

    if (!_map.getLayer(id.line)) {
      _map.addLayer({
        id: id.line, type: 'line', source: id.lineSrc, filter: ['!', isPlane],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
    }
    if (!_map.getLayer(id.dash)) {
      _map.addLayer({
        id: id.dash, type: 'line', source: id.lineSrc, filter: isPlane,
        paint: { 'line-dasharray': [2, 1.5] },
      });
    }
    if (!_map.getLayer(id.arrow)) {
      _map.addLayer({
        id: id.arrow, type: 'symbol', source: id.lineSrc,
        layout: {
          'symbol-placement':      'line',
          'symbol-spacing':        110,
          'icon-image':            'cg-arrow',
          'icon-size':             1.7,
          'icon-allow-overlap':    true,
          'icon-ignore-placement': true,
        },
        // Dark outline keeps the arrow readable on top of its own line
        paint: { 'icon-halo-color': 'rgba(15, 23, 42, 0.55)', 'icon-halo-width': 1.2 },
      });
    }
    if (!_map.getLayer(id.mode)) {
      _map.addLayer({
        id: id.mode, type: 'symbol', source: id.midSrc,
        layout: {
          'icon-image':            ['concat', 'cg-mode-', ['get', 'mode']],
          'icon-allow-overlap':    true,
          'icon-ignore-placement': true,
        },
      });
    }
    if (!_map.getLayer(id.pts)) {
      _map.addLayer({
        id: id.pts, type: 'circle', source: id.ptSrc,
        paint: {
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    }
  }

  /** Colour, emphasis and arrow style — depend on grade, selection and round trip. */
  function _applyStyle(route) {
    const id     = _ids(route.id);
    const color  = _routeColor(route);
    const active = route.id === window.CG.team.getActiveRouteId();
    const alpha  = active ? 0.95 : 0.35;
    const width  = active ? 3.5 : 2;

    [id.line, id.dash].forEach(l => {
      _map.setPaintProperty(l, 'line-color',   color);
      _map.setPaintProperty(l, 'line-opacity', alpha);
      _map.setPaintProperty(l, 'line-width',   width);
    });
    _map.setLayoutProperty(id.arrow, 'icon-image', route.roundTrip ? 'cg-arrow-both' : 'cg-arrow');
    _map.setPaintProperty(id.arrow, 'icon-color',   color);
    _map.setPaintProperty(id.arrow, 'icon-opacity', alpha);
    _map.setLayoutProperty(id.mode, 'icon-size', active ? 1 : 0.8);
    _map.setPaintProperty(id.mode, 'icon-opacity', active ? 1 : 0.5);
    _map.setPaintProperty(id.pts, 'circle-color', color);
    _map.setPaintProperty(id.pts, 'circle-opacity', active ? 0.95 : 0.4);
    _map.setPaintProperty(id.pts, 'circle-stroke-opacity', active ? 1 : 0.4);
    _map.setPaintProperty(id.pts, 'circle-radius',
      ['case', ['boolean', ['feature-state', 'hover'], false], active ? 11 : 8, active ? 7 : 5]);
  }

  function _buildRouteGeoJSON(route) {
    const points = route.waypoints.map((coords, i) => {
      const f = turf.point(coords, { routeId: route.id });
      f.id = i;
      return f;
    });

    const lines = [];
    const mids  = [];
    window.CG.team.getRouteLegs(route).forEach(leg => {
      const props = { mode: leg.mode };
      try {
        lines.push(turf.greatCircle(leg.from, leg.to, { npoints: 80, properties: props }));
      } catch (_) {
        lines.push(turf.lineString([leg.from, leg.to], props));
      }
      const mid = turf.midpoint(leg.from, leg.to);
      mid.properties = props;
      mids.push(mid);
    });

    return {
      lines:  turf.featureCollection(lines),
      points: turf.featureCollection(points),
      mids:   turf.featureCollection(mids),
    };
  }

  function _updateRouteData(route) {
    const id = _ids(route.id);
    if (!_map || !_map.getSource(id.lineSrc)) return;
    const { lines, points, mids } = _buildRouteGeoJSON(route);
    _map.getSource(id.lineSrc).setData(lines);
    _map.getSource(id.ptSrc).setData(points);
    _map.getSource(id.midSrc).setData(mids);
    _applyStyle(route);
  }

  /** Draw the active route above all others. */
  function _raiseActive() {
    const rid = window.CG.team.getActiveRouteId();
    if (!rid) return;
    const id = _ids(rid);
    [id.line, id.dash, id.arrow, id.mode, id.pts].forEach(l => {
      if (_map.getLayer(l)) _map.moveLayer(l);
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  // Both are no-ops until the style is ready; 'style.load' redraws everything.
  function refreshAllLayers() {
    if (!_styleReady) return;
    _ensureImages();
    window.CG.team.getRoutes().forEach(r => {
      _ensureLayers(r);
      _updateRouteData(r);
    });
    _raiseActive();
  }

  function updateRouteLayers(route) {
    if (!_styleReady) return;
    _ensureImages();
    _ensureLayers(route);
    _updateRouteData(route);
    _raiseActive();
  }

  function removeRouteLayers(routeId) {
    if (!_map) return;
    const id = _ids(routeId);
    [id.pts, id.mode, id.arrow, id.dash, id.line].forEach(l => {
      try { if (_map.getLayer(l)) _map.removeLayer(l); } catch (_) {}
    });
    [id.lineSrc, id.ptSrc, id.midSrc].forEach(s => {
      try { if (_map.getSource(s)) _map.removeSource(s); } catch (_) {}
    });
  }

  function setPointHover(routeId, featureIdx, hover) {
    if (!_map) return;
    const src = _ids(routeId).ptSrc;
    if (_map.getSource(src))
      _map.setFeatureState({ source: src, id: featureIdx }, { hover });
  }

  return {
    initMap, changeMapStyle, flyTo, openPopup, closePopup,
    refreshAllLayers, updateRouteLayers, removeRouteLayers, setPointHover,
  };
})();
