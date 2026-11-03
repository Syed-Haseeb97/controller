import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  CheckCircle2,
  Compass,
  Crosshair,
  QrCode,
  RefreshCw,
  Sliders,
  Smartphone,
  Sparkles,
  Wifi,
  X,
} from 'lucide-react';
import { DS4_BUTTONS, UI_TRIGGER_FLAGS } from '../protocol/ds4Packet';

export interface GyroSettings {
  enabled: boolean;
  sensitivity: number;       // 0.2 .. 5.0
  invertX: boolean;
  invertY: boolean;
  deadzoneRadPerSec: number; // 0.0 .. 0.15
  smoothingAlpha: number;    // 0.0 .. 0.90
  requireHoldButton: boolean;
  activationButtonMask: number;
}

export interface GyroDriftCalibration {
  isCalibrating: boolean;
  progress: number; // 0..1
  hardwareDriftX: number; // Simulated/real sensor inherent bias (rad/s)
  hardwareDriftY: number;
  hardwareDriftZ: number;
  calibratedBiasX: number; // Measured & subtracted bias (rad/s)
  calibratedBiasY: number;
  calibratedBiasZ: number;
  lastCalibratedAt: string | null;
}

export const ACTIVATION_BUTTON_OPTIONS: Array<{ label: string; mask: number }> = [
  { label: 'Cross (X / Bottom Face)', mask: DS4_BUTTONS.CROSS },
  { label: 'L2 Trigger (ADS Aim)', mask: UI_TRIGGER_FLAGS.L2_DIG },
  { label: 'L1 Left Shoulder', mask: DS4_BUTTONS.L1 },
  { label: 'R1 Right Shoulder', mask: DS4_BUTTONS.R1 },
  { label: 'Square (Left Face)', mask: DS4_BUTTONS.SQUARE },
  { label: 'Circle (Right Face)', mask: DS4_BUTTONS.CIRCLE },
  { label: 'Triangle (Top Face)', mask: DS4_BUTTONS.TRIANGLE },
];

interface GyroPanelProps {
  settings: GyroSettings;
  onChangeSettings: React.Dispatch<React.SetStateAction<GyroSettings>>;
  calibration: GyroDriftCalibration;
  onStartCalibration: () => void;
  onInjectDriftForTest: () => void;
  manualGyroInput: { yawZ: number; pitchX: number; rollY: number };
  onChangeManualGyro: React.Dispatch<
    React.SetStateAction<{ yawZ: number; pitchX: number; rollY: number }>
  >;
  effectiveGyroRad: { x: number; y: number; z: number };
  mappedRightStickDelta: { x: number; y: number };
  isHoldGateSatisfied: boolean;
  onToggleHoldActivationButton: () => void;
}

export const GyroConfigurationPanel: React.FC<GyroPanelProps> = ({
  settings,
  onChangeSettings,
  calibration,
  onStartCalibration,
  onInjectDriftForTest,
  manualGyroInput,
  onChangeManualGyro,
  effectiveGyroRad,
  mappedRightStickDelta,
  isHoldGateSatisfied,
  onToggleHoldActivationButton,
}) => {
  const residualDriftZ = calibration.hardwareDriftZ - calibration.calibratedBiasZ;
  const residualDriftX = calibration.hardwareDriftX - calibration.calibratedBiasX;

  const handleTiltPadPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0 && e.type !== 'pointerdown') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    onChangeManualGyro({
      yawZ: -Math.max(-2.5, Math.min(2.5, nx * 2.0)),
      pitchX: Math.max(-2.5, Math.min(2.5, ny * 2.0)),
      rollY: 0,
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* LEFT 7 COLS: SensorManager.SENSOR_DELAY_FASTEST Controls & Right-Stick Mapping */}
      <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">
              Gyroscope &rarr; Right Stick Pipeline (SENSOR_DELAY_FASTEST Thread)
            </h3>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) =>
                onChangeSettings((s) => ({ ...s, enabled: e.target.checked }))
              }
              className="rounded accent-cyan-400"
            />
            Enable Gyro Aim
          </label>
        </div>

        {/* Sliders: Sensitivity, Deadzone, EMA Smoothing */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-3">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-300 font-medium">Sensitivity</span>
              <span className="font-mono text-cyan-300">
                {settings.sensitivity.toFixed(2)}x
              </span>
            </div>
            <input
              type="range"
              min={0.2}
              max={5.0}
              step={0.05}
              value={settings.sensitivity}
              onChange={(e) =>
                onChangeSettings((s) => ({
                  ...s,
                  sensitivity: parseFloat(e.target.value),
                }))
              }
              className="w-full accent-cyan-400 cursor-pointer"
            />
            <div className="mt-1 text-[10px] text-slate-400">
              Scales rad/s angular velocity to RX/RY int16
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-3">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-300 font-medium">Radial Deadzone</span>
              <span className="font-mono text-cyan-300">
                {settings.deadzoneRadPerSec.toFixed(3)} rad/s
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={0.15}
              step={0.005}
              value={settings.deadzoneRadPerSec}
              onChange={(e) =>
                onChangeSettings((s) => ({
                  ...s,
                  deadzoneRadPerSec: parseFloat(e.target.value),
                }))
              }
              className="w-full accent-cyan-400 cursor-pointer"
            />
            <div className="mt-1 text-[10px] text-slate-400">
              Suppresses hand micro-tremors near zero
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-3">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-300 font-medium">EMA Smoothing</span>
              <span className="font-mono text-cyan-300">
                {Math.round(settings.smoothingAlpha * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={0.9}
              step={0.05}
              value={settings.smoothingAlpha}
              onChange={(e) =>
                onChangeSettings((s) => ({
                  ...s,
                  smoothingAlpha: parseFloat(e.target.value),
                }))
              }
              className="w-full accent-cyan-400 cursor-pointer"
            />
            <div className="mt-1 text-[10px] text-slate-400">
              Low-pass filter α ({settings.smoothingAlpha.toFixed(2)}) on sensor thread
            </div>
          </div>
        </div>

        {/* Per-Axis Invert & "Gyro Active While Button X Is Held" */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-3 flex flex-col justify-between gap-2">
            <div className="text-xs font-medium text-slate-300">Per-Axis Polarity Invert</div>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.invertX}
                  onChange={(e) =>
                    onChangeSettings((s) => ({ ...s, invertX: e.target.checked }))
                  }
                  className="rounded accent-cyan-400"
                />
                Invert X (Yaw &rarr; RX)
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.invertY}
                  onChange={(e) =>
                    onChangeSettings((s) => ({ ...s, invertY: e.target.checked }))
                  }
                  className="rounded accent-cyan-400"
                />
                Invert Y (Pitch &rarr; RY)
              </label>
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.requireHoldButton}
                  onChange={(e) =>
                    onChangeSettings((s) => ({
                      ...s,
                      requireHoldButton: e.target.checked,
                    }))
                  }
                  className="rounded accent-cyan-400"
                />
                Gyro active only while button held
              </label>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                  isHoldGateSatisfied
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                }`}
              >
                {isHoldGateSatisfied ? 'GATE OPEN' : 'HOLD TO ACTIVATE'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={settings.activationButtonMask}
                onChange={(e) =>
                  onChangeSettings((s) => ({
                    ...s,
                    activationButtonMask: Number(e.target.value),
                  }))
                }
                className="flex-1 rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 font-mono"
              >
                {ACTIVATION_BUTTON_OPTIONS.map((opt) => (
                  <option key={opt.mask} value={opt.mask}>
                    Hold: {opt.label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={onToggleHoldActivationButton}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono transition ${
                  isHoldGateSatisfied && settings.requireHoldButton
                    ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {isHoldGateSatisfied && settings.requireHoldButton ? 'Release Btn' : 'Hold Btn'}
              </button>
            </div>
          </div>
        </div>

        {/* Interactive Phone Tilt Simulator Pad */}
        <div className="rounded-xl bg-slate-950/90 border border-slate-800 p-3 flex flex-col sm:flex-row items-center gap-4">
          <div
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              handleTiltPadPointer(e);
            }}
            onPointerMove={handleTiltPadPointer}
            onPointerUp={() =>
              onChangeManualGyro({ yawZ: 0, pitchX: 0, rollY: 0 })
            }
            className="relative w-32 h-32 shrink-0 rounded-xl bg-slate-900 border border-cyan-500/40 flex items-center justify-center cursor-crosshair select-none touch-none"
          >
            <div className="pointer-events-none absolute inset-x-2 h-px bg-slate-800" />
            <div className="pointer-events-none absolute inset-y-2 w-px bg-slate-800" />
            <div
              className="pointer-events-none w-8 h-8 rounded-full bg-cyan-500/30 border-2 border-cyan-300 flex items-center justify-center"
              style={{
                transform: `translate(${(-manualGyroInput.yawZ / 2.0) * 44}px, ${(manualGyroInput.pitchX / 2.0) * 44}px)`,
              }}
            >
              <Crosshair className="w-4 h-4 text-cyan-200" />
            </div>
            <span className="pointer-events-none absolute bottom-1 text-[9px] font-mono text-slate-400">
              DRAG PHONE TILT
            </span>
          </div>

          <div className="flex-1 space-y-2 text-xs">
            <div className="font-semibold text-slate-200">
              Test Angular Velocity &rarr; Right Stick Mapping
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Drag inside the tilt pad (or tilt your physical phone) to generate angular velocity
              in rad/s. Notice how the calibrated, deadzone-filtered, EMA-smoothed gyro rate maps
              cleanly onto the Right Stick (`rx`, `ry`).
            </p>
            <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
              <div className="rounded bg-slate-900 px-2.5 py-1.5 border border-slate-800 text-cyan-300">
                Filtered Gyro: ({effectiveGyroRad.x.toFixed(2)}, {effectiveGyroRad.z.toFixed(2)})
                rad/s
              </div>
              <div className="rounded bg-slate-900 px-2.5 py-1.5 border border-slate-800 text-violet-300">
                RS Delta: (RX {(mappedRightStickDelta.x * 100).toFixed(0)}%, RY{' '}
                {(mappedRightStickDelta.y * 100).toFixed(0)}%)
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT 5 COLS: Stationary Gyro Drift Calibration Screen */}
      <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col justify-between gap-4">
        <div>
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-white">
                Stationary Gyro Drift Calibration Screen
              </h3>
            </div>
            <button
              type="button"
              onClick={onInjectDriftForTest}
              className="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[11px] font-mono transition"
              title="Simulates thermal MEMS gyroscope drift so you can watch calibration measure and subtract it"
            >
              + Simulate Sensor Drift
            </button>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed mb-3">
            MEMS gyroscopes exhibit zero-rate bias drift that causes the Right Stick to slowly creep
            even when the phone is still. Place the phone on a flat surface and run the 240-sample
            calibration pass to measure and subtract the bias vector.
          </p>

          {/* Drift Telemetry Comparison */}
          <div className="space-y-2 font-mono text-xs">
            <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] text-slate-400">RAW SENSOR BIAS (UNCORRECTED)</div>
                <div className="text-amber-300 font-bold mt-0.5">
                  X: {calibration.hardwareDriftX >= 0 ? '+' : ''}
                  {calibration.hardwareDriftX.toFixed(3)} | Z:{' '}
                  {calibration.hardwareDriftZ >= 0 ? '+' : ''}
                  {calibration.hardwareDriftZ.toFixed(3)} rad/s
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-400">
                MEMS Raw
              </span>
            </div>

            <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] text-slate-400">MEASURED &amp; SUBTRACTED OFFSET</div>
                <div className="text-sky-300 font-bold mt-0.5">
                  X: {calibration.calibratedBiasX >= 0 ? '+' : ''}
                  {calibration.calibratedBiasX.toFixed(3)} | Z:{' '}
                  {calibration.calibratedBiasZ >= 0 ? '+' : ''}
                  {calibration.calibratedBiasZ.toFixed(3)} rad/s
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-sky-500/15 text-sky-300">
                240 Samples
              </span>
            </div>

            <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] text-slate-400">NET RESIDUAL DRIFT AFTER SUBTRACTION</div>
                <div
                  className={`font-bold mt-0.5 ${
                    Math.hypot(residualDriftX, residualDriftZ) < 0.005
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  X: {residualDriftX >= 0 ? '+' : ''}
                  {residualDriftX.toFixed(3)} | Z: {residualDriftZ >= 0 ? '+' : ''}
                  {residualDriftZ.toFixed(3)} rad/s
                </div>
              </div>
              <span
                className={`text-[10px] px-2 py-0.5 rounded ${
                  Math.hypot(residualDriftX, residualDriftZ) < 0.005
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-rose-500/20 text-rose-300'
                }`}
              >
                {Math.hypot(residualDriftX, residualDriftZ) < 0.005 ? 'ZEROED' : 'DRIFTING'}
              </span>
            </div>
          </div>
        </div>

        {/* Calibration Progress & CTA */}
        <div className="space-y-2">
          {calibration.isCalibrating && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-mono text-amber-300">
                <span>Sampling stationary sensor bias (keep phone still)...</span>
                <span>{Math.round(calibration.progress * 100)}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-amber-400 transition-all"
                  style={{ width: `${calibration.progress * 100}%` }}
                />
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={calibration.isCalibrating}
            onClick={onStartCalibration}
            className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 transition"
          >
            <RefreshCw
              className={`w-4 h-4 ${calibration.isCalibrating ? 'animate-spin' : ''}`}
            />
            {calibration.isCalibrating
              ? 'Calibrating Stationary Drift...'
              : 'Measure & Subtract Stationary Gyro Drift'}
          </button>
        </div>
      </div>
    </div>
  );
};

interface PairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  endpoint: { ip: string; port: number; rateHz: number; connected: boolean };
  onSaveEndpoint: (next: {
    ip: string;
    port: number;
    rateHz: number;
    connected: boolean;
  }) => void;
}

export const PairingQrModal: React.FC<PairingModalProps> = ({
  isOpen,
  onClose,
  endpoint,
  onSaveEndpoint,
}) => {
  const [ip, setIp] = useState(endpoint.ip);
  const [port, setPort] = useState(endpoint.port);
  const [rateHz, setRateHz] = useState(endpoint.rateHz);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [scanSimulated, setScanSimulated] = useState(false);

  const pairingUri = `ds4udp://${ip}:${port}`;

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(pairingUri, {
      width: 200,
      margin: 1,
      color: { dark: '#38BDF8', light: '#090D16' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pairingUri]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-bold text-white">
              PC &harr; Android Connect &amp; QR Code Pairing
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
          {/* PC QR Code Generator */}
          <div className="md:col-span-5 flex flex-col items-center rounded-xl bg-slate-950 border border-slate-800 p-4 text-center">
            <div className="text-[11px] font-mono text-sky-400 mb-2">
              PC TERMINAL QR (`ds4_udp_receiver.py`)
            </div>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Pairing QR Code"
                className="w-40 h-40 rounded-lg border border-sky-500/30 p-1 bg-[#090D16]"
              />
            ) : (
              <div className="w-40 h-40 rounded-lg bg-slate-900 animate-pulse" />
            )}
            <code className="mt-2 text-xs font-mono text-slate-300 bg-slate-900 px-2.5 py-1 rounded border border-slate-800">
              {pairingUri}
            </code>
            <button
              type="button"
              onClick={() => {
                setScanSimulated(true);
                setTimeout(() => setScanSimulated(false), 1800);
              }}
              className="mt-3 w-full py-1.5 px-3 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 text-xs font-medium transition"
            >
              {scanSimulated ? '✓ QR Payload Parsed!' : 'Simulate Android Camera QR Scan'}
            </button>
          </div>

          {/* Manual IP / Port / Rate Configuration */}
          <div className="md:col-span-7 space-y-3 text-xs">
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                PC Receiver LAN IPv4 Address
              </label>
              <input
                type="text"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="192.168.1.100"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-100 font-mono focus:border-sky-400 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  UDP Port
                </label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value) || 26760)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-100 font-mono focus:border-sky-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  UDP Send Rate (Hz)
                </label>
                <select
                  value={rateHz}
                  onChange={(e) => setRateHz(Number(e.target.value))}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-slate-100 font-mono focus:border-sky-400 focus:outline-none"
                >
                  <option value={60}>60 Hz (16.6ms)</option>
                  <option value={120}>120 Hz (8.33ms - Default)</option>
                  <option value={240}>240 Hz (4.16ms - Ultra)</option>
                </select>
              </div>
            </div>

            <div className="rounded-xl bg-slate-950/90 border border-slate-800 p-3 text-[11px] text-slate-300 space-y-1">
              <div className="font-semibold text-sky-300">How QR Pairing Works:</div>
              <p className="text-slate-400">
                When you start <code>python ds4_udp_receiver.py</code> on Windows, it detects your
                LAN IP and prints a QR code encoding <code>{pairingUri}</code>. Scanning it in the
                Android app configures <code>UdpSenderThread</code> and begins streaming 48-byte
                packets immediately.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onSaveEndpoint({ ip, port, rateHz, connected: true });
                  onClose();
                }}
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold"
              >
                Connect &amp; Stream at {rateHz}Hz
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
