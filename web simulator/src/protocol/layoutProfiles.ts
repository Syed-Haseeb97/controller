import { DS4_BUTTONS, UI_TRIGGER_FLAGS } from './ds4Packet';

export type ControlBindingType =
  | 'LEFT_STICK'
  | 'RIGHT_STICK'
  | 'L2_TRIGGER'
  | 'R2_TRIGGER'
  | 'BTN_CROSS'
  | 'BTN_CIRCLE'
  | 'BTN_SQUARE'
  | 'BTN_TRIANGLE'
  | 'BTN_L1'
  | 'BTN_R1'
  | 'BTN_L3'
  | 'BTN_R3'
  | 'BTN_SHARE'
  | 'BTN_OPTIONS'
  | 'BTN_PS'
  | 'BTN_TOUCHPAD'
  | 'DPAD_UP'
  | 'DPAD_DOWN'
  | 'DPAD_LEFT'
  | 'DPAD_RIGHT';

export interface BindingOption {
  id: ControlBindingType;
  label: string;
  drawableFile: string;
  kind: 'stick' | 'trigger' | 'button';
  mask?: number;
}

export const BINDING_OPTIONS: BindingOption[] = [
  { id: 'LEFT_STICK', label: 'Left Analog Stick', drawableFile: 'stick_base.png', kind: 'stick' },
  { id: 'RIGHT_STICK', label: 'Right Analog Stick', drawableFile: 'stick_base.png', kind: 'stick' },
  { id: 'L2_TRIGGER', label: 'L2 Trigger', drawableFile: 'btn_l2.png', kind: 'trigger', mask: UI_TRIGGER_FLAGS.L2_DIG },
  { id: 'R2_TRIGGER', label: 'R2 Trigger', drawableFile: 'btn_r2.png', kind: 'trigger', mask: UI_TRIGGER_FLAGS.R2_DIG },
  { id: 'BTN_CROSS', label: 'Cross', drawableFile: 'btn_cross.png', kind: 'button', mask: DS4_BUTTONS.CROSS },
  { id: 'BTN_CIRCLE', label: 'Circle', drawableFile: 'btn_circle.png', kind: 'button', mask: DS4_BUTTONS.CIRCLE },
  { id: 'BTN_SQUARE', label: 'Square', drawableFile: 'btn_square.png', kind: 'button', mask: DS4_BUTTONS.SQUARE },
  { id: 'BTN_TRIANGLE', label: 'Triangle', drawableFile: 'btn_triangle.png', kind: 'button', mask: DS4_BUTTONS.TRIANGLE },
  { id: 'BTN_L1', label: 'L1 Left Shoulder', drawableFile: 'btn_l1.png', kind: 'button', mask: DS4_BUTTONS.L1 },
  { id: 'BTN_R1', label: 'R1 Right Shoulder', drawableFile: 'btn_r1.png', kind: 'button', mask: DS4_BUTTONS.R1 },
  { id: 'BTN_L3', label: 'L3 Thumb Click', drawableFile: 'btn_l3.png', kind: 'button', mask: DS4_BUTTONS.L3 },
  { id: 'BTN_R3', label: 'R3 Thumb Click', drawableFile: 'btn_r3.png', kind: 'button', mask: DS4_BUTTONS.R3 },
  { id: 'BTN_SHARE', label: 'Share / Select', drawableFile: 'btn_share.png', kind: 'button', mask: DS4_BUTTONS.SHARE },
  { id: 'BTN_OPTIONS', label: 'Options / Start', drawableFile: 'btn_options.png', kind: 'button', mask: DS4_BUTTONS.OPTIONS },
  { id: 'BTN_PS', label: 'PS Home Button', drawableFile: 'btn_ps.png', kind: 'button', mask: DS4_BUTTONS.PS },
  { id: 'BTN_TOUCHPAD', label: 'Touchpad Click', drawableFile: 'btn_touchpad.png', kind: 'button', mask: DS4_BUTTONS.TOUCHPAD },
  { id: 'DPAD_UP', label: 'D-Pad Up', drawableFile: 'dpad_up.png', kind: 'button', mask: DS4_BUTTONS.DPAD_UP },
  { id: 'DPAD_DOWN', label: 'D-Pad Down', drawableFile: 'dpad_down.png', kind: 'button', mask: DS4_BUTTONS.DPAD_DOWN },
  { id: 'DPAD_LEFT', label: 'D-Pad Left', drawableFile: 'dpad_left.png', kind: 'button', mask: DS4_BUTTONS.DPAD_LEFT },
  { id: 'DPAD_RIGHT', label: 'D-Pad Right', drawableFile: 'dpad_right.png', kind: 'button', mask: DS4_BUTTONS.DPAD_RIGHT },
];

export function resolveControlAssetFilename(ctrl: ControlWidgetLayout): string {
  const byId: Record<string, string> = {
    cross: 'btn_cross.png',
    circle: 'btn_circle.png',
    square: 'btn_square.png',
    triangle: 'btn_triangle.png',
    dpad_up: 'dpad_up.png',
    dpad_down: 'dpad_down.png',
    dpad_left: 'dpad_left.png',
    dpad_right: 'dpad_right.png',
    l1: 'btn_l1.png',
    r1: 'btn_r1.png',
    l2: 'btn_l2.png',
    r2: 'btn_r2.png',
    l3: 'btn_l3.png',
    r3: 'btn_r3.png',
    share: 'btn_share.png',
    options: 'btn_options.png',
    ps: 'btn_ps.png',
    touchpad: 'btn_touchpad.png',
    left_stick: 'stick_base.png',
    right_stick: 'stick_base.png',
  };
  if (byId[ctrl.id]) return byId[ctrl.id];
  const found = BINDING_OPTIONS.find((b) => b.id === ctrl.binding);
  return found?.drawableFile ?? 'btn_cross.png';
}

export interface ControlWidgetLayout {
  id: string;
  label: string;
  xPct: number;       // 4 .. 96 (% of canvas width)
  yPct: number;       // 8 .. 92 (% of canvas height)
  scale: number;      // 0.6 .. 1.8
  opacity: number;    // 0.2 .. 1.0
  binding: ControlBindingType;
}

export interface ControllerLayoutProfile {
  id: string;
  name: string;
  description: string;
  controls: ControlWidgetLayout[];
}

export function getBindingMask(binding: ControlBindingType): number {
  const found = BINDING_OPTIONS.find((b) => b.id === binding);
  return found?.mask ?? 0;
}

export const DEFAULT_DS4_CONTROLS: ControlWidgetLayout[] = [
  { id: 'l2', label: 'L2', xPct: 9, yPct: 14, scale: 1.0, opacity: 0.95, binding: 'L2_TRIGGER' },
  { id: 'l1', label: 'L1', xPct: 20, yPct: 14, scale: 1.0, opacity: 0.95, binding: 'BTN_L1' },
  { id: 'share', label: 'Share', xPct: 34, yPct: 14, scale: 0.9, opacity: 0.85, binding: 'BTN_SHARE' },
  { id: 'touchpad', label: 'Touchpad', xPct: 50, yPct: 22, scale: 1.0, opacity: 0.85, binding: 'BTN_TOUCHPAD' },
  { id: 'options', label: 'Options', xPct: 66, yPct: 14, scale: 0.9, opacity: 0.85, binding: 'BTN_OPTIONS' },
  { id: 'r1', label: 'R1', xPct: 80, yPct: 14, scale: 1.0, opacity: 0.95, binding: 'BTN_R1' },
  { id: 'r2', label: 'R2', xPct: 91, yPct: 14, scale: 1.0, opacity: 0.95, binding: 'R2_TRIGGER' },

  // D-Pad
  { id: 'dpad_up', label: 'Up', xPct: 14, yPct: 40, scale: 1.0, opacity: 0.92, binding: 'DPAD_UP' },
  { id: 'dpad_down', label: 'Down', xPct: 14, yPct: 68, scale: 1.0, opacity: 0.92, binding: 'DPAD_DOWN' },
  { id: 'dpad_left', label: 'Left', xPct: 7, yPct: 54, scale: 1.0, opacity: 0.92, binding: 'DPAD_LEFT' },
  { id: 'dpad_right', label: 'Right', xPct: 21, yPct: 54, scale: 1.0, opacity: 0.92, binding: 'DPAD_RIGHT' },

  // Analog Sticks + L3/R3
  { id: 'l3', label: 'L3', xPct: 36, yPct: 44, scale: 0.9, opacity: 0.85, binding: 'BTN_L3' },
  { id: 'left_stick', label: 'LS', xPct: 36, yPct: 72, scale: 1.0, opacity: 0.95, binding: 'LEFT_STICK' },
  { id: 'ps', label: 'PS', xPct: 50, yPct: 78, scale: 0.95, opacity: 0.9, binding: 'BTN_PS' },
  { id: 'r3', label: 'R3', xPct: 64, yPct: 44, scale: 0.9, opacity: 0.85, binding: 'BTN_R3' },
  { id: 'right_stick', label: 'RS', xPct: 64, yPct: 72, scale: 1.0, opacity: 0.95, binding: 'RIGHT_STICK' },

  // Face Buttons
  { id: 'triangle', label: 'Triangle', xPct: 86, yPct: 40, scale: 1.0, opacity: 0.95, binding: 'BTN_TRIANGLE' },
  { id: 'cross', label: 'Cross', xPct: 86, yPct: 68, scale: 1.0, opacity: 0.95, binding: 'BTN_CROSS' },
  { id: 'square', label: 'Square', xPct: 79, yPct: 54, scale: 1.0, opacity: 0.95, binding: 'BTN_SQUARE' },
  { id: 'circle', label: 'Circle', xPct: 93, yPct: 54, scale: 1.0, opacity: 0.95, binding: 'BTN_CIRCLE' },
];

export const BUILTIN_LAYOUT_PROFILES: ControllerLayoutProfile[] = [
  {
    id: 'default_ds4',
    name: 'Default DS4',
    description: 'Standard symmetrical DualShock 4 layout with 1.0x controls.',
    controls: DEFAULT_DS4_CONTROLS,
  },
  {
    id: 'fps_pro',
    name: 'FPS',
    description: 'Enlarged Right Stick (1.30x) for precision aim + oversized L2/R2 triggers for claw grip.',
    controls: DEFAULT_DS4_CONTROLS.map((c) => {
      if (c.id === 'right_stick') return { ...c, scale: 1.3, xPct: 66, yPct: 70 };
      if (c.id === 'l2') return { ...c, label: 'ADS (L2)', scale: 1.25, xPct: 10, yPct: 18 };
      if (c.id === 'r2') return { ...c, label: 'FIRE (R2)', scale: 1.25, xPct: 90, yPct: 18 };
      if (c.id === 'cross') return { ...c, label: 'JUMP (✕)', scale: 1.15 };
      return c;
    }),
  },
  {
    id: 'racing_sim',
    name: 'Racing',
    description: 'Oversized L2 Brake & R2 Throttle pedals + paddle shifters mapped to L1/R1.',
    controls: DEFAULT_DS4_CONTROLS.map((c) => {
      if (c.id === 'l2') return { ...c, label: 'BRAKE', scale: 1.4, xPct: 11, yPct: 24 };
      if (c.id === 'r2') return { ...c, label: 'THROTTLE', scale: 1.4, xPct: 89, yPct: 24 };
      if (c.id === 'square') return { ...c, label: 'SHIFT -', binding: 'BTN_L1', scale: 1.15 };
      if (c.id === 'circle') return { ...c, label: 'SHIFT +', binding: 'BTN_R1', scale: 1.15 };
      if (c.id.startsWith('dpad_')) return { ...c, opacity: 0.55, scale: 0.85 };
      return c;
    }),
  },
];
