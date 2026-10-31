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

// VARIABLES DEL FILTRO PASO BAJO (VECTORIAL)
let smoothedSin = 0;
let smoothedCos = 1;
const SMOOTHING_FACTOR = 0.18;
let isFirstHeadingSample = true;

// Detección de plataforma
const isIOS = (function () {
  const ua = navigator.userAgent || navigator.vendor || window.opera || '';
  const isAppleTouch = (/iPad|iPhone|iPod/.test(ua)) || 
                       (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
                       (navigator.vendor && navigator.vendor.indexOf('Apple') > -1 && 'ontouchend' in document);
  const hasIOSPermissionAPI = typeof DeviceOrientationEvent !== 'undefined' && 
                              typeof DeviceOrientationEvent.requestPermission === 'function';
  return isAppleTouch || hasIOSPermissionAPI;
})();

const isAndroid = /Android/.test(navigator.userAgent);

// Detección de si la app ya está abierta como PWA instalada (Standalone)
const isRunningStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                            window.navigator.standalone === true;

// Control de calibración y precisión
let precisionState = isIOS ? 'high' : 'low';
let appIniciada = false;
let precisionFinalizada = isIOS;
let transitionToMainTimeout = null;

const headingHistory = [];
const HISTORY_SIZE = 12;
let totalSamples = 0;

// Elementos DOM
const appContainer = document.getElementById('app-container');
const permissionModal = document.getElementById('permission-modal');
const calibrationModal = document.getElementById('calibration-modal');
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

// Elementos del Banner PWA
const pwaInstallBanner = document.getElementById('pwa-install-banner');
const pwaInstallActionBtn = document.getElementById('pwa-install-action-btn');
const pwaDismissBtn = document.getElementById('pwa-dismiss-btn');
const pwaBannerDesc = document.getElementById('pwa-banner-desc');

let deferredPrompt = null;

// ============================================================
// GESTIÓN DEL AVISO DE INSTALACIÓN PWA
// ============================================================
function setupPwaInstallBanner() {
  // Si ya está abierta como app instalada, no mostramos nada
  if (isRunningStandalone) return;

  // En Android / Navegadores Chromium: Interceptamos el evento nativo
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    pwaInstallBanner.style.display = 'flex';
  });

  // En iOS Safari / Chrome iOS: Mostramos instrucciones contextuales
  if (isIOS) {
    pwaBannerDesc.innerHTML = 'Pulsa <strong>Compartir ⎋</strong> y luego <strong>«Añadir a inicio ⊞»</strong>.';
    pwaInstallActionBtn.textContent = 'Ver cómo';
    
    // Mostramos el banner pasados 1.5s
    setTimeout(() => {
      pwaInstallBanner.style.display = 'flex';
    }, 1500);
  }

  // Clic en el botón principal del banner
  pwaInstallActionBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      // Disparo del popup nativo en Android
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        pwaInstallBanner.style.display = 'none';
      }
      deferredPrompt = null;
    } else if (isIOS) {
      alert('Para instalar en iPhone:\n\n1. Toca el botón de Compartir (el cuadrado con la flecha hacia arriba en Safari/Chrome).\n2. Baja y pulsa «Añadir a pantalla de inicio».');
    }
  });

  // Botón para cerrar el banner
  pwaDismissBtn.addEventListener('click', () => {
    pwaInstallBanner.style.display = 'none';
  });
}
setupPwaInstallBanner();

// Control de visibilidad
function actualizarVisibilidadApp() {
  const modalInicioVisible = permissionModal && permissionModal.style.display !== 'none';
  const modalCalibracionVisible = !isIOS && calibrationModal && calibrationModal.style.display !== 'none';

  if (!appIniciada || modalInicioVisible || modalCalibracionVisible) {
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

// Instrucciones para Android / Otros
function setupInstructionsText() {
  if (isIOS || !calibrationInstructions) return;

  if (isAndroid) {
    calibrationInstructions.innerHTML = `
      <p>El sensor magnético de tu <strong>Android</strong> requiere calibración.</p>
      <ol class="calibration-steps">
        <li>Mueve el teléfono en el aire trazando la forma de un <strong>«8» amplio</strong>, girando la muñeca sobre los 3 ejes.</li>
        <li>Aléjate de ordenadores, cables de alta potencia o fundas magnéticas.</li>
        <li>Si persiste, abre <strong>Google Maps</strong>, toca tu punto azul de ubicación y pulsa en <em>«Calibrar brújula»</em>.</li>
      </ol>
    `;
  } else {
    calibrationInstructions.innerHTML = `
      <p>Mueve el dispositivo formando un <strong>«8» en el aire</strong> para calibrar los sensores magnéticos.</p>
    `;
  }
}
setupInstructionsText();

// EVALUACIÓN DE PRECISIÓN (SOLO ACTIVA EN ANDROID / OTROS)
function evaluarPrecisionReal(event, rawHeading) {
  if (isIOS || precisionFinalizada || !calibrationModal) return;

  totalSamples++;
  let isAccurate = false;

  if (event.absolute === true && rawHeading !== null) {
    headingHistory.push(rawHeading);
    if (headingHistory.length > HISTORY_SIZE) {
      headingHistory.shift();
    }

    if (headingHistory.length >= HISTORY_SIZE && totalSamples > 15) {
      let maxDiff = 0;
      for (let i = 1; i < headingHistory.length; i++) {
        let d = Math.abs(headingHistory[i] - headingHistory[i - 1]);
        if (d > 180) d = 360 - d;
        if (d > maxDiff) maxDiff = d;
      }
      if (maxDiff < 30) {
        isAccurate = true;
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
      if (accuracyStatusTag) {
        accuracyStatusTag.textContent = "Precisión: Baja";
        accuracyStatusTag.className = "accuracy-low";
      }
      calibrationModal.style.display = "flex";
      actualizarVisibilidadApp();
    } else if (precisionState === 'high') {
      if (accuracyStatusTag) {
        accuracyStatusTag.textContent = "Precisión: Alta";
        accuracyStatusTag.className = "accuracy-high";
      }

      if (!transitionToMainTimeout) {
        transitionToMainTimeout = setTimeout(() => {
          calibrationModal.style.display = "none";
          precisionFinalizada = true;
          transitionToMainTimeout = null;
          actualizarVisibilidadApp();
        }, 1000);
      }
    }
  }
}

// Evaluación pasiva previa (solo no-iOS)
function iniciarEvaluacionPasiva() {
  if (isIOS) return;

  const handlerPasivo = (e) => {
    let h = null;
    if (typeof e.webkitCompassHeading !== "undefined" && e.webkitCompassHeading !== null) {
      h = e.webkitCompassHeading;
    } else if (e.alpha !== null) {
      h = (360 - e.alpha) % 360;
    }
    evaluarPrecisionReal(e, h);
  };

  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', handlerPasivo, true);
  } else if ('ondeviceorientation' in window) {
    window.addEventListener('deviceorientation', handlerPasivo, true);
  }
}
iniciarEvaluacionPasiva();

// Postura física: Plano respecto al suelo (< 25°) = Brújula | Levantado (>= 25°) = AR
function evaluarPosturaYModo(beta, gamma) {
  const bRad = ((beta || 0) * Math.PI) / 180;
  const gRad = ((gamma || 0) * Math.PI) / 180;

  const cosTilt = Math.abs(Math.cos(bRad) * Math.cos(gRad));
  const inclinacionSuelo = Math.acos(Math.max(-1, Math.min(1, cosTilt))) * (180 / Math.PI);

  const esPlano = inclinacionSuelo < 25;

  if (esPlano) {
    if (currentMode !== 'compass') {
      currentMode = 'compass';
      compassMode.style.display = "flex";
      arMode.style.display = "none";
      video.style.display = "none";
      reticleToggleWrapper.style.display = "none";
    }
  } else {
    if (currentMode !== 'ar') {
      currentMode = 'ar';
      compassMode.style.display = "none";
      arMode.style.display = "flex";
      video.style.display = "block";
      reticleToggleWrapper.style.display = "flex";
    }
  }

  actualizarVisibilidadApp();
}

// Obtener rotación nativa de la pantalla
function getScreenAngle() {
  if (screen.orientation && typeof screen.orientation.angle !== 'undefined') {
    return screen.orientation.angle;
  }
  if (typeof window.orientation !== 'undefined') {
    return Number(window.orientation) || 0;
  }
  return 0;
}

// Lectura de orientación con filtro paso bajo vectorial
function handleOrientation(e) {
  let rawDeg = null;

  if (typeof e.webkitCompassHeading !== "undefined" && e.webkitCompassHeading !== null) {
    rawDeg = e.webkitCompassHeading;
  } else if (e.alpha !== null) {
    rawDeg = (360 - e.alpha) % 360;
  }

  evaluarPrecisionReal(e, rawDeg);

  if (rawDeg !== null) {
    const screenAngle = getScreenAngle();
    let targetHeading = (rawDeg + screenAngle + 360) % 360;

    const targetRad = (targetHeading * Math.PI) / 180;
    const targetSin = Math.sin(targetRad);
    const targetCos = Math.cos(targetRad);

    if (isFirstHeadingSample) {
      smoothedSin = targetSin;
      smoothedCos = targetCos;
      isFirstHeadingSample = false;
    } else {
      smoothedSin = smoothedSin + SMOOTHING_FACTOR * (targetSin - smoothedSin);
      smoothedCos = smoothedCos + SMOOTHING_FACTOR * (targetCos - smoothedCos);
    }

    let computedHeading = Math.atan2(smoothedSin, smoothedCos) * (180 / Math.PI);
    currentHeading = (computedHeading + 360) % 360;
  }

  const beta = e.beta || 0;
  const gamma = e.gamma || 0;
  evaluarPosturaYModo(beta, gamma);

  actualizarVista();
}

// Cinta métrica AR
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

// Distancia Haversine
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Cámara trasera
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

// Renderizado de interfaz
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

// Geolocalización GPS
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

// Botón de inicio
startBtn.addEventListener('click', async () => {
  // Al pulsar en comenzar, si el banner de instalación sigue visible, se oculta para despejar la vista
  if (pwaInstallBanner) {
    pwaInstallBanner.style.display = 'none';
  }

  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res === 'granted') {
        window.addEventListener('deviceorientation', handleOrientation, true);
      } else {
        alert('Permiso denegado para los sensores de orientación.');
      }
    } catch (err) {
      console.error('Error al pedir permisos de orientación:', err);
    }
  } else {
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    } else {
      window.addEventListener('deviceorientation', handleOrientation, true);
    }
  }

  requestAppFullscreen();

  permissionModal.style.display = 'none';
  appIniciada = true;
  actualizarVisibilidadApp();

  if (!isIOS && !precisionFinalizada && precisionState === 'low') {
    if (accuracyStatusTag) {
      accuracyStatusTag.textContent = "Precisión: Baja";
      accuracyStatusTag.className = "accuracy-low";
    }
    if (calibrationModal) {
      calibrationModal.style.display = "flex";
    }
    actualizarVisibilidadApp();
  }

  initGPS();
  await startCamera();
});

// Selector de mira
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

// Reseteo al girar la pantalla
window.addEventListener('orientationchange', () => {
  isFirstHeadingSample = true;
  actualizarVista();
});
