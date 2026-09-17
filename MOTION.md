# Motion Reference: Hinge (for Windows)

This document outlines the motion timing, sensor pipeline, and shader projection geometry ported to Windows.

## Sensor Pipeline on Windows

### Hardware Detection
Windows laptops support lid angle detection across multiple interfaces:
1. **WinRT `Windows.Devices.Sensors.HingeAngleSensor`**: Built into Windows 10 (version 2004+) and Windows 11 for convertible and 2-in-1 laptops (e.g. Surface Laptop Studio, Lenovo Yoga, HP Spectre x360, Dell 2-in-1, Asus Zenbook Flip).
2. **USB/HID Sensors**: HID devices on Usage Page `0x0020` (Sensors) and Usage `0x008A` (Hinge Angle).
3. **Interactive Virtual Sensor & Simulation**: Standard clamshell laptops typically only feature an ACPI binary lid-closed switch rather than a 0–180° continuous angle potentiometer. Hinge (for Windows) automatically detects hardware sensor capabilities and provides an interactive test slider, global hotkeys (`Ctrl+Shift+[` and `Ctrl+Shift+]`), and an animated demo fold so users on any Windows PC can experience the full fold effect.

## Motion Filter & Smoothing

The motion filter in `src/motion/LidMotion.js` is a direct mathematical port of Hinge's macOS algorithm:
- **Baseline Calibration**: The default open viewing position is 100°. The user can calibrate any angle $\ge 25^\circ$ using "Set open position".
- **Noise Deadband**: A $0.6^\circ$ deadband suppresses alternating integer sensor readings from causing jitter.
- **Angular Velocity Estimation**: Filtered with a $60\text{ ms}$ time constant:
  $$\omega \leftarrow \omega + (\omega_{\text{measured}} - \omega) \cdot (1 - e^{-\Delta t / 0.06})$$
- **Lookahead Prediction**: Velocity prediction looks ahead by $35\text{ ms}$ (clamped to $\pm 0.75^\circ$).
- **Normalized Target Mapping**:
  $$\text{target} = \text{clamp}\left(\frac{\text{baseline} - 0.6 - \theta_{\text{tracked}} - \text{prediction}}{\text{baseline} - 8.6}, 0, 1\right)$$
- **Critically Damped Second-Order Response**:
  $$\text{frequency} = 30 + \min(|\omega| \cdot 0.55, 25) \text{ rad/s}$$
  Smoothly interpolates position and velocity without overshooting or stair-stepping.

## GPU Projection & Shader Math

The rendering pipeline in `src/renderer/shaders.js` ports `Resources/Fold.metal` to WebGL 2.0:
- **Homogeneous Horizontal Taper**:
  $$q = \frac{1.0 + 0.30 \cdot p}{1.0 + 0.30 \cdot p \cdot y}$$
  $$\mathbf{uv}_{\text{projected}} = \left((x - 0.5) \cdot q + 0.5, \; y \cdot q\right)$$
  The bottom of the screen ($y = 1$) stays anchored, while the top ($y = 0$) narrows horizontally by up to 11.5% on each side.
- **Multi-Level Gaussian Blur Pyramid**:
  - Downsampled 4x offscreen texture for high-efficiency 60 FPS performance.
  - Three cached blur levels: Soft ($6\text{ px}$), Medium ($16\text{ px}$), Broad ($36\text{ px}$).
  - Progress-dependent blur fades toward the lower tenth of the screen:
    $$\text{amount} = 36.0 \cdot p \cdot (1.0 - \text{smoothstep}(0.0, 0.9, y))$$
- **Corner Shading & Feathering**:
  Darkens top corners subtly and feathers outer edges into the broad blurred desktop extension.
- **Smooth Presentation Blend**:
  First 2.5% of closure uses a cubic Hermite curve ($3b^2 - 2b^3$) for a seamless fade-in from the live desktop.
