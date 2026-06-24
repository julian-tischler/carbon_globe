/**
 * app.js — CarbonGlobe
 * Entry point: wires map ↔ ui, seeds demo data.
 */
(function () {
  const { map: cgMap, ui: cgUI, team } = window.CG;

  cgMap.initMap(
    'map',
    coords => cgUI.onMapClick(coords),
    ()     => cgUI.onWaypointDragEnd()
  );

  cgUI.initUI();

  // Seed demo data
  // const m1 = team.addMember('jan');
  // const m2 = team.addMember('patrick');
  // const m3 = team.addMember('michi');

  // team.setActiveMember(m1);

  // const r1 = team.addRoute('indien');
  // team.setActiveRoute(r1);
  // team.assignMember(r1, m1);

  cgUI.renderAll();
})();
