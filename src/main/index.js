const { app, BrowserWindow, Tray, Menu, ipcMain, desktopCapturer, screen, powerMonitor, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { LidMotion } = require('../motion/LidMotion');
const { SensorManager } = require('../sensor/SensorManager');

// Single instance lock
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// Config file path for persistent settings
const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {}
  return { openAngle: 100, autoStart: true };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {}
}

const config = loadConfig();

let tray = null;
let settingsWindow = null;
let overlayWindow = null;
let sensorManager = null;
let lidMotion = null;

let isActive = false;
let isStarting = false;
let currentError = null;
let motionLoopInterval = null;
let overlayIsReady = false;

function broadcastState(updateTray = false) {
  const state = {
    isActive,
    isStarting,
    openAngle: lidMotion ? lidMotion.openAngle : 100,
    currentAngle: sensorManager ? sensorManager.currentAngle : 100,
    sensorType: sensorManager ? sensorManager.sensorType : 'Checking sensor…',
    hardwareAvailable: sensorManager ? sensorManager.hardwareAvailable : false,
    error: currentError
  };

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('state-update', state);
  }
  if (updateTray) {
    updateTrayMenu();
  }
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 400,
    height: 520,
    resizable: false,
    maximizable: false,
    frame: false,
    show: false,
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));

  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show();
    broadcastState(true);
  });

  settingsWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      settingsWindow.hide();
    }
  });
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.bounds;

  overlayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    }
  });

  // Pure OS-level click-through on Windows (WS_EX_TRANSPARENT)
  overlayWindow.setIgnoreMouseEvents(true);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');

  overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'));

  overlayWindow.once('ready-to-show', () => {
    overlayWindow.showInactive();
  });
}

async function sendCaptureSourceToOverlay() {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    const primarySource = sources.find(s => s.id.startsWith('screen:') || s.name === 'Entire screen') || sources[0];

    if (!primarySource) {
      throw new Error('No desktop screen found.');
    }

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('init-capture', {
        sourceId: primarySource.id
      });
    }
  } catch (err) {
    console.error('Failed to get screen sources:', err.message);
  }
}

async function startCapture() {
  if (isActive || isStarting) return;
  isStarting = true;
  currentError = null;
  broadcastState(true);

  try {
    createOverlayWindow();

    if (overlayIsReady) {
      await sendCaptureSourceToOverlay();
    }

    lidMotion.setEnabled(true);
    startMotionLoop();

    isActive = true;
    isStarting = false;
    broadcastState(true);
  } catch (err) {
    isActive = false;
    isStarting = false;
    currentError = err.message || 'Failed to start screen capture.';
    stopCapture();
    broadcastState(true);
  }
}

function stopCapture() {
  isActive = false;
  isStarting = false;
  lidMotion.setEnabled(false);
  stopMotionLoop();

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('stop-capture');
  }
  broadcastState(true);
}

function startMotionLoop() {
  if (motionLoopInterval) return;

  // 60 Hz motion update dispatch to overlay renderer
  motionLoopInterval = setInterval(() => {
    if (!isActive) return;
    const progress = lidMotion.sample();

    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('update-motion', { progress });
    }
  }, 16);
}

function stopMotionLoop() {
  if (motionLoopInterval) {
    clearInterval(motionLoopInterval);
    motionLoopInterval = null;
  }
}

function updateTrayMenu() {
  if (!tray) return;

  const trayIconPath = isActive
    ? path.join(__dirname, '../assets/tray-active.png')
    : path.join(__dirname, '../assets/tray-inactive.png');

  if (fs.existsSync(trayIconPath)) {
    tray.setImage(trayIconPath);
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: isActive ? 'Turn off' : 'Turn on',
      enabled: !isStarting,
      click: () => {
        if (isActive) {
          stopCapture();
        } else {
          startCapture();
        }
      }
    },
    {
      label: 'Set open position',
      enabled: isActive && !isStarting,
      click: () => {
        calibrateOpenPosition();
      }
    },
    {
      label: 'Test Lid Bend (Demo)',
      enabled: isActive && !isStarting,
      click: () => {
        runDemoFold();
      }
    },
    { type: 'separator' },
    {
      label: 'Settings…',
      accelerator: 'CmdOrCtrl+,',
      click: () => {
        createSettingsWindow();
      }
    },
    {
      label: 'Quit Hinge',
      accelerator: 'CmdOrCtrl+Q',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip(`Hinge (for Windows) - ${isActive ? 'On' : 'Off'}`);
  tray.setContextMenu(contextMenu);
}

function calibrateOpenPosition() {
  const angle = lidMotion.calibrate();
  if (angle !== null) {
    config.openAngle = angle;
    saveConfig(config);
    currentError = null;
  } else {
    currentError = 'Open lid to your comfortable viewing position first.';
  }
  broadcastState(true);
}

function runDemoFold() {
  if (!isActive) {
    startCapture();
  }
  setTimeout(() => {
    sensorManager.startDemoFold(lidMotion.openAngle);
  }, 350);
}

function setupGlobalShortcuts() {
  // Hotkeys to fold/unfold virtual lid: Ctrl+Shift+[ and Ctrl+Shift+]
  globalShortcut.register('CommandOrControl+Shift+[', () => {
    if (!isActive) startCapture();
    sensorManager.adjustVirtualAngle(-5);
  });
  globalShortcut.register('CommandOrControl+Shift+]', () => {
    if (!isActive) startCapture();
    sensorManager.adjustVirtualAngle(+5);
  });
}

// App Lifecycle
app.whenReady().then(async () => {
  // Power and Display monitoring
  powerMonitor.on('suspend', () => {
    if (isActive) {
      stopCapture();
    }
    sensorManager.stop();
  });

  powerMonitor.on('resume', async () => {
    await sensorManager.init();
    sensorManager.start();
    broadcastState(true);
  });

  screen.on('display-metrics-changed', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      const primaryDisplay = screen.getPrimaryDisplay();
      overlayWindow.setBounds(primaryDisplay.bounds);
    }
  });

  // Initialize Motion with saved open angle
  lidMotion = new LidMotion(config.openAngle || 100);

  // Initialize Sensor Manager
  sensorManager = new SensorManager();
  sensorManager.on('angle', (angle) => {
    lidMotion.receive(angle);
    // Broadcast state without rebuilding tray every frame
    broadcastState(false);
  });

  await sensorManager.init();
  sensorManager.start();

  // Create Tray Icon
  const iconPath = path.join(__dirname, '../assets/tray-inactive.png');
  tray = new Tray(iconPath);
  tray.on('click', () => {
    createSettingsWindow();
  });

  updateTrayMenu();
  createSettingsWindow();
  setupGlobalShortcuts();

  // Proactively auto-start capture if configured
  if (config.autoStart) {
    setTimeout(() => {
      startCapture();
    }, 500);
  }
});

// IPC Handlers
ipcMain.on('get-state', () => {
  broadcastState(false);
});

ipcMain.on('toggle-active', (event, enabled) => {
  if (enabled) {
    startCapture();
  } else {
    stopCapture();
  }
});

ipcMain.on('calibrate-angle', () => {
  calibrateOpenPosition();
});

ipcMain.on('set-virtual-angle', (event, angle) => {
  if (!isActive) {
    startCapture();
  }
  sensorManager.setVirtualAngle(angle);
});

ipcMain.on('start-demo-fold', () => {
  runDemoFold();
});

ipcMain.on('close-settings', () => {
  if (settingsWindow) {
    settingsWindow.hide();
  }
});

ipcMain.on('overlay-dom-ready', () => {
  overlayIsReady = true;
  if (isActive || isStarting) {
    sendCaptureSourceToOverlay();
  }
});

ipcMain.on('overlay-ready', () => {
  currentError = null;
  broadcastState(false);
});

ipcMain.on('overlay-error', (event, message) => {
  currentError = message;
  broadcastState(false);
});

app.on('second-instance', () => {
  createSettingsWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopCapture();
  sensorManager.stop();
});
