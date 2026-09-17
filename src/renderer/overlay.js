const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { LidMotion } = require('../motion/LidMotion');

const canvas = document.getElementById('gl-canvas');
const video = document.getElementById('capture-video');

let gl = null;
let foldProgram = null;
let blurProgram = null;
let quadVao = null;
let fboVao = null;

let sourceTexture = null;
let smallTexture = null;
let softTexture = null;
let mediumTexture = null;
let broadTexture = null;
let tempBlurTexture = null;

let fbo = null;
let isCapturing = false;
let animationFrameId = null;
let backgroundCaptureInterval = null;
let screenWidth = window.innerWidth;
let screenHeight = window.innerHeight;

let lastCaptureTime = 0;
let lastVideoCurrentTime = -1;
let isOverlayDrawn = false;

// LidMotion physics simulation inside renderer (VSync-locked)
let lidMotion = new LidMotion(100);

// Fullscreen quad [-1, 1]
const quadVertices = new Float32Array([
  -1.0, -1.0,
   1.0, -1.0,
  -1.0,  1.0,
   1.0,  1.0
]);

function initGL() {
  if (gl) return true;

  gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance'
  });

  if (!gl) {
    console.error('WebGL 2.0 not supported');
    return false;
  }

  foldProgram = Shaders.createProgram(gl, Shaders.quadVertex, Shaders.foldFragment);
  blurProgram = Shaders.createProgram(gl, Shaders.fboVertex, Shaders.gaussianBlurFragment);

  // Setup Quad VAO
  quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

  const aPosFold = gl.getAttribLocation(foldProgram, 'aPosition');
  gl.enableVertexAttribArray(aPosFold);
  gl.vertexAttribPointer(aPosFold, 2, gl.FLOAT, false, 0, 0);

  // Setup FBO Quad VAO
  fboVao = gl.createVertexArray();
  gl.bindVertexArray(fboVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  const aPosBlur = gl.getAttribLocation(blurProgram, 'aPosition');
  gl.enableVertexAttribArray(aPosBlur);
  gl.vertexAttribPointer(aPosBlur, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);

  fbo = gl.createFramebuffer();
  allocateTextures();

  if (!loadSystemWallpaper()) {
    initDefaultPattern();
  }
  updateBlurPyramid();

  return true;
}

function loadSystemWallpaper() {
  try {
    const wallpaperPath = path.join(process.env.APPDATA || '', 'Microsoft/Windows/Themes/TranscodedWallpaper');
    if (fs.existsSync(wallpaperPath)) {
      const img = new Image();
      img.onload = () => {
        if (gl && sourceTexture) {
          gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          updateBlurPyramid();
        }
      };
      img.src = 'file:///' + wallpaperPath.replace(/\\/g, '/');
      return true;
    }
  } catch (e) {}
  return false;
}

function createTexture(width, height) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

function allocateTextures() {
  screenWidth = window.innerWidth;
  screenHeight = window.innerHeight;
  canvas.width = screenWidth;
  canvas.height = screenHeight;

  // Downsample to 1/4 size for blur pyramid (blazing fast 60+ FPS on laptop GPUs)
  const smallW = Math.max(Math.floor(screenWidth / 4), 1);
  const smallH = Math.max(Math.floor(screenHeight / 4), 1);

  sourceTexture = createTexture(screenWidth, screenHeight);
  smallTexture = createTexture(smallW, smallH);
  softTexture = createTexture(smallW, smallH);
  mediumTexture = createTexture(smallW, smallH);
  broadTexture = createTexture(smallW, smallH);
  tempBlurTexture = createTexture(smallW, smallH);
}

function initDefaultPattern() {
  const data = new Uint8Array(screenWidth * screenHeight * 4);
  for (let y = 0; y < screenHeight; y++) {
    const v = y / screenHeight;
    for (let x = 0; x < screenWidth; x++) {
      const u = x / screenWidth;
      const idx = (y * screenWidth + x) * 4;
      data[idx] = Math.floor(18 + 22 * (1 - v) + 10 * u);
      data[idx + 1] = Math.floor(48 + 48 * (1 - v) + 38 * u);
      data[idx + 2] = Math.floor(125 + 85 * (1 - v) + 40 * u);
      data[idx + 3] = 255;
    }
  }
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, screenWidth, screenHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

function applyBlurPass(sourceTex, targetTex, radius, width, height) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, width, height);
  gl.useProgram(blurProgram);
  gl.bindVertexArray(fboVao);

  const uTexture = gl.getUniformLocation(blurProgram, 'uTexture');
  const uDirection = gl.getUniformLocation(blurProgram, 'uDirection');
  const uRadius = gl.getUniformLocation(blurProgram, 'uRadius');

  // Pass 1: Horizontal into tempBlurTexture
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tempBlurTexture, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTex);
  gl.uniform1i(uTexture, 0);
  gl.uniform2f(uDirection, 1.0 / width, 0.0);
  gl.uniform1f(uRadius, radius);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Pass 2: Vertical into targetTex
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, targetTex, 0);
  gl.bindTexture(gl.TEXTURE_2D, tempBlurTexture);
  gl.uniform2f(uDirection, 0.0, 1.0 / height);
  gl.uniform1f(uRadius, radius);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function downsampleSource(width, height) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, width, height);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, smallTexture, 0);

  gl.useProgram(blurProgram);
  gl.bindVertexArray(fboVao);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.uniform1i(gl.getUniformLocation(blurProgram, 'uTexture'), 0);
  gl.uniform2f(gl.getUniformLocation(blurProgram, 'uDirection'), 0.0, 0.0);
  gl.uniform1f(gl.getUniformLocation(blurProgram, 'uRadius'), 0.0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function updateBlurPyramid() {
  const smallW = Math.max(Math.floor(screenWidth / 4), 1);
  const smallH = Math.max(Math.floor(screenHeight / 4), 1);

  downsampleSource(smallW, smallH);

  const refWidth = 786.0;
  const scale = smallW / refWidth;
  applyBlurPass(smallTexture, softTexture, 6.0 * scale, smallW, smallH);
  applyBlurPass(smallTexture, mediumTexture, 16.0 * scale, smallW, smallH);
  applyBlurPass(smallTexture, broadTexture, 36.0 * scale, smallW, smallH);
}

// Background desktop snapshot: ONLY updates when screen is completely open / resting
// Puts WebRTC track to sleep between snapshots to eliminate 100% of cursor errors & CPU drain
let captureStream = null;
let isRefreshingSnapshot = false;

function refreshSnapshot() {
  if (!captureStream || !isCapturing || !gl || isRefreshingSnapshot) return;
  if (lidMotion && (lidMotion.isClosing || lidMotion.displayed > 0.0)) return;

  const track = captureStream.getVideoTracks()[0];
  if (!track) return;

  isRefreshingSnapshot = true;
  track.enabled = true;

  video.play().then(() => {
    setTimeout(() => {
      if (video.readyState >= video.HAVE_CURRENT_DATA && (!lidMotion || (!lidMotion.isClosing && lidMotion.displayed <= 0.0))) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        updateBlurPyramid();
        lastCaptureTime = performance.now();
      }
      // Immediately disable track and pause video to sleep WebRTC frame grabber
      if (track) track.enabled = false;
      video.pause();
      isRefreshingSnapshot = false;
    }, 120);
  }).catch(() => {
    if (track) track.enabled = false;
    isRefreshingSnapshot = false;
  });
}

// Silky 60+ FPS VSync-locked render loop
function renderFold(timestamp) {
  if (!gl || !lidMotion) return;

  const time = (timestamp || performance.now()) / 1000.0;
  const progress = lidMotion.sample(time);

  if (progress <= 0.0 && !lidMotion.isClosing) {
    // Lid is fully open/resting: clear overlay to 0% opacity
    if (isOverlayDrawn) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      isOverlayDrawn = false;
    }
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    return;
  }

  isOverlayDrawn = true;

  // Smooth cubic opacity blend for first 2.5% of closure
  const blend = Math.min(progress / 0.025, 1.0);
  const opacity = blend * blend * (3.0 - 2.0 * blend);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.0, 0.0, 0.0, 0.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(foldProgram);
  gl.bindVertexArray(quadVao);

  // Bind pre-cached textures (zero upload overhead during fold)
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.uniform1i(gl.getUniformLocation(foldProgram, 'uSource'), 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, softTexture);
  gl.uniform1i(gl.getUniformLocation(foldProgram, 'uSoft'), 1);

  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, mediumTexture);
  gl.uniform1i(gl.getUniformLocation(foldProgram, 'uMedium'), 2);

  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, broadTexture);
  gl.uniform1i(gl.getUniformLocation(foldProgram, 'uBroad'), 3);

  gl.uniform1f(gl.getUniformLocation(foldProgram, 'uProgress'), progress);
  gl.uniform1f(gl.getUniformLocation(foldProgram, 'uOpacity'), opacity);

  // Single fast GPU draw call (~0.05ms)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Keep RAF going while folding
  animationFrameId = requestAnimationFrame(renderFold);
}

function wakeRenderLoop() {
  if (!animationFrameId) {
    animationFrameId = requestAnimationFrame(renderFold);
  }
}

async function startCapture(sourceId) {
  isCapturing = true;

  try {
    captureStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxFrameRate: 15
        },
        optional: [
          { googCursor: false },
          { cursor: 'never' }
        ]
      }
    });

    const track = captureStream.getVideoTracks()[0];
    if (track) {
      track.onended = () => {
        loadSystemWallpaper();
      };
    }

    video.srcObject = captureStream;
    video.onloadedmetadata = async () => {
      try {
        refreshSnapshot();
        ipcRenderer.send('overlay-ready');
      } catch (e) {
        loadSystemWallpaper();
        ipcRenderer.send('overlay-ready');
      }
    };

    if (!backgroundCaptureInterval) {
      // Relaxed 4-second cadence to refresh background snapshot while resting
      backgroundCaptureInterval = setInterval(refreshSnapshot, 4000);
    }
  } catch (err) {
    loadSystemWallpaper();
    ipcRenderer.send('overlay-ready');
  }
}

function stopCapture() {
  if (backgroundCaptureInterval) {
    clearInterval(backgroundCaptureInterval);
    backgroundCaptureInterval = null;
  }
  if (captureStream) {
    captureStream.getTracks().forEach(track => track.stop());
    captureStream = null;
  }
  video.srcObject = null;
  isCapturing = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (gl) {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  isOverlayDrawn = false;
}

window.addEventListener('resize', () => {
  if (gl) {
    allocateTextures();
    initDefaultPattern();
    updateBlurPyramid();
  }
});

// DOM loaded: initialize GL and signal ready to main process
window.addEventListener('DOMContentLoaded', () => {
  initGL();
  ipcRenderer.send('overlay-dom-ready');
});

// IPC Listeners
ipcRenderer.on('init-capture', (event, { sourceId, openAngle, inverted }) => {
  initGL();
  if (typeof openAngle === 'number') {
    lidMotion.setBaseline(openAngle);
  }
  if (inverted !== undefined) {
    lidMotion.setInverted(inverted);
  }
  lidMotion.setEnabled(true);
  startCapture(sourceId);
});

ipcRenderer.on('sensor-angle', (event, { angle }) => {
  if (!lidMotion) return;
  const update = lidMotion.receive(angle, performance.now() / 1000.0);
  if (update.beganClosing || lidMotion.isClosing) {
    wakeRenderLoop();
  }
});

ipcRenderer.on('update-config', (event, { openAngle, inverted }) => {
  if (!lidMotion) return;
  if (typeof openAngle === 'number') {
    lidMotion.setBaseline(openAngle);
  }
  if (inverted !== undefined) {
    lidMotion.setInverted(inverted);
  }
});

ipcRenderer.on('stop-capture', () => {
  if (lidMotion) {
    lidMotion.setEnabled(false);
  }
  stopCapture();
});
