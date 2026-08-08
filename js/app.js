/**
 * app.js — colle entre les ephemerides, les capteurs et l'ecran.
 */
import { circumstances, findEclipse } from './astro.js';
import {
  OrientationSensor, startCamera, stopCamera,
  vectorFromAzAlt, azAltFromVector, project, cameraAxis,
} from './ar.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'eclipse-toit/v1';

const DEFAULT_SITE = { lat: 46.5197, lon: 6.6323, elevation: 495 };
const DEFAULT_DATE = '2026-08-12';

const ROSE = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const compass = (az) => ROSE[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
/** Ramene un ecart d'angle dans ]-180, 180]. */
const wrap180 = (d) => { let x = d % 360; if (x > 180) x -= 360; if (x <= -180) x += 360; return x; };

const fmtTime = (d) => d
  ? d.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })
  : '—';
const fmtTimeS = (d) => d
  ? d.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  : '—';

/* ------------------------------------------------------------- etat */

const state = {
  site: { ...DEFAULT_SITE },
  dateStr: DEFAULT_DATE,
  eclipse: null,
  track: [],        // trajectoire echantillonnee
  keyPoints: [],
  windowStart: 0,
  windowEnd: 0,
  time: null,       // instant simule
  live: false,
  playing: false,
  mode: 'ar',       // 'ar' | 'map'
  fovH: 65,
  current: null,    // circonstances a `time`
  calibrated: false,
};

const sensor = new OrientationSensor();
let stream = null;
let canvas, ctx, dpr = 1;

/* --------------------------------------------------------- stockage */

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    if (raw.site && Number.isFinite(raw.site.lat)) state.site = raw.site;
    if (raw.dateStr) state.dateStr = raw.dateStr;
    if (Number.isFinite(raw.fovH)) state.fovH = raw.fovH;
    if (Number.isFinite(raw.headingOffset)) {
      sensor.headingOffset = raw.headingOffset;
      state.calibrated = raw.headingOffset !== 0;
    }
  } catch { /* stockage indisponible : on garde les valeurs par defaut */ }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      site: state.site,
      dateStr: state.dateStr,
      fovH: state.fovH,
      headingOffset: sensor.headingOffset,
    }));
  } catch { /* ignore */ }
}

/* ------------------------------------------------------ calcul eclipse */

/** Minuit local du jour demande (le balayage couvre ensuite 24 h). */
function localMidnight(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0); // minuit local
}

function recompute() {
  const day = localMidnight(state.dateStr);
  state.eclipse = findEclipse(day, state.site);

  if (state.eclipse && state.eclipse.c1 && state.eclipse.c4) {
    const e = state.eclipse;
    state.windowStart = e.c1.getTime();
    state.windowEnd = e.c4.getTime();

    state.keyPoints = [
      { t: e.c1, label: 'début', key: true },
      e.c2 && { t: e.c2, label: 'totalité', key: true },
      { t: e.max, label: 'maximum', key: true },
      e.c3 && { t: e.c3, label: 'fin tot.', key: true },
      e.horizonCrossing && { t: e.horizonCrossing, label: e.crossingKind, key: true },
      { t: e.c4, label: 'fin', key: true },
    ].filter(Boolean).sort((a, b) => a.t - b.t);
  } else {
    // pas d'eclipse : on trace quand meme la course du Soleil ce jour-la
    const noon = day.getTime() + 12 * 3600000;
    state.windowStart = noon - 8 * 3600000;
    state.windowEnd = noon + 8 * 3600000;
    state.keyPoints = [];
  }

  // echantillonnage de la trajectoire. On deroule l'azimut (azU) pour que la
  // vue carte ne se casse pas si la course traverse le nord (0°/360°).
  const N = 160;
  state.track = [];
  let azU = null;
  for (let i = 0; i <= N; i++) {
    const ms = state.windowStart + ((state.windowEnd - state.windowStart) * i) / N;
    const c = circumstances(new Date(ms), state.site);
    azU = azU === null ? c.sun.az : azU + wrap180(c.sun.az - azU);
    state.track.push({
      ms, az: c.sun.az, azU, alt: c.sun.altApparent, obsc: c.obscuration,
    });
  }

  setTime(state.eclipse ? state.eclipse.max : new Date(state.windowStart + (state.windowEnd - state.windowStart) / 2));
  renderStaticUI();
}

function setTime(d) {
  state.time = d instanceof Date ? d : new Date(d);
  state.current = circumstances(state.time, state.site);
  const span = state.windowEnd - state.windowStart;
  const frac = span > 0 ? (state.time.getTime() - state.windowStart) / span : 0.5;
  const range = $('tlRange');
  if (range) range.value = String(Math.round(Math.max(0, Math.min(1, frac)) * 1000));
  updateHud();
}

/* ---------------------------------------------------------- interface */

const crossingLabel = (e) =>
  (e.crossingKind === 'coucher' ? 'Coucher du Soleil' : 'Lever du Soleil');

function verdictFor() {
  const e = state.eclipse;
  if (!e) {
    return { cls: '', text: `Aucune éclipse solaire visible depuis ce lieu le ${state.dateStr}.` };
  }
  const c = e.maxCircumstances;
  const dir = compass(c.sun.az);
  const pct = (c.obscuration * 100).toFixed(0);

  if (c.sun.altApparent <= 0) {
    const last = e.observableUntil;
    return {
      cls: 'bad',
      text: `Le maximum a lieu sous l'horizon. Visible seulement jusqu'à ${fmtTime(last)}.`,
    };
  }
  if (c.sun.altApparent < 6) {
    return {
      cls: 'warn',
      text: `${pct} % du Soleil couvert, mais à seulement ${c.sun.altApparent.toFixed(1)}° ` +
        `de hauteur vers le ${dir} (${c.sun.az.toFixed(0)}°) : il faut un horizon totalement dégagé.`,
    };
  }
  if (c.sun.altApparent < 15) {
    return {
      cls: 'warn',
      text: `${pct} % du Soleil couvert, à ${c.sun.altApparent.toFixed(1)}° de hauteur ` +
        `vers le ${dir} (${c.sun.az.toFixed(0)}°). Vérifie les obstacles bas.`,
    };
  }
  return {
    cls: 'ok',
    text: `${pct} % du Soleil couvert, à ${c.sun.altApparent.toFixed(0)}° de hauteur vers le ${dir}.`,
  };
}

function renderStaticUI() {
  const v = verdictFor();
  const el = $('verdict');
  el.textContent = v.text;
  el.className = 'verdict ' + v.cls;

  // reperes de la timeline
  const marks = $('tlMarks');
  marks.innerHTML = '';
  const span = state.windowEnd - state.windowStart;
  for (const kp of state.keyPoints) {
    const frac = (kp.t.getTime() - state.windowStart) / span;
    if (frac < -0.02 || frac > 1.02) continue;
    const s = document.createElement('span');
    s.className = 'key';
    s.style.left = `${Math.max(3, Math.min(97, frac * 100))}%`;
    s.textContent = fmtTime(kp.t);
    s.title = kp.label;
    marks.appendChild(s);
  }

  renderDetails();
  renderIntroSummary();
}

function renderDetails() {
  const e = state.eclipse;
  const box = $('details');
  if (!e) { box.innerHTML = '<p class="note">Pas d\'éclipse ce jour-là à cet endroit.</p>'; return; }
  const c = e.maxCircumstances;
  const rows = [
    ['Type', e.type],
    ['Premier contact', fmtTimeS(e.c1)],
    e.c2 && ['Début totalité', fmtTimeS(e.c2)],
    ['Maximum', fmtTimeS(e.max)],
    e.c3 && ['Fin totalité', fmtTimeS(e.c3)],
    ['Dernier contact', fmtTimeS(e.c4)],
    e.horizonCrossing && [crossingLabel(e), fmtTimeS(e.horizonCrossing)],
    ['Obscuration max', `${(c.obscuration * 100).toFixed(1)} %`],
    ['Magnitude max', c.magnitude.toFixed(3)],
    ['Hauteur au max', `${c.sun.altApparent.toFixed(2)}°`],
    ['Azimut au max', `${c.sun.az.toFixed(2)}° (${compass(c.sun.az)})`],
  ].filter(Boolean);
  box.innerHTML = '<dl>' + rows
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + '</dl>';
}

function renderIntroSummary() {
  const e = state.eclipse;
  const box = $('introSummary');
  if (!e) { box.hidden = true; return; }
  const c = e.maxCircumstances;
  const v = verdictFor();
  box.hidden = false;
  box.innerHTML =
    `<h4>Éclipse ${e.type} du ${localMidnight(state.dateStr).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long', year: 'numeric' })}</h4>` +
    '<dl>' +
    `<dt>Début</dt><dd>${fmtTime(e.c1)}</dd>` +
    `<dt>Maximum</dt><dd>${fmtTime(e.max)} — ${(c.obscuration * 100).toFixed(0)} % couvert</dd>` +
    (e.horizonCrossing ? `<dt>${crossingLabel(e)}</dt><dd>${fmtTime(e.horizonCrossing)}</dd>` : '') +
    `<dt>Direction</dt><dd>${compass(c.sun.az)} — ${c.sun.az.toFixed(0)}°, hauteur ${c.sun.altApparent.toFixed(1)}°</dd>` +
    '</dl>' +
    `<p class="flag ${v.cls === 'ok' ? '' : 'warn'}">${v.text}</p>`;
}

function updateHud() {
  const c = state.current;
  if (!c) return;
  $('hudTime').textContent = fmtTime(state.time);
  $('hudObsc').textContent = `${(c.obscuration * 100).toFixed(0)} %`;
  $('hudAlt').textContent = `${c.sun.altApparent.toFixed(1)}°`;
  $('hudAz').textContent = `${c.sun.az.toFixed(0)}° ${compass(c.sun.az)}`;
  $('btnLive').classList.toggle('on', state.live);
}

let toastTimer = null;
function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

/* ------------------------------------------------------------ rendu */

function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}

function view() {
  return { width: canvas.width, height: canvas.height, fovH: state.fovH };
}

function drawFrame() {
  if (!canvas.clientWidth) return;
  if (canvas.width !== Math.round(canvas.clientWidth * dpr)
    || canvas.height !== Math.round(canvas.clientHeight * dpr)) {
    resizeCanvas();
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (state.mode === 'map') drawMap();
  else drawAR();
  drawPhaseInset();
}

/* --- vue realite augmentee --- */

function drawAR() {
  const R = sensor.matrix();
  const w = canvas.width, h = canvas.height;

  if (!R) {
    ctx.fillStyle = '#000a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2f4f8';
    ctx.textAlign = 'center';
    ctx.font = `${14 * dpr}px sans-serif`;
    ctx.fillText("Capteurs d'orientation indisponibles.", w / 2, h / 2 - 10 * dpr);
    ctx.fillText('Bascule en vue carte.', w / 2, h / 2 + 12 * dpr);
    return;
  }

  const v = view();
  const p = (az, alt) => project(vectorFromAzAlt(az, alt), R, sensor.screenAngle, v);
  const onScreen = (q, margin = 0.5) => q.inFront
    && q.x > -margin * w && q.x < (1 + margin) * w
    && q.y > -margin * h && q.y < (1 + margin) * h;

  // --- lignes d'altitude
  ctx.lineWidth = 1 * dpr;
  for (const alt of [0, 10, 20, 30, 45, 60]) {
    ctx.beginPath();
    ctx.strokeStyle = alt === 0 ? '#ffffffcc' : '#ffffff33';
    let started = false;
    for (let az = 0; az <= 360; az += 2) {
      const q = p(az, alt);
      if (!q.inFront) { started = false; continue; }
      if (!started) { ctx.moveTo(q.x, q.y); started = true; }
      else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
  }

  // --- graduations d'azimut
  ctx.font = `${11 * dpr}px sans-serif`;
  ctx.textAlign = 'center';
  for (let az = 0; az < 360; az += 15) {
    const q = p(az, 0);
    if (!onScreen(q, 0.1)) continue;
    const major = az % 45 === 0;
    ctx.strokeStyle = '#ffffff88';
    ctx.beginPath();
    ctx.moveTo(q.x, q.y - (major ? 9 : 5) * dpr);
    ctx.lineTo(q.x, q.y + (major ? 9 : 5) * dpr);
    ctx.stroke();
    if (major) {
      ctx.fillStyle = '#ffffffdd';
      ctx.fillText(compass(az), q.x, q.y + 24 * dpr);
    }
  }

  // --- trajectoire du Soleil
  if (state.track.length) {
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = '#ffc94dcc';
    ctx.beginPath();
    let started = false;
    for (const s of state.track) {
      const q = p(s.az, s.alt);
      if (!q.inFront) { started = false; continue; }
      if (!started) { ctx.moveTo(q.x, q.y); started = true; }
      else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();

    // repères horaires
    ctx.font = `${10 * dpr}px sans-serif`;
    for (const kp of state.keyPoints) {
      const c = circumstances(kp.t, state.site);
      const q = p(c.sun.az, c.sun.altApparent);
      if (!onScreen(q, 0.05)) continue;
      ctx.fillStyle = '#ffc94d';
      ctx.beginPath();
      ctx.arc(q.x, q.y, 3.5 * dpr, 0, 2 * Math.PI);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffffee';
      ctx.fillText(`${fmtTime(kp.t)} ${kp.label}`, q.x + 7 * dpr, q.y - 6 * dpr);
    }
  }

  // --- position courante du Soleil
  const c = state.current;
  if (c) {
    const q = p(c.sun.az, c.sun.altApparent);
    const up = p(c.sun.az, c.sun.altApparent + 1);
    if (q.inFront) {
      const rot = Math.atan2(up.x - q.x, -(up.y - q.y)); // rotation du zenith a l'ecran
      drawSunReticle(q.x, q.y, 30 * dpr, rot, c);
    } else {
      drawOffscreenArrow(c.sun.az, c.sun.altApparent, R);
    }
  }

  // --- viseur central
  ctx.strokeStyle = '#ffffff55';
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 10 * dpr, h / 2); ctx.lineTo(w / 2 + 10 * dpr, h / 2);
  ctx.moveTo(w / 2, h / 2 - 10 * dpr); ctx.lineTo(w / 2, h / 2 + 10 * dpr);
  ctx.stroke();
}

/** Cercle repere + phase agrandie a l'interieur, orientee comme le ciel. */
function drawSunReticle(x, y, r, rot, c) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);

  ctx.beginPath();
  ctx.arc(0, 0, r * 1.5, 0, 2 * Math.PI);
  ctx.strokeStyle = '#ffc94d';
  ctx.lineWidth = 2 * dpr;
  ctx.setLineDash([5 * dpr, 5 * dpr]);
  ctx.stroke();
  ctx.setLineDash([]);

  drawEclipsedDisc(ctx, 0, 0, r, c, 12 * dpr);
  ctx.restore();
}

/**
 * Dessine le disque solaire et l'ombre lunaire a l'echelle relative reelle,
 * agrandis pour etre lisibles (les disques ne font que ~0,5° dans le ciel).
 * Le contexte est passe explicitement : la meme routine sert a l'incrustation
 * de phase, qui a son propre canvas.
 */
function drawEclipsedDisc(g, x, y, rPix, c, blur) {
  const scale = rPix / c.sun.radius;
  // decalage Lune - Soleil dans le plan du ciel (azimut vers la droite,
  // hauteur vers le haut, vu par un observateur tourne vers le Soleil)
  let dAz = c.moon.az - c.sun.az;
  while (dAz > 180) dAz -= 360;
  while (dAz < -180) dAz += 360;
  const dx = dAz * Math.cos(c.sun.alt * Math.PI / 180) * scale;
  const dy = -(c.moon.alt - c.sun.alt) * scale;

  g.save();
  g.beginPath();
  g.arc(x, y, rPix, 0, 2 * Math.PI);
  g.fillStyle = '#ffd764';
  g.shadowColor = '#ffc94d';
  g.shadowBlur = blur;
  g.fill();
  g.shadowBlur = 0;

  // la Lune : disque opaque decoupe dans le Soleil
  g.beginPath();
  g.arc(x + dx, y + dy, rPix * (c.moon.radius / c.sun.radius), 0, 2 * Math.PI);
  g.fillStyle = '#12151f';
  g.fill();
  g.restore();
}

function drawOffscreenArrow(az, alt, R) {
  const cam = azAltFromVector(cameraAxis(R));
  let dAz = az - cam.az;
  while (dAz > 180) dAz -= 360;
  while (dAz < -180) dAz += 360;
  const dAlt = alt - cam.alt;

  const w = canvas.width, h = canvas.height;
  const ang = Math.atan2(dAz, dAlt);
  const rad = Math.min(w, h) * 0.32;
  const x = w / 2 + Math.sin(ang) * rad;
  const y = h / 2 - Math.cos(ang) * rad;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, -16 * dpr);
  ctx.lineTo(11 * dpr, 10 * dpr);
  ctx.lineTo(0, 4 * dpr);
  ctx.lineTo(-11 * dpr, 10 * dpr);
  ctx.closePath();
  ctx.fillStyle = '#ffc94d';
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#ffffffdd';
  ctx.font = `${12 * dpr}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('Soleil par ici', x, y + 30 * dpr);
}

/* --- vue carte (sans capteurs) --- */

function drawMap() {
  const w = canvas.width, h = canvas.height;
  const pad = { l: 44 * dpr, r: 16 * dpr, t: 90 * dpr, b: 150 * dpr };

  if (!state.track.length) return;
  const azs = state.track.map((s) => s.azU);
  const azMin = Math.min(...azs) - 8, azMax = Math.max(...azs) + 8;
  const altMax = Math.max(12, Math.max(...state.track.map((s) => s.alt)) + 4);
  const altMin = Math.min(-4, Math.min(...state.track.map((s) => s.alt)) - 2);

  // ramene un azimut brut dans la plage tracee (course pouvant croiser le nord)
  const azRef = (azMin + azMax) / 2;
  const unwrap = (az) => azRef + wrap180(az - azRef);

  const X = (az) => pad.l + ((az - azMin) / (azMax - azMin)) * (w - pad.l - pad.r);
  const Y = (alt) => h - pad.b - ((alt - altMin) / (altMax - altMin)) * (h - pad.t - pad.b);

  ctx.fillStyle = '#0b0d14';
  ctx.fillRect(0, 0, w, h);

  // sol
  ctx.fillStyle = '#1a2030';
  ctx.fillRect(pad.l, Y(0), w - pad.l - pad.r, h - pad.b - Y(0));
  ctx.strokeStyle = '#ffffffcc';
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.moveTo(pad.l, Y(0)); ctx.lineTo(w - pad.r, Y(0)); ctx.stroke();

  ctx.font = `${11 * dpr}px sans-serif`;
  ctx.fillStyle = '#9aa3b5';
  ctx.textAlign = 'right';
  for (let alt = Math.ceil(altMin / 5) * 5; alt <= altMax; alt += 5) {
    const y = Y(alt);
    ctx.strokeStyle = alt === 0 ? '#ffffff00' : '#ffffff1a';
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(`${alt}°`, pad.l - 6 * dpr, y + 4 * dpr);
  }
  ctx.textAlign = 'center';
  for (let az = Math.ceil(azMin / 5) * 5; az <= azMax; az += 5) {
    const x = X(az);
    ctx.strokeStyle = '#ffffff14';
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
    if (az % 10 === 0) {
      ctx.fillStyle = '#9aa3b5';
      ctx.fillText(`${((az % 360) + 360) % 360}°`, x, h - pad.b + 16 * dpr);
      ctx.fillStyle = '#78829a';
      ctx.fillText(compass(az), x, h - pad.b + 30 * dpr);
    }
  }

  // trajectoire
  ctx.strokeStyle = '#ffc94d';
  ctx.lineWidth = 3 * dpr;
  ctx.beginPath();
  state.track.forEach((s, i) => {
    const x = X(s.azU), y = Y(s.alt);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // reperes
  ctx.font = `${10 * dpr}px sans-serif`;
  for (const kp of state.keyPoints) {
    const c = circumstances(kp.t, state.site);
    const x = X(unwrap(c.sun.az)), y = Y(c.sun.altApparent);
    ctx.fillStyle = '#ffc94d';
    ctx.beginPath(); ctx.arc(x, y, 3.5 * dpr, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = '#ffffffdd';
    ctx.textAlign = 'left';
    ctx.fillText(`${fmtTime(kp.t)} ${kp.label}`, x + 6 * dpr, y - 5 * dpr);
  }

  // position courante
  const c = state.current;
  if (c) drawEclipsedDisc(ctx, X(unwrap(c.sun.az)), Y(c.sun.altApparent), 13 * dpr, c, 12 * dpr);

  // direction visee par la camera, si les capteurs repondent
  const R = sensor.matrix();
  if (R) {
    const camAz = unwrap(azAltFromVector(cameraAxis(R)).az);
    if (camAz > azMin && camAz < azMax) {
      ctx.strokeStyle = '#57d38c';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(X(camAz), pad.t); ctx.lineTo(X(camAz), h - pad.b);
      ctx.stroke();
      ctx.fillStyle = '#57d38c';
      ctx.textAlign = 'center';
      ctx.fillText('visée', X(camAz), pad.t - 4 * dpr);
    }
  }
}

/* --- vignette de phase --- */

function drawPhaseInset() {
  const el = $('phase');
  if (!el || state.mode === 'map') return;
  const g = el.getContext('2d');
  const s = el.width;
  g.clearRect(0, 0, s, s);
  const c = state.current;
  if (!c) return;

  drawEclipsedDisc(g, s / 2, s / 2, s * 0.3, c, 10);

  g.fillStyle = '#ffffffcc';
  g.font = '13px sans-serif';
  g.textAlign = 'center';
  g.fillText(`${(c.obscuration * 100).toFixed(0)} %`, s / 2, s - 12);
}

/* ------------------------------------------------------ boucle & live */

let frameErrorLogged = false;

function tick() {
  // Une exception isolee ne doit pas figer definitivement l'affichage : sur un
  // toit, une app gelee est inutilisable et on ne peut pas la deboguer.
  try {
    if (state.live) {
      const now = new Date();
      state.time = now;
      state.current = circumstances(now, state.site);
      const span = state.windowEnd - state.windowStart;
      $('tlRange').value = String(Math.round(
        Math.max(0, Math.min(1, (now.getTime() - state.windowStart) / span)) * 1000,
      ));
      updateHud();
    }
    drawFrame();
  } catch (err) {
    if (!frameErrorLogged) {
      frameErrorLogged = true;
      console.error('Erreur de rendu :', err);
      toast('Un problème est survenu à l’affichage.', true);
    }
  }
  requestAnimationFrame(tick);
}

let playTimer = null;
function togglePlay() {
  if (playTimer) {
    clearInterval(playTimer); playTimer = null;
    $('btnPlay').textContent = '▶ Rejouer';
    return;
  }
  state.live = false;
  setTime(new Date(state.windowStart));
  $('btnPlay').textContent = '⏸ Pause';
  playTimer = setInterval(() => {
    const next = state.time.getTime() + (state.windowEnd - state.windowStart) / 200;
    if (next > state.windowEnd) { togglePlay(); return; }
    setTime(new Date(next));
  }, 60);
}

/* ------------------------------------------------------------ demarrage */

async function enterAR() {
  $('intro').hidden = true;
  $('stage').hidden = false;
  resizeCanvas();

  let sensorOk = false;
  try {
    await sensor.start();
    sensorOk = true;
  } catch (err) {
    toast(err.message, true);
  }

  try {
    stream = await startCamera($('cam'));
  } catch (err) {
    toast(`Caméra indisponible : ${err.message}`, true);
    setMode('map');
  }

  if (!sensorOk) setMode('map');
  else if (!state.calibrated) $('calibNote').hidden = false;
}

function enterMapOnly() {
  $('intro').hidden = true;
  $('stage').hidden = false;
  resizeCanvas();
  setMode('map');
  // les capteurs restent utiles pour la ligne de visee, sans etre obligatoires
  sensor.start().catch(() => { });
}

function setMode(mode) {
  state.mode = mode;
  $('stage').classList.toggle('map-mode', mode === 'map');
  $('btnMode').textContent = mode === 'map' ? 'Vue caméra' : 'Vue carte';
  if (mode === 'map') $('calibNote').hidden = true;
}

/* --------------------------------------------------------------- events */

function wire() {
  $('btnStart').addEventListener('click', enterAR);
  $('btnMapOnly').addEventListener('click', enterMapOnly);

  $('btnSettings').addEventListener('click', () => { $('panel').hidden = false; });
  $('btnClosePanel').addEventListener('click', () => { $('panel').hidden = true; });

  $('tlRange').addEventListener('input', (e) => {
    state.live = false;
    const frac = Number(e.target.value) / 1000;
    setTime(new Date(state.windowStart + frac * (state.windowEnd - state.windowStart)));
  });

  $('btnLive').addEventListener('click', () => {
    state.live = !state.live;
    if (state.live) setTime(new Date());
    updateHud();
  });
  $('btnMax').addEventListener('click', () => {
    state.live = false;
    if (state.eclipse) setTime(state.eclipse.max);
  });
  $('btnPlay').addEventListener('click', togglePlay);
  $('btnMode').addEventListener('click', () => setMode(state.mode === 'ar' ? 'map' : 'ar'));

  const calibrate = () => {
    if (!state.current) return;
    if (sensor.calibrateOn(state.current.sun.az)) {
      state.calibrated = true;
      $('calibNote').hidden = true;
      $('inOffset').value = String(shortOffset(sensor.headingOffset));
      $('outOffset').textContent = `${shortOffset(sensor.headingOffset).toFixed(1)}°`;
      save();
      toast('Boussole calée sur le Soleil.');
    } else {
      toast("Capteurs indisponibles : impossible de caler.", true);
    }
  };
  $('btnCalibInline').addEventListener('click', calibrate);
  $('btnCalibSun').addEventListener('click', calibrate);
  $('btnCalibReset').addEventListener('click', () => {
    sensor.resetCalibration();
    state.calibrated = false;
    $('inOffset').value = '0';
    $('outOffset').textContent = '0°';
    save();
  });

  $('inOffset').addEventListener('input', (e) => {
    sensor.headingOffset = Number(e.target.value);
    state.calibrated = true;
    $('outOffset').textContent = `${Number(e.target.value).toFixed(1)}°`;
    save();
  });
  $('inFov').addEventListener('input', (e) => {
    state.fovH = Number(e.target.value);
    $('outFov').textContent = `${state.fovH}°`;
    save();
  });

  const onSite = () => {
    const lat = Number($('inLat').value), lon = Number($('inLon').value);
    const elev = Number($('inElev').value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      toast('Coordonnées hors bornes.', true); return;
    }
    state.site = { lat, lon, elevation: Number.isFinite(elev) ? elev : 0 };
    state.dateStr = $('inDate').value || DEFAULT_DATE;
    save();
    recompute();
  };
  for (const id of ['inLat', 'inLon', 'inElev', 'inDate']) {
    $(id).addEventListener('change', onSite);
  }

  $('btnGeo').addEventListener('click', () => {
    if (!navigator.geolocation) { toast('Géolocalisation indisponible.', true); return; }
    $('geoNote').textContent = 'Localisation en cours…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.site = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          elevation: Number.isFinite(pos.coords.altitude) ? pos.coords.altitude : 0,
        };
        syncInputs();
        save();
        recompute();
        $('geoNote').textContent =
          `Position obtenue (±${Math.round(pos.coords.accuracy)} m).`;
      },
      (err) => { $('geoNote').textContent = `Échec : ${err.message}`; },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });

  window.addEventListener('resize', resizeCanvas);
}

const shortOffset = (o) => { const x = ((o + 180) % 360 + 360) % 360 - 180; return x; };

function syncInputs() {
  $('inLat').value = state.site.lat.toFixed(4);
  $('inLon').value = state.site.lon.toFixed(4);
  $('inElev').value = Math.round(state.site.elevation || 0);
  $('inDate').value = state.dateStr;
  $('inFov').value = String(state.fovH);
  $('outFov').textContent = `${state.fovH}°`;
  $('inOffset').value = String(shortOffset(sensor.headingOffset));
  $('outOffset').textContent = `${shortOffset(sensor.headingOffset).toFixed(1)}°`;
}

/* ----------------------------------------------------------------- init */

canvas = $('overlay');
ctx = canvas.getContext('2d');
load();
wire();
syncInputs();
recompute();
resizeCanvas();
requestAnimationFrame(tick);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  });
}
