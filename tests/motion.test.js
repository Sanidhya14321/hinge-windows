const assert = require('assert');
const { LidMotion } = require('../src/motion/LidMotion');

console.log('--- Running LidMotion Tests ---');

// Test 1: Initial state
{
  const motion = new LidMotion(100);
  assert.strictEqual(motion.openAngle, 100, 'Default open angle should be 100');
  assert.strictEqual(motion.sample(), 0.0, 'Initial sample should be 0.0');
  console.log('✓ Test 1: Initial state passed');
}

// Test 2: Calibration
{
  const motion = new LidMotion(100);
  motion.receive(105, 1.0);
  const calibrated = motion.calibrate();
  assert.strictEqual(calibrated, 105, 'Calibrated angle should be 105');
  assert.strictEqual(motion.openAngle, 105, 'openAngle should be updated');

  // Below 25 should not calibrate
  motion.receive(20, 2.0);
  assert.strictEqual(motion.calibrate(), null, 'Should reject calibration below 25 degrees');
  console.log('✓ Test 2: Calibration passed');
}

// Test 3: Deadband & noise suppression
{
  const motion = new LidMotion(100);
  motion.setEnabled(true);
  motion.receive(100, 1.0);
  assert.strictEqual(motion.sample(1.0), 0.0, 'At 100 degrees, progress is 0');

  // Small perturbation within 0.6 degree deadband at baseline
  motion.receive(99.6, 1.05);
  // Tracked angle clamps to min(max(tracked, 99.6 - 0.6), 99.6 + 0.6) = 100.0 (no movement)
  assert.strictEqual(motion.isClosing, false, 'Noise within deadband should not trigger closing');
  console.log('✓ Test 3: Deadband & noise suppression passed');
}

// Test 4: Smooth closing progression
{
  const motion = new LidMotion(100);
  motion.setEnabled(true);
  motion.receive(100, 1.0);

  // Close towards 50 degrees over 0.5s
  let t = 1.0;
  for (let angle = 100; angle >= 50; angle -= 2) {
    t += 0.02;
    motion.receive(angle, t);
    const progress = motion.sample(t);
    assert(progress >= 0 && progress <= 1, `Progress must be in [0, 1], got ${progress}`);
  }

  assert(motion.isClosing, 'Should be closing');
  const midProgress = motion.sample(t);
  assert(midProgress > 0.4 && midProgress < 0.7, `Expected progress around 0.55, got ${midProgress}`);
  console.log(`✓ Test 4: Closing progression passed (sample=${midProgress.toFixed(3)})`);
}

// Test 5: Reopening settles cleanly to 0
{
  const motion = new LidMotion(100);
  motion.setEnabled(true);
  motion.receive(50, 1.0);
  motion.sample(1.0);

  // Reopen to 100
  let t = 1.0;
  for (let angle = 50; angle <= 100; angle += 5) {
    t += 0.02;
    motion.receive(angle, t);
    motion.sample(t);
  }

  // Allow filter to settle
  for (let i = 0; i < 20; i++) {
    t += 0.016;
    motion.sample(t);
  }

  const finalProgress = motion.sample(t);
  assert.strictEqual(finalProgress, 0.0, `Final progress should settle cleanly to 0.0, got ${finalProgress}`);
  assert.strictEqual(motion.isClosing, false, 'isClosing should be false');
  console.log('✓ Test 5: Reopening settlement passed');
}

console.log('All 5 LidMotion tests passed successfully!');
