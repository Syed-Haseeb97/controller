import React, { useEffect, useState } from 'react';
import { AssetImage } from './AssetImage';
import { TransportKind } from './AndroidControllerSurface';
import { GyroDriftCalibration, GyroSettings } from './GyroAndPairingPanels';
import { ControllerLayoutProfile } from '../protocol/layoutProfiles';

export const STORAGE_KEY_SETUP_COMPLETED = 'setup_completed';
export const STORAGE_KEY_SETUP_STEP = 'setup_current_step';
export const STORAGE_KEY_SETUP_CONN_CHOICE = 'setup_connection_choice';

export type ConnectionChoice = 'wifi' | 'usb' | 'both';

interface SetupWizardProps {
  currentStep: number;
  onChangeStep: (step: number) => void;
  pairedEndpoint: { ip: string; port: number; token?: string; rateHz: number; connected: boolean };
  onChangeEndpoint: React.Dispatch<
    React.SetStateAction<{ ip: string; port: number; token?: string; rateHz: number; connected: boolean }>
  >;
  transportKind: TransportKind;
  onChangeTransportKind: (kind: TransportKind) => void;
  rttMs: number;
  gyroSettings: GyroSettings;
  onChangeGyroSettings: React.Dispatch<React.SetStateAction<GyroSettings>>;
  calibration: GyroDriftCalibration;
  onStartCalibration: () => void;
  liveTiltOffset: { x: number; y: number };
  onChangeManualGyro: React.Dispatch<
    React.SetStateAction<{ yawZ: number; pitchX: number; rollY: number }>
  >;
  profiles: ControllerLayoutProfile[];
  activeProfileId: string;
  onSelectProfile: (id: string) => void;
  onCompleteSetup: () => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({
  currentStep,
  onChangeStep,
  pairedEndpoint,
  onChangeEndpoint,
  transportKind,
  onChangeTransportKind,
  rttMs,
  gyroSettings,
  onChangeGyroSettings,
  calibration,
  onStartCalibration,
  liveTiltOffset,
  onChangeManualGyro,
  profiles,
  activeProfileId,
  onSelectProfile,
  onCompleteSetup,
}) => {
  const step = Math.max(1, Math.min(7, currentStep));

  const [connChoice, setConnChoice] = useState<ConnectionChoice>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_SETUP_CONN_CHOICE);
    if (saved === 'wifi' || saved === 'usb' || saved === 'both') return saved;
    return 'both';
  });

  // Step 3: Camera permission requested ONLY when user clicks Scan QR in Step 3
  const [cameraState, setCameraState] = useState<'idle' | 'granted' | 'denied'>('idle');
  const [qrScannedMessage, setQrScannedMessage] = useState<string | null>(null);
  const [usbDetected, setUsbDetected] = useState<boolean>(true);

  // Step 4: Test connection state
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'failed'>('idle');
  const [simulateFail, setSimulateFail] = useState<boolean>(false);

  // Step 5: Gyro sensor permission & tilt simulation
  const [sensorPermStatus, setSensorPermStatus] = useState<string | null>(null);
  const [simTiltX, setSimTiltX] = useState<number>(0);
  const [simTiltY, setSimTiltY] = useState<number>(0);

  // Step 6: Button tap check & vibrate permission
  const [tapTested, setTapTested] = useState<boolean>(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SETUP_CONN_CHOICE, connChoice);
    if (connChoice === 'wifi') {
      onChangeTransportKind('WIFI');
    } else if (connChoice === 'usb') {
      onChangeTransportKind('USB');
    }
  }, [connChoice, onChangeTransportKind]);

  const goToStep = (nextStep: number) => {
    const clamped = Math.max(1, Math.min(7, nextStep));
    localStorage.setItem(STORAGE_KEY_SETUP_STEP, String(clamped));
    onChangeStep(clamped);
  };

  const handleRequestCameraAndScanQr = async () => {
    setQrScannedMessage(null);
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((t) => t.stop());
      }
      setCameraState('granted');
      setQrScannedMessage(
        `Simulated QR scan: ds4udp://${pairedEndpoint.ip || '192.168.1.42'}:${pairedEndpoint.port}?token=${pairedEndpoint.token || 'a1b2c3d4e5f60718'}`
      );
    } catch {
      // Simulated or declined camera permission — never leave the user stuck
      setCameraState('denied');
      setQrScannedMessage(
        `Simulated QR scan (no camera in browser preview): ds4udp://${pairedEndpoint.ip || '192.168.1.42'}:${pairedEndpoint.port}?token=${pairedEndpoint.token || 'a1b2c3d4e5f60718'}`
      );
    }
  };

  const handleRunConnectionTest = () => {
    setTestState('testing');
    window.setTimeout(() => {
      if (simulateFail || !pairedEndpoint.ip.trim()) {
        setTestState('failed');
      } else {
        setTestState('ok');
      }
    }, 280);
  };

  const handleCalibrateGyroStep = async () => {
    // Request sensor permission only at Step 5 if required by mobile browser
    const devMotion = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof devMotion.requestPermission === 'function') {
      try {
        const res = await devMotion.requestPermission();
        setSensorPermStatus(
          res === 'granted' ? 'Sensor permission granted' : 'Using simulated sensor'
        );
      } catch {
        setSensorPermStatus('Using simulated gyroscope sensor');
      }
    }
    onStartCalibration();
  };

  const handleButtonTapTest = () => {
    // Request vibrate only at Step 6
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(12);
    }
    setTapTested(true);
  };

  const handleSkipStep = () => {
    if (step === 5) {
      // Skip leaves safe gyro defaults
      onChangeGyroSettings((prev) => ({
        ...prev,
        enabled: true,
        sensitivity: 1.6,
        deadzoneRadPerSec: 0.025,
        smoothingAlpha: 0.35,
      }));
    }
    if (step < 7) {
      goToStep(step + 1);
    } else {
      onCompleteSetup();
    }
  };

  const handleNextStep = () => {
    if (step < 7) {
      goToStep(step + 1);
    } else {
      onCompleteSetup();
    }
  };

  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) ?? profiles[0];

  // Combine real tilt with interactive preview tilt on Step 5
  const previewDotX = Math.max(
    -1,
    Math.min(1, liveTiltOffset.x + simTiltX * gyroSettings.sensitivity * 0.45)
  );
  const previewDotY = Math.max(
    -1,
    Math.min(1, liveTiltOffset.y + simTiltY * gyroSettings.sensitivity * 0.45)
  );

  return (
    <div className="min-h-screen bg-[#060911] text-slate-100 flex flex-col justify-between px-5 py-6">
      {/* TOP PROGRESS INDICATOR ("Step X of 7") */}
      <div className="max-w-xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7">
            <AssetImage
              filename="logo_app.png"
              fallbackLabel="LOGO"
              fallbackClassName="rounded-lg"
            />
          </div>
          <span className="font-mono text-xs font-bold text-sky-400">
            Step {step} of 7
          </span>
          <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 font-mono text-[10px] text-amber-300">
            Web Preview (Simulated)
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5, 6, 7].map((s) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all ${
                s === step
                  ? 'w-6 bg-sky-400'
                  : s < step
                    ? 'w-2.5 bg-sky-500/60'
                    : 'w-2 bg-slate-800'
              }`}
            />
          ))}
        </div>
      </div>

      {/* CENTER STEP CARD — One clear action per step */}
      <div className="max-w-xl w-full mx-auto my-auto py-6">
        <div className="rounded-2xl bg-[#0E1525] border border-slate-800 p-7 shadow-2xl">
          {/* STEP 1: WELCOME */}
          {step === 1 && (
            <div className="flex flex-col items-center text-center space-y-5 py-4">
              <div className="w-16 h-16">
                <AssetImage
                  filename="logo_app.png"
                  fallbackLabel="LOGO"
                  fallbackClassName="rounded-2xl"
                />
              </div>
              <div className="space-y-1.5">
                <h1 className="text-xl font-bold text-white">DS4 Bridge 120Hz</h1>
                <p className="text-sm text-slate-300">
                  Use your phone as a 120Hz DualShock 4 controller for your Windows PC.
                </p>
              </div>
              <button
                type="button"
                onClick={() => goToStep(2)}
                className="px-7 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm transition cursor-pointer"
              >
                Get started
              </button>
            </div>
          )}

          {/* STEP 2: INSTALL PC APP */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-white">Install PC Receiver App</h2>
                <p className="text-xs text-slate-300 mt-1">
                  Download and run <code className="text-sky-300">DS4Bridge120Hz.exe</code> (or{' '}
                  <code className="text-sky-300">python ds4_tray_app.py</code>) on your Windows PC.
                </p>
              </div>

              <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 space-y-2 text-xs">
                <div className="text-slate-200 font-semibold">Requirements:</div>
                <ul className="space-y-1.5 text-slate-300 list-disc list-inside">
                  <li>
                    <span className="text-white font-medium">ViGEmBus driver</span> — emulates a native Sony DualShock 4 on Windows.
                  </li>
                  <li>
                    <span className="text-white font-medium">USB debugging</span> — required only if you want wired USB cable mode.
                  </li>
                </ul>
              </div>

              <button
                type="button"
                onClick={() => goToStep(3)}
                className="px-6 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs sm:text-sm transition cursor-pointer"
              >
                I&apos;ve installed it
              </button>
            </div>
          )}

          {/* STEP 3: CHOOSE CONNECTION */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-white">Choose Connection</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Connect via Wi-Fi, USB cable, or both with automatic failover.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2.5 text-xs">
                {(
                  [
                    ['wifi', 'Wi-Fi'],
                    ['usb', 'USB cable'],
                    ['both', 'Both'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setConnChoice(id)}
                    className={`py-2.5 px-3 rounded-xl border font-bold transition cursor-pointer ${
                      connChoice === id
                        ? 'bg-sky-500 text-slate-950 border-sky-300'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {(connChoice === 'wifi' || connChoice === 'both') && (
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-white">Wi-Fi Pairing</div>
                      <div className="text-[11px] text-slate-400">
                        Camera access is used only to scan the PC pairing QR code.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRequestCameraAndScanQr}
                      className="px-3.5 py-2 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/50 text-sky-200 font-semibold cursor-pointer"
                    >
                      Scan QR Code
                    </button>
                  </div>

                  {qrScannedMessage && (
                    <div
                      className={`text-[11px] font-mono ${
                        cameraState === 'granted' ? 'text-emerald-300' : 'text-sky-300'
                      }`}
                    >
                      {qrScannedMessage}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2.5 pt-1">
                    <div className="col-span-2">
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Or enter PC IP manually
                      </label>
                      <input
                        type="text"
                        value={pairedEndpoint.ip}
                        onChange={(e) =>
                          onChangeEndpoint((prev) => ({ ...prev, ip: e.target.value }))
                        }
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Port
                      </label>
                      <input
                        type="number"
                        value={pairedEndpoint.port}
                        onChange={(e) =>
                          onChangeEndpoint((prev) => ({
                            ...prev,
                            port: Number(e.target.value) || 26760,
                          }))
                        }
                        className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-1.5 text-white font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              {(connChoice === 'usb' || connChoice === 'both') && (
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5">
                        <AssetImage
                          filename="ic_badge_usb.png"
                          fallbackLabel="USB"
                          fallbackClassName="rounded"
                        />
                      </div>
                      <span className="font-semibold text-white">
                        USB Debugging Guide
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUsbDetected((v) => !v)}
                      className={`px-2.5 py-1 rounded-md font-mono text-[11px] font-bold border cursor-pointer ${
                        usbDetected
                          ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-300'
                          : 'bg-amber-500/15 border-amber-400/50 text-amber-300'
                      }`}
                    >
                      {usbDetected
                        ? 'Device detected (Simulated)'
                        : 'Waiting for cable (Simulated)'}
                    </button>
                  </div>
                  <p className="text-slate-300 text-[11px]">
                    Open Settings &rarr; About phone &rarr; tap Build number 7 times &rarr; Developer options &rarr; enable USB debugging.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: TEST CONNECTION */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">Test Connection</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Send a 48-byte test packet to verify latency and PC response.
                  </p>
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simulateFail}
                    onChange={(e) => setSimulateFail(e.target.checked)}
                  />
                  Simulate error
                </label>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleRunConnectionTest}
                  className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs cursor-pointer"
                >
                  {testState === 'failed'
                    ? 'Try again'
                    : testState === 'testing'
                      ? 'Sending packet...'
                      : 'Send test packet'}
                </button>
              </div>

              {testState === 'ok' && (
                <div className="rounded-xl bg-emerald-950/50 border border-emerald-500/50 p-4 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500 text-slate-950 font-bold">
                      OK
                    </span>
                    <div>
                      <div className="font-bold text-emerald-300">
                        Connected — 16B echo received (Simulated)
                      </div>
                      <div className="text-slate-300 text-[11px]">
                        Active transport: {transportKind}
                      </div>
                    </div>
                  </div>
                  <div className="font-mono font-bold text-sm text-white">
                    {rttMs.toFixed(2)} ms (Simulated)
                  </div>
                </div>
              )}

              {testState === 'failed' && (
                <div className="rounded-xl bg-rose-950/50 border border-rose-500/50 p-4 space-y-2 text-xs">
                  <div className="font-bold text-rose-300">
                    Connection test did not receive a reply.
                  </div>
                  <div className="text-slate-200 text-[11px]">
                    Fix suggestions: check that PC and phone are on the same Wi-Fi network, allow UDP port 26760 in Windows Firewall, check the USB cable, or verify ViGEmBus is installed.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSimulateFail(false);
                      handleRunConnectionTest();
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-rose-500 text-white font-bold text-[11px] cursor-pointer"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 5: CALIBRATE GYRO */}
          {step === 5 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white">Calibrate Gyro</h2>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Place your phone flat and still.
                  </p>
                  {sensorPermStatus && (
                    <p className="text-[11px] font-mono text-sky-300 mt-1">
                      {sensorPermStatus}
                    </p>
                  )}
                </div>

                {/* Progress Ring + Calibrate Button */}
                <div className="flex items-center gap-3">
                  <div className="relative w-12 h-12 flex items-center justify-center">
                    <svg className="w-12 h-12 -rotate-90" viewBox="0 0 40 40">
                      <circle
                        cx="20"
                        cy="20"
                        r="16"
                        fill="none"
                        stroke="#1E293B"
                        strokeWidth="4"
                      />
                      <circle
                        cx="20"
                        cy="20"
                        r="16"
                        fill="none"
                        stroke="#38BDF8"
                        strokeWidth="4"
                        strokeDasharray={100.5}
                        strokeDashoffset={
                          100.5 *
                          (1 - (calibration.isCalibrating ? calibration.progress : 1))
                        }
                      />
                    </svg>
                    <span className="absolute font-mono text-[10px] text-sky-300 font-bold">
                      {Math.round(
                        (calibration.isCalibrating ? calibration.progress : 1) * 100
                      )}
                      %
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCalibrateGyroStep}
                    disabled={calibration.isCalibrating}
                    className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    {calibration.isCalibrating ? 'Calibrating...' : 'Calibrate'}
                  </button>
                </div>
              </div>

              {/* Sensitivity Slider + Live Preview Dot */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center rounded-xl bg-slate-950 border border-slate-800 p-4 text-xs">
                <div className="sm:col-span-8 space-y-3">
                  <div>
                    <div className="flex justify-between text-slate-300 mb-1">
                      <span>Gyro Sensitivity</span>
                      <span className="font-mono text-sky-300">
                        {gyroSettings.sensitivity.toFixed(2)}x
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.2}
                      max={5.0}
                      step={0.05}
                      value={gyroSettings.sensitivity}
                      onChange={(e) =>
                        onChangeGyroSettings((prev) => ({
                          ...prev,
                          sensitivity: parseFloat(e.target.value),
                        }))
                      }
                      className="w-full accent-sky-400"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                      <span>Test Phone Tilt (Yaw / Pitch)</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSimTiltX(0);
                          setSimTiltY(0);
                          onChangeManualGyro({ yawZ: 0, pitchX: 0, rollY: 0 });
                        }}
                        className="text-sky-400 hover:underline"
                      >
                        Center
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.05}
                        value={simTiltX}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setSimTiltX(v);
                          onChangeManualGyro((prev) => ({ ...prev, yawZ: -v }));
                        }}
                        className="w-full accent-cyan-400"
                      />
                      <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.05}
                        value={simTiltY}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setSimTiltY(v);
                          onChangeManualGyro((prev) => ({ ...prev, pitchX: v }));
                        }}
                        className="w-full accent-cyan-400"
                      />
                    </div>
                  </div>
                </div>

                {/* Live Preview Dot */}
                <div className="sm:col-span-4 flex flex-col items-center">
                  <div className="relative w-20 h-20 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center">
                    <div
                      className="w-4 h-4 rounded-full bg-sky-400 shadow transition-transform duration-75"
                      style={{
                        transform: `translate(${previewDotX * 26}px, ${
                          previewDotY * 26
                        }px)`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 mt-1">
                    Live preview dot
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 6: PICK LAYOUT */}
          {step === 6 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-white">Pick Layout</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Choose a layout profile and tap to verify PC response.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {profiles.slice(0, 3).map((prof) => {
                  const selected = prof.id === activeProfileId;
                  const previewAsset =
                    prof.id === 'fps'
                      ? 'btn_r2.png'
                      : prof.id === 'racing'
                        ? 'stick_base.png'
                        : 'btn_cross.png';
                  return (
                    <button
                      key={prof.id}
                      type="button"
                      onClick={() => onSelectProfile(prof.id)}
                      className={`p-3.5 rounded-xl border text-left flex items-center gap-3 transition cursor-pointer ${
                        selected
                          ? 'bg-sky-500/15 border-sky-400 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      <div className="w-10 h-10 shrink-0">
                        <AssetImage
                          filename={previewAsset}
                          fallbackLabel={prof.name}
                          fallbackClassName="rounded-lg"
                        />
                      </div>
                      <div>
                        <div className="text-xs font-bold">{prof.name}</div>
                        <div className="text-[10px] text-slate-400 line-clamp-1">
                          {prof.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                <button
                  type="button"
                  onClick={handleButtonTapTest}
                  className="inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold cursor-pointer"
                >
                  <span className="w-5 h-5 inline-block">
                    <AssetImage
                      filename="btn_cross.png"
                      fallbackLabel="Cross"
                      fallbackClassName="rounded-full"
                    />
                  </span>
                  Press a button to test it
                </button>

                {tapTested && (
                  <span className="font-mono text-emerald-300 font-semibold">
                    Simulated PC response: Cross (0x0001) received ({rttMs.toFixed(2)} ms)
                  </span>
                )}
              </div>
            </div>
          )}

          {/* STEP 7: DONE */}
          {step === 7 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-white">Ready to Play</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Setup summary before opening the main menu.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-950 border border-slate-800 p-4 text-xs">
                <div>
                  <div className="text-slate-400">Connection Type</div>
                  <div className="font-bold text-white mt-0.5 uppercase">
                    {connChoice} ({transportKind})
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Measured Latency</div>
                  <div className="font-mono font-bold text-emerald-300 mt-0.5">
                    {rttMs.toFixed(2)} ms RTT (Simulated)
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Gyro Aim</div>
                  <div className="font-bold text-sky-300 mt-0.5">
                    {gyroSettings.enabled
                      ? `On (${gyroSettings.sensitivity.toFixed(2)}x)`
                      : 'Off'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Layout Profile</div>
                  <div className="font-bold text-white mt-0.5">
                    {activeProfile.name}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onCompleteSetup}
                className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-extrabold text-sm transition cursor-pointer"
              >
                Start
              </button>
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM NAVIGATION BAR: Back, Skip, Next on every step */}
      <div className="max-w-xl w-full mx-auto flex items-center justify-between">
        <button
          type="button"
          onClick={() => step > 1 && goToStep(step - 1)}
          disabled={step === 1}
          className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-800 text-xs font-semibold text-slate-200 cursor-pointer"
        >
          Back
        </button>

        <button
          type="button"
          onClick={handleSkipStep}
          className="px-5 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
        >
          Skip
        </button>

        <button
          type="button"
          onClick={handleNextStep}
          className="px-6 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold cursor-pointer"
        >
          {step < 7 ? 'Next' : 'Start'}
        </button>
      </div>
    </div>
  );
};
