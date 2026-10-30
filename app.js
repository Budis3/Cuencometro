const CUENCA_LAT = 40.07833;
const CUENCA_LON = -2.12889;

let userLat = null;
let userLon = null;
let bearingToCuenca = 0;
let distanceKm = 0;

let currentHeading = 0;
let currentMode = 'compass'; // 'compass' o 'ar'
let reticleMode = 'casas';

const TOLERANCE_DEG = 12;
const PX_PER_DEG = 4;
let wasAlignedLastFrame = false;

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let precisionState = 'low';
let appIniciada = false;
let precisionFinalizada = false;
let transitionToMainTimeout = null;

const headingHistory = [];
const HISTORY_SIZE = 12;
let totalSamples = 0;

// Elementos DOM
const appContainer = document.getElementById('app-container');
const permissionModal = document.getElementById('permission-modal');
const calibrationModal = document.getElementById('calibration-modal');
const arOrientationModal = document.getElementById('ar-orientation-modal');
const calibrationInstructions = document.getElementById('calibration-instructions');
const accuracyStatusTag = document.getElementById('accuracy-status-tag');
const startBtn = document.getElementById('start-btn');
const video = document.getElementById('camera-video');
const compassMode = document.getElementById('compass-mode');
const arMode = document.getElementById('ar-mode');
const compassDial = document.getElementById('compass-dial');
const cuencaNeedle = document.getElementById('cuenca-needle');
const needleHead = document.getElementById('needle-head');
const fixedTriangle = document.getElementById('fixed-triangle');
const bannerStatusText = document.getElementById('banner-status-text');
const distanceLabel = document.getElementById('distance-label');
const reticleToggleWrapper = document.getElementById('reticle-toggle-wrapper');
const toggleReticleBtn = document.getElementById('toggle-reticle-btn');
const reticleIcon = document.getElementById('reticle-icon');
const circleReticle = document.getElementById('circle-reticle');
const casasReticle = document.getElementById('casas-reticle');
const arCompassTrack = document.getElementById('ar-compass-track');
const arCuencaTargetPin = document.getElementById('ar-cuenca-target-pin');
const arGuidanceText = document.getElementById('ar-guidance-text');
const debugHeading = document.getElementById('debug-heading');
const debugCuenca = document.getElementById('debug-cuenca');
const debugDiff = document.getElementById('debug-diff');

// Control centralizado de visibilidad (Oculta la brújula si hay modales activos)
function actualizarVisibilidadApp() {
  const modalInicioVisible = permissionModal.style.display !== 'none';
  const modalCalibracionVisible = calibrationModal.style.display !== 'none';
  const modalOrientacionVisible = arOrientationModal.style.display !== 'none';

  if (!appIniciada || modalInicioVisible || modalCalibracionVisible || modalOrientacionVisible) {
    appContainer.classList.add('app-hidden');
  } else {
    appContainer.classList.remove('app-hidden');
  }
}

// Pantalla completa
function requestAppFullscreen() {
  const docEl = document.documentElement;
  if (docEl.requestFullscreen) docEl.requestFullscreen().catch(() => {});
  else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen().catch(() => {});
  else if (docEl.msRequestFullscreen) docEl.msRequestFullscreen().catch(() => {});
}

// Instrucciones según plataforma
function setupInstructionsText() {
  if (isIOS) {
    calibrationInstructions.innerHTML = `
      <p>La brújula de tu <strong>iPhone</strong> detecta interferencias magnéticas.</p>
      <ol class="calibration-steps">
        <li>Mueve el iPhone dibujando un <strong>«8» amplio en el aire</strong>.</li>
        <li>Aléjate de fundas con imanes o superficies metálicas.</li>
      </ol>
    `;
  } else {
    calibrationInstructions.innerHTML = `
      <p>El sensor magnético requiere calibración.</p>
      <ol class="calibration-steps">
        <li>Traza un <strong>«8» amplio en el aire</strong> girando la muñeca sobre los 3 ejes.</li>
        <li>Aléjate de ordenadores o imanes.</li>
      </ol>
    `;
  }
}
setupInstructionsText();

// Evaluación de precisión magnética
function evaluarPrecisionReal(event, rawHeading) {
  totalSamples++;
  let isAccurate = false;

  if (isIOS) {
    const acc = event.webkitCompassAccuracy;
    if (typeof acc !== 'undefined' && acc !== null && acc >= 0 && acc <= 20) {
      isAccurate = true;
    }
  } else {
    if (event.absolute === true && rawHeading !== null) {
      headingHistory.push(rawHeading);
      if (headingHistory.length > HISTORY_SIZE) headingHistory.shift();

      if (headingHistory.length >= HISTORY_SIZE && totalSamples > 20) {
        let maxDiff = 0;
        for (let i = 1; i < headingHistory.length; i++) {
          let d = Math.abs(headingHistory[i] - headingHistory[i - 1]);
          if (d > 180) d = 360 - d;
          if (d > maxDiff) maxDiff = d;
        }
        if (maxDiff < 25) isAccurate = true;
      }
    }
  }

  precisionState = isAccurate ? 'high' : 'low';

  if (appIniciada && !precisionFinalizada) {
    if (precisionState === 'low') {
      if (transitionToMainTimeout) {
        clearTimeout(transitionToMainTimeout);
        transitionToMainTimeout = null;
      }
      accuracyStatusTag.textContent = "Precisión: Baja";
      accuracyStatusTag.className = "accuracy-low";
      calibrationModal.style.display = "flex";
      actualizarVisibilidadApp();
    } else if (precisionState === 'high') {
      if (calibrationModal.style.display !== "none") {
        accuracyStatusTag.textContent = "Precisión: Alta";
        accuracyStatusTag.className = "accuracy-high";

        if (!transitionToMainTimeout) {
          transitionToMainTimeout = setTimeout(() => {
            calibrationModal.style.display = "none";
            precisionFinalizada = true;
            transitionToMainTimeout = null;
            actualizarVisibilidadApp();
          }, 2000);
        }
      } else {
        precisionFinalizada = true;
        actualizarVisibilidadApp();
      }
    }
  }
}

// Discriminación con umbral de 20º: Plano (Brújula) vs Levantado (AR)
function evaluarPosturaYModo(beta, gamma) {
  const absB = Math.abs(beta || 0);
  const absG = Math.abs(gamma || 0);

  // 1. REGLA PLANO: Solo brújula si ambos ejes están casi paralelos al suelo (umbral 20°)
  const esPlano = (absB < 20) && (absG < 20);

  if (esPlano) {
    if (currentMode !== 'compass') {
      currentMode = 'compass';
      compassMode.style.display = "flex";
      arMode.style.display = "none";
      video.style.display = "none";
      reticleToggleWrapper.style.display = "none";
    }
    // En el plano de la mano NUNCA se activa el aviso
    arOrientationModal.style.display = "none";

  } else {
    // 2. MODO AR: En cualquier otra postura fuera del plano
    if (currentMode !== 'ar') {
      currentMode = 'ar';
      compassMode.style.display = "none";
      arMode.style.display = "flex";
      video.style.display = "block";
      reticleToggleWrapper.style.display = "flex";
    }

    // 3. REGLA APAISADO EN MODO AR:
    // Si en el aire el teléfono se gira de lado (absG > 45) o la ventana está apaisada
    const estaDeLado = absG > 45;
    const pantallaApaisada = window.innerWidth > window.innerHeight;

    if (estaDeLado || pantallaApaisada) {
      arOrientationModal.style.display = "flex";
    } else {
      arOrientationModal.style.display = "none";
    }
  }

  actualizarVisibilidadApp();
}

// Lectura de orientación general
function handleOrientation(e) {
  let rawHeading = null;
  if (typeof e.webkitCompassHeading !== "undefined" && e.webkitCompassHeading !== null) {
    rawHeading = e.webkitCompassHeading;
  } else if (e.alpha !== null) {
    rawHeading = (360 - e.alpha) % 360;
  }

  evaluarPrecisionReal(e, rawHeading);
  if (rawHeading !== null) {
    currentHeading = rawHeading;
  }

  const beta = e.beta || 0;
  const gamma = e.gamma || 0;
  evaluarPosturaYModo(beta, gamma);

  actualizarVista();
}

// Construcción de la cinta métrica AR
function buildCompassTrack() {
  const cardinalMap = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };
  let html = '';
  for (let cycle = -1; cycle <= 2; cycle++) {
    for (let deg = 0; deg < 360; deg += 15) {
      const absDeg = (deg + 360) % 360;
      const isMajor = deg % 45 === 0;
      const label = cardinalMap[absDeg] || `${absDeg}°`;
      html += `
        <div class="ar-compass-tick ${isMajor ? 'major' : ''}">
          <div class="tick-line"></div>
          ${isMajor ? `<span class="tick-label">${label}</span>` : ''}
        </div>
      `;
    }
  }
  arCompassTrack.innerHTML = html;
}
buildCompassTrack();

// Rumbo geográfico
function calculateBearing(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Distancia en línea recta (Haversine)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Inicialización de la cámara trasera
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    video.srcObject = stream;
    video.play();
  } catch (err) {
    console.warn("Cámara trasera no accesible:", err);
  }
}

// Actualización visual de brújula, agujas y retículo
function actualizarVista() {
  compassDial.style.transform = `rotate(${-currentHeading}deg)`;
  const needleAngle = (bearingToCuenca - currentHeading + 360) % 360;
  cuencaNeedle.style.transform = `rotate(${needleAngle}deg)`;

  let diff = ((bearingToCuenca - currentHeading + 540) % 360) - 180;
  const isLookingAtCuenca = Math.abs(diff) <= TOLERANCE_DEG;

  if (isLookingAtCuenca && !wasAlignedLastFrame) {
    if (navigator.vibrate) navigator.vibrate(40);
  }
  wasAlignedLastFrame = isLookingAtCuenca;

  if (isLookingAtCuenca) {
    fixedTriangle.classList.add('aligned');
    needleHead.style.borderBottomColor = "#10b981";
    bannerStatusText.textContent = "Mirando a Cuenca";
    bannerStatusText.classList.add('aligned');
    
    circleReticle.classList.add('on-target');
    casasReticle.classList.add('on-target');
    arGuidanceText.textContent = "🎯 ¡Estás mirando a Cuenca!";
    arGuidanceText.classList.add('on-target');
  } else {
    fixedTriangle.classList.remove('aligned');
    needleHead.style.borderBottomColor = "#ef4444";
    bannerStatusText.textContent = "Buscando Cuenca";
    bannerStatusText.classList.remove('aligned');
    
    circleReticle.classList.remove('on-target');
    casasReticle.classList.remove('on-target');
    arGuidanceText.textContent = diff > 0 ? "Gira a la derecha ➡️" : "⬅️ Gira a la izquierda";
    arGuidanceText.classList.remove('on-target');
  }

  const baseTrackOffset = 1440; 
  const trackShift = -(baseTrackOffset + (currentHeading * PX_PER_DEG));
  arCompassTrack.style.transform = `translateX(${trackShift}px)`;

  const maxPinOffset = 140;
  const pinOffset = Math.max(-maxPinOffset, Math.min(maxPinOffset, diff * PX_PER_DEG));
  arCuencaTargetPin.style.transform = `translateX(calc(-50% + ${pinOffset}px))`;
  
  if (isLookingAtCuenca) {
    arCuencaTargetPin.classList.add('aligned');
  } else {
    arCuencaTargetPin.classList.remove('aligned');
  }

  debugHeading.textContent = `${Math.round(currentHeading)}°`;
  debugCuenca.textContent = `${Math.round(bearingToCuenca)}°`;
  debugDiff.textContent = `${Math.abs(Math.round(diff))}° ${diff > 0 ? 'der. ➡️' : 'izq. ⬅️'}`;
}

// Seguimiento GPS
function initGPS() {
  if (!navigator.geolocation) return;

  navigator.geolocation.watchPosition(
    (pos) => {
      userLat = pos.coords.latitude;
      userLon = pos.coords.longitude;
      bearingToCuenca = calculateBearing(userLat, userLon, CUENCA_LAT, CUENCA_LON);
      distanceKm = calculateDistance(userLat, userLon, CUENCA_LAT, CUENCA_LON);
      distanceLabel.textContent = `A ${Math.round(distanceKm)} km en línea recta`;
      actualizarVista();
    },
    () => {
      userLat = 40.4168;
      userLon = -3.7038;
      bearingToCuenca = calculateBearing(userLat, userLon, CUENCA_LAT, CUENCA_LON);
      distanceKm = calculateDistance(userLat, userLon, CUENCA_LAT, CUENCA_LON);
      distanceLabel.textContent = `Aprox. ${Math.round(distanceKm)} km (Modo estimado)`;
      actualizarVista();
    },
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}

// Botón "Comenzar experiencia"
startBtn.addEventListener('click', async () => {
  requestAppFullscreen();

  permissionModal.style.display = 'none';
  appIniciada = true;
  actualizarVisibilidadApp();

  if (precisionState === 'low') {
    accuracyStatusTag.textContent = "Precisión: Baja";
    accuracyStatusTag.className = "accuracy-low";
    calibrationModal.style.display = "flex";
    actualizarVisibilidadApp();
  }

  initGPS();
  await startCamera();

  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res === 'granted') {
        window.addEventListener('deviceorientation', handleOrientation, true);
      } else {
        alert('Permiso denegado para la orientación.');
      }
    } catch (err) {
      console.error(err);
    }
  } else {
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    } else {
      window.addEventListener('deviceorientation', handleOrientation, true);
    }
  }
});

// Selector de mira (Casas Colgadas / Círculo con cruz)
toggleReticleBtn.addEventListener('click', () => {
  if (reticleMode === 'casas') {
    reticleMode = 'circle';
    casasReticle.style.display = 'none';
    circleReticle.style.display = 'flex';
    reticleIcon.textContent = "🏛️";
  } else {
    reticleMode = 'casas';
    circleReticle.style.display = 'none';
    casasReticle.style.display = 'block';
    reticleIcon.textContent = "⭕";
  }
});

// Listener de cambio de tamaño de ventana
window.addEventListener('resize', () => {
  if (appIniciada) actualizarVisibilidadApp();
});
