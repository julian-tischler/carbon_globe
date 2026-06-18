/**
 * map.js — CarbonGlobe
 * MapLibre GL JS wrapper. Layers keyed by route ID, color from grade.
 * Waypoint drag: mousedown over a point disables pan immediately;
 * mouseup always re-enables it, whether or not a real drag occurred.
 * Exposes: window.CG.map
 */
window.CG = window.CG || {};

window.CG.map = (function () {
  let _map            = null;
  let _onRightClick   = null;
  let _onWaypointMove = null;

  // Drag state — both null when idle.
  // _pending: mousedown landed on a point, waiting to see if mouse moves.
  // _drag:    mouse actually moved, waypoint is being repositioned.
  let _pending = null;  // { routeId, localIdx }
  let _drag    = null;  // { routeId, localIdx }

  const DEFAULT_COLOR = '#60a5fa';

  // ── Init ──────────────────────────────────────────────────────────────────

  function initMap(containerId, onRightClick, onWaypointMove) {
    _onRightClick   = onRightClick;
    _onWaypointMove = onWaypointMove;

    _map = new maplibregl.Map({
      container: containerId,
      style: 'https://tiles.openfreemap.org/styles/bright',
      center: [15, 45],
      zoom: 2,
      projection: 'globe',
    });

    _map.on('style.load', refreshAllLayers);

    // Right-click → add waypoint
    _map.on('contextmenu', e => {
      e.originalEvent.preventDefault();
      if (_onRightClick) _onRightClick([e.lngLat.lng, e.lngLat.lat]);
    });

    // ── Drag: mousedown ───────────────────────────────────────────────────
    // If the click lands on a waypoint circle, disable pan immediately so
    // MapLibre never sees the subsequent mousemove as a pan gesture.
    // mouseup always restores pan, so a plain click has no lasting effect.
    _map.on('mousedown', e => {
      if (e.originalEvent.button !== 0) return;  // left button only

      const route = window.CG.team.getActiveRoute();
      if (!route) return;

      const pLyr = _ptLayerId(route.id);
      if (!_map.getLayer(pLyr)) return;

      const features = _map.queryRenderedFeatures(e.point, { layers: [pLyr] });
      if (!features.length) return;

      const localIdx = features[0].id;
      if (typeof localIdx !== 'number' || localIdx < 0 || localIdx >= route.waypoints.length) return;

      // Suppress pan and record the candidate point.
      e.preventDefault();
      _map.dragPan.disable();
      _pending = { routeId: route.id, localIdx };
      _map.getCanvas().style.cursor = 'grab';
    });

    // ── Drag: mousemove ───────────────────────────────────────────────────
    _map.on('mousemove', e => {
      // Promote pending → active drag on first movement
      if (_pending) {
        _drag    = _pending;
        _pending = null;
        _map.getCanvas().style.cursor = 'grabbing';
      }

      if (_drag) {
        window.CG.team.moveWaypoint(_drag.routeId, _drag.localIdx, [e.lngLat.lng, e.lngLat.lat]);
        const route = window.CG.team.getRoute(_drag.routeId);
        if (route) _updateRouteData(route);
        return;
      }

      // Idle: show grab cursor when hovering over a waypoint
      const route = window.CG.team.getActiveRoute();
      if (!route) return;
      const pLyr = _ptLayerId(route.id);
      if (!_map.getLayer(pLyr)) return;
      const hovered = _map.queryRenderedFeatures(e.point, { layers: [pLyr] });
      _map.getCanvas().style.cursor = hovered.length ? 'grab' : '';
    });

    // ── Drag: mouseup ─────────────────────────────────────────────────────
    // Always restore pan. If _drag was active, notify UI to re-render.
    _map.on('mouseup', () => {
      const wasDragging = !!_drag;
      _pending = null;
      _drag    = null;
      _map.dragPan.enable();
      _map.getCanvas().style.cursor = '';
      if (wasDragging && _onWaypointMove) _onWaypointMove();
    });

    return _map;
  }

  function changeMapStyle(url) { if (_map) _map.setStyle(url); }

  function flyTo(coords, zoom) {
    if (_map) _map.flyTo({ center: coords, zoom: zoom ?? 4, duration: 1200, essential: true });
  }

  // ── ID helpers ────────────────────────────────────────────────────────────

  function _routeSrcId(rid)   { return `cg-route-src-${rid}`; }
  function _ptSrcId(rid)      { return `cg-pts-src-${rid}`; }
  function _routeLayerId(rid) { return `cg-route-lyr-${rid}`; }
  function _ptLayerId(rid)    { return `cg-pts-lyr-${rid}`; }
  function _emptyFC()         { return { type: 'FeatureCollection', features: [] }; }

  // ── Color ─────────────────────────────────────────────────────────────────

  function _routeColor(route) {
    const { co2Kg } = window.CG.team.getRouteStats(route);
    if (co2Kg === 0) return DEFAULT_COLOR;
    return window.CG.team.getRouteGrade(route).color;
  }

  // ── Layer management ──────────────────────────────────────────────────────

  function _ensureLayers(route) {
    const rSrc  = _routeSrcId(route.id);
    const pSrc  = _ptSrcId(route.id);
    const rLyr  = _routeLayerId(route.id);
    const pLyr  = _ptLayerId(route.id);
    const color = _routeColor(route);

    if (!_map.getSource(rSrc)) _map.addSource(rSrc, { type: 'geojson', data: _emptyFC() });
    if (!_map.getSource(pSrc)) _map.addSource(pSrc, { type: 'geojson', data: _emptyFC() });

    if (!_map.getLayer(rLyr)) {
      _map.addLayer({
        id: rLyr, type: 'line', source: rSrc,
        paint: { 'line-color': color, 'line-width': 2.5, 'line-opacity': 0.85 },
      });
    }
    if (!_map.getLayer(pLyr)) {
      _map.addLayer({
        id: pLyr, type: 'circle', source: pSrc,
        paint: {
          'circle-radius':       ['case', ['boolean', ['feature-state', 'hover'], false], 11, 7],
          'circle-color':        color,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity':      0.95,
        },
      });
    }

    _map.setPaintProperty(rLyr, 'line-color', color);
    _map.setPaintProperty(pLyr, 'circle-color', color);
  }

  function _buildRouteGeoJSON(route) {
    const wp       = route.waypoints;
    const ptFeats  = wp.map((coords, i) => {
      const f = turf.point(coords);
      f.id = i;
      return f;
    });

    const routeFeats = [];
    if (wp.length >= 2) {
      for (let i = 0; i < wp.length - 1; i++) {
        try {
          routeFeats.push(turf.greatCircle(wp[i], wp[i + 1], { npoints: 80 }));
        } catch (_) {
          routeFeats.push(turf.lineString([wp[i], wp[i + 1]]));
        }
      }
    }

    return {
      routes: turf.featureCollection(routeFeats),
      points: turf.featureCollection(ptFeats),
    };
  }

  function _updateRouteData(route) {
    const rSrc = _routeSrcId(route.id);
    const pSrc = _ptSrcId(route.id);
    if (!_map || !_map.getSource(rSrc)) return;
    const { routes, points } = _buildRouteGeoJSON(route);
    _map.getSource(rSrc).setData(routes);
    _map.getSource(pSrc).setData(points);
    const color = _routeColor(route);
    _map.setPaintProperty(_routeLayerId(route.id), 'line-color', color);
    _map.setPaintProperty(_ptLayerId(route.id),    'circle-color', color);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function refreshAllLayers() {
    if (!_map || !_map.isStyleLoaded()) {
      if (_map) _map.once('style.load', refreshAllLayers);
      return;
    }
    window.CG.team.getRoutes().forEach(r => {
      _ensureLayers(r);
      _updateRouteData(r);
    });
  }

  function updateRouteLayers(route) {
    if (!_map || !_map.isStyleLoaded()) return;
    _ensureLayers(route);
    _updateRouteData(route);
  }

  function removeRouteLayers(routeId) {
    if (!_map) return;
    [_routeLayerId(routeId), _ptLayerId(routeId)].forEach(id => {
      try { if (_map.getLayer(id))  _map.removeLayer(id); } catch (_) {}
    });
    [_routeSrcId(routeId), _ptSrcId(routeId)].forEach(id => {
      try { if (_map.getSource(id)) _map.removeSource(id); } catch (_) {}
    });
  }

  function setPointHover(routeId, featureIdx, hover) {
    if (!_map) return;
    const src = _ptSrcId(routeId);
    if (_map.getSource(src))
      _map.setFeatureState({ source: src, id: featureIdx }, { hover });
  }

  return {
    initMap, changeMapStyle, flyTo,
    refreshAllLayers, updateRouteLayers, removeRouteLayers, setPointHover,
  };
})();