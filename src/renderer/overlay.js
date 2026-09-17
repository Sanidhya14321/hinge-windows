const { ipcRenderer } = require('electron');

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
let currentProgress = 0.0;
let currentOpacity = 0.0;
let animationFrameId = null;
let isDrawing = false;
let screenWidth = window.innerWidth;
let screenHeight = window.innerHeight;

// Fullscreen quad [-1, 1]
const quadVertices = new Float32Array([
  -1.0, -1.0,
   1.0, -1.0,
  -1.0,  1.0,
   1.0,  1.0
]);

function initGL() {
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

  return true;
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

  const smallW = Math.max(Math.floor(screenWidth / 4), 1);
  const smallH = Math.max(Math.floor(screenHeight / 4), 1);

  sourceTexture = createTexture(screenWidth, screenHeight);
  smallTexture = createTexture(smallW, smallH);
  softTexture = createTexture(smallW, smallH);
  mediumTexture = createTexture(smallW, smallH);
  broadTexture = createTexture(smallW, smallH);
  tempBlurTexture = createTexture(smallW, smallH);
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

  // Copy sourceTexture into smallTexture
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

  // Downsample source to 1/4 size
  downsampleSource(smallW, smallH);

  // Soft blur (~6px scaled)
  const refWidth = 786.0;
  const scale = smallW / refWidth;
  applyBlurPass(smallTexture, softTexture, 6.0 * scale, smallW, smallH);
  applyBlurPass(smallTexture, mediumTexture, 16.0 * scale, smallW, smallH);
  applyBlurPass(smallTexture, broadTexture, 36.0 * scale, smallW, smallH);
}

function renderFold() {
  if (!gl || !isCapturing) return;

  if (currentProgress <= 0.0) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    isDrawing = false;
    return;
  }

  isDrawing = true;

  // Upload latest video frame to sourceTexture
  if (video.readyState >= video.HAVE_CURRENT_DATA) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    updateBlurPyramid();
  }

  // Calculate smooth cubic opacity blend for first 2.5% of closure
  const blend = Math.min(currentProgress / 0.025, 1.0);
  currentOpacity = blend * blend * (3.0 - 2.0 * blend);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.0, 0.0, 0.0, 0.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(foldProgram);
  gl.bindVertexArray(quadVao);

  // Bind textures
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

  gl.uniform1f(gl.getUniformLocation(foldProgram, 'uProgress'), currentProgress);
  gl.uniform1f(gl.getUniformLocation(foldProgram, 'uOpacity'), currentOpacity);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function startRenderLoop() {
  function loop() {
    renderFold();
    animationFrameId = requestAnimationFrame(loop);
  }
  if (!animationFrameId) {
    animationFrameId = requestAnimationFrame(loop);
  }
}

async function startCapture(sourceId) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: screenWidth,
          maxWidth: screenWidth,
          minHeight: screenHeight,
          maxHeight: screenHeight,
          maxFrameRate: 60
        }
      }
    });

    video.srcObject = stream;
    await video.play();
    isCapturing = true;
    startRenderLoop();
    ipcRenderer.send('overlay-ready');
  } catch (err) {
    console.error('Failed to capture screen:', err);
    ipcRenderer.send('overlay-error', err.message);
  }
}

function stopCapture() {
  if (video.srcObject) {
    const tracks = video.srcObject.getTracks();
    tracks.forEach(track => track.stop());
    video.srcObject = null;
  }
  isCapturing = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (gl) {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}

window.addEventListener('resize', () => {
  if (gl) {
    allocateTextures();
  }
});

// IPC Listeners
ipcRenderer.on('init-capture', (event, { sourceId }) => {
  if (!gl) {
    initGL();
  }
  startCapture(sourceId);
});

ipcRenderer.on('update-motion', (event, { progress }) => {
  currentProgress = progress;
  if (!animationFrameId && isCapturing) {
    startRenderLoop();
  }
});

ipcRenderer.on('stop-capture', () => {
  stopCapture();
});
