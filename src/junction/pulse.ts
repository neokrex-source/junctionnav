/** The impulses running along the route in the junction views (3D illustration and map mode). */
import * as THREE from 'three';

/** Impulses along the route arrow: one every PULSE_PERIOD metres, moving at PULSE_SPEED m/s. */
export const PULSE_PERIOD = 36;
export const PULSE_SPEED = 55;

/**
 * The impulse pattern along the arrow (v runs along it, 1 PULSE_PERIOD per repeat): clear, then
 * a streak brightening towards a sharp front, like a signal running down a nerve.
 */
export function pulseTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  // Canvas bottom is v = 0, top v = 1 (textures are flipped): the front of the streak at the top.
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad.addColorStop(0.88, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.96, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Something can move on a page here (a browser, and no "reduce motion" preference). */
export const motionOk = () => typeof window !== 'undefined' && typeof document !== 'undefined' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

