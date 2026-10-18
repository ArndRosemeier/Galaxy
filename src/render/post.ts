/**
 * The post chain: HDR scene target → bloom → ACES tone map → sRGB → screen.
 *
 * Design constraints, from `docs/ARCHITECTURE.md` and the view budgets:
 *  - **4 draw calls total.** A bright-pass at half resolution, one separable blur pair
 *    (a dual-radius gaussian, so a tight sparkle and a wide halo both come for free),
 *    and one composite that also does tone mapping, the vignette and the cinematic
 *    flash used by camera flights. There is no SMAA pass: the scene target is
 *    multisampled (`samples: 4`), which is both cheaper and sharper on planet limbs.
 *  - **HDR throughout.** The scene is rendered into a half-float target with no tone
 *    mapping, so emissive values above 1 (star cores, specular, lava) survive into the
 *    bloom; the composite applies ACES once and encodes sRGB once. That is the only
 *    correct place to do either.
 *  - **No silent fallback.** Half-float render targets are required; if the context
 *    cannot render to one, construction throws with the reason rather than quietly
 *    rendering a tone-mapping-free, banded image.
 */

import * as THREE from 'three';
import { GLSL_TONEMAP } from './glsl';

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D uScene;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
void main() {
  // 4-tap box downsample (half resolution), so the bloom sees a stable signal.
  vec3 c = texture2D(uScene, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  c += texture2D(uScene, vUv + vec2( 1.0, -1.0) * uTexel).rgb;
  c += texture2D(uScene, vUv + vec2(-1.0,  1.0) * uTexel).rgb;
  c += texture2D(uScene, vUv + vec2( 1.0,  1.0) * uTexel).rgb;
  c *= 0.25;

  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float soft = clamp((luma - uThreshold + uKnee) / (2.0 * uKnee), 0.0, 1.0);
  float contribution = max(luma - uThreshold, 0.0) + soft * soft * uKnee * 0.5;
  gl_FragColor = vec4(c * (contribution / max(luma, 1e-4)), 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  // Two gaussians in one pass: a 5-tap tight core plus a 4-tap wide halo.
  vec3 sum = texture2D(uTex, vUv).rgb * 0.24;
  sum += (texture2D(uTex, vUv + uDir * 1.0).rgb + texture2D(uTex, vUv - uDir * 1.0).rgb) * 0.155;
  sum += (texture2D(uTex, vUv + uDir * 2.0).rgb + texture2D(uTex, vUv - uDir * 2.0).rgb) * 0.105;
  sum += (texture2D(uTex, vUv + uDir * 3.0).rgb + texture2D(uTex, vUv - uDir * 3.0).rgb) * 0.055;
  sum += (texture2D(uTex, vUv + uDir * 5.5).rgb + texture2D(uTex, vUv - uDir * 5.5).rgb) * 0.025;
  gl_FragColor = vec4(sum, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
${GLSL_TONEMAP}
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uFlash;
uniform float uVignette;
uniform vec3 uFlashColor;
uniform float uTime;
varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  vec2 center = uv - 0.5;

  vec3 scene = texture2D(uScene, uv).rgb;

  // The flight flash is a radial dolly blur: the frame appears to rush past while the
  // white-hot core covers the scale change between views. Subtle on purpose.
  if (uFlash > 0.001) {
    vec3 zoom = vec3(0.0);
    float total = 0.0;
    for (int i = 0; i < 6; i++) {
      float k = float(i) / 5.0;
      float scale = 1.0 - k * 0.055 * uFlash;
      float w = 1.0 - k * 0.45;
      zoom += texture2D(uScene, center * scale + 0.5).rgb * w;
      total += w;
    }
    scene = mix(scene, zoom / total, clamp(uFlash * 0.85, 0.0, 0.9));
  }

  vec3 bloom = texture2D(uBloom, uv).rgb;
  vec3 color = scene + bloom * uBloomStrength;

  // Warm flash at the frame centre, added before tone mapping so it rolls off.
  float core = exp(-dot(center * vec2(1.35, 1.0), center * vec2(1.35, 1.0)) * 18.0);
  color += uFlashColor * uFlash * (0.35 + 1.45 * core);

  color = acesTone(color * uExposure);

  // A soft vignette is most of what makes a frame look like a lens rather than a buffer.
  float vig = smoothstep(1.25, 0.30, length(center * vec2(1.0, 0.82)));
  color *= mix(1.0, vig, uVignette);

  // Ordered-ish dither kills 8-bit banding in the dark half of the sky.
  float dither = fract(sin(dot(uv + uTime * 0.0001, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  color += dither / 255.0;

  gl_FragColor = vec4(linearToSRGB(clamp(color, 0.0, 1.0)), 1.0);
}
`;

export interface PostOptions {
  /** Bloom contribution, per view. */
  bloomStrength: number;
  exposure?: number;
  vignette?: number;
}

export class PostChain {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly sceneRT: THREE.WebGLRenderTarget;
  private readonly bloomA: THREE.WebGLRenderTarget;
  private readonly bloomB: THREE.WebGLRenderTarget;
  private readonly brightMaterial: THREE.ShaderMaterial;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly quadScene: THREE.Scene;
  private readonly quadCamera: THREE.OrthographicCamera;
  private readonly quad: THREE.Mesh;
  private readonly quadGeometry: THREE.PlaneGeometry;
  readonly samples: number;
  private width = 1;
  private height = 1;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const ext = renderer.extensions;
    if (
      !ext.has('EXT_color_buffer_half_float') &&
      !ext.has('EXT_color_buffer_float') &&
      !ext.has('WEBGL_color_buffer_float')
    ) {
      throw new Error(
        'GalaxyRenderer: this WebGL context cannot render to half-float targets ' +
          '(needs EXT_color_buffer_half_float). HDR bloom and ACES tone mapping are not optional here.',
      );
    }

    const maxSamples = renderer.capabilities.maxSamples;
    this.samples = Math.min(4, maxSamples);

    const target = (): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: true,
        stencilBuffer: false,
        samples: this.samples,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      });

    this.sceneRT = target();
    this.sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.sceneRT.texture.name = 'hdr-scene';

    const bloomTarget = (): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      });
    this.bloomA = bloomTarget();
    this.bloomB = bloomTarget();
    this.bloomA.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.bloomB.texture.colorSpace = THREE.LinearSRGBColorSpace;

    this.brightMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BRIGHT_FRAG,
      uniforms: {
        uScene: { value: this.sceneRT.texture },
        uTexel: { value: new THREE.Vector2(0.5, 0.5) },
        uThreshold: { value: 0.72 },
        uKnee: { value: 0.42 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.blurMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: {
        uTex: { value: null },
        uDir: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        uScene: { value: this.sceneRT.texture },
        uBloom: { value: this.bloomA.texture },
        uBloomStrength: { value: 0.7 },
        uExposure: { value: 1.0 },
        uFlash: { value: 0 },
        uVignette: { value: 0.34 },
        uFlashColor: { value: new THREE.Color(1.0, 0.82, 0.58) },
        uTime: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.quadGeometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(this.quadGeometry, this.brightMaterial);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadCamera.position.set(0, 0, 1);
  }

  /** Resize the internal targets. `width`/`height` are CSS pixels; `dpr` is capped by the caller. */
  setSize(width: number, height: number, dpr: number): void {
    const maxTexture = this.renderer.capabilities.maxTextureSize;
    const w = Math.max(1, Math.min(Math.floor(width * dpr), maxTexture));
    const h = Math.max(1, Math.min(Math.floor(height * dpr), maxTexture));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.sceneRT.setSize(w, h);
    const bw = Math.max(1, Math.floor(w / 2));
    const bh = Math.max(1, Math.floor(h / 2));
    this.bloomA.setSize(bw, bh);
    this.bloomB.setSize(bw, bh);
    (this.brightMaterial.uniforms.uTexel!.value as THREE.Vector2).set(0.5 / w, 0.5 / h);
  }

  private drawQuad(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, options: PostOptions): void {
    const renderer = this.renderer;
    renderer.setRenderTarget(this.sceneRT);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);

    this.drawQuad(this.brightMaterial, this.bloomA);

    const bw = this.bloomA.width;
    const bh = this.bloomA.height;
    const blur = this.blurMaterial.uniforms;
    blur.uTex!.value = this.bloomA.texture;
    (blur.uDir!.value as THREE.Vector2).set(1 / bw, 0);
    this.drawQuad(this.blurMaterial, this.bloomB);

    blur.uTex!.value = this.bloomB.texture;
    (blur.uDir!.value as THREE.Vector2).set(0, 1 / bh);
    this.drawQuad(this.blurMaterial, this.bloomA);

    const composite = this.compositeMaterial.uniforms;
    composite.uBloomStrength!.value = options.bloomStrength;
    composite.uExposure!.value = options.exposure ?? 1.0;
    composite.uVignette!.value = options.vignette ?? 0.34;
    composite.uTime!.value = (composite.uTime!.value as number) + 1;
    this.drawQuad(this.compositeMaterial, null);
  }

  setFlash(amount: number): void {
    this.compositeMaterial.uniforms.uFlash!.value = THREE.MathUtils.clamp(amount, 0, 1);
  }

  dispose(): void {
    this.sceneRT.dispose();
    this.bloomA.dispose();
    this.bloomB.dispose();
    this.brightMaterial.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
    this.quadGeometry.dispose();
  }
}
