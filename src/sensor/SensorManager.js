const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

class SensorManager extends EventEmitter {
  constructor() {
    super();
    this.hardwareAvailable = false;
    this.sensorType = 'Virtual Lid Sensor';
    this.isTracking = false;
    this.currentAngle = 100.0;
    this.streamProcess = null;
    this.demoInterval = null;
    this.demoStep = 0;
  }

  async init() {
    try {
      const probeScript = path.join(__dirname, 'probe-sensor.ps1');
      const probe = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', probeScript], {
        windowsHide: true
      });

      let stdout = '';
      probe.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      await new Promise((resolve) => {
        probe.on('close', resolve);
        setTimeout(resolve, 3000);
      });

      if (stdout.includes('HARDWARE_SENSOR_FOUND')) {
        this.hardwareAvailable = true;
        this.sensorType = 'Windows HingeAngleSensor (Hardware)';
        this.emit('sensor-detected', { hardware: true, name: this.sensorType });
      } else {
        this.hardwareAvailable = false;
        this.sensorType = 'Virtual / Interactive Lid (Demo Mode)';
        this.emit('sensor-detected', { hardware: false, name: this.sensorType });
      }
    } catch (e) {
      this.hardwareAvailable = false;
      this.sensorType = 'Virtual / Interactive Lid (Fallback)';
    }

    // Emit initial angle
    this.emit('angle', this.currentAngle);
  }

  start() {
    if (this.hardwareAvailable) {
      this.startHardwareStream();
    } else {
      // In virtual mode, emit steady current angle
      this.emit('angle', this.currentAngle);
    }
  }

  startHardwareStream() {
    if (this.streamProcess) {
      return;
    }
    const streamScript = path.join(__dirname, 'winrt-stream.ps1');
    this.streamProcess = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', streamScript], {
      windowsHide: true
    });

    let buffer = '';
    this.streamProcess.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed);
          if (typeof json.angle === 'number') {
            this.currentAngle = json.angle;
            this.emit('angle', this.currentAngle);
          }
        } catch (err) {
          // ignore non-json lines
        }
      }
    });

    this.streamProcess.on('exit', () => {
      this.streamProcess = null;
    });
  }

  stopHardwareStream() {
    if (this.streamProcess) {
      this.streamProcess.kill();
      this.streamProcess = null;
    }
  }

  setVirtualAngle(angle) {
    const clamped = Math.min(Math.max(angle, 10), 180);
    this.currentAngle = clamped;
    this.emit('angle', this.currentAngle);
  }

  adjustVirtualAngle(delta) {
    this.setVirtualAngle(this.currentAngle + delta);
  }

  startDemoFold(baseline = 100, onComplete = null) {
    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }

    let progress = 0;
    const duration = 3000; // 3 seconds full fold cycle
    const startTime = performance.now();
    const minAngle = 20;

    this.demoInterval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      progress = elapsed / duration;

      if (progress >= 1.0) {
        clearInterval(this.demoInterval);
        this.demoInterval = null;
        this.setVirtualAngle(baseline);
        if (onComplete) onComplete();
        return;
      }

      // Smooth cosine wave: 0 -> 1 -> 0
      const wave = (1 - Math.cos(progress * 2 * Math.PI)) / 2;
      const angle = baseline - wave * (baseline - minAngle);
      this.setVirtualAngle(angle);
    }, 16);
  }

  stopDemoFold() {
    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }
  }

  get status() {
    return {
      hardwareAvailable: this.hardwareAvailable,
      sensorType: this.sensorType,
      currentAngle: this.currentAngle
    };
  }

  stop() {
    this.stopHardwareStream();
    this.stopDemoFold();
  }
}

module.exports = { SensorManager };
