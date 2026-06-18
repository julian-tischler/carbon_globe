/**
 * team.js — CarbonGlobe
 * State: members (lightweight) + standalone routes.
 * Routes are decoupled from members; members are assigned to routes.
 * No DOM, no map side-effects.
 * Exposes: window.CG.team
 */
window.CG = window.CG || {};

window.CG.team = (function () {
  const C = window.CG.constants;

  // ── State ─────────────────────────────────────────────────────────────────

  const _members = new Map();   // id → { id, name, color }
  const _routes  = new Map();   // id → route object (see addRoute)

  let _activeMemberId = null;
  let _activeRouteId  = null;
  let _teamBudget     = 0;

  // ── Members ───────────────────────────────────────────────────────────────

  function addMember(name, workingHours = 1) {
    const id    = C.uid();
    const color = C.MEMBER_COLORS[_members.size % C.MEMBER_COLORS.length];
    _members.set(id, {
      id,
      name,
      color,
      workingHours: Number(workingHours) > 0 ? Number(workingHours) : 1,
    });
    return id;
  }

  function setMemberName(id, name) {
    const member = _members.get(id);
    if (!member) return;
    member.name = name.trim() || member.name;
  }

  function setMemberHours(id, hours) {
    const member = _members.get(id);
    if (!member) return;
    const value = Number(hours);
    member.workingHours = value > 0 ? value : member.workingHours;
  }

  function getMemberHours(id) {
    const member = _members.get(id);
    return member ? member.workingHours : 1;
  }

  function getMemberFTE(id) {
    return getMemberHours(id) / 40;
  }

  function getTeamFTE() {
    return Array.from(_members.values()).reduce((sum, member) => sum + ((member.workingHours || 1) / 40), 0);
  }

  function getMemberBudgetAllocation(memberId, budgetKg) {
    if (budgetKg <= 0) return 0;
    const member = _members.get(memberId);
    if (!member) return 0;
    const memberFTE = getMemberFTE(memberId);
    const totalFTE  = getTeamFTE();
    if (totalFTE <= 0) return 0;
    return (budgetKg * memberFTE) / totalFTE;
  }

  function removeMember(id) {
    _members.delete(id);
    if (_activeMemberId === id) _activeMemberId = null;
    // Unassign from all routes
    for (const r of _routes.values()) {
      r.assignedMemberIds = r.assignedMemberIds.filter(mid => mid !== id);
    }
  }

  function getMembers()  { return Array.from(_members.values()); }
  function getMember(id) { return _members.get(id) ?? null; }

  function setActiveMember(id) { _activeMemberId = id; }
  function getActiveMember()   { return _activeMemberId ? (_members.get(_activeMemberId) ?? null) : null; }
  function getActiveMemberId() { return _activeMemberId; }

  // ── Routes ────────────────────────────────────────────────────────────────

  function addRoute(label) {
    const id = C.uid();
    _routes.set(id, {
      id,
      label:             label || `Route ${_routes.size + 1}`,
      mode:              'plane',
      waypoints:         [],   // [[lng, lat], …]
      waypointNames:     [],   // string[]
      impactFactor:      2,    // 1 | 2 | 3
      assignedMemberIds: [],   // string[]
    });
    return id;
  }

  function removeRoute(id) {
    _routes.delete(id);
    if (_activeRouteId === id)
      _activeRouteId = _routes.size > 0 ? _routes.keys().next().value : null;
  }

  function getRoutes()   { return Array.from(_routes.values()); }
  function getRoute(id)  { return _routes.get(id) ?? null; }

  function setActiveRoute(id) { _activeRouteId = id; }
  function getActiveRoute()   { return _activeRouteId ? (_routes.get(_activeRouteId) ?? null) : null; }
  function getActiveRouteId() { return _activeRouteId; }

  function setRouteLabel(id, label) {
    const r = _routes.get(id);
    if (r) r.label = label;
  }

  function setRouteMode(id, mode) {
    const r = _routes.get(id);
    if (r) r.mode = mode;
  }

  function setRouteImpact(id, factor) {
    const r = _routes.get(id);
    if (r) r.impactFactor = Number(factor);
  }

  // ── Member assignment ─────────────────────────────────────────────────────

  function assignMember(routeId, memberId) {
    const r = _routes.get(routeId);
    if (!r || r.assignedMemberIds.includes(memberId)) return;
    r.assignedMemberIds.push(memberId);
  }

  function unassignMember(routeId, memberId) {
    const r = _routes.get(routeId);
    if (!r) return;
    r.assignedMemberIds = r.assignedMemberIds.filter(id => id !== memberId);
  }

  // ── Waypoints ─────────────────────────────────────────────────────────────

  function addWaypoint(routeId, coords, name) {
    const r = _routes.get(routeId);
    if (!r) return;
    r.waypoints.push([coords[0], coords[1]]);
    r.waypointNames.push(name || '');
  }

  function removeWaypoint(routeId, index) {
    const r = _routes.get(routeId);
    if (!r) return;
    r.waypoints.splice(index, 1);
    r.waypointNames.splice(index, 1);
  }

  function moveWaypoint(routeId, index, newCoords) {
    const r = _routes.get(routeId);
    if (!r || index < 0 || index >= r.waypoints.length) return;
    r.waypoints[index] = [newCoords[0], newCoords[1]];
    r.waypointNames[index] = '';
  }

  // ── Statistics ────────────────────────────────────────────────────────────

  /** Stats for one route (single-person CO₂). */
  function getRouteStats(route) {
    const wp = route.waypoints;
    if (wp.length < 2) return { distanceKm: 0, co2Kg: 0, timeHours: 0 };
    let dist = 0;
    for (let i = 0; i < wp.length - 1; i++)
      dist += turf.distance(wp[i], wp[i + 1]);
    return {
      distanceKm: dist,
      co2Kg:      C.calcCO2(dist, route.mode),
      timeHours:  C.calcTravelTime(dist, route.mode),
    };
  }

  /** Grade for a route, factoring in assigned members and impact. */
  function getRouteGrade(route) {
    const { co2Kg } = getRouteStats(route);
    return C.calcGrade(co2Kg, route.assignedMemberIds.length, route.impactFactor);
  }

  /** Total CO₂ attributed to a member: sum of co2Kg across all routes they're on. */
  function getMemberCO2(memberId) {
    let total = 0;
    for (const r of _routes.values()) {
      if (r.assignedMemberIds.includes(memberId))
        total += getRouteStats(r).co2Kg;
    }
    return total;
  }

  /** Team total = sum of (co2Kg × memberCount) per route. */
  function getTeamCO2() {
    let total = 0;
    for (const r of _routes.values()) {
      const { co2Kg } = getRouteStats(r);
      total += co2Kg * r.assignedMemberIds.length;
    }
    return total;
  }

  function setTeamBudget(kg) { _teamBudget = kg; }
  function getTeamBudget()   { return _teamBudget; }

  // ── Export ────────────────────────────────────────────────────────────────

  return {
    // Members
    addMember, removeMember, getMembers, getMember,
    setActiveMember, getActiveMember, getActiveMemberId,
    getMemberHours, getMemberFTE, getTeamFTE, getMemberBudgetAllocation,
    // Routes
    addRoute, removeRoute, getRoutes, getRoute,
    setActiveRoute, getActiveRoute, getActiveRouteId,
    setRouteLabel, setRouteMode, setRouteImpact,
    // Assignment
    assignMember, unassignMember,
    // Waypoints
    addWaypoint, removeWaypoint, moveWaypoint,
    // Stats
    getRouteStats, getRouteGrade, getMemberCO2, getTeamCO2,
    // Budget
    setTeamBudget, getTeamBudget,
  };
})();
