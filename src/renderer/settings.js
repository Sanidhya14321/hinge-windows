const { ipcRenderer } = require('electron');

const toggleActive = document.getElementById('toggle-active');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const openAngleDisplay = document.getElementById('open-angle-display');
const btnCalibrate = document.getElementById('btn-calibrate');
const sensorTypeLabel = document.getElementById('sensor-type-label');
const currentAngleLabel = document.getElementById('current-angle-label');
const lidAngleSlider = document.getElementById('lid-angle-slider');
const btnDemoFold = document.getElementById('btn-demo-fold');
const infoMessage = document.getElementById('info-message');
const btnClose = document.getElementById('btn-close');

let isUserDraggingSlider = false;

// Event Listeners
btnClose.addEventListener('click', () => {
  ipcRenderer.send('close-settings');
});

toggleActive.addEventListener('change', (e) => {
  const enabled = e.target.checked;
  statusText.textContent = enabled ? 'Starting…' : 'Off';
  statusDot.classList.toggle('active', enabled);
  ipcRenderer.send('toggle-active', enabled);
});

btnCalibrate.addEventListener('click', () => {
  ipcRenderer.send('calibrate-angle');
});

btnDemoFold.addEventListener('click', () => {
  btnDemoFold.disabled = true;
  btnDemoFold.textContent = 'Folding…';
  ipcRenderer.send('start-demo-fold');
  setTimeout(() => {
    btnDemoFold.disabled = false;
    btnDemoFold.textContent = 'Test Lid Bend';
  }, 3200);
});

lidAngleSlider.addEventListener('mousedown', () => {
  isUserDraggingSlider = true;
});

lidAngleSlider.addEventListener('mouseup', () => {
  isUserDraggingSlider = false;
});

lidAngleSlider.addEventListener('input', (e) => {
  const angle = parseFloat(e.target.value);
  currentAngleLabel.textContent = `${Math.round(angle)}°`;
  ipcRenderer.send('set-virtual-angle', angle);
});

const toggleInvert = document.getElementById('toggle-invert');

toggleInvert.addEventListener('change', (e) => {
  ipcRenderer.send('toggle-invert', e.target.checked);
});

// IPC Incoming State
ipcRenderer.on('state-update', (event, state) => {
  toggleActive.checked = state.isActive;
  statusText.textContent = state.isStarting ? 'Starting…' : state.isActive ? 'On' : 'Off';
  statusDot.classList.toggle('active', state.isActive);
  openAngleDisplay.textContent = `${Math.round(state.openAngle)}°`;
  sensorTypeLabel.textContent = state.sensorType || 'Virtual Lid Sensor';
  currentAngleLabel.textContent = `${Math.round(state.currentAngle)}°`;
  toggleInvert.checked = Boolean(state.inverted);

  if (!isUserDraggingSlider) {
    lidAngleSlider.value = state.currentAngle;
  }

  if (state.error) {
    infoMessage.textContent = state.error;
    infoMessage.style.color = '#ff9900';
  } else {
    infoMessage.textContent = 'Starts at 100°. Set your comfortable open position once, and Hinge remembers it.';
    infoMessage.style.color = '';
  }
});

// Request initial state on load
ipcRenderer.send('get-state');
