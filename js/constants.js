/**
 * constants.js — CarbonGlobe
 * CO₂ factors (ClimCalc 2022, g CO₂eq / Pkm) and shared utilities.
 * Exposes: window.CG.constants
 */
window.CG = window.CG || {};

window.CG.constants = (function () {

  const CO2_FACTORS = {
    plane: { label: 'Flugzeug', icon: '✈️',  co2PerKm: null, speedKmh: 800 },
    train: { label: 'Bahn',     icon: '🚆',  co2PerKm: 9,   speedKmh: 120 },
    car:   { label: 'Pkw',      icon: '🚗',  co2PerKm: 226, speedKmh: 90  },
    ecar:  { label: 'E-Pkw',    icon: '⚡',  co2PerKm: 106, speedKmh: 90  },
    bus:   { label: 'Fernbus',  icon: '🚌',  co2PerKm: 49,  speedKmh: 80  },
  };

  const MEMBER_COLORS = [
    '#4ade80','#f472b6','#60a5fa','#fb923c',
    '#a78bfa','#facc15','#34d399','#f87171',
    '#38bdf8','#e879f9',
  ];

  /** ClimCalc 2022: flight g CO₂/km by distance bracket */
  function getFlightCO2Factor(distKm) {
    if (distKm <= 1000) return 283;   // Kurz-/Mittelstrecke
    if (distKm <= 4000) return 258;   // Kurze Langstrecke
    return 216;                        // Langstrecke > 4000 km
  }

  /** Returns CO₂ in kg for a distance + transport mode */
  function calcCO2(distKm, mode) {
    if (mode === 'plane') {
      return (distKm * getFlightCO2Factor(distKm)) / 1000;
    }
    const f = CO2_FACTORS[mode];
    if (!f || f.co2PerKm == null) return 0;
    return (distKm * f.co2PerKm) / 1000;
  }

  function calcTravelTime(distKm, mode) {
    const f = CO2_FACTORS[mode];
    return f ? distKm / f.speedKmh : 0;
  }

  function formatTime(hours) {
    const d = Math.floor(hours / 24);
    const h = Math.floor(hours % 24);
    const m = Math.round((hours % 1) * 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0 || d > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(' ');
  }

  function formatCO2(kg) {
    if (kg >= 1000) return `${(kg / 1000).toFixed(2)} t`;
    return `${kg.toFixed(1)} kg`;
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Impact Factors ────────────────────────────────────────────────────────
  // Numeric weight used in grade denominator. Higher = journey matters more = grade easier.
  const IMPACT_FACTORS = {
    1: { label: 'Niedrig',  icon: '🔴', weight: 10 },
    2: { label: 'Mittel',   icon: '🟡', weight: 20 },
    3: { label: 'Hoch',     icon: '🟢', weight: 30 },
  };

  // ── Grade thresholds ──────────────────────────────────────────────────────
  // Applied to: (total route CO₂ kg × memberCount) / impactWeight
  // Lower score = better grade.
  const GRADE_THRESHOLDS = [
    { max:  20,  grade: 'A', color: '#4ade80' },
    { max:  60,  grade: 'B', color: '#a3e635' },
    { max: 150,  grade: 'C', color: '#facc15' },
    { max: 350,  grade: 'D', color: '#fb923c' },
    { max: 700,  grade: 'E', color: '#f87171' },
    { max: Infinity, grade: 'F', color: '#ef4444' },
  ];

  /**
   * Calculate route grade.
   * @param {number} co2Kg        – CO₂ for one person doing the route
   * @param {number} memberCount  – number of assigned members
   * @param {number} impactWeight – numeric weight (1|2|3)
   * @returns {{ grade, color, score }}
   */
  function calcGrade(co2Kg, memberCount, impactWeight) {
    const count  = memberCount  || 1;
    const weight = impactWeight || 1;
    const score  = (co2Kg * count) / weight;
    const entry  = GRADE_THRESHOLDS.find(t => score <= t.max) ?? GRADE_THRESHOLDS.at(-1);
    return { grade: entry.grade, color: entry.color, score };
  }

  return {
    CO2_FACTORS, MEMBER_COLORS, IMPACT_FACTORS, GRADE_THRESHOLDS,
    getFlightCO2Factor, calcCO2, calcTravelTime,
    formatTime, formatCO2, calcGrade, uid, escHtml,
  };
})();
