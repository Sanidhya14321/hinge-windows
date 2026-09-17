/**
 * LidMotion filter port for Windows.
 *
 * Implements second-order critically damped motion smoothing, velocity estimation,
 * 0.6-degree noise deadband, and lookahead prediction, exactly matching Hinge's
 * macOS motion specifications.
 */

class LidMotion {
  constructor(openAngle = 100) {
    this.baseline = openAngle;
    this.angle = null;
    this.trackedAngle = null;
    this.angularVelocity = 0.0;
    this.direction = 0;
    this.enabled = false;
    this.target = 0.0;
    this.displayed = 0.0;
    this.displayVelocity = 0.0;
    this.lastFrame = 0.0;
    this.lastSample = 0.0;
    this.inverted = false;
  }

  now() {
    return performance.now() / 1000.0;
  }

  setInverted(val) {
    this.inverted = Boolean(val);
    this.reset();
    this.updateTarget();
  }

  receive(value, time = this.now()) {
    const changed = (this.angle === null) !== (value === null);
    const previous = this.target;
    this.angle = value;

    if (value !== null && this.trackedAngle !== null && this.lastSample > 0 && time >= this.lastSample) {
      const delta = Math.max(time - this.lastSample, 0.001);
      const nextAngle = Math.min(Math.max(this.trackedAngle, value - 0.6), value + 0.6);

      if (this.inverted) {
        if (nextAngle > this.trackedAngle) {
          this.direction = 1; // closing
        } else if (nextAngle < this.trackedAngle) {
          this.direction = -1; // opening
        }
      } else {
        if (nextAngle < this.trackedAngle) {
          this.direction = 1; // closing
        } else if (nextAngle > this.trackedAngle) {
          this.direction = -1; // opening
        }
      }

      const measuredVelocity = (nextAngle - this.trackedAngle) / delta;
      this.angularVelocity += (measuredVelocity - this.angularVelocity) * (1 - Math.exp(-delta / 0.06));
      this.trackedAngle = nextAngle;
    } else {
      this.trackedAngle = value;
      this.angularVelocity = 0.0;
      this.direction = 0;
    }

    this.lastSample = time;
    this.updateTarget(time);

    return {
      availabilityChanged: changed,
      available: value !== null,
      beganClosing: previous === 0 && this.target > 0
    };
  }

  calibrate() {
    if (this.angle === null || this.angle < 25) {
      return null;
    }
    this.baseline = this.angle;
    this.reset();
    return this.baseline;
  }

  setBaseline(angle) {
    if (typeof angle === 'number' && angle >= 25 && angle <= 180) {
      this.baseline = angle;
      this.reset();
      this.updateTarget();
    }
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    this.reset();
    this.updateTarget();
  }

  reset() {
    this.trackedAngle = this.angle;
    this.angularVelocity = 0.0;
    this.direction = 0;
    this.target = 0.0;
    this.displayed = 0.0;
    this.displayVelocity = 0.0;
    this.lastFrame = 0.0;
  }

  updateTarget(time = this.now()) {
    if (!this.enabled || this.baseline <= 8 || this.angle === null || this.trackedAngle === null) {
      this.target = 0.0;
      if (this.enabled) {
        this.direction = -1;
      }
      return;
    }

    const current = this.trackedAngle;
    const base = this.baseline;

    if (this.inverted) {
      // Inverted: closing is towards 180°
      if (current <= base) {
        this.target = 0.0;
        this.direction = -1;
        return;
      }
      const prediction = Math.min(Math.max(-this.velocity(time) * 0.035, -0.75), 0.75);
      this.target = Math.min(Math.max((current - 0.6 - base - prediction) / (180.0 - base - 8.6), 0), 1);
    } else {
      // Standard: angle decreases when closing towards keyboard (< baseline)
      // If angle >= baseline (upright to 180° flat), lid is open -> target = 0.0
      if (current >= base) {
        this.target = 0.0;
        this.direction = -1;
        return;
      }

      const prediction = Math.min(Math.max(this.velocity(time) * 0.035, -0.75), 0.75);
      this.target = Math.min(Math.max((base - 0.6 - current - prediction) / (base - 8.6), 0), 1);
    }
  }

  sample(time = this.now()) {
    if (!this.enabled || this.angle === null) {
      this.displayed = 0.0;
      this.displayVelocity = 0.0;
      return 0.0;
    }

    this.updateTarget(time);
    const elapsed = time - this.lastFrame;
    const delta = this.lastFrame > 0 && elapsed < 0.1 ? Math.min(Math.max(elapsed, 0.001), 0.033) : 1.0 / 60.0;
    this.lastFrame = time;

    const frequency = 30 + Math.min(Math.abs(this.velocity(time)) * 0.55, 25);
    const offset = this.displayed - this.target;
    const travel = (this.displayVelocity + frequency * offset) * delta;
    const decay = Math.exp(-frequency * delta);
    const previous = this.displayed;
    this.displayed = this.target + (offset + travel) * decay;
    this.displayVelocity = (this.displayVelocity - frequency * travel) * decay;

    // Monotonic clamping: if closing, displayed cannot decrease; if opening, displayed cannot increase
    if ((this.direction > 0 && this.displayed < previous) || (this.direction < 0 && this.displayed > previous)) {
      this.displayed = previous;
      this.displayVelocity = 0.0;
    }

    // Settling condition matching macOS Hinge
    const canSettle =
      this.direction === 0 || (this.direction > 0 && this.target >= this.displayed)
      || (this.direction < 0 && this.target <= this.displayed);
    if (canSettle && Math.abs(this.displayed - this.target) < 0.0001 && Math.abs(this.displayVelocity) < 0.0001) {
      this.displayed = this.target;
      this.displayVelocity = 0.0;
    }

    // Clamp bounds
    if (this.displayed < 0.0) {
      this.displayed = 0.0;
      this.displayVelocity = 0.0;
    } else if (this.displayed > 1.0) {
      this.displayed = 1.0;
      this.displayVelocity = 0.0;
    }

    return this.displayed;
  }

  velocity(time) {
    return this.angularVelocity * Math.exp(-Math.max(time - this.lastSample - 0.025, 0) / 0.08);
  }

  get isClosing() {
    return this.target > 0 || this.displayed > 0.0001;
  }

  get currentAngle() {
    return this.angle;
  }

  get openAngle() {
    return this.baseline;
  }
}

module.exports = { LidMotion };
