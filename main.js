import { tourData } from './tourData.js';

const micBtn = document.getElementById('mic-btn');
const transcriptText = document.getElementById('transcript-text');
const transcriptBox = document.getElementById('transcript-box');
const responseBox = document.getElementById('response-box');
const responseText = document.getElementById('response-text');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');

// API Key 관리
let geminiApiKey = localStorage.getItem('gemini_api_key') || '';
if (geminiApiKey) {
  apiKeyInput.value = geminiApiKey;
}

saveKeyBtn.addEventListener('click', () => {
  geminiApiKey = apiKeyInput.value.trim();
  if (geminiApiKey) {
    localStorage.setItem('gemini_api_key', geminiApiKey);
    alert('API Key가 저장되었습니다.');
  } else {
    localStorage.removeItem('gemini_api_key');
    alert('API Key가 삭제되었습니다.');
  }
});

// 모바일 기기 감지 (User-Agent 기반)
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// 위치 안내 일시정지 상태 변수 (음성 대화 시 GPS 멘트 겹침 방지)
let isLocationGuidancePaused = false;

// TTS (Text-to-Speech) 함수
function speakText(text, onEndCallback = null) {
  if (!window.speechSynthesis) {
    if (onEndCallback) onEndCallback();
    return;
  }
  window.speechSynthesis.cancel(); // 기존 재생 중인 음성 취소
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ko-KR';
  
  // PC와 스마트폰의 기본 TTS 엔진 속도 해석이 다르므로 분기 처리
  if (isMobile) {
    utterance.rate = 1.2; // 스마트폰은 엔진 특성상 기본 속도가 빨라서 1.2로 하향
  } else {
    utterance.rate = 1.8; // PC는 1.8배속
  }
  
  if (onEndCallback) {
    utterance.onend = onEndCallback;
    utterance.onerror = onEndCallback; // 에러 시 복구
  }
  
  window.speechSynthesis.speak(utterance);
}

// 두 지점 간의 거리를 미터(m) 단위로 계산하는 하버사인 공식
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // 지구 반경 (미터)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// 두 지점 간의 방위각(Bearing: 0 ~ 360도) 계산 함수
function getBearing(lat1, lon1, lat2, lon2) {
  const radLat1 = (lat1 * Math.PI) / 180;
  const radLat2 = (lat2 * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(radLat2);
  const x = Math.cos(radLat1) * Math.sin(radLat2) - Math.sin(radLat1) * Math.cos(radLat2) * Math.cos(dLon);

  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360; // 0 ~ 360도 정규화
}

// Web Audio API 3D 공간 음향 내비게이션 클래스 (Spatial Audio Beacon Guide)
class SpatialAudioGuide {
  constructor() {
    this.audioCtx = null;
    this.targetSpot = null;
    this.isActive = false;
    this.timerId = null;
    this.currentDistance = 9999;
    this.currentRelativeAngle = 0;
  }

  initContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  start(targetSpot) {
    this.initContext();
    this.targetSpot = targetSpot;
    this.isActive = true;
    console.log(`[Spatial Audio] 가이드 시작: ${targetSpot.name}`);
    this.scheduleNextPing(500); // 0.5초 뒤 첫 핑 재생 시작
  }

  stop() {
    this.isActive = false;
    this.targetSpot = null;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    console.log("[Spatial Audio] 가이드 중지");
  }

  update(currentLat, currentLon, currentHeading) {
    if (!this.isActive || !this.targetSpot || !this.targetSpot.lat || !this.targetSpot.lng) return;

    // 1. 목적지와의 거리 계산
    this.currentDistance = getDistance(currentLat, currentLon, this.targetSpot.lat, this.targetSpot.lng);

    // 2. 목적지의 절대 방위각(Bearing) 계산
    const targetBearing = getBearing(currentLat, currentLon, this.targetSpot.lat, this.targetSpot.lng);

    // 3. 내 스마트폰 향(Heading) 기준 목적지 상대 각도 계산 (-180 ~ +180도)
    let relativeAngle = (targetBearing - currentHeading + 540) % 360 - 180;
    this.currentRelativeAngle = relativeAngle;

    console.log(`[Spatial Guide] 거리: ${this.currentDistance.toFixed(1)}m, 상대 각도: ${relativeAngle.toFixed(1)}°`);

    // 4. 3m 이내 도달 시 도착 처리
    if (this.currentDistance <= 3.0) {
      this.playArrivalChime();
      const spotName = this.targetSpot.name.replace(/\([^)]*\)/g, '').trim();
      const arrivalMsg = `목적지인 ${getJosa(spotName, '에', '에')} 도착했습니다.`;
      this.stop();

      responseText.textContent = arrivalMsg;
      speakText(arrivalMsg, () => {
        isLocationGuidancePaused = false;
      });
    }
  }

  scheduleNextPing(delayMs) {
    if (!this.isActive) return;
    if (this.timerId) clearTimeout(this.timerId);

    this.timerId = setTimeout(() => {
      if (!this.isActive) return;
      this.playBeaconSound();

      // 거리(Distance)에 따른 다음 핑 간격 계산
      let nextInterval = 2000; // 30m 이상: 2초
      if (this.currentDistance <= 10.0) {
        nextInterval = 600; // 10m 이내: 0.6초 (빠름)
      } else if (this.currentDistance <= 30.0) {
        nextInterval = 1200; // 10~30m: 1.2초
      }

      this.scheduleNextPing(nextInterval);
    }, delayMs);
  }

  // 맑은 아날로그 핑/종소리 합성 (Web Audio Oscillator + StereoPanner)
  playBeaconSound() {
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gainNode = this.audioCtx.createGain();

      // 상대 각도(relativeAngle: -180 ~ +180)를 Panning 값(-1.0 ~ +1.0)으로 변환
      const panValue = Math.sin((this.currentRelativeAngle * Math.PI) / 180);

      // StereoPannerNode 지원 여부 확인 후 적용
      let pannerNode = null;
      if (this.audioCtx.createStereoPanner) {
        pannerNode = this.audioCtx.createStereoPanner();
        pannerNode.pan.setValueAtTime(panValue, now);
      }

      // 음정 설정 (맑은 C6 = 1046.5Hz 아날로그 벨 소리)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046.5, now);

      // 엔벨로프 (짧고 맑은 종소리 잔향 0.25초)
      gainNode.gain.setValueAtTime(0.001, now);
      gainNode.gain.exponentialRampToValueAtTime(0.3, now + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

      // 노드 연결
      if (pannerNode) {
        osc.connect(gainNode);
        gainNode.connect(pannerNode);
        pannerNode.connect(this.audioCtx.destination);
      } else {
        osc.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);
      }

      osc.start(now);
      osc.stop(now + 0.26);
    } catch (e) {
      console.error("Beacon sound play error:", e);
    }
  }

  // 목적지 도착 차임벨 (도미솔 피치 사운드)
  playArrivalChime() {
    if (!this.audioCtx) return;
    try {
      const now = this.audioCtx.currentTime;
      const freqs = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      freqs.forEach((freq, idx) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        const startTime = now + idx * 0.12;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.25, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.4);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.42);
      });
    } catch (e) {
      console.error("Arrival chime play error:", e);
    }
  }
}

const spatialGuide = new SpatialAudioGuide();

// 경량 2D GPS 칼만 필터 클래스 (지능형 속도 기반 동적 노이즈 제어 & 이중 안전망)
class GPSKalmanFilter {
  constructor(defaultProcessNoise = 0.8) {
    this.defaultProcessNoise = defaultProcessNoise; // 기본 보행자 노이즈 (Q = 0.8)
    this.isInitialized = false;
    this.lat = 0;
    this.lon = 0;
    this.variance = -1; // P: 추정 오차 공분산
    this.timestamp = 0;
  }

  process(lat, lon, accuracy, timestamp, hwSpeed = null) {
    if (!this.isInitialized) {
      this.lat = lat;
      this.lon = lon;
      this.variance = accuracy * accuracy;
      this.timestamp = timestamp;
      this.isInitialized = true;
      return { lat: this.lat, lon: this.lon, effectiveSpeed: 0, q: this.defaultProcessNoise };
    }

    const duration = (timestamp - this.timestamp) / 1000;
    // 10초 이상 갱신이 멈췄거나 끊긴 경우 새로 초기화
    if (duration > 10) {
      this.lat = lat;
      this.lon = lon;
      this.variance = accuracy * accuracy;
      this.timestamp = timestamp;
      return { lat: this.lat, lon: this.lon, effectiveSpeed: 0, q: this.defaultProcessNoise };
    }

    // --- [이중 안전망 속도 판정 로직] ---
    let effectiveSpeed = null;

    // 1순위: 하드웨어가 제공한 speed 검사 (m/s)
    if (typeof hwSpeed === 'number' && !isNaN(hwSpeed) && hwSpeed >= 0) {
      effectiveSpeed = hwSpeed;
    } 
    // 2순위 (하드웨어 speed 미지원 시): 이전 보정 좌표와 현재 좌표간 자가 속도 계산
    else if (duration > 0) {
      const movedDistance = getDistance(this.lat, this.lon, lat, lon);
      effectiveSpeed = movedDistance / duration;
    }

    // 3순위 (동적 Process Noise Q 결정 및 Fallback)
    let currentQ = this.defaultProcessNoise; // 기본 보행자 값 (0.8)
    if (effectiveSpeed !== null) {
      if (effectiveSpeed < 0.3) {
        // 정지/미동 상태: 위치 떨림 방지 대폭 강화 (Q = 0.1)
        currentQ = 0.1;
      } else if (effectiveSpeed <= 2.0) {
        // 보행 상태 (약 1.0 ~ 7.2 km/h): 보행자 최적 노이즈 (Q = 0.8)
        currentQ = 0.8;
      } else {
        // 빠른 이동 / 차량 (7.2 km/h 초과): 반응성 향상 (Q = 2.0)
        currentQ = 2.0;
      }
    }

    if (duration > 0) {
      this.variance += duration * currentQ * currentQ;
      this.timestamp = timestamp;
    }

    const measurementNoise = accuracy * accuracy;
    const kalmanGain = this.variance / (this.variance + measurementNoise);

    this.lat = this.lat + kalmanGain * (lat - this.lat);
    this.lon = this.lon + kalmanGain * (lon - this.lon);
    this.variance = (1 - kalmanGain) * this.variance;

    return { 
      lat: this.lat, 
      lon: this.lon, 
      effectiveSpeed: effectiveSpeed !== null ? effectiveSpeed : 0, 
      q: currentQ 
    };
  }

  reset() {
    this.isInitialized = false;
  }
}

const gpsFilter = new GPSKalmanFilter();

// GPS 좌표 업데이트 로직
const gpsLat = document.getElementById('gps-lat');
const gpsLon = document.getElementById('gps-lon');
const gpsRawLat = document.getElementById('gps-raw-lat');
const gpsRawLon = document.getElementById('gps-raw-lon');
const gpsAcc = document.getElementById('gps-acc');
const nearbyLocation = document.getElementById('nearby-location');
const nearbyName = document.getElementById('nearby-name');
const nearbyDesc = document.getElementById('nearby-desc');

let gpsInterval = null;
let lastAnnouncedSpotName = null; // TTS 중복 재생 방지용
let currentHeading = 0; // 스마트폰 정면 나침반 방위각 (0 ~ 360도)

// 지자기 센서(DeviceOrientation) 수신 및 저주파 필터링(Smoothing)
function handleOrientation(event) {
  let heading = null;
  if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
    // iOS Safari
    heading = event.webkitCompassHeading;
  } else if (event.alpha !== null && event.alpha !== undefined) {
    // Android / Standard
    heading = (360 - event.alpha) % 360;
  }

  if (heading !== null) {
    // 저주파 필터로 나침반 떨림 보정 (Low-pass Filter)
    const diff = (heading - currentHeading + 540) % 360 - 180;
    currentHeading = (currentHeading + diff * 0.2 + 360) % 360;
  }
}

if (window.DeviceOrientationEvent) {
  window.addEventListener('deviceorientationabsolute', handleOrientation, true);
  window.addEventListener('deviceorientation', handleOrientation, true);
}

// 한글 받침 여부를 확인하여 조사('이/가', '은/는', '을/를')를 붙여 반환하는 함수
function getJosa(word, josa1, josa2) {
  const lastChar = word.charCodeAt(word.length - 1);
  if (lastChar < 0xAC00 || lastChar > 0xD7A3) return word + josa1;
  const hasJongseong = (lastChar - 0xAC00) % 28 > 0;
  return word + (hasJongseong ? josa1 : josa2);
}

function fetchLocation() {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const rawLat = position.coords.latitude;
      const rawLon = position.coords.longitude;
      const accuracy = position.coords.accuracy || 10;
      const timestamp = position.timestamp || Date.now();
      const hwSpeed = position.coords.speed; // 하드웨어 속도 (null 일 수 있음)

      // 지능형 칼만 필터를 통과하여 노이즈 제거 및 좌표 스무딩
      const filtered = gpsFilter.process(rawLat, rawLon, accuracy, timestamp, hwSpeed);
      const currentLat = filtered.lat;
      const currentLon = filtered.lon;

      // 3D 공간 음향 내비게이션 활성화 시 위치 및 방위각 실시간 갱신
      if (spatialGuide.isActive) {
        spatialGuide.update(currentLat, currentLon, currentHeading);
      }

      console.log(`[GPS Kalman] Raw: (${rawLat.toFixed(6)}, ${rawLon.toFixed(6)}, Acc: ${accuracy.toFixed(1)}m, Speed: ${filtered.effectiveSpeed.toFixed(1)}m/s, Q: ${filtered.q}) -> Filtered: (${currentLat.toFixed(6)}, ${currentLon.toFixed(6)})`);

      // 화면 UI 표출 (보정 좌표 & 원본 좌표 & 오차 범위를 모바일 화면에 모두 노출)
      gpsLat.textContent = currentLat.toFixed(6);
      gpsLon.textContent = currentLon.toFixed(6);
      if (gpsRawLat) gpsRawLat.textContent = rawLat.toFixed(6);
      if (gpsRawLon) gpsRawLon.textContent = rawLon.toFixed(6);
      if (gpsAcc) gpsAcc.textContent = accuracy.toFixed(1);

      // 15미터 이내의 가장 가까운 장소 찾기
      let closestSpot = null;
      let minDistance = 15; // 최대 반경 15m

      for (const spot of tourData) {
        if (spot.lat && spot.lng) {
          const distance = getDistance(currentLat, currentLon, spot.lat, spot.lng);
          if (distance <= minDistance) {
            closestSpot = spot;
            minDistance = distance;
          }
        }
      }

      if (closestSpot) {
        nearbyName.textContent = closestSpot.name;
        nearbyDesc.textContent = closestSpot.descKo;
        nearbyLocation.style.display = 'flex';
        
        // 새로 진입한 장소라면 TTS 재생 (단, 음성 질의응답 중이 아닐 때만)
        if (lastAnnouncedSpotName !== closestSpot.name) {
          lastAnnouncedSpotName = closestSpot.name;
          if (!isLocationGuidancePaused) {
            const nameWithJosa = getJosa(closestSpot.name, '이', '가');
            speakText(`근처에 ${nameWithJosa} 있습니다. ${closestSpot.descKo}`);
          }
        }
      } else {
        nearbyLocation.style.display = 'none';
        lastAnnouncedSpotName = null; // 장소를 벗어나면 초기화
      }
    },
    (error) => {
      console.error("GPS Error:", error);
      gpsLat.textContent = "오류";
      gpsLon.textContent = "오류";
      if (gpsRawLat) gpsRawLat.textContent = "오류";
      if (gpsRawLon) gpsRawLon.textContent = "오류";
      if (gpsAcc) gpsAcc.textContent = "-";
    },
    { enableHighAccuracy: true }
  );
}

function startGpsPolling() {
  if (navigator.geolocation && !gpsInterval) {
    gpsFilter.reset(); // 폴링 시작 시 필터 초기화
    fetchLocation(); // 즉시 1회 실행
    gpsInterval = setInterval(fetchLocation, 1000);
  } else if (!navigator.geolocation) {
    gpsLat.textContent = "미지원";
    gpsLon.textContent = "미지원";
  }
}

function stopGpsPolling() {
  if (gpsInterval) {
    clearInterval(gpsInterval);
    gpsInterval = null;
    gpsFilter.reset();
  }
}

// Screen Wake Lock API를 사용하여 화면 꺼짐 방지
let wakeLock = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('화면 꺼짐 방지(Wake Lock) 활성화');
      wakeLock.addEventListener('release', () => {
        console.log('화면 꺼짐 방지(Wake Lock) 해제');
      });
    } else {
      console.log('이 브라우저는 Wake Lock API를 지원하지 않거나 HTTPS 환경이 아닙니다.');
    }
  } catch (err) {
    console.error(`Wake Lock 오류: ${err.name}, ${err.message}`);
  }
}

// NoSleep.js (Wake Lock API의 강력한 대안, 비디오 재생 방식 - HTTP(로컬 네트워크) 테스트 환경에서도 완벽 작동)
let noSleep = new NoSleep();
let isNoSleepEnabled = false;

// 브라우저 정책상 화면 꺼짐 방지(특히 비디오 방식)는 사용자의 '터치/클릭' 액션이 있어야만 시작할 수 있습니다.
document.addEventListener('click', function enableNoSleep() {
  document.removeEventListener('click', enableNoSleep, false);
  if (!isNoSleepEnabled) {
    noSleep.enable();
    isNoSleepEnabled = true;
    console.log('NoSleep.js 방식 화면 꺼짐 방지 완벽 활성화');
  }
}, false);

// 초기 실행
startGpsPolling();
requestWakeLock(); // 앱 시작 시 화면 꺼짐 방지 요청

// 앱 시작 10초 후 위치 탐색 자세 안내 TTS 출력
setTimeout(() => {
  if (!isLocationGuidancePaused) {
    speakText("스마트폰을 가슴 높이로 들고 정면을 향해 주시면 위치 탐색이 더욱 정확해집니다.");
  }
}, 10000);

// 탭/브라우저가 숨겨지면 GPS 요청 중지, 다시 열리면 재개 및 Wake Lock 재요청
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopGpsPolling();
  } else {
    startGpsPolling();
    // 브라우저가 다시 활성화되면 Wake Lock을 다시 요청
    requestWakeLock();
  }
});

let audioCtx = null;

function playMicSound(isStart) {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.type = 'sine'; // 맑은 비프음
  const now = audioCtx.currentTime;
  
  if (isStart) {
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
  } else {
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
  }
  
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.4, now + 0.02); // 볼륨을 0.1에서 0.4로 증가
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  
  osc.start(now);
  osc.stop(now + 0.2);
}

let loadingSoundInterval = null;

function startLoadingSound() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  
  // 0.4초 간격으로 물방울/생각하는 느낌의 가벼운 '톡' 소리 재생
  loadingSoundInterval = setInterval(() => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.type = 'sine';
    const now = audioCtx.currentTime;
    
    // 맑고 경쾌한 방울(Ping) 소리
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(1500, now + 0.1);
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.01); // 선명한 볼륨
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2); // 맑은 여운을 위해 조금 길게
    
    osc.start(now);
    osc.stop(now + 0.2);
  }, 1000); // 1초 간격으로 변경
}

function stopLoadingSound() {
  if (loadingSoundInterval) {
    clearInterval(loadingSoundInterval);
    loadingSoundInterval = null;
  }
}

// Web Speech API 지원 확인
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognition) {
  transcriptText.innerHTML = "죄송합니다. 현재 브라우저가 Web Speech API를 지원하지 않습니다.<br>Chrome 또는 Edge 브라우저를 사용해 주세요.";
  transcriptText.classList.remove('placeholder');
  transcriptText.style.color = '#ef4444'; // Error Red
  micBtn.disabled = true;
  micBtn.style.opacity = '0.5';
  micBtn.style.cursor = 'not-allowed';
} else {
  const recognition = new SpeechRecognition();
  recognition.continuous = false; // 말을 멈추면 자동으로 인식 종료 (자연스러운 질의응답)
  recognition.interimResults = true; // 실시간 중간 결과 반환
  recognition.lang = 'ko-KR'; // 한국어 설정 (원하는 경우 'en-US' 등 변경 가능)

  let isListening = false;
  let finalTranscript = '';

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add('listening');
    if (finalTranscript === '') {
      transcriptText.textContent = '듣고 있습니다...';
      transcriptText.classList.add('placeholder');
    }
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript + ' ';
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }

    transcriptText.classList.remove('placeholder');
    
    // 최종 텍스트와 실시간 텍스트를 함께 표시
    if (finalTranscript || interimTranscript) {
      transcriptText.innerHTML = 
        `<span>${finalTranscript}</span>` + 
        `<span class="interim-text">${interimTranscript}</span>`;
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error', event.error);
    if (event.error === 'not-allowed') {
      transcriptText.textContent = "마이크 접근이 거부되었습니다. 권한을 허용해 주세요.";
      transcriptText.style.color = '#ef4444';
    }
    isListening = false;
    micBtn.classList.remove('listening');
  };

  let currentNewsContext = null; // 뉴스 상태 저장용 전역 변수
  let chatHistory = []; // 멀티턴 대화 기록 저장용 전역 변수

  // 날짜 키워드 분석 함수
  function getRequestedDateIndex(text) {
    if (text.includes("어제") || text.includes("하루 전") || text.includes("1일 전")) return 1;
    if (text.includes("그저께") || text.includes("그제") || text.includes("이틀 전") || text.includes("2일 전")) return 2;
    if (text.includes("3일 전") || text.includes("삼일 전") || text.includes("사흘 전")) return 3;
    if (text.includes("4일 전") || text.includes("나흘 전")) return 4;
    if (text.includes("5일 전") || text.includes("오일 전") || text.includes("닷새 전")) return 5;
    if (text.includes("6일 전") || text.includes("육일 전") || text.includes("엿새 전")) return 6;
    if (text.includes("1주일 전") || text.includes("일주일 전") || text.includes("7일 전") || text.includes("칠일 전")) return 7;
    return 0; // 기본값은 최신(오늘)
  }

  // Gemini API 호출 함수
  async function askGemini(question) {
    if (!geminiApiKey) {
      responseText.textContent = "Gemini API Key를 먼저 상단에 입력하고 저장해 주세요.";
      responseBox.style.display = 'flex';
      return;
    }

    micBtn.classList.add('loading'); // 마이크 버튼 로딩 애니메이션
    startLoadingSound(); // 대기 효과음 시작
    responseText.textContent = "Gemini가 답변을 생각하는 중입니다...";
    responseBox.style.display = 'flex';

    try {
      // 0. 사용자의 명시적인 위치/장소 탐색 질의 처리 ("OO 위치 알려줘", "OO 어디야?" 등)
      const isExplicitLocationSearch = question.includes("위치") || question.includes("어디") || question.includes("찾아") || question.includes("안내해");

      if (isExplicitLocationSearch) {
        let searchMatchedSpot = null;
        let longestNameLen = 0;

        for (const spot of tourData) {
          if (spot.name && spot.name.trim() !== '' && !spot.name.startsWith("TYPE0_")) {
            const cleanName = spot.name.replace(/\([^)]*\)/g, '').trim();
            if (cleanName.length >= 2 && question.includes(cleanName)) {
              if (cleanName.length > longestNameLen) {
                searchMatchedSpot = spot;
                longestNameLen = cleanName.length;
              }
            }
          }
        }

        stopLoadingSound();
        micBtn.classList.remove('loading');

        if (searchMatchedSpot) {
          const cleanName = searchMatchedSpot.name.replace(/\([^)]*\)/g, '').trim();
          const nameWithJosa = getJosa(cleanName, '을', '를');
          const replyText = `${nameWithJosa} 안내하겠습니다. 안전을 위해 외부 노출형 이어폰 착용을 권장합니다. 목적지 방향의 종소리를 따라 이동하세요.`;
          responseText.textContent = replyText;
          
          // 기존 안내 음성이 끝나면 3D 오디오 가이드 시작
          speakText(replyText, () => {
            isLocationGuidancePaused = false;
            spatialGuide.start(searchMatchedSpot);
          });
          return; // Gemini 호출 없이 즉시 안내 및 리턴
        } else {
          spatialGuide.stop(); // 미등록 장소 검색 시 기존 오디오 가이드 중지
          const notFoundText = "요청하신 위치를 찾을 수 없습니다.";
          responseText.textContent = notFoundText;
          speakText(notFoundText, () => {
            isLocationGuidancePaused = false;
          });
          return; // Gemini 호출 없이 즉시 안내 및 리턴
        }
      }

      // 1. 사용자 질문에서 유적지 이름 검색 (RAG 로직 향상)
      let matchedSpot = null;
      let matchedLength = 0;

      for (const spot of tourData) {
        // A. 괄호를 제외한 핵심 이름 덩어리가 통째로 포함된 경우 ("불국사 석축")
        const cleanName = spot.name.replace(/\([^)]*\)/g, '').trim(); 
        if (cleanName.length >= 2 && question.includes(cleanName)) {
          if (cleanName.length > matchedLength) {
            matchedSpot = spot;
            matchedLength = cleanName.length;
          }
        }
        
        // B. 띄어쓰기나 괄호로 구분된 개별 단어가 포함된 경우 ("청운교", "백운교", "목어")
        const words = spot.name.split(/[\s(),/]+/).filter(w => w.trim().length >= 2);
        for (const word of words) {
          const keyword = word.trim();
          // 일반적인 단어(예: '및', '경주' 등) 필터링 생략: 관광지에 특화된 데이터이므로 단어가 매칭되면 우선 사용
          if (question.includes(keyword)) {
            if (keyword.length > matchedLength) {
              matchedSpot = spot;
              matchedLength = keyword.length;
            }
          }
        }
      }

      // 2. 상황에 따른 System Instruction 동적 조립
      let systemPrompt = "당신은 친절한 AI 관광 및 일상 비서입니다.\n답변을 시작할 때 '네, 투어에이전트입니다' 같은 자기소개나 인사말은 생략하고 곧바로 질문에 대한 답변만 시작하세요.\n사용자가 한국어로 물으면 한국어로, 영어로 물으면 영어로 대답하세요.\n음성 비서이므로 안내 데스크 직원이나 라디오 아나운서처럼 자연스러운 구어체로 2~3문장 이내로 짧고 명확하게 대답하세요.\n절대 '*', '#', 이모지, 이모티콘 등 읽을 수 없는 특수기호나 마크다운 서식을 사용하지 마세요.\n\n";
      
      // 사용자가 뉴스를 선택하는 표현을 썼는지 검사 (정규식: 첫 번째, 두 번째, 1번, 2번 등)
      const isSelection = question.match(/(첫|두|세|1|2|3|일|이|삼)[\s]*(번째|번)/) || question.includes("자세히") || question.includes("그 뉴스");

      // 환율 최우선 매칭 키워드 리스트
      const exchangeKeywords = ['환율', '달러', '엔화', '유로', '위안', '파운드', '환전', '외환', '원달러', '원엔'];
      const isExchangeRequest = exchangeKeywords.some(keyword => question.includes(keyword));

      // Case 0 (최우선 순위): 환율 및 외환 관련 질문인 경우 ("환율 뉴스 알려줘" 포함)
      if (isExchangeRequest) {
        try {
          const datesRes = await fetch('https://kjwtuat.github.io/tinynews-exchangerate/data/index.json');
          if (!datesRes.ok) throw new Error("환율 날짜 정보를 가져올 수 없습니다.");
          const dates = await datesRes.json();
          
          if (dates.length > 0) {
            let dateIdx = getRequestedDateIndex(question);
            dateIdx = Math.min(dateIdx, dates.length - 1);
            const targetDate = dates[dateIdx];

            const exRes = await fetch(`https://kjwtuat.github.io/tinynews-exchangerate/data/${targetDate}.json`);
            if (!exRes.ok) throw new Error("환율 데이터를 가져올 수 없습니다.");
            const exData = await exRes.json();
            
            systemPrompt += `[${targetDate} 최신 환율 및 외환 뉴스 정보]\n`;
            systemPrompt += `전체 요약: ${exData.speakableTitle}\n\n`;
            systemPrompt += `[주요 통화별 환율 수치]\n`;
            if (exData.rates && Array.isArray(exData.rates)) {
              exData.rates.forEach(r => {
                systemPrompt += `- ${r.name}(${r.code}): ${r.value}원 (${r.change} ${r.changeText})\n`;
              });
            }
            systemPrompt += `\n[외환 시장 세부 분석 및 환전 팁]\n`;
            if (exData.script && Array.isArray(exData.script)) {
              exData.script.forEach(item => {
                systemPrompt += `[${item.originalTitle}]\n- ${item.detailedSummary}\n\n`;
              });
            }
            systemPrompt += `\n[지시사항]\n위 제공된 [${targetDate} 최신 환율 및 외환 뉴스 정보]를 바탕으로, 사용자의 질문에 맞춰 정확하고 밝은 구어체로 2~3문장 이내로 브리핑해주세요. 수치가 요구되면 정확한 원화 가격과 변동폭을 안내해 주세요. 단, "안녕하세요" 같은 인사말은 생략하고 곧바로 본론부터 시작하세요.`;
          } else {
            systemPrompt += "현재 등록된 환율 정보가 없습니다. 이 상황을 사용자에게 자연스럽게 설명해주세요.";
          }
          currentNewsContext = null;
        } catch (error) {
          console.error("환율 Fetch 에러:", error);
          systemPrompt += "환율 데이터 서버에 접속하는 중 오류가 발생했습니다. 이 상황을 사용자에게 자연스럽게 설명해주세요.";
          currentNewsContext = null;
        }
      }
      // Case B: 뉴스 컨텍스트가 유지되고 있고, 사용자가 특정 뉴스를 선택한 경우
      else if (currentNewsContext && currentNewsContext.length > 0 && !matchedSpot && isSelection) {
        const ordinalPrefixes = ["첫 번째", "두 번째", "세 번째"];
        systemPrompt += `[방금 사용자에게 안내한 뉴스 목록]\n`;
        currentNewsContext.forEach((item, idx) => {
          const prefix = ordinalPrefixes[idx] || `${idx + 1}번째`;
          systemPrompt += `${prefix} 뉴스\n- 제목: ${item.speakableTitle}\n- 상세내용: ${item.detailedSummary}\n\n`;
        });
        systemPrompt += `[지시사항]\n사용자의 최근 질문이 위 3개의 뉴스 중 특정 뉴스를 선택하는 것이라면, 해당 뉴스의 '상세내용'을 아나운서처럼 자연스럽고 친절하게 읽어주세요. (제목은 이미 안내했으니 상세내용 위주로 풀어주세요)\n만약 사용자가 전혀 상관없는 질문을 했다면 뉴스 목록은 무시하고 질문에 알맞게 대답하세요.`;
      }
      // Case A: 명시적인 새로운 뉴스 요청 ("뉴스 알려줘" 등)
      else if (question.includes("뉴스") && !matchedSpot) {
        try {
          const datesRes = await fetch('https://kjwtuat.github.io/tinynews/data/index.json');
          if (!datesRes.ok) throw new Error("날짜 정보를 가져올 수 없습니다.");
          const dates = await datesRes.json();
          
          if (dates.length > 0) {
            let dateIdx = getRequestedDateIndex(question);
            dateIdx = Math.min(dateIdx, dates.length - 1);
            const targetDate = dates[dateIdx];

            const newsRes = await fetch(`https://kjwtuat.github.io/tinynews/data/${targetDate}.json`);
            if (!newsRes.ok) throw new Error("뉴스 데이터를 가져올 수 없습니다.");
            const newsItems = await newsRes.json();
            
            // 전체 뉴스 중 랜덤으로 3개 추출하여 컨텍스트에 저장
            const shuffledNews = [...newsItems].sort(() => 0.5 - Math.random());
            currentNewsContext = shuffledNews.slice(0, 3);
            
            const ordinalPrefixes = ["첫 번째", "두 번째", "세 번째"];
            systemPrompt += `[${targetDate} 주요 뉴스 제목]\n`;
            currentNewsContext.forEach((item, idx) => {
              const prefix = ordinalPrefixes[idx] || `${idx + 1}번째`;
              systemPrompt += `${prefix} 소식입니다. ${item.speakableTitle}\n`;
            });
            systemPrompt += `\n[지시사항]\n위 주요 뉴스 제목들을 첫 번째, 두 번째, 세 번째 소식 순서대로 아나운서처럼 자연스럽게 브리핑해주고, 마지막에 "자세히 듣고 싶은 뉴스가 있다면 '첫 번째', '두 번째' 등 순서나 제목을 말씀해 주세요."라고 덧붙이세요. 뉴스의 세부 내용은 아직 절대 말하지 마세요.`;
          } else {
            systemPrompt += "현재 등록된 뉴스가 없습니다. 이 상황을 사용자에게 자연스럽게 설명해주세요.";
            currentNewsContext = null;
          }
        } catch (error) {
          console.error("뉴스 Fetch 에러:", error);
          systemPrompt += "뉴스 서버에 접속하는 중 오류가 발생했습니다. 이 상황을 사용자에게 자연스럽게 설명해주세요.";
          currentNewsContext = null;
        }
      }
      // Case C: 새로운 날씨 요청 ("날씨 알려줘" 등)
      else if (question.includes("날씨") && !matchedSpot) {
        try {
          const datesRes = await fetch('https://kjwtuat.github.io/tinynews-weather/data/index.json');
          if (!datesRes.ok) throw new Error("날짜 정보를 가져올 수 없습니다.");
          const dates = await datesRes.json();
          
          if (dates.length > 0) {
            let dateIdx = getRequestedDateIndex(question);
            dateIdx = Math.min(dateIdx, dates.length - 1);
            const targetDate = dates[dateIdx];

            const weatherRes = await fetch(`https://kjwtuat.github.io/tinynews-weather/data/${targetDate}.json`);
            if (!weatherRes.ok) throw new Error("날씨 데이터를 가져올 수 없습니다.");
            const weatherItems = await weatherRes.json();
            
            systemPrompt += `[${targetDate} 종합 날씨 정보]\n`;
            weatherItems.forEach((item) => {
              systemPrompt += `[${item.originalTitle}]\n- ${item.detailedSummary}\n\n`;
            });
            systemPrompt += `\n[지시사항]\n위 제공된 [${targetDate} 종합 날씨 정보] 4가지 파트를 모두 종합하여, 밝고 친절한 구어체로 해당 날짜의 날씨를 상세하게 브리핑해주세요. 단, 제공된 정보에 "안녕하세요", "AI 기상캐스터입니다" 같은 인사말이 있더라도 전부 무시하고, 절대 인사말 없이 바로 날씨 본론부터 시작하세요. (예: "오늘 전국 날씨는...")`;
          } else {
            systemPrompt += "현재 등록된 날씨 정보가 없습니다. 이 상황을 사용자에게 자연스럽게 설명해주세요.";
          }
          currentNewsContext = null;
        } catch (error) {
          console.error("날씨 Fetch 에러:", error);
          systemPrompt += "날씨 서버에 접속하는 중 오류가 발생했습니다. 이 상황을 사용자에게 자연스럽게 설명해주세요.";
          currentNewsContext = null;
        }
      }
      // Case D: 관광지가 매칭되었거나 일반 대화인 경우
      else {
        currentNewsContext = null; // 뉴스가 아닌 다른 화제이므로 뉴스 컨텍스트 초기화
        if (matchedSpot) {
          systemPrompt += `[관광지 공식 참고 자료]\n`;
          systemPrompt += `이름: ${matchedSpot.name}\n`;
          systemPrompt += `한국어 소개: ${matchedSpot.descKo}\n`;
          systemPrompt += `영어 소개: ${matchedSpot.descEn}\n\n`;
          systemPrompt += `[지시사항]\n위 [관광지 공식 참고 자료]를 최우선으로 바탕으로 사용자의 질문에 대답하세요.\n자료에 없는 내용이라면 일반 지식으로 자연스럽게 대답하세요.`;
        } else {
          systemPrompt += "[지시사항]\n사용자의 질문에 친절하게 2~3문장 이내로 짧게 대답해주세요.";
        }
      }

      // 대화 기록에 사용자 질문 추가
      chatHistory.push({ role: "user", parts: [{ text: question }] });

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: chatHistory
        })
      });

      if (!response.ok) throw new Error('API 호출 실패');
      
      const data = await response.json();
      const rawAnswer = data.candidates[0].content.parts[0].text;
      
      // 대화 기록에 AI 답변 추가
      chatHistory.push({ role: "model", parts: [{ text: rawAnswer }] });
      
      // 대화 기록 길이 제한 (최대 20개 = 10턴 유지)
      if (chatHistory.length > 20) {
        chatHistory = chatHistory.slice(-20);
      }
      
      // 시각적, 청각적 깔끔함을 위해 불필요한 마크다운 특수기호(*, #) 및 이모지 강제 제거
      const answer = rawAnswer.replace(/[*\#]/g, '').trim();

      responseText.textContent = answer;
      speakText(answer, () => {
        // AI 답변 재생이 완전히 끝나면 다시 GPS 위치 안내 활성화
        isLocationGuidancePaused = false;
      }); // 응답을 음성으로 출력
    } catch (error) {
      console.error(error);
      responseText.textContent = "답변을 가져오는 중 오류가 발생했습니다. API Key를 확인해 주세요.";
      // API 실패 시 턴이 꼬이지 않도록 마지막 사용자 질문 롤백
      if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') {
        chatHistory.pop();
      }
      isLocationGuidancePaused = false; // 에러 발생 시 즉시 안내 복구
    } finally {
      stopLoadingSound(); // 대기 효과음 종료
      micBtn.classList.remove('loading');
    }
  }

  recognition.onend = () => {
    if (isListening) {
      playMicSound(false); // 마이크 꺼짐 효과음 (침묵 감지로 인한 자동 종료 시에도 발생)
    }
    isListening = false;
    micBtn.classList.remove('listening');

    // 마이크 인식이 끝났고 인식된 텍스트가 있다면 Gemini에게 질문
    if (finalTranscript.trim() !== '') {
      askGemini(finalTranscript.trim());
    } else {
      // 아무 말 없이 종료된 경우 즉시 GPS 안내 복구
      isLocationGuidancePaused = false;
    }
  };

  // 마이크 버튼 클릭 이벤트
  micBtn.addEventListener('click', () => {
    // iOS Safari 지자기 센서 권한 요청 지원
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(permissionState => {
        if (permissionState === 'granted') {
          window.addEventListener('deviceorientation', handleOrientation, true);
        }
      }).catch(console.error);
    }

    if (isListening) {
      // 듣고 있는 중이면 중지
      recognition.stop();
      if (!finalTranscript) {
        transcriptText.textContent = '마이크를 누르고 말씀해 주세요...';
        transcriptText.classList.add('placeholder');
      }
      // 수동으로 중지했을 때, 인식된 텍스트가 없다면 바로 GPS 안내 복구
      if (finalTranscript.trim() === '') {
        isLocationGuidancePaused = false;
      }
    } else {
      // 새로 시작 (대화가 시작되므로 GPS 안내 및 3D 사운드 가이드 일시정지)
      isLocationGuidancePaused = true;
      spatialGuide.stop(); // 기존 진행 중인 오디오 내비게이션 중지
      if (window.speechSynthesis) window.speechSynthesis.cancel(); // 새로운 질문을 하면 기존 답변 읽던 것 중단
      stopLoadingSound(); // 혹시 로딩음이 실행 중이면 중단
      playMicSound(true); // 마이크 켜짐 효과음
      finalTranscript = ''; 
      transcriptText.textContent = '연결 중...';
      transcriptText.classList.add('placeholder');
      transcriptText.style.color = ''; // Reset error color if any
      responseBox.style.display = 'none'; // 답변 박스 숨김
      
      try {
        recognition.start();
      } catch(e) {
        // 이미 시작된 경우 방어
        console.error(e);
      }
    }
  });
}
