/**
 * Validation des ephemerides contre les exemples de reference de
 * Meeus, "Astronomical Algorithms" 2e ed., puis calcul des circonstances
 * locales de l'eclipse pour quelques villes.
 *
 *   node tools/verify.mjs
 */
import {
  sunPosition, moonPosition, nutation, meanObliquity,
  findEclipse, circumstances, deltaTSeconds,
} from '../js/astro.js';

let failures = 0;

function check(label, actual, expected, tolerance, unit = '') {
  const diff = Math.abs(actual - expected);
  const ok = diff <= tolerance;
  if (!ok) failures++;
  const status = ok ? 'OK  ' : 'FAIL';
  console.log(
    `  ${status} ${label.padEnd(34)} calc=${actual.toFixed(6)} ` +
    `ref=${expected.toFixed(6)} ecart=${diff.toExponential(2)}${unit}`,
  );
}

console.log('\n=== Meeus 47.a — Lune, 1992-04-12 0h TD (JDE 2448724.5) ===');
{
  const m = moonPosition(2448724.5);
  check('longitude apparente (deg)', m.lambda, 133.162655, 0.001);
  check('latitude (deg)', m.beta, -3.229126, 0.001);
  check('distance (km)', m.distanceKm, 368409.7, 1.0);
}

console.log('\n=== Meeus 25.b — Soleil, 1992-10-13 0h TD (JDE 2448908.5) ===');
{
  const s = sunPosition(2448908.5);
  // reference VSOP87 complet (25.b) : lambda apparente = 199.90895 deg
  check('longitude apparente (deg)', s.lambda, 199.90895, 0.01);
  // le rayon vecteur est compare a l'exemple 25.a (methode basse precision,
  // R = 0.99766) : l'ecart de 5e-5 UA avec VSOP87 est inherent a la methode et
  // ne represente que 0.05" sur le demi-diametre solaire.
  check('rayon vecteur (UA)', s.R, 0.99766, 0.00001);
}

console.log('\n=== Meeus 22.a — nutation, 1987-04-10 0h TD (JDE 2446895.5) ===');
{
  const T = (2446895.5 - 2451545.0) / 36525;
  const n = nutation(T);
  check('delta psi (arcsec)', n.dpsi * 3600, -3.788, 0.5, '"');
  check('delta epsilon (arcsec)', n.deps * 3600, 9.443, 0.1, '"');
  check('epsilon0 (deg)', meanObliquity(T), 23.44094629, 0.00001);
}

console.log('\n=== Delta T ===');
console.log(`  2026 -> ${deltaTSeconds(2026).toFixed(2)} s`);

/* ------------------------------------------------------------------ */

const VILLES = [
  { nom: 'Geneve', lat: 46.2044, lon: 6.1432, elevation: 375 },
  { nom: 'Lausanne', lat: 46.5197, lon: 6.6323, elevation: 495 },
  { nom: 'Neuchatel', lat: 46.9930, lon: 6.9310, elevation: 430 },
  { nom: 'Berne', lat: 46.9480, lon: 7.4474, elevation: 540 },
  { nom: 'Bale', lat: 47.5596, lon: 7.5886, elevation: 260 },
  { nom: 'Zurich', lat: 47.3769, lon: 8.5417, elevation: 410 },
  { nom: 'Lugano', lat: 46.0037, lon: 8.9511, elevation: 273 },
  { nom: 'Paris', lat: 48.8566, lon: 2.3522, elevation: 35 },
  { nom: 'Reykjavik', lat: 64.1466, lon: -21.9426, elevation: 40 },
  { nom: 'Burgos (ES)', lat: 42.3439, lon: -3.6969, elevation: 860 },
];

const fmt = (d) => d
  ? d.toLocaleString('fr-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  : '   --   ';

console.log('\n=== Eclipse du 12 aout 2026 — circonstances locales (heure CH) ===\n');
console.log(
  'Ville'.padEnd(13) + 'debut'.padEnd(11) + 'max'.padEnd(11) + 'fin'.padEnd(11) +
  'obsc.'.padEnd(8) + 'haut.'.padEnd(8) + 'azimut'.padEnd(9) + 'type',
);
console.log('-'.repeat(78));

for (const v of VILLES) {
  const e = findEclipse(new Date(Date.UTC(2026, 7, 12, 0, 0, 0)), v);
  if (!e) { console.log(`${v.nom.padEnd(13)}aucune eclipse`); continue; }
  const c = e.maxCircumstances;
  console.log(
    v.nom.padEnd(13) +
    fmt(e.c1).padEnd(11) + fmt(e.max).padEnd(11) + fmt(e.c4).padEnd(11) +
    `${(c.obscuration * 100).toFixed(1)}%`.padEnd(8) +
    `${c.sun.altApparent.toFixed(1)}deg`.padEnd(8) +
    `${c.sun.az.toFixed(1)}deg`.padEnd(9) +
    e.type,
  );
}

console.log('\n=== Point de plus grande eclipse (verification globale) ===');
{
  // reference NASA/Espenak : 2026-08-12 17:46:01 UTC, 65.2 N 25.2 W, magnitude 1.039
  const site = { lat: 65.2, lon: -25.2, elevation: 0 };
  const e = findEclipse(new Date(Date.UTC(2026, 7, 12, 0, 0, 0)), site);
  const refMax = Date.UTC(2026, 7, 12, 17, 46, 1);
  console.log(`  type=${e.type}  max=${e.max.toISOString()}`);
  check('instant du maximum (s)', (e.max.getTime() - refMax) / 1000, 0, 60, ' s');
  check('magnitude', e.maxCircumstances.magnitude, 1.039, 0.005);
}

console.log(failures === 0
  ? '\nToutes les verifications sont passees.\n'
  : `\n${failures} verification(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);
