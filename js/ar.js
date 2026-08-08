/**
 * ar.js — orientation du telephone et projection du ciel sur l'ecran.
 *
 * Reperes utilises :
 *   - monde  : ENU, x = Est, y = Nord, z = Zenith (repere de la spec
 *              DeviceOrientation)
 *   - appareil : x = bord droit, y = bord haut, z = sort de l'ecran vers
 *              l'utilisateur. La camera arriere regarde donc selon -z.
 *   - ecran  : obtenu depuis le repere appareil par une rotation d'angle
 *              screen.orientation.angle autour de z.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/**
 * Matrice de rotation appareil -> monde, a partir des angles de la spec
 * (rotation intrinseque Z-X'-Y'').
 */
export function deviceToWorld(alpha, beta, gamma) {
  const a = alpha * DEG, b = beta * DEG, g = gamma * DEG;
  const cA = Math.cos(a), sA = Math.sin(a);
  const cB = Math.cos(b), sB = Math.sin(b);
  const cG = Math.cos(g), sG = Math.sin(g);
  return [
    [cA * cG - sA * sB * sG, -cB * sA, cA * sG + cG * sA * sB],
    [cG * sA + cA * sB * sG, cA * cB, sA * sG - cA * cG * sB],
    [-cB * sG, sB, cB * cG],
  ];
}

/** Applique la transposee de R (monde -> appareil). */
function applyTranspose(R, v) {
  return {
    x: R[0][0] * v.x + R[1][0] * v.y + R[2][0] * v.z,
    y: R[0][1] * v.x + R[1][1] * v.y + R[2][1] * v.z,
    z: R[0][2] * v.x + R[1][2] * v.y + R[2][2] * v.z,
  };
}

/** Direction unitaire dans le repere monde depuis azimut/hauteur (degres). */
export function vectorFromAzAlt(az, alt) {
  const ca = Math.cos(alt * DEG);
  return {
    x: ca * Math.sin(az * DEG), // Est
    y: ca * Math.cos(az * DEG), // Nord
    z: Math.sin(alt * DEG),     // Zenith
  };
}

/** Inverse : azimut/hauteur depuis une direction du repere monde. */
export function azAltFromVector(v) {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  const az = (Math.atan2(v.x / n, v.y / n) * RAD + 360) % 360;
  const alt = Math.asin(Math.max(-1, Math.min(1, v.z / n))) * RAD;
  return { az, alt };
}

/**
 * Projette une direction du ciel sur l'ecran.
 * Modele stenope : f = (largeur/2) / tan(champ horizontal / 2).
 *
 * @returns {{x:number, y:number, inFront:boolean, offAxisDeg:number}}
 */
export function project(worldVec, R, screenAngleDeg, view) {
  const d = applyTranspose(R, worldVec);

  // repere appareil -> repere ecran : rotation de +angle autour de z
  const t = screenAngleDeg * DEG;
  const ct = Math.cos(t), st = Math.sin(t);
  const sx = ct * d.x - st * d.y;
  const sy = st * d.x + ct * d.y;
  const sz = d.z;

  // la camera arriere regarde selon -z : la cible est devant si sz < 0
  const inFront = sz < 0;
  const depth = Math.abs(sz) < 1e-9 ? 1e-9 : -sz;

  const f = (view.width / 2) / Math.tan((view.fovH * DEG) / 2);
  const px = view.width / 2 + (f * sx) / depth;
  const py = view.height / 2 - (f * sy) / depth;

  const offAxisDeg = Math.acos(Math.max(-1, Math.min(1, -sz))) * RAD;
  return { x: px, y: py, inFront, offAxisDeg };
}

/** Direction visee par la camera arriere, dans le repere monde. */
export function cameraAxis(R) {
  // -z de l'appareil exprime dans le monde = -(3e colonne de R)
  return { x: -R[0][2], y: -R[1][2], z: -R[2][2] };
}

/* ------------------------------------------------------- capteurs */

export class OrientationSensor extends EventTarget {
  constructor() {
    super();
    this.alpha = null;
    this.beta = null;
    this.gamma = null;
    this.absolute = false;
    this.usesTrueNorth = false; // iOS : webkitCompassHeading est deja vrai nord
    this.accuracy = null;
    this.screenAngle = 0;
    this.headingOffset = 0;     // calage manuel, en degres
    this.available = false;
    this._handler = this._onOrientation.bind(this);
    this._screenHandler = this._onScreenChange.bind(this);
    this._eventName = null;
  }

  static get needsPermission() {
    return typeof DeviceOrientationEvent !== 'undefined'
      && typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  /** Doit etre appelee depuis un geste utilisateur (exigence iOS). */
  async start() {
    if (typeof DeviceOrientationEvent === 'undefined') {
      throw new Error("Ce navigateur n'expose pas les capteurs d'orientation.");
    }
    if (OrientationSensor.needsPermission) {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') {
        throw new Error("Acces aux capteurs de mouvement refuse.");
      }
    }
    // 'deviceorientationabsolute' donne un cap reference au nord sur Android.
    this._eventName = 'ondeviceorientationabsolute' in window
      ? 'deviceorientationabsolute'
      : 'deviceorientation';
    window.addEventListener(this._eventName, this._handler, true);
    this._onScreenChange();
    window.addEventListener('orientationchange', this._screenHandler);
    if (screen.orientation) {
      screen.orientation.addEventListener('change', this._screenHandler);
    }
  }

  stop() {
    if (this._eventName) {
      window.removeEventListener(this._eventName, this._handler, true);
    }
    window.removeEventListener('orientationchange', this._screenHandler);
    if (screen.orientation) {
      screen.orientation.removeEventListener('change', this._screenHandler);
    }
  }

  _onScreenChange() {
    this.screenAngle = (screen.orientation && typeof screen.orientation.angle === 'number')
      ? screen.orientation.angle
      : (window.orientation || 0);
  }

  _onOrientation(ev) {
    if (ev.alpha === null && ev.webkitCompassHeading === undefined) return;

    if (typeof ev.webkitCompassHeading === 'number' && !Number.isNaN(ev.webkitCompassHeading)) {
      // iOS : cap magnetique deja corrige de la declinaison -> nord vrai.
      // alpha croit dans le sens antihoraire, le cap dans le sens horaire.
      this.alpha = (360 - ev.webkitCompassHeading) % 360;
      this.usesTrueNorth = true;
      this.absolute = true;
      this.accuracy = ev.webkitCompassAccuracy;
    } else {
      this.alpha = ev.alpha;
      this.absolute = ev.absolute === true || this._eventName === 'deviceorientationabsolute';
    }
    this.beta = ev.beta;
    this.gamma = ev.gamma;
    this.available = this.alpha !== null && this.beta !== null && this.gamma !== null;
    this.dispatchEvent(new Event('update'));
  }

  /** Matrice appareil -> monde, calage manuel inclus. */
  matrix() {
    if (!this.available) return null;
    return deviceToWorld(this.alpha + this.headingOffset, this.beta, this.gamma);
  }

  /**
   * Cale la boussole : l'utilisateur vise un astre dont on connait l'azimut
   * reel et dont il place l'image au centre de l'ecran.
   * Corrige d'un coup la declinaison magnetique et le biais du magnetometre.
   */
  calibrateOn(trueAzimuth) {
    const R = this.matrix();
    if (!R) return false;
    const seen = azAltFromVector(cameraAxis(R));
    let delta = trueAzimuth - seen.az;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    // alpha croit dans le sens antihoraire : un azimut a augmenter demande de
    // diminuer alpha.
    this.headingOffset = ((this.headingOffset - delta) % 360 + 360) % 360;
    return true;
  }

  resetCalibration() { this.headingOffset = 0; }
}

/* --------------------------------------------------------- camera */

export async function startCamera(videoEl) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("La camera n'est pas accessible (HTTPS requis).");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

export function stopCamera(stream) {
  if (stream) for (const track of stream.getTracks()) track.stop();
}
