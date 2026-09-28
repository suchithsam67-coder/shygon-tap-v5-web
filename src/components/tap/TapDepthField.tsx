import { useEffect, useRef } from 'react';

/**
 * The depth field behind GOAT's immersive layout.
 *
 * This is real 3D, not a CSS scale dressed up as one: the field below is a set
 * of points with x/y/z coordinates that are rotated by a yaw/pitch matrix and
 * then perspective-projected (`scale = focal / (focal + z)`) every frame. Depth
 * drives size, brightness and parallax, so points genuinely pass in front of
 * and behind one another as the scene turns. The card content above it is
 * separately laid out in 3D by the browser (`transform-style: preserve-3d`,
 * layers at different `translateZ`), which is what makes the content feel part
 * of the same space rather than a flat sheet floating over a background.
 *
 * Why a 2D canvas and not WebGL: a few hundred projected points cost almost
 * nothing to draw, and a 2D context has no context-loss handling, no shader
 * compilation and no driver blocklist to fall foul of on the mid-range Android
 * phones most Taps are opened on. The 3D is in the maths, not in the API.
 *
 * Degrades cleanly: no canvas support, or the OS asking for reduced motion, and
 * the scene renders one static frame (or nothing) while the Tap itself is
 * completely unaffected.
 */

interface Point {
  x: number;
  y: number;
  z: number;
  /** Base radius in pixels at the focal plane. */
  r: number;
  hue: number;
}

const POINT_COUNT = 190;
const FIELD = 260;
const FOCAL = 420;
/** How far the pointer/device can turn the field, in radians. */
const MAX_YAW = 0.42;
const MAX_PITCH = 0.3;

function createField(): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < POINT_COUNT; i++) {
    points.push({
      x: (Math.random() - 0.5) * FIELD * 2,
      y: (Math.random() - 0.5) * FIELD * 2,
      z: (Math.random() - 0.5) * FIELD * 2,
      r: 0.6 + Math.random() * 1.9,
      hue: 214 + Math.random() * 48,
    });
  }
  return points;
}

export function TapDepthField({ accent }: { accent?: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const points = createField();

    // Where the scene is being looked at from, and where it is easing towards.
    let yaw = 0;
    let pitch = 0;
    let targetYaw = 0;
    let targetPitch = 0;
    let spin = 0;

    let width = 0;
    let height = 0;
    let frame = 0;
    let running = true;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      targetYaw = ((event.clientX - rect.left) / rect.width - 0.5) * 2 * MAX_YAW;
      targetPitch = ((event.clientY - rect.top) / rect.height - 0.5) * 2 * MAX_PITCH;
    };

    // Where the browser exposes it without an explicit permission prompt
    // (Android, and iOS only after the visitor has granted motion access),
    // tilting the phone moves the camera. Pointer input covers everywhere else.
    const onOrientation = (event: DeviceOrientationEvent) => {
      if (event.gamma === null || event.beta === null) return;
      targetYaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, (event.gamma / 45) * MAX_YAW));
      targetPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, ((event.beta - 45) / 45) * MAX_PITCH));
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);

      // Ease towards the target so a flick of the finger glides rather than snaps.
      yaw += (targetYaw + Math.sin(spin) * 0.08 - yaw) * 0.06;
      pitch += (targetPitch - pitch) * 0.06;
      if (!reduceMotion) spin += 0.0028;

      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);
      const cosPitch = Math.cos(pitch);
      const sinPitch = Math.sin(pitch);
      const centreX = width / 2;
      const centreY = height / 2;

      // Painter's algorithm: far points first, so near ones genuinely occlude.
      const projected: { sx: number; sy: number; r: number; alpha: number; hue: number; z: number }[] =
        [];

      for (const point of points) {
        // Rotate about Y (yaw) then X (pitch).
        const x1 = point.x * cosYaw - point.z * sinYaw;
        const z1 = point.x * sinYaw + point.z * cosYaw;
        const y2 = point.y * cosPitch - z1 * sinPitch;
        const z2 = point.y * sinPitch + z1 * cosPitch;

        const denominator = FOCAL + z2;
        if (denominator <= 1) continue; // behind the camera

        const scale = FOCAL / denominator;
        projected.push({
          sx: centreX + x1 * scale,
          sy: centreY + y2 * scale,
          r: Math.max(0.25, point.r * scale),
          // Depth cue: distant points recede rather than all reading equally.
          alpha: Math.max(0.05, Math.min(0.85, scale * 0.62)),
          hue: point.hue,
          z: z2,
        });
      }

      projected.sort((a, b) => b.z - a.z);

      for (const p of projected) {
        context.beginPath();
        context.arc(p.sx, p.sy, p.r, 0, Math.PI * 2);
        context.fillStyle = `hsla(${p.hue}, 90%, ${62 + p.alpha * 22}%, ${p.alpha})`;
        context.fill();
      }

      if (running && !reduceMotion) frame = window.requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      // A background tab must not keep a phone's GPU awake.
      if (document.hidden) {
        running = false;
        window.cancelAnimationFrame(frame);
      } else if (!reduceMotion) {
        running = true;
        frame = window.requestAnimationFrame(draw);
      }
    };

    resize();
    draw();

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('deviceorientation', onOrientation);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('deviceorientation', onOrientation);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="tap-depth-field"
      aria-hidden="true"
      style={accent ? { ['--tap-field-accent' as string]: accent } : undefined}
    />
  );
}
