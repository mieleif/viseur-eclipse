/**
 * astro.js — positions topocentriques Soleil / Lune et circonstances locales
 * d'une eclipse solaire.
 *
 * Algorithmes : Jean Meeus, "Astronomical Algorithms" 2e ed.
 *   - ch. 25  Soleil (precision ~0.01 deg)
 *   - ch. 47  Lune, series ELP tronquee (~10" en longitude, ~4 km en distance)
 *   - ch. 22  nutation, ch. 12 temps sideral, ch. 11 rayon terrestre
 * La parallaxe est traitee vectoriellement : on soustrait le vecteur
 * geocentrique de l'observateur, ce qui donne direction ET distance
 * topocentriques d'un coup (indispensable : le demi-diametre lunaire varie
 * de ~2 % entre le centre de la Terre et la surface).
 *
 * Aucune dependance. Utilisable en module ES dans le navigateur et sous Node.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

const AU_KM = 149597870.7;
const EARTH_EQ_RADIUS_KM = 6378.137;
const EARTH_FLATTENING_RATIO = 0.996647189335; // b/a (WGS84)
const SUN_RADIUS_KM = 696000;
const MOON_RADIUS_KM = 1737.4;

const norm360 = (x) => ((x % 360) + 360) % 360;
const sin = (d) => Math.sin(d * DEG);
const cos = (d) => Math.cos(d * DEG);

/* ------------------------------------------------------------------ temps */

/** Jour julien (UT) a partir d'un Date JS. */
export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

export function dateFromJulianDay(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}

/**
 * Delta T = TT - UT, en secondes.
 * Valeurs observees (IERS) jusqu'a 2025, puis maintien de la valeur courante :
 * depuis ~2016 Delta T stagne autour de 69 s. Les polynomes d'Espenak-Meeus
 * predisaient ~75 s en 2026, ce qui est aujourd'hui trop haut d'environ 6 s
 * (soit ~12 s d'erreur sur les instants de contact) — d'ou la table.
 */
export function deltaTSeconds(year) {
  const table = {
    1990: 56.86, 1995: 60.78, 2000: 63.83, 2005: 64.69, 2010: 66.07,
    2015: 67.64, 2016: 68.10, 2017: 68.59, 2018: 68.97, 2019: 69.22,
    2020: 69.36, 2021: 69.36, 2022: 69.29, 2023: 69.22, 2024: 69.18,
    2025: 69.20,
  };
  if (table[Math.floor(year)] !== undefined) return table[Math.floor(year)];
  const years = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (year < years[0]) return table[years[0]];
  if (year > years[years.length - 1]) return table[years[years.length - 1]];
  let lo = years[0];
  for (const y of years) if (y <= year) lo = y;
  const hi = years[years.indexOf(lo) + 1];
  const f = (year - lo) / (hi - lo);
  return table[lo] + f * (table[hi] - table[lo]);
}

/** JD des ephemerides (echelle TT) a partir du JD en UT. */
export function jdeFromJd(jd) {
  const year = dateFromJulianDay(jd).getUTCFullYear();
  return jd + deltaTSeconds(year) / 86400;
}

/* ------------------------------------------------- nutation et obliquite */

export function nutation(T) {
  const omega = 125.04452 - 1934.136261 * T + 0.0020708 * T * T + T * T * T / 450000;
  const L = 280.4665 + 36000.7698 * T;      // longitude moyenne du Soleil
  const Lp = 218.3165 + 481267.8813 * T;    // longitude moyenne de la Lune
  // arcsecondes -> degres
  const dpsi = (-17.20 * sin(omega) - 1.32 * sin(2 * L)
    - 0.23 * sin(2 * Lp) + 0.21 * sin(2 * omega)) / 3600;
  const deps = (9.20 * cos(omega) + 0.57 * cos(2 * L)
    + 0.10 * cos(2 * Lp) - 0.09 * cos(2 * omega)) / 3600;
  return { dpsi, deps, omega };
}

export function meanObliquity(T) {
  const U = T / 100;
  return 23.43929111
    - (46.815 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600
    + 0 * U; // termes d'ordre superieur negligeables sur +/- 1 siecle
}

/** Temps sideral apparent a Greenwich, en degres. */
export function apparentSiderealTime(jd, T, dpsi, eps) {
  const theta0 = 280.46061837
    + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T * T
    - (T * T * T) / 38710000;
  return norm360(theta0 + dpsi * cos(eps));
}

/* ---------------------------------------------------------------- Soleil */

/** Position geometrique/apparente du Soleil (Meeus ch. 25, precision ~0.01 deg). */
export function sunPosition(jde) {
  const T = (jde - 2451545.0) / 36525;
  const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M)
    + (0.019993 - 0.000101 * T) * sin(2 * M)
    + 0.000289 * sin(3 * M);
  const trueLon = L0 + C;
  const v = M + C;
  const R = (1.000001018 * (1 - e * e)) / (1 + e * cos(v)); // UA
  const omega = 125.04 - 1934.136 * T;
  // longitude apparente : nutation + aberration
  const lambda = trueLon - 0.00569 - 0.00478 * sin(omega);
  return { lambda: norm360(lambda), beta: 0, distanceKm: R * AU_KM, R };
}

/* ------------------------------------------------------------------ Lune */

// Table 47.A — arguments (D, M, M', F) et coefficients Sigma-l / Sigma-r
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751], [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0], [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0], [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0], [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165], [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];

// Table 47.B — arguments (D, M, M', F) et coefficient Sigma-b
const MOON_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794], [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107], [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777], [4, 0, -2, 1, 671], [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596], [2, -1, 1, -1, 491], [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439], [2, 0, 2, 1, 422], [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366], [2, 1, 0, 1, -351], [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315], [2, -2, 0, -1, 302], [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229], [1, 1, 0, -1, 223], [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220], [2, 1, -1, -1, -220], [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181], [0, 1, 2, 1, -177], [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166], [1, 0, 1, -1, -164], [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119], [4, -1, 0, -1, 115], [2, -2, 0, 1, 107],
];

/** Position geocentrique de la Lune (Meeus ch. 47). Longitude apparente. */
export function moonPosition(jde) {
  const T = (jde - 2451545.0) / 36525;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;

  const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2
    + T3 / 538841 - T4 / 65194000);
  const D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T2
    + T3 / 545868 - T4 / 113065000);
  const M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T2
    + T3 / 24490000);
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T2
    + T3 / 69699 - T4 / 14712000);
  const F = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T2
    - T3 / 3526000 + T4 / 863310000);

  const A1 = norm360(119.75 + 131.849 * T);
  const A2 = norm360(53.09 + 479264.290 * T);
  const A3 = norm360(313.45 + 481266.484 * T);
  const E = 1 - 0.002516 * T - 0.0000074 * T2;

  let sumL = 0, sumR = 0, sumB = 0;

  for (const [d, m, mp, f, cl, cr] of MOON_LR) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const ecc = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E);
    sumL += cl * ecc * sin(arg);
    sumR += cr * ecc * cos(arg);
  }
  for (const [d, m, mp, f, cb] of MOON_B) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const ecc = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E);
    sumB += cb * ecc * sin(arg);
  }

  // termes additifs (Venus, Jupiter, aplatissement terrestre)
  sumL += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
  sumB += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F)
    + 175 * sin(A1 + F) + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);

  return {
    lambda: norm360(Lp + sumL / 1000000), // moyenne equinoxe de la date
    beta: sumB / 1000000,
    distanceKm: 385000.56 + sumR / 1000,
  };
}

/* ---------------------------------------------- geometrie / repere local */

/** Ecliptique spherique -> equatorial rectangulaire (km). */
function eclipticToEquatorialVector(lambda, beta, distanceKm, eps) {
  const x = distanceKm * cos(beta) * cos(lambda);
  const y = distanceKm * cos(beta) * sin(lambda);
  const z = distanceKm * sin(beta);
  return {
    x,
    y: y * cos(eps) - z * sin(eps),
    z: y * sin(eps) + z * cos(eps),
  };
}

/** Vecteur geocentrique de l'observateur, repere equatorial, en km. */
function observerVector(latDeg, lonDeg, elevationM, gastDeg) {
  const u = Math.atan(EARTH_FLATTENING_RATIO * Math.tan(latDeg * DEG));
  const hRatio = elevationM / (EARTH_EQ_RADIUS_KM * 1000);
  const rhoSin = EARTH_FLATTENING_RATIO * Math.sin(u) + hRatio * sin(latDeg);
  const rhoCos = Math.cos(u) + hRatio * cos(latDeg);
  const lst = gastDeg + lonDeg; // longitude est positive
  return {
    x: rhoCos * EARTH_EQ_RADIUS_KM * cos(lst),
    y: rhoCos * EARTH_EQ_RADIUS_KM * sin(lst),
    z: rhoSin * EARTH_EQ_RADIUS_KM,
    lst: norm360(lst),
  };
}

function vectorToSpherical(v) {
  const dist = Math.hypot(v.x, v.y, v.z);
  return {
    ra: norm360(Math.atan2(v.y, v.x) * RAD),
    dec: Math.asin(v.z / dist) * RAD,
    distanceKm: dist,
  };
}

/** Equatorial -> horizontal. Azimut compte depuis le Nord vers l'Est. */
function equatorialToHorizontal(ra, dec, latDeg, lstDeg) {
  const H = lstDeg - ra;
  const alt = Math.asin(sin(latDeg) * sin(dec) + cos(latDeg) * cos(dec) * cos(H)) * RAD;
  const az = norm360(Math.atan2(
    sin(H),
    cos(H) * sin(latDeg) - Math.tan(dec * DEG) * cos(latDeg),
  ) * RAD + 180);
  return { az, alt };
}

/** Refraction atmospherique (Bennett), en degres, pour une altitude vraie. */
export function refraction(altDeg) {
  if (altDeg < -2) return 0;
  const r = 1.02 / Math.tan((altDeg + 10.3 / (altDeg + 5.11)) * DEG); // arcmin
  return r / 60;
}

/* ------------------------------------------------- circonstances locales */

/** Angle entre deux directions (az/alt) en degres. */
function angularSeparation(ra1, dec1, ra2, dec2) {
  const c = sin(dec1) * sin(dec2) + cos(dec1) * cos(dec2) * cos(ra1 - ra2);
  return Math.acos(Math.min(1, Math.max(-1, c))) * RAD;
}

/**
 * Etat de l'eclipse a un instant donne, pour un site donne.
 * site = { lat, lon, elevation }  (degres, est positif, metres)
 */
export function circumstances(date, site) {
  const jd = julianDay(date);
  const jde = jdeFromJd(jd);
  const T = (jde - 2451545.0) / 36525;
  const { dpsi, deps } = nutation(T);
  const eps = meanObliquity(T) + deps;
  const gast = apparentSiderealTime(jd, T, dpsi, eps);

  const sun = sunPosition(jde);
  const moon = moonPosition(jde);

  const sunGeo = eclipticToEquatorialVector(sun.lambda, sun.beta, sun.distanceKm, eps);
  const moonGeo = eclipticToEquatorialVector(moon.lambda + dpsi, moon.beta, moon.distanceKm, eps);
  const obs = observerVector(site.lat, site.lon, site.elevation || 0, gast);

  const sunTopo = vectorToSpherical({
    x: sunGeo.x - obs.x, y: sunGeo.y - obs.y, z: sunGeo.z - obs.z,
  });
  const moonTopo = vectorToSpherical({
    x: moonGeo.x - obs.x, y: moonGeo.y - obs.y, z: moonGeo.z - obs.z,
  });

  const sunH = equatorialToHorizontal(sunTopo.ra, sunTopo.dec, site.lat, obs.lst);
  const moonH = equatorialToHorizontal(moonTopo.ra, moonTopo.dec, site.lat, obs.lst);

  // demi-diametres apparents topocentriques
  const rSun = Math.asin(SUN_RADIUS_KM / sunTopo.distanceKm) * RAD;
  const rMoon = Math.asin(MOON_RADIUS_KM / moonTopo.distanceKm) * RAD;

  const sep = angularSeparation(sunTopo.ra, sunTopo.dec, moonTopo.ra, moonTopo.dec);

  return {
    date,
    sun: {
      az: sunH.az,
      alt: sunH.alt,
      altApparent: sunH.alt + refraction(sunH.alt),
      radius: rSun,
      distanceKm: sunTopo.distanceKm,
    },
    moon: {
      az: moonH.az,
      alt: moonH.alt,
      altApparent: moonH.alt + refraction(moonH.alt),
      radius: rMoon,
      distanceKm: moonTopo.distanceKm,
    },
    separation: sep,
    magnitude: magnitudeFrom(sep, rSun, rMoon),
    obscuration: obscurationFrom(sep, rSun, rMoon),
  };
}

/**
 * Magnitude de l'eclipse = fraction du DIAMETRE solaire couverte.
 * Convention Espenak/Meeus : quand le disque solaire est entierement contenu
 * dans le disque lunaire (totalite), la magnitude vaut le rapport des
 * diametres apparents — elle depasse alors 1.
 */
function magnitudeFrom(sep, rSun, rMoon) {
  if (sep >= rSun + rMoon) return 0;
  if (sep <= Math.abs(rMoon - rSun)) return rMoon / rSun;
  return (rSun + rMoon - sep) / (2 * rSun);
}

/** Fraction de la SURFACE du disque solaire couverte (0..1). */
function obscurationFrom(d, R, r) {
  if (d >= R + r) return 0;
  if (d <= Math.abs(R - r)) return r >= R ? 1 : (r * r) / (R * R);
  const a = r * r * Math.acos((d * d + r * r - R * R) / (2 * d * r))
    + R * R * Math.acos((d * d + R * R - r * r) / (2 * d * R))
    - 0.5 * Math.sqrt((-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R));
  return a / (Math.PI * R * R);
}

/** Recherche par bissection de l'instant ou f(t) change de signe. */
function bisect(f, t0, t1, iterations = 40) {
  let a = t0, b = t1;
  let fa = f(a);
  for (let i = 0; i < iterations; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else { b = m; }
  }
  return new Date(Math.round((a + b) / 2));
}

/**
 * Circonstances locales completes de l'eclipse du jour donne.
 * Balaye la journee (en UTC) minute par minute puis affine par bissection.
 * Retourne null si aucune eclipse n'est visible depuis ce site ce jour-la.
 */
export function findEclipse(dayStartUtc, site, { windowHours = 24, stepMinutes = 1 } = {}) {
  const t0 = dayStartUtc.getTime();
  const stepMs = stepMinutes * 60000;
  const steps = Math.ceil((windowHours * 3600000) / stepMs);

  const sepMinus = (ms) => {
    const c = circumstances(new Date(ms), site);
    return c.separation - (c.sun.radius + c.moon.radius);
  };

  let best = null;
  let bestValue = Infinity;
  const samples = [];
  for (let i = 0; i <= steps; i++) {
    const ms = t0 + i * stepMs;
    const v = sepMinus(ms);
    samples.push({ ms, v });
    if (v < bestValue) { bestValue = v; best = ms; }
  }
  if (bestValue >= 0) return null; // les disques ne se touchent jamais

  // C1 / C4 : changements de signe autour du maximum
  let c1 = null, c4 = null;
  for (let i = 1; i < samples.length; i++) {
    const p = samples[i - 1], q = samples[i];
    if (p.v >= 0 && q.v < 0 && c1 === null) {
      c1 = bisect((ms) => -sepMinus(ms), p.ms, q.ms);
    }
    if (p.v < 0 && q.v >= 0) c4 = bisect((ms) => sepMinus(ms), p.ms, q.ms);
  }

  // maximum : minimum de la separation, affine par section doree
  const refineMax = (lo, hi) => {
    const phi = (Math.sqrt(5) - 1) / 2;
    let a = lo, b = hi;
    for (let i = 0; i < 60; i++) {
      const x1 = b - phi * (b - a);
      const x2 = a + phi * (b - a);
      const f1 = circumstances(new Date(x1), site).separation;
      const f2 = circumstances(new Date(x2), site).separation;
      if (f1 < f2) b = x2; else a = x1;
    }
    return new Date(Math.round((a + b) / 2));
  };
  const maxDate = refineMax(best - stepMs, best + stepMs);
  const max = circumstances(maxDate, site);

  // totalite / annularite : le disque lunaire contient-il le disque solaire ?
  const innerContact = (ms) => {
    const c = circumstances(new Date(ms), site);
    return c.separation - Math.abs(c.moon.radius - c.sun.radius);
  };
  let c2 = null, c3 = null;
  if (max.moon.radius >= max.sun.radius && innerContact(maxDate.getTime()) < 0) {
    c2 = bisect((ms) => -innerContact(ms), c1 ? c1.getTime() : t0, maxDate.getTime());
    c3 = bisect(innerContact, maxDate.getTime(), c4 ? c4.getTime() : t0 + windowHours * 3600000);
  }

  const type = c2
    ? (max.moon.radius >= max.sun.radius ? 'totale' : 'annulaire')
    : 'partielle';

  // Coucher (ou lever) du Soleil pendant l'eclipse : sous nos latitudes
  // l'eclipse du 12 aout 2026 se termine apres le coucher, la fin theorique
  // n'est donc pas observable. On cherche le passage de la hauteur apparente
  // du bord superieur du disque par zero.
  const upperLimbAlt = (ms) => {
    const c = circumstances(new Date(ms), site);
    return c.sun.altApparent + c.sun.radius;
  };
  const spanStart = (c1 || new Date(t0)).getTime();
  const spanEnd = (c4 || new Date(t0 + windowHours * 3600000)).getTime();
  let horizonCrossing = null;
  let crossingKind = null;
  {
    const n = 240;
    let prev = upperLimbAlt(spanStart);
    for (let i = 1; i <= n; i++) {
      const ms = spanStart + ((spanEnd - spanStart) * i) / n;
      const cur = upperLimbAlt(ms);
      if ((prev >= 0) !== (cur >= 0)) {
        const prevMs = spanStart + ((spanEnd - spanStart) * (i - 1)) / n;
        const descending = prev >= 0 && cur < 0;
        horizonCrossing = bisect(
          descending ? (ms2) => -upperLimbAlt(ms2) : upperLimbAlt,
          prevMs, ms,
        );
        crossingKind = descending ? 'coucher' : 'lever';
        break;
      }
      prev = cur;
    }
  }

  return {
    type,
    c1, c2, max: maxDate, c3, c4,
    maxCircumstances: max,
    /** l'eclipse est-elle au moins partiellement au-dessus de l'horizon ? */
    sunAboveHorizonAtMax: max.sun.altApparent > 0,
    /** instant ou le Soleil passe l'horizon pendant l'eclipse (ou null) */
    horizonCrossing,
    crossingKind,
    /** derniere phase reellement observable */
    observableUntil: crossingKind === 'coucher' ? horizonCrossing : c4,
    observableFrom: crossingKind === 'lever' ? horizonCrossing : c1,
  };
}

/** Echantillonne l'eclipse pour tracer une courbe / une timeline. */
export function sampleEclipse(eclipse, site, count = 120) {
  if (!eclipse || !eclipse.c1 || !eclipse.c4) return [];
  const t0 = eclipse.c1.getTime(), t1 = eclipse.c4.getTime();
  const out = [];
  for (let i = 0; i <= count; i++) {
    const ms = t0 + ((t1 - t0) * i) / count;
    out.push(circumstances(new Date(ms), site));
  }
  return out;
}

export const constants = { AU_KM, EARTH_EQ_RADIUS_KM, SUN_RADIUS_KM, MOON_RADIUS_KM };
