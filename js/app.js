/**
 * app.js — CarbonGlobe
 * Entry point: wires map ↔ ui, restores the autosave or seeds demo data.
 */
(function () {
  const { map: cgMap, ui: cgUI, team } = window.CG;

  const AUTOSAVE_KEY   = 'carbonglobe.autosave';
  const AUTOSAVE_DELAY = 500; // ms; coalesces bursts like waypoint dragging

  cgMap.initMap('map', {
    onRightClick:    coords          => cgUI.onMapRightClick(coords),
    onWaypointMove:  ()              => cgUI.onWaypointDragEnd(),
    onWaypointClick: (routeId, idx)  => cgUI.onWaypointClick(routeId, idx),
  });

  if (!restoreAutosave()) seedDemo();

  cgUI.initUI();

  // Autosave every change to the browser's local storage
  let saveTimer = null;
  team.onChange(() => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeAutosave, AUTOSAVE_DELAY);
  });
  window.addEventListener('pagehide', () => {
    if (saveTimer) writeAutosave();
  });

  function writeAutosave() {
    saveTimer = null;
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(team.serialize()));
    } catch (_) { /* storage blocked or full: the file save still works */ }
  }

  function restoreAutosave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return false;
      team.deserialize(JSON.parse(raw));
      return true;
    } catch (_) {
      return false;
    }
  }

  function seedDemo() {
    const m1 = team.addMember('jan');
    team.addMember('patrick');
    team.addMember('michi');

    team.setActiveMember(m1);

    const r1 = team.addRoute('indien');
    team.setActiveRoute(r1);
    team.assignMember(r1, m1);
  }
})();
