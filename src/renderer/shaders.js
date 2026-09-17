/**
 * WebGL 2.0 Shaders for Hinge (for Windows)
 * Direct mathematical translation of Resources/Fold.metal
 */

const Shaders = {
  // Fullscreen quad vertex shader
  quadVertex: `#version 300 es
    in vec2 aPosition;
    out vec2 vUv;
    void main() {
      // aPosition is [-1, 1]
      // Map to [0, 1] with Y=0 at TOP and Y=1 at BOTTOM to match macOS screen coordinates
      vUv = vec2((aPosition.x + 1.0) * 0.5, (1.0 - aPosition.y) * 0.5);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `,

  // Standard UV quad vertex shader for FBO blur passes (aligned with OpenGL framebuffer row 0)
  fboVertex: `#version 300 es
    in vec2 aPosition;
    out vec2 vUv;
    void main() {
      vUv = vec2((aPosition.x + 1.0) * 0.5, (aPosition.y + 1.0) * 0.5);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `,

  // High-performance 5-tap linear-sampled Gaussian blur fragment shader
  gaussianBlurFragment: `#version 300 es
    precision mediump float;
    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uTexture;
    uniform vec2 uDirection; // (1.0 / width, 0.0) or (0.0, 1.0 / height)
    uniform float uRadius;

    void main() {
      vec2 offset = uDirection * (uRadius * 0.45);
      vec4 color = texture(uTexture, vUv) * 0.227027;
      color += texture(uTexture, vUv + offset * 1.384615) * 0.316216;
      color += texture(uTexture, vUv - offset * 1.384615) * 0.316216;
      color += texture(uTexture, vUv + offset * 3.230769) * 0.070270;
      color += texture(uTexture, vUv - offset * 3.230769) * 0.070270;
      fragColor = color;
    }
  `,

  // Fold perspective and progressive blur fragment shader (Fold.metal port)
  foldFragment: `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 fragColor;

    uniform sampler2D uSource;
    uniform sampler2D uSoft;
    uniform sampler2D uMedium;
    uniform sampler2D uBroad;

    uniform float uProgress;
    uniform float uOpacity;

    void main() {
      // Perspective projection: homogeneous horizontal taper
      // As lid closes, top (vUv.y = 0.0) compresses horizontally while bottom remains anchored
      float q = (1.0 + 0.30 * uProgress) / (1.0 + 0.30 * uProgress * vUv.y);
      vec2 uv = vec2((vUv.x - 0.5) * q + 0.5, vUv.y * q);

      float edge = min(uv.x, 1.0 - uv.x);

      // Outside the projected screen edge: extend with broad blur
      if (edge <= 0.0) {
        vec3 broadColor = texture(uBroad, clamp(uv, 0.0, 1.0)).rgb;
        fragColor = vec4(broadColor * uOpacity, uOpacity);
        return;
      }

      // Progressive blur amount: maximum at the top (vUv.y = 0), fades towards the bottom
      float amount = 36.0 * uProgress * (1.0 - smoothstep(0.0, 0.9, uv.y));
      vec3 color;

      vec3 srcCol = texture(uSource, uv).rgb;
      vec3 softCol = texture(uSoft, uv).rgb;
      vec3 medCol = texture(uMedium, uv).rgb;
      vec3 broadCol = texture(uBroad, uv).rgb;

      if (amount < 6.0) {
        color = mix(srcCol, softCol, amount / 6.0);
      } else if (amount < 16.0) {
        color = mix(softCol, medCol, (amount - 6.0) / 10.0);
      } else {
        color = mix(medCol, broadCol, min((amount - 16.0) / 20.0, 1.0));
      }

      // Shading: upper edge and top corners darken subtly as lid closes
      float upper = 1.0 - smoothstep(0.0, 0.85, uv.y);
      float corners = (1.0 - smoothstep(0.0, 0.19, edge)) * upper;
      color *= 1.0 - uProgress * (0.50 * corners + 0.10 * upper);

      // Side feathering into broad blurred background
      float feather = smoothstep(0.0, max(0.0001, uProgress * 0.012 * (1.0 - uv.y)), edge);
      if (feather < 1.0) {
        color = mix(broadCol, color, feather);
      }

      fragColor = vec4(color * uOpacity, uOpacity);
    }
  `,

  createProgram(gl, vertexSrc, fragmentSrc) {
    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compilation error: ${info}`);
      }
      return shader;
    }

    const vs = compile(gl.VERTEX_SHADER, vertexSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragmentSrc);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link error: ${info}`);
    }

    return program;
  }
};

if (typeof module !== 'undefined') {
  module.exports = { Shaders };
}
