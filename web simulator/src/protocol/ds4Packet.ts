/**
 * Exact 48-Byte Little-Endian Binary Packet Format (`<IQHhhhhBBffffff`)
 * Shared across:
 *  - Windows Python Receiver (`pc_server/ds4_udp_receiver.py`)
 *  - Python 120Hz Fake-Phone Benchmark (`pc_server/fake_phone_sender.py`)
 *  - Android Kotlin UDP Sender (`ControllerState.kt` / `UdpSenderThread.kt`)
 *  - Interactive Protocol Workbench (Web Simulator)
 */

export const PACKET_SIZE_BYTES = 48;

export const DS4_BUTTONS = {
  CROSS: 1 << 0,       // 0x0001
  CIRCLE: 1 << 1,      // 0x0002
  SQUARE: 1 << 2,      // 0x0004
  TRIANGLE: 1 << 3,    // 0x0008
  L1: 1 << 4,          // 0x0010
  R1: 1 << 5,          // 0x0020
  PS: 1 << 6,          // 0x0040 (DS4 special button: PS / Home)
  TOUCHPAD: 1 << 7,    // 0x0080 (DS4 special button: touchpad click)
  SHARE: 1 << 8,       // 0x0100 (Select)
  OPTIONS: 1 << 9,     // 0x0200 (Start)
  L3: 1 << 10,         // 0x0400
  R3: 1 << 11,         // 0x0800
  DPAD_UP: 1 << 12,    // 0x1000
  DPAD_DOWN: 1 << 13,  // 0x2000
  DPAD_LEFT: 1 << 14,  // 0x4000
  DPAD_RIGHT: 1 << 15, // 0x8000
} as const;

/**
 * UI-ONLY flags (bits 16/17). L2/R2 have NO digital bit on the wire: the PC derives them
 * from the analog l2/r2 bytes. The UI uses these to track a held trigger and for the gyro
 * activation gate; encodeControllerPacket() masks them off with `& 0xffff`.
 */
export const UI_TRIGGER_FLAGS = {
  L2_DIG: 1 << 16,
  R2_DIG: 1 << 17,
} as const;
export const WIRE_BUTTON_MASK = 0xffff;

export const BUTTON_METADATA: Array<{
  mask: number;
  name: string;
  shortLabel: string;
  bit: number;
}> = [
  { bit: 0, mask: DS4_BUTTONS.CROSS, name: 'Cross (A)', shortLabel: '✕' },
  { bit: 1, mask: DS4_BUTTONS.CIRCLE, name: 'Circle (B)', shortLabel: '○' },
  { bit: 2, mask: DS4_BUTTONS.SQUARE, name: 'Square (X)', shortLabel: '□' },
  { bit: 3, mask: DS4_BUTTONS.TRIANGLE, name: 'Triangle (Y)', shortLabel: '△' },
  { bit: 4, mask: DS4_BUTTONS.L1, name: 'L1 Shoulder', shortLabel: 'L1' },
  { bit: 5, mask: DS4_BUTTONS.R1, name: 'R1 Shoulder', shortLabel: 'R1' },
  { bit: 6, mask: DS4_BUTTONS.PS, name: 'PS / Home (special)', shortLabel: 'PS' },
  { bit: 7, mask: DS4_BUTTONS.TOUCHPAD, name: 'Touchpad Click (special)', shortLabel: 'TP' },
  { bit: 8, mask: DS4_BUTTONS.SHARE, name: 'Share / Select', shortLabel: 'SHR' },
  { bit: 9, mask: DS4_BUTTONS.OPTIONS, name: 'Options / Start', shortLabel: 'OPT' },
  { bit: 10, mask: DS4_BUTTONS.L3, name: 'L3 Thumb Click', shortLabel: 'L3' },
  { bit: 11, mask: DS4_BUTTONS.R3, name: 'R3 Thumb Click', shortLabel: 'R3' },
  { bit: 12, mask: DS4_BUTTONS.DPAD_UP, name: 'D-Pad Up', shortLabel: 'UP' },
  { bit: 13, mask: DS4_BUTTONS.DPAD_DOWN, name: 'D-Pad Down', shortLabel: 'DN' },
  { bit: 14, mask: DS4_BUTTONS.DPAD_LEFT, name: 'D-Pad Left', shortLabel: 'LT' },
  { bit: 15, mask: DS4_BUTTONS.DPAD_RIGHT, name: 'D-Pad Right', shortLabel: 'RT' },
];

export interface ControllerState {
  buttonsMask: number; // uint16 (0..65535)
  lx: number;          // int16 (-32768..32767)
  ly: number;          // int16 (-32768..32767)
  rx: number;          // int16 (-32768..32767)
  ry: number;          // int16 (-32768..32767)
  l2: number;          // uint8 (0..255)
  r2: number;          // uint8 (0..255)
  gyroX: number;       // float32 (rad/s)
  gyroY: number;       // float32 (rad/s)
  gyroZ: number;       // float32 (rad/s)
  accelX: number;      // float32 (m/s^2)
  accelY: number;      // float32 (m/s^2)
  accelZ: number;      // float32 (m/s^2)
}

export interface DecodedPacket extends ControllerState {
  seq: number;
  timestampUs: number;
}

export interface PacketFieldSlice {
  name: string;
  cType: string;
  structCode: string;
  offset: number;
  length: number;
  colorClass: string;
  formattedValue: string;
}

export const INITIAL_CONTROLLER_STATE: ControllerState = {
  buttonsMask: 0,
  lx: 0,
  ly: 0,
  rx: 0,
  ry: 0,
  l2: 0,
  r2: 0,
  gyroX: 0,
  gyroY: 0,
  gyroZ: 0,
  accelX: 0,
  accelY: 0,
  accelZ: 9.81,
};

export function floatToInt16(norm: number): number {
  const clamped = Math.max(-1, Math.min(1, norm));
  return Math.max(-32768, Math.min(32767, Math.round(clamped * 32767)));
}

export function int16ToDs4Byte(val: number): number {
  const clamped = Math.max(-32768, Math.min(32767, val));
  return Math.max(0, Math.min(255, Math.round(((clamped + 32768) / 65535) * 255)));
}

/**
 * Packs ControllerState into a 48-byte Little-Endian Uint8Array (`<IQHhhhhBBffffff`)
 */
export function encodeControllerPacket(
  state: ControllerState,
  seq: number,
  timestampUs: number
): Uint8Array {
  const buffer = new ArrayBuffer(PACKET_SIZE_BYTES);
  const view = new DataView(buffer);

  view.setUint32(0, seq >>> 0, true);
  view.setBigUint64(4, BigInt(Math.max(0, Math.floor(timestampUs))), true);
  view.setUint16(12, state.buttonsMask & WIRE_BUTTON_MASK, true);
  view.setInt16(14, Math.max(-32768, Math.min(32767, state.lx)), true);
  view.setInt16(16, Math.max(-32768, Math.min(32767, state.ly)), true);
  view.setInt16(18, Math.max(-32768, Math.min(32767, state.rx)), true);
  view.setInt16(20, Math.max(-32768, Math.min(32767, state.ry)), true);
  view.setUint8(22, Math.max(0, Math.min(255, Math.round(state.l2))));
  view.setUint8(23, Math.max(0, Math.min(255, Math.round(state.r2))));
  view.setFloat32(24, state.gyroX, true);
  view.setFloat32(28, state.gyroY, true);
  view.setFloat32(32, state.gyroZ, true);
  view.setFloat32(36, state.accelX, true);
  view.setFloat32(40, state.accelY, true);
  view.setFloat32(44, state.accelZ, true);

  return new Uint8Array(buffer);
}

/**
 * Unpacks a 48-byte Little-Endian Uint8Array into a DecodedPacket
 */
export function decodeControllerPacket(bytes: Uint8Array): DecodedPacket {
  if (bytes.byteLength !== PACKET_SIZE_BYTES) {
    throw new Error(`Invalid packet length ${bytes.byteLength}, expected ${PACKET_SIZE_BYTES}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    seq: view.getUint32(0, true),
    timestampUs: Number(view.getBigUint64(4, true)),
    buttonsMask: view.getUint16(12, true),
    lx: view.getInt16(14, true),
    ly: view.getInt16(16, true),
    rx: view.getInt16(18, true),
    ry: view.getInt16(20, true),
    l2: view.getUint8(22),
    r2: view.getUint8(23),
    gyroX: view.getFloat32(24, true),
    gyroY: view.getFloat32(28, true),
    gyroZ: view.getFloat32(32, true),
    accelX: view.getFloat32(36, true),
    accelY: view.getFloat32(40, true),
    accelZ: view.getFloat32(44, true),
  };
}

export function getPacketFieldSlices(pkt: DecodedPacket): PacketFieldSlice[] {
  return [
    {
      name: 'seq',
      cType: 'uint32',
      structCode: 'I',
      offset: 0,
      length: 4,
      colorClass: 'text-sky-400 border-sky-500/40 bg-sky-500/10',
      formattedValue: `#${pkt.seq}`,
    },
    {
      name: 'timestamp_us',
      cType: 'uint64',
      structCode: 'Q',
      offset: 4,
      length: 8,
      colorClass: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
      formattedValue: `${pkt.timestampUs} µs`,
    },
    {
      name: 'buttons',
      cType: 'uint16',
      structCode: 'H',
      offset: 12,
      length: 2,
      colorClass: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
      formattedValue: `0x${pkt.buttonsMask.toString(16).padStart(4, '0').toUpperCase()}`,
    },
    {
      name: 'lx, ly, rx, ry',
      cType: 'int16[4]',
      structCode: 'hhhh',
      offset: 14,
      length: 8,
      colorClass: 'text-violet-400 border-violet-500/40 bg-violet-500/10',
      formattedValue: `L(${pkt.lx},${pkt.ly}) R(${pkt.rx},${pkt.ry})`,
    },
    {
      name: 'l2, r2',
      cType: 'uint8[2]',
      structCode: 'BB',
      offset: 22,
      length: 2,
      colorClass: 'text-rose-400 border-rose-500/40 bg-rose-500/10',
      formattedValue: `L2:${pkt.l2} R2:${pkt.r2}`,
    },
    {
      name: 'gyro_xyz',
      cType: 'float32[3]',
      structCode: 'fff',
      offset: 24,
      length: 12,
      colorClass: 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10',
      formattedValue: `(${pkt.gyroX.toFixed(2)}, ${pkt.gyroY.toFixed(2)}, ${pkt.gyroZ.toFixed(2)}) rad/s`,
    },
    {
      name: 'accel_xyz',
      cType: 'float32[3]',
      structCode: 'fff',
      offset: 36,
      length: 12,
      colorClass: 'text-teal-400 border-teal-500/40 bg-teal-500/10',
      formattedValue: `(${pkt.accelX.toFixed(2)}, ${pkt.accelY.toFixed(2)}, ${pkt.accelZ.toFixed(2)}) m/s²`,
    },
  ];
}

/**
 * Generates the exact hardware verification state for `--test` mode
 * (cycles all buttons, 8-way D-pad, 360-degree dual sticks, and L2/R2 trigger ramps).
 */
export function generateTestModeState(elapsedSec: number): {
  state: ControllerState;
  phaseLabel: string;
} {
  const cycleDuration = 14.0;
  const t = elapsedSec % cycleDuration;

  // Phase 1 (0..4.8s): Cycle each of the 12 non-Dpad buttons (0.4s each)
  if (t < 4.8) {
    const idx = Math.floor(t / 0.4);
    const meta = BUTTON_METADATA[idx] ?? BUTTON_METADATA[0];
    return {
      phaseLabel: `Button Test: Pressing ${meta.name}`,
      state: {
        ...INITIAL_CONTROLLER_STATE,
        buttonsMask: meta.mask,
        l2: meta.mask === DS4_BUTTONS.L2_DIG ? 255 : 0,
        r2: meta.mask === DS4_BUTTONS.R2_DIG ? 255 : 0,
      },
    };
  }

  // Phase 2 (4.8..7.2s): 8-way D-Pad sweep
  if (t < 7.2) {
    const dpadPhases = [
      { label: 'D-Pad UP (North)', mask: DS4_BUTTONS.DPAD_UP },
      { label: 'D-Pad UP-RIGHT (NorthEast)', mask: DS4_BUTTONS.DPAD_UP | DS4_BUTTONS.DPAD_RIGHT },
      { label: 'D-Pad RIGHT (East)', mask: DS4_BUTTONS.DPAD_RIGHT },
      { label: 'D-Pad DOWN-RIGHT (SouthEast)', mask: DS4_BUTTONS.DPAD_DOWN | DS4_BUTTONS.DPAD_RIGHT },
      { label: 'D-Pad DOWN (South)', mask: DS4_BUTTONS.DPAD_DOWN },
      { label: 'D-Pad DOWN-LEFT (SouthWest)', mask: DS4_BUTTONS.DPAD_DOWN | DS4_BUTTONS.DPAD_LEFT },
      { label: 'D-Pad LEFT (West)', mask: DS4_BUTTONS.DPAD_LEFT },
      { label: 'D-Pad UP-LEFT (NorthWest)', mask: DS4_BUTTONS.DPAD_UP | DS4_BUTTONS.DPAD_LEFT },
    ];
    const idx = Math.min(7, Math.floor((t - 4.8) / 0.3));
    return {
      phaseLabel: `D-Pad Test: ${dpadPhases[idx].label}`,
      state: {
        ...INITIAL_CONTROLLER_STATE,
        buttonsMask: dpadPhases[idx].mask,
      },
    };
  }

  // Phase 3 (7.2..11.0s): Dual Analog Stick 360-degree sweep
  if (t < 11.0) {
    const progress = (t - 7.2) / 3.8;
    const angle = progress * Math.PI * 4;
    return {
      phaseLabel: `Analog Stick Test: 360° Counter-Rotating Sweep (${Math.round(progress * 100)}%)`,
      state: {
        ...INITIAL_CONTROLLER_STATE,
        lx: floatToInt16(Math.cos(angle)),
        ly: floatToInt16(Math.sin(angle)),
        rx: floatToInt16(Math.cos(-angle)),
        ry: floatToInt16(Math.sin(-angle)),
      },
    };
  }

  // Phase 4 (11.0..14.0s): Analog Trigger L2/R2 ramp 0 -> 255 -> 0
  const trigProgress = (t - 11.0) / 3.0;
  const wave = trigProgress < 0.5 ? trigProgress * 2 : (1 - trigProgress) * 2;
  const l2 = Math.round(wave * 255);
  const r2 = Math.round((1 - wave) * 255);
  return {
    phaseLabel: `Trigger Ramp Test: L2=${l2}/255, R2=${r2}/255`,
    state: {
      ...INITIAL_CONTROLLER_STATE,
      buttonsMask:
        (l2 > 10 ? DS4_BUTTONS.L2_DIG : 0) | (r2 > 10 ? DS4_BUTTONS.R2_DIG : 0),
      l2,
      r2,
    },
  };
}
