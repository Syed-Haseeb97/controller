// Mirror of android StickConfig.kt / StickMath.shape (keep both in sync).
export type StickCurve = 'LINEAR' | 'QUADRATIC' | 'CUSTOM';

export interface StickConfig {
  deadzone: number; // 0..0.5 radial inner deadzone
  outerZone: number; // 0.6..1 travel at which output reaches 100 %
  curve: StickCurve;
  exponent: number; // used by CUSTOM
  invertY: boolean;
}

export const DEFAULT_STICK_CONFIG: StickConfig = {
  deadzone: 0.08,
  outerZone: 1,
  curve: 'LINEAR',
  exponent: 1.5,
  invertY: false,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function shapeStick(x: number, y: number, cfg: StickConfig): [number, number] {
  const dz = clamp(cfg.deadzone, 0, 0.5);
  const outer = clamp(cfg.outerZone, dz + 0.05, 1);
  const mag = Math.hypot(x, y);
  let ox = 0;
  let oy = 0;
  if (mag > dz && mag > 0) {
    const scaled = clamp((mag - dz) / (outer - dz), 0, 1);
    const curved =
      cfg.curve === 'LINEAR'
        ? scaled
        : cfg.curve === 'QUADRATIC'
          ? scaled * scaled
          : Math.pow(scaled, clamp(cfg.exponent, 0.3, 4));
    ox = (x / mag) * curved;
    oy = (y / mag) * curved;
  }
  return [ox, cfg.invertY ? -oy : oy];
}
