import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Code2,
  Compass,
  Download,
  Edit3,
  Play,
  QrCode,
  ShieldCheck,
  Sliders,
  Terminal,
  Upload,
  Vibrate,
  Wifi,
} from 'lucide-react';
import {
  AndroidControllerSurface,
  TouchInputSnapshot,
  TransportKind,
} from './components/AndroidControllerSurface';
import { AssetImage } from './components/AssetImage';
import {
  SetupWizard,
  STORAGE_KEY_SETUP_COMPLETED,
  STORAGE_KEY_SETUP_STEP,
} from './components/SetupWizard';
import {
  GyroConfigurationPanel,
  GyroDriftCalibration,
  GyroSettings,
  PairingQrModal,
} from './components/GyroAndPairingPanels';
import { PcReceiverInspector, ReceiverStats } from './components/PcReceiverInspector';
import { SourceCodeExplorer } from './components/SourceCodeExplorer';
import { TrayAndTestSuitePanel } from './components/TrayAndTestSuitePanel';
import { SOURCE_FILES } from './data/sourceFiles';
import {
  ControllerState,
  DS4_BUTTONS,
  decodeControllerPacket,
  encodeControllerPacket,
  floatToInt16,
  generateTestModeState,
  INITIAL_CONTROLLER_STATE,
  UI_TRIGGER_FLAGS,
} from './protocol/ds4Packet';
import {
  BINDING_OPTIONS,
  BUILTIN_LAYOUT_PROFILES,
  ControlBindingType,
  ControllerLayoutProfile,
  ControlWidgetLayout,
  resolveControlAssetFilename,
} from './protocol/layoutProfiles';

type AppScreen = 'menu' | 'gamepad';
type MenuSection = 'connect' | 'mapping' | 'adjust' | 'haptics' | 'developer';
type DeveloperSubTab = 'inspector' | 'tray_tests' | 'gyro' | 'code';
type StreamSourceMode = 'interactive' | 'vigem_test_cycle' | 'fake_phone_120hz';

export default function App() {
  // First-Run Setup Wizard state (persisted via `setup_completed` and `setup_current_step`)
  const [setupCompleted, setSetupCompleted] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEY_SETUP_COMPLETED) === 'true';
  });
  const [wizardStep, setWizardStep] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY_SETUP_STEP) || '1');
    return Math.max(1, Math.min(7, saved));
  });

  // Two Separate Full-Page Screens: Screen 1 ('menu') -> Screen 2 ('gamepad')
  const [appScreen, setAppScreen] = useState<AppScreen>('menu');
  const [menuSection, setMenuSection] = useState<MenuSection>('connect');
  const [devSubTab, setDevSubTab] = useState<DeveloperSubTab>('inspector');
  const [openGamepadInEditMode, setOpenGamepadInEditMode] = useState<boolean>(false);

  const [sourceMode, setSourceMode] = useState<StreamSourceMode>('interactive');
  const [testPhaseLabel, setTestPhaseLabel] = useState<string>('');

  // Transport Mode: USB (`adb reverse` TCP 127.0.0.1:26761) vs Wi-Fi (UDP :26760)
  const [transportKind, setTransportKind] = useState<TransportKind>('USB');
  const [rttMs, setRttMs] = useState<number>(0.84);
  const [rttHistory, setRttHistory] = useState<number[]>(() =>
    Array.from({ length: 28 }, () => 0.85)
  );

  // Bi-directional DualShock 4 Rumble & Button Tap Haptics
  const [rumbleState, setRumbleState] = useState({ largeMotor: 0, smallMotor: 0 });
  const [autoRumbleOnTriggers, setAutoRumbleOnTriggers] = useState<boolean>(true);
  const [hapticTapEnabled, setHapticTapEnabled] = useState<boolean>(true);
  const [rumbleEnabled, setRumbleEnabled] = useState<boolean>(true);

  // Layout Profiles ("Default DS4", "FPS", "Racing" + Custom JSON)
  const [profiles, setProfiles] = useState<ControllerLayoutProfile[]>(
    BUILTIN_LAYOUT_PROFILES
  );
  const [activeProfileId, setActiveProfileId] = useState<string>(
    BUILTIN_LAYOUT_PROFILES[0].id
  );
  const [jsonModalOpen, setJsonModalOpen] = useState<boolean>(false);
  const [jsonText, setJsonText] = useState<string>('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) ?? profiles[0];

  const handleUpdateActiveProfileControls = (controls: ControlWidgetLayout[]) => {
    setProfiles((prev) =>
      prev.map((p) => (p.id === activeProfileId ? { ...p, controls } : p))
    );
  };

  const handleRemapSingleControl = (
    controlId: string,
    newBinding: ControlBindingType
  ) => {
    const updated = activeProfile.controls.map((c) =>
      c.id === controlId ? { ...c, binding: newBinding } : c
    );
    handleUpdateActiveProfileControls(updated);
  };

  const handleImportProfileJson = (jsonText: string): boolean => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed.name !== 'string' || !Array.isArray(parsed.controls)) {
        return false;
      }
      const imported: ControllerLayoutProfile = {
        id: parsed.id || `custom_${Date.now()}`,
        name: parsed.name,
        description: parsed.description || 'Imported JSON layout profile',
        controls: parsed.controls,
      };
      setProfiles((prev) => {
        const exists = prev.some((p) => p.id === imported.id);
        return exists
          ? prev.map((p) => (p.id === imported.id ? imported : p))
          : [...prev, imported];
      });
      setActiveProfileId(imported.id);
      return true;
    } catch {
      return false;
    }
  };

  // Paired PC Receiver Endpoint & Rate (default 120Hz)
  const [pairedEndpoint, setPairedEndpoint] = useState({
    ip: '192.168.1.42',
    port: 26760,
    token: 'a1b2c3d4e5f60718',
    rateHz: 120,
    connected: true,
  });
  const [isPairingModalOpen, setIsPairingModalOpen] = useState(false);
  const [vigemDriverInstalled, setVigemDriverInstalled] = useState(true);

  // Multi-touch Android Controller State
  const [touchInput, setTouchInput] = useState<TouchInputSnapshot>({
    buttonsMask: 0,
    leftStick: { x: 0, y: 0 },
    rightStick: { x: 0, y: 0 },
    l2Analog: 0,
    r2Analog: 0,
    activeTouchCount: 0,
  });

  // Gyroscope SensorManager.SENSOR_DELAY_FASTEST Configuration
  const [gyroSettings, setGyroSettings] = useState<GyroSettings>({
    enabled: true,
    sensitivity: 1.6,
    invertX: false,
    invertY: false,
    deadzoneRadPerSec: 0.025,
    smoothingAlpha: 0.35,
    requireHoldButton: true,
    activationButtonMask: UI_TRIGGER_FLAGS.L2_DIG,
  });

  // Stationary Gyro Drift Calibration State
  const [calibration, setCalibration] = useState<GyroDriftCalibration>({
    isCalibrating: false,
    progress: 0,
    hardwareDriftX: 0.042,
    hardwareDriftY: -0.018,
    hardwareDriftZ: -0.065,
    calibratedBiasX: 0.042,
    calibratedBiasY: -0.018,
    calibratedBiasZ: -0.065,
    lastCalibratedAt: 'Calibrated on startup',
  });

  // Interactive / Physical DeviceMotion Gyro Angular Velocity (rad/s)
  const [manualGyroInput, setManualGyroInput] = useState({
    yawZ: 0,
    pitchX: 0,
    rollY: 0,
  });
  const smoothedGyroRef = useRef({ x: 0, y: 0, z: 0 });

  // Listen to real smartphone gyroscope if opened on a mobile browser
  useEffect(() => {
    const onDeviceMotion = (e: DeviceMotionEvent) => {
      if (!e.rotationRate) return;
      const degToRad = Math.PI / 180;
      const alpha = (e.rotationRate.alpha ?? 0) * degToRad;
      const beta = (e.rotationRate.beta ?? 0) * degToRad;
      const gamma = (e.rotationRate.gamma ?? 0) * degToRad;
      if (Math.hypot(alpha, beta, gamma) > 0.02) {
        setManualGyroInput({
          pitchX: alpha,
          rollY: beta,
          yawZ: gamma,
        });
      }
    };
    window.addEventListener('devicemotion', onDeviceMotion);
    return () => window.removeEventListener('devicemotion', onDeviceMotion);
  }, []);

  // Run 240-sample stationary drift calibration loop when requested
  const handleStartCalibration = () => {
    if (calibration.isCalibrating) return;
    setCalibration((prev) => ({ ...prev, isCalibrating: true, progress: 0 }));
    let step = 0;
    const totalSteps = 20;
    const timer = window.setInterval(() => {
      step += 1;
      if (step >= totalSteps) {
        window.clearInterval(timer);
        setCalibration((prev) => ({
          ...prev,
          isCalibrating: false,
          progress: 1,
          calibratedBiasX: prev.hardwareDriftX,
          calibratedBiasY: prev.hardwareDriftY,
          calibratedBiasZ: prev.hardwareDriftZ,
          lastCalibratedAt: new Date().toLocaleTimeString(),
        }));
      } else {
        setCalibration((prev) => ({
          ...prev,
          progress: step / totalSteps,
        }));
      }
    }, 65);
  };

  const handleInjectDriftForTest = () => {
    setCalibration((prev) => ({
      ...prev,
      hardwareDriftX: 0.145,
      hardwareDriftZ: -0.21,
    }));
  };

  // Latest binary packet & receiver filter state
  const [latestBytes, setLatestBytes] = useState<Uint8Array>(() =>
    encodeControllerPacket(INITIAL_CONTROLLER_STATE, 1, 0)
  );
  const [decodedPacket, setDecodedPacket] = useState(() =>
    decodeControllerPacket(encodeControllerPacket(INITIAL_CONTROLLER_STATE, 1, 0))
  );
  const [receiverStats, setReceiverStats] = useState<ReceiverStats>({
    acceptedPackets: 0,
    droppedOutOfOrder: 0,
    droppedStale: 0,
    actualHz: 120,
    avgLatencyMs: 8.33,
    p99JitterMs: 0.42,
    lastSeq: 1,
  });

  const seqRef = useRef<number>(1);
  const lastAcceptedSeqRef = useRef<number>(0);
  const startPerfRef = useRef<number>(performance.now());
  const windowCountRef = useRef<number>(0);
  const windowStartRef = useRef<number>(performance.now());

  // Compute gyro-to-right-stick offset in real time
  const isHoldGateSatisfied =
    !gyroSettings.requireHoldButton ||
    (touchInput.buttonsMask & gyroSettings.activationButtonMask) !== 0;

  // Latest refs for high-rate loop
  const stateSnapshotRef = useRef({
    touchInput,
    gyroSettings,
    calibration,
    manualGyroInput,
    sourceMode,
    pairedEndpoint,
    transportKind,
    autoRumbleOnTriggers,
  });
  stateSnapshotRef.current = {
    touchInput,
    gyroSettings,
    calibration,
    manualGyroInput,
    sourceMode,
    pairedEndpoint,
    transportKind,
    autoRumbleOnTriggers,
  };

  const [liveGyroDisplay, setLiveGyroDisplay] = useState({
    filteredX: 0,
    filteredY: 0,
    filteredZ: 0,
    rsDeltaX: 0,
    rsDeltaY: 0,
  });

  // Dedicated UDP Sender + Receiver loop (runs at configurable rateHz, default 120Hz)
  useEffect(() => {
    const intervalMs = Math.max(4, Math.round(1000 / pairedEndpoint.rateHz));
    const timer = window.setInterval(() => {
      const nowMs = performance.now();
      const elapsedSec = (nowMs - startPerfRef.current) / 1000;
      const timestampUs = Math.floor(elapsedSec * 1_000_000);

      const {
        touchInput: ti,
        gyroSettings: gs,
        calibration: cal,
        manualGyroInput: mg,
        sourceMode: mode,
      } = stateSnapshotRef.current;

      // 1. SensorManager thread: Raw Gyro = manual tilt + hardware drift - calibrated bias
      const rawX = mg.pitchX + cal.hardwareDriftX - cal.calibratedBiasX;
      const rawY = mg.rollY + cal.hardwareDriftY - cal.calibratedBiasY;
      const rawZ = mg.yawZ + cal.hardwareDriftZ - cal.calibratedBiasZ;

      // 2. EMA Low-Pass Smoothing filter
      const alpha = Math.max(0, Math.min(0.95, gs.smoothingAlpha));
      const oneMinusAlpha = 1 - alpha;
      smoothedGyroRef.current = {
        x: alpha * smoothedGyroRef.current.x + oneMinusAlpha * rawX,
        y: alpha * smoothedGyroRef.current.y + oneMinusAlpha * rawY,
        z: alpha * smoothedGyroRef.current.z + oneMinusAlpha * rawZ,
      };

      // 3. Radial Deadzone + Per-Axis Invert + Sensitivity -> Right Stick offset
      let rsGyroX = 0;
      let rsGyroY = 0;
      const gateOpen =
        !gs.requireHoldButton || (ti.buttonsMask & gs.activationButtonMask) !== 0;

      if (gs.enabled && gateOpen) {
        let yawRate = -smoothedGyroRef.current.z;
        let pitchRate = smoothedGyroRef.current.x;
        const mag = Math.hypot(yawRate, pitchRate);
        if (mag > gs.deadzoneRadPerSec && mag > 0) {
          const rescale = (mag - gs.deadzoneRadPerSec) / mag;
          yawRate *= rescale;
          pitchRate *= rescale;
          if (gs.invertX) yawRate = -yawRate;
          if (gs.invertY) pitchRate = -pitchRate;
          rsGyroX = Math.max(-1, Math.min(1, yawRate * gs.sensitivity * 0.45));
          rsGyroY = Math.max(-1, Math.min(1, pitchRate * gs.sensitivity * 0.45));
        }
      }

      setLiveGyroDisplay({
        filteredX: smoothedGyroRef.current.x,
        filteredY: smoothedGyroRef.current.y,
        filteredZ: smoothedGyroRef.current.z,
        rsDeltaX: rsGyroX,
        rsDeltaY: rsGyroY,
      });

      // 4. Build ControllerState according to active StreamSourceMode
      let controllerState: ControllerState;

      if (mode === 'vigem_test_cycle') {
        const testOut = generateTestModeState(elapsedSec);
        controllerState = testOut.state;
        setTestPhaseLabel(testOut.phaseLabel);
      } else if (mode === 'fake_phone_120hz') {
        const btnIdx = Math.floor(elapsedSec * 4) % 16;
        controllerState = {
          buttonsMask: 1 << btnIdx,
          lx: floatToInt16(Math.sin(elapsedSec * 2.0)),
          ly: floatToInt16(Math.cos(elapsedSec * 2.0)),
          rx: floatToInt16(Math.sin(elapsedSec * 3.5)),
          ry: floatToInt16(Math.cos(elapsedSec * 1.75)),
          l2: Math.round((Math.sin(elapsedSec * 1.5) * 0.5 + 0.5) * 255),
          r2: Math.round((Math.cos(elapsedSec * 1.5) * 0.5 + 0.5) * 255),
          gyroX: 0.85 * Math.sin(elapsedSec * 5.0),
          gyroY: 0.65 * Math.cos(elapsedSec * 4.0),
          gyroZ: 1.2 * Math.sin(elapsedSec * 3.0),
          accelX: 0.15 * Math.sin(elapsedSec * 1.2),
          accelY: 0.2 * Math.cos(elapsedSec * 1.2),
          accelZ: 9.81,
        };
        setTestPhaseLabel(
          'Fake-Phone 120Hz Sender (`fake_phone_sender.py`): Figure-8 Sticks + Trigger Waves + 3-Axis IMU'
        );
      } else {
        controllerState = {
          buttonsMask: ti.buttonsMask,
          lx: floatToInt16(ti.leftStick.x),
          ly: floatToInt16(ti.leftStick.y),
          rx: floatToInt16(ti.rightStick.x + rsGyroX),
          ry: floatToInt16(ti.rightStick.y + rsGyroY),
          l2: ti.l2Analog,
          r2: ti.r2Analog,
          gyroX: smoothedGyroRef.current.x,
          gyroY: smoothedGyroRef.current.y,
          gyroZ: smoothedGyroRef.current.z,
          accelX: 0,
          accelY: 0,
          accelZ: 9.81,
        };
      }

      // 5. Serialize into 48-byte little-endian binary packet & pass to PC UDP Receiver parser
      const seq = seqRef.current++;
      const packetBytes = encodeControllerPacket(controllerState, seq, timestampUs);
      const parsed = decodeControllerPacket(packetBytes);

      if (parsed.seq > lastAcceptedSeqRef.current) {
        lastAcceptedSeqRef.current = parsed.seq;
        windowCountRef.current += 1;
        setLatestBytes(packetBytes);
        setDecodedPacket(parsed);
      }

      const windowElapsedSec = (nowMs - windowStartRef.current) / 1000;
      if (windowElapsedSec >= 0.5) {
        const measuredHz = windowCountRef.current / windowElapsedSec;
        const currentTransport = stateSnapshotRef.current.transportKind;
        const simulatedRtt =
          currentTransport === 'USB'
            ? Number((0.78 + Math.random() * 0.16).toFixed(2))
            : Number((3.05 + Math.random() * 0.45).toFixed(2));

        setRttMs(simulatedRtt);
        setRttHistory((prev) => [...prev.slice(1), simulatedRtt]);

        if (stateSnapshotRef.current.autoRumbleOnTriggers) {
          setRumbleState({
            largeMotor: parsed.l2,
            smallMotor: parsed.r2,
          });
        }

        setReceiverStats((prev) => ({
          ...prev,
          acceptedPackets: prev.acceptedPackets + windowCountRef.current,
          actualHz: measuredHz,
          avgLatencyMs: simulatedRtt,
          p99JitterMs:
            currentTransport === 'USB'
              ? Number((0.18 + Math.random() * 0.12).toFixed(2))
              : Number((0.62 + Math.random() * 0.35).toFixed(2)),
          lastSeq: parsed.seq,
        }));
        windowCountRef.current = 0;
        windowStartRef.current = nowMs;
      } else {
        setReceiverStats((prev) => ({
          ...prev,
          lastSeq: parsed.seq,
        }));
      }
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [pairedEndpoint.rateHz]);

  const handleInjectOutOfOrder = () => {
    setReceiverStats((prev) => ({
      ...prev,
      droppedOutOfOrder: prev.droppedOutOfOrder + 1,
    }));
  };

  const handleInjectStalePacket = () => {
    setReceiverStats((prev) => ({
      ...prev,
      droppedStale: prev.droppedStale + 1,
    }));
  };

  const toggleHoldActivationButton = () => {
    setTouchInput((prev) => {
      const mask = gyroSettings.activationButtonMask;
      const nextButtons = prev.buttonsMask ^ mask;
      return {
        ...prev,
        buttonsMask: nextButtons,
        l2Analog: nextButtons & UI_TRIGGER_FLAGS.L2_DIG ? 255 : 0,
        r2Analog: nextButtons & UI_TRIGGER_FLAGS.R2_DIG ? 255 : 0,
      };
    });
  };

  // Enter Screen 2 (Full-Viewport Gamepad) and request browser fullscreen
  const handleStartGamepad = (startInEditMode = false) => {
    setOpenGamepadInEditMode(startInEditMode);
    setAppScreen('gamepad');
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  // Exit Screen 2 back to Screen 1 (Full-Page Menu)
  const handleBackToMenu = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    setOpenGamepadInEditMode(false);
    setAppScreen('menu');
  };

  const handleDisconnectToMenu = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    setTouchInput({
      buttonsMask: 0,
      leftStick: { x: 0, y: 0 },
      rightStick: { x: 0, y: 0 },
      l2Analog: 0,
      r2Analog: 0,
      activeTouchCount: 0,
    });
    setOpenGamepadInEditMode(false);
    setAppScreen('menu');
  };

  const handleCompleteSetup = () => {
    localStorage.setItem(STORAGE_KEY_SETUP_COMPLETED, 'true');
    localStorage.setItem(STORAGE_KEY_SETUP_STEP, '1');
    setWizardStep(1);
    setSetupCompleted(true);
    setAppScreen('menu');
  };

  const handleRunSetupAgain = () => {
    localStorage.setItem(STORAGE_KEY_SETUP_STEP, '1');
    setWizardStep(1);
    setSetupCompleted(false);
  };

  const handleResetSetup = () => {
    localStorage.removeItem(STORAGE_KEY_SETUP_COMPLETED);
    localStorage.removeItem(STORAGE_KEY_SETUP_STEP);
    localStorage.removeItem('pc_tray_setup_completed');
    localStorage.removeItem('pc_tray_setup_step');
    setWizardStep(1);
    setSetupCompleted(false);
  };

  // =========================================================================
  // FIRST-RUN SETUP WIZARD (Shown only when `setup_completed` is not set,
  // or when re-run via "Run setup again" / "Reset setup")
  // =========================================================================
  if (!setupCompleted) {
    return (
      <SetupWizard
        currentStep={wizardStep}
        onChangeStep={setWizardStep}
        pairedEndpoint={pairedEndpoint}
        onChangeEndpoint={setPairedEndpoint}
        transportKind={transportKind}
        onChangeTransportKind={setTransportKind}
        rttMs={rttMs}
        gyroSettings={gyroSettings}
        onChangeGyroSettings={setGyroSettings}
        calibration={calibration}
        onStartCalibration={handleStartCalibration}
        liveTiltOffset={{
          x: liveGyroDisplay.rsDeltaX,
          y: liveGyroDisplay.rsDeltaY,
        }}
        onChangeManualGyro={setManualGyroInput}
        profiles={profiles}
        activeProfileId={activeProfileId}
        onSelectProfile={setActiveProfileId}
        onCompleteSetup={handleCompleteSetup}
      />
    );
  }

  // =========================================================================
  // SCREEN 2: FULL-VIEWPORT GAMEPAD (`100vw x 100vh`)
  // No page header, no tabs, no badges, no text above or around it,
  // no scrolling, and no panels below it.
  // =========================================================================
  if (appScreen === 'gamepad') {
    return (
      <AndroidControllerSurface
        touchInput={
          sourceMode === 'interactive'
            ? touchInput
            : {
                buttonsMask: decodedPacket.buttonsMask,
                leftStick: {
                  x: decodedPacket.lx / 32767,
                  y: decodedPacket.ly / 32767,
                },
                rightStick: {
                  x: decodedPacket.rx / 32767,
                  y: decodedPacket.ry / 32767,
                },
                l2Analog: decodedPacket.l2,
                r2Analog: decodedPacket.r2,
                activeTouchCount: 0,
              }
        }
        onChangeTouchInput={setTouchInput}
        gyroOffsetNorm={
          sourceMode === 'interactive'
            ? { x: liveGyroDisplay.rsDeltaX, y: liveGyroDisplay.rsDeltaY }
            : { x: 0, y: 0 }
        }
        gyroActivationMask={gyroSettings.activationButtonMask}
        transportKind={transportKind}
        onToggleTransportKind={() =>
          setTransportKind((prev) => (prev === 'USB' ? 'WIFI' : 'USB'))
        }
        rttMs={rttMs}
        hapticTapEnabled={hapticTapEnabled}
        gyroSettings={gyroSettings}
        onChangeGyroSettings={setGyroSettings}
        profiles={profiles}
        activeProfileId={activeProfileId}
        onSelectProfile={setActiveProfileId}
        onUpdateActiveProfileControls={handleUpdateActiveProfileControls}
        liveStats={{
          actualHz: receiverStats.actualHz,
          seq: receiverStats.lastSeq,
        }}
        initialEditMode={openGamepadInEditMode}
        onBackToMenu={handleBackToMenu}
        onDisconnect={handleDisconnectToMenu}
        disabledByAutomation={sourceMode !== 'interactive'}
      />
    );
  }

  // =========================================================================
  // SCREEN 1: FULL-PAGE MENU (First view when opening the app)
  // =========================================================================
  return (
    <div className="min-h-screen bg-[#060911] text-slate-100 flex flex-col">
      {/* Screen 1 Top Bar: App Logo (`/assets/logo_app.png`) + Status Badge + Big START Button */}
      <header className="border-b border-slate-800/80 bg-[#0A101D]">
        <div className="max-w-6xl mx-auto px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 shrink-0">
              <AssetImage
                filename="logo_app.png"
                fallbackLabel="LOGO"
                fallbackClassName="rounded-xl bg-slate-900 border-slate-700"
              />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
                DS4 Bridge 120Hz
              </h1>
              <div className="flex flex-wrap items-center gap-2.5 mt-0.5 text-xs font-mono">
                <button
                  type="button"
                  onClick={() =>
                    setTransportKind((prev) => (prev === 'USB' ? 'WIFI' : 'USB'))
                  }
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-900 border border-slate-700 text-slate-200 hover:border-slate-500"
                >
                  <span className="w-4 h-4 inline-block">
                    <AssetImage
                      filename={
                        transportKind === 'USB'
                          ? 'ic_badge_usb.png'
                          : 'ic_badge_wifi.png'
                      }
                      fallbackLabel={transportKind}
                      fallbackClassName="rounded"
                    />
                  </span>
                  <span
                    className={
                      transportKind === 'USB'
                        ? 'text-emerald-300 font-semibold'
                        : 'text-sky-300 font-semibold'
                    }
                  >
                    {transportKind === 'USB' ? 'USB (adb reverse)' : 'Wi-Fi UDP'}
                  </span>
                </button>
                <span className="text-slate-400">
                  {pairedEndpoint.ip}:{pairedEndpoint.port} • RTT {rttMs.toFixed(2)}ms (Simulated) •{' '}
                  {Math.round(receiverStats.actualHz)}Hz (Simulated)
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRunSetupAgain}
              className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 transition cursor-pointer"
            >
              Run setup again
            </button>

            {/* Big START Button -> Requests Browser Fullscreen & Switches to Screen 2 (Gamepad) */}
            <button
              type="button"
              onClick={() => handleStartGamepad(false)}
              className="inline-flex items-center gap-2.5 px-8 py-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-95 text-slate-950 font-extrabold text-sm sm:text-base shadow-lg shadow-sky-500/25 transition cursor-pointer"
            >
              <Play className="w-5 h-5 fill-current" />
              START
            </button>
          </div>
        </div>
      </header>

      {/* Screen 1 Section Navigation */}
      <div className="border-b border-slate-800/70 bg-[#080D18]">
        <div className="max-w-6xl mx-auto px-5 py-3 flex flex-wrap gap-2">
          {(
            [
              ['connect', 'Connect', Wifi],
              ['mapping', 'Mapping & Layout', Edit3],
              ['adjust', 'Adjust', Sliders],
              ['haptics', 'Haptics', Vibrate],
              ['developer', 'Developer', Terminal],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMenuSection(id)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold border transition cursor-pointer ${
                menuSection === id
                  ? 'bg-sky-500 text-slate-950 border-sky-400 shadow-sm'
                  : 'bg-[#0E1525] border-slate-800 text-slate-300 hover:text-white hover:border-slate-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Screen 1 Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-5 py-6">
        {/* ================================================================= */}
        {/* SECTION 1: CONNECT (QR scan, manual IP & port, USB / Wi-Fi)       */}
        {/* ================================================================= */}
        {menuSection === 'connect' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            <div className="md:col-span-7 rounded-2xl bg-[#0E1525] border border-slate-800 p-6 space-y-5">
              <div>
                <h2 className="text-base font-bold text-white">
                  PC Server Connection
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Connect over USB (`adb reverse tcp:26761`) or Wi-Fi UDP (`:26760`).
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    PC LAN IP Address
                  </label>
                  <input
                    type="text"
                    value={pairedEndpoint.ip}
                    onChange={(e) =>
                      setPairedEndpoint((prev) => ({
                        ...prev,
                        ip: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white font-mono focus:border-sky-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    UDP Port
                  </label>
                  <input
                    type="number"
                    value={pairedEndpoint.port}
                    onChange={(e) =>
                      setPairedEndpoint((prev) => ({
                        ...prev,
                        port: Number(e.target.value) || 26760,
                      }))
                    }
                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3.5 py-2.5 text-sm text-white font-mono focus:border-sky-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* USB vs Wi-Fi Mode Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Transport Mode
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setTransportKind('USB')}
                    className={`flex items-center gap-3 p-3.5 rounded-xl border text-left transition ${
                      transportKind === 'USB'
                        ? 'bg-emerald-500/15 border-emerald-400 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="w-8 h-8 shrink-0">
                      <AssetImage
                        filename="ic_badge_usb.png"
                        fallbackLabel="USB"
                        fallbackClassName="rounded-lg"
                      />
                    </div>
                    <div>
                      <div className="text-xs font-bold">USB Mode</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        adb reverse • ~0.8ms
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTransportKind('WIFI')}
                    className={`flex items-center gap-3 p-3.5 rounded-xl border text-left transition ${
                      transportKind === 'WIFI'
                        ? 'bg-sky-500/15 border-sky-400 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="w-8 h-8 shrink-0">
                      <AssetImage
                        filename="ic_badge_wifi.png"
                        fallbackLabel="WiFi"
                        fallbackClassName="rounded-lg"
                      />
                    </div>
                    <div>
                      <div className="text-xs font-bold">Wi-Fi Mode</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        UDP :26760 • ~3.2ms
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setIsPairingModalOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-sky-300"
                >
                  <QrCode className="w-4 h-4" />
                  Scan / View Pairing QR Code
                </button>

                <button
                  type="button"
                  onClick={() => handleStartGamepad(false)}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs sm:text-sm"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Start Fullscreen Gamepad
                </button>
              </div>
            </div>

            <div className="md:col-span-5 rounded-2xl bg-[#0E1525] border border-slate-800 p-6 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-white">
                  Quick QR Pairing URI
                </h3>
                <p className="text-xs text-slate-400">
                  Scan the QR code from the PC tray app or enter the URI below:
                </p>
                <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 font-mono text-xs text-sky-300 break-all">
                  ds4udp://{pairedEndpoint.ip}:{pairedEndpoint.port}?token=
                  {pairedEndpoint.token || 'a1b2c3d4e5f60718'}
                </div>
              </div>

              <div className="rounded-xl bg-slate-950/90 border border-slate-800 p-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Active Transport</span>
                  <span className="font-mono text-white font-semibold">
                    {transportKind} (Simulated)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Measured Latency</span>
                  <span className="font-mono text-emerald-300 font-semibold">
                    {rttMs.toFixed(2)} ms RTT (Simulated)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">UDP Stream Rate</span>
                  <span className="font-mono text-sky-300 font-semibold">
                    {pairedEndpoint.rateHz} Hz
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* SECTION 2: MAPPING & LAYOUT (Profiles, Edit Layout, Remap, JSON)  */}
        {/* ================================================================= */}
        {menuSection === 'mapping' && (
          <div className="space-y-6">
            <div className="rounded-2xl bg-[#0E1525] border border-slate-800 p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-white">
                    Layout Profiles &amp; Button Remapping
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Switch presets, launch fullscreen Edit Layout mode, or remap any control.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleStartGamepad(true)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    <Edit3 className="w-4 h-4" />
                    Edit Layout on Fullscreen Gamepad
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setJsonText(JSON.stringify(activeProfile, null, 2));
                      setJsonError(null);
                      setJsonModalOpen(true);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-xs cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    JSON Import / Export
                  </button>
                </div>
              </div>

              {/* Profile Picker */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActiveProfileId(p.id)}
                    className={`p-4 rounded-xl border text-left transition cursor-pointer ${
                      activeProfileId === p.id
                        ? 'bg-sky-500/15 border-sky-400 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <div className="text-sm font-bold">{p.name}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      {p.description}
                    </div>
                  </button>
                ))}
              </div>

              {/* Button Remapping Grid showing each control's image asset + binding selector */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                  Control Image Assets (`/assets/*.png`) &amp; Button Remapping
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {activeProfile.controls.map((ctrl) => {
                    const assetFile = resolveControlAssetFilename(ctrl);
                    return (
                      <div
                        key={ctrl.id}
                        className="flex items-center justify-between gap-3 rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 shrink-0">
                            <AssetImage
                              filename={assetFile}
                              fallbackLabel={ctrl.label}
                              fallbackClassName="rounded-lg"
                            />
                          </div>
                          <div className="truncate">
                            <div className="font-semibold text-white truncate">
                              {ctrl.label}
                            </div>
                            <div className="font-mono text-[10px] text-slate-400 truncate">
                              /assets/{assetFile}
                            </div>
                          </div>
                        </div>

                        <select
                          value={ctrl.binding}
                          onChange={(e) =>
                            handleRemapSingleControl(
                              ctrl.id,
                              e.target.value as ControlBindingType
                            )
                          }
                          className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-[11px] font-mono text-sky-300"
                        >
                          {BINDING_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* SECTION 3: ADJUST (Gyro sensitivity, deadzone, smoothing, rate)   */}
        {/* ================================================================= */}
        {menuSection === 'adjust' && (
          <div className="rounded-2xl bg-[#0E1525] border border-slate-800 p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-white">
                  Gyroscope, Calibration &amp; Send Rate
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Configure gyroscope-to-right-stick sensitivity, deadzone, smoothing, axis inversion, and UDP rate.
                </p>
              </div>

              <button
                type="button"
                onClick={handleStartCalibration}
                className="px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-200 font-semibold text-xs cursor-pointer"
              >
                {calibration.isCalibrating
                  ? `Calibrating Drift... ${Math.round(calibration.progress * 100)}%`
                  : 'Calibrate Stationary Gyro Drift'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <label className="flex items-center gap-2.5 p-3.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gyroSettings.enabled}
                  onChange={(e) =>
                    setGyroSettings((s) => ({ ...s, enabled: e.target.checked }))
                  }
                  className="accent-cyan-400"
                />
                <span className="font-semibold text-white">Enable Gyro Aim</span>
              </label>

              <label className="flex items-center gap-2.5 p-3.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gyroSettings.invertX}
                  onChange={(e) =>
                    setGyroSettings((s) => ({ ...s, invertX: e.target.checked }))
                  }
                  className="accent-cyan-400"
                />
                <span className="font-semibold text-white">Invert X (Yaw)</span>
              </label>

              <label className="flex items-center gap-2.5 p-3.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gyroSettings.invertY}
                  onChange={(e) =>
                    setGyroSettings((s) => ({ ...s, invertY: e.target.checked }))
                  }
                  className="accent-cyan-400"
                />
                <span className="font-semibold text-white">Invert Y (Pitch)</span>
              </label>

              <label className="flex items-center gap-2.5 p-3.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gyroSettings.requireHoldButton}
                  onChange={(e) =>
                    setGyroSettings((s) => ({
                      ...s,
                      requireHoldButton: e.target.checked,
                    }))
                  }
                  className="accent-cyan-400"
                />
                <span className="font-semibold text-white">Hold-Gate (L2 ADS)</span>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
                <div className="flex justify-between text-slate-300 mb-2">
                  <span>Gyro Sensitivity</span>
                  <span className="font-mono text-cyan-300">
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
                    setGyroSettings((s) => ({
                      ...s,
                      sensitivity: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-cyan-400"
                />
              </div>

              <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
                <div className="flex justify-between text-slate-300 mb-2">
                  <span>Radial Deadzone</span>
                  <span className="font-mono text-cyan-300">
                    {gyroSettings.deadzoneRadPerSec.toFixed(3)} rad/s
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={0.15}
                  step={0.005}
                  value={gyroSettings.deadzoneRadPerSec}
                  onChange={(e) =>
                    setGyroSettings((s) => ({
                      ...s,
                      deadzoneRadPerSec: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-cyan-400"
                />
              </div>

              <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
                <div className="flex justify-between text-slate-300 mb-2">
                  <span>EMA Smoothing</span>
                  <span className="font-mono text-cyan-300">
                    {Math.round(gyroSettings.smoothingAlpha * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={0.9}
                  step={0.05}
                  value={gyroSettings.smoothingAlpha}
                  onChange={(e) =>
                    setGyroSettings((s) => ({
                      ...s,
                      smoothingAlpha: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-cyan-400"
                />
              </div>
            </div>

            {/* Packet Send Rate Selector */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800 text-xs">
              <div>
                <div className="font-bold text-white">UDP Packet Send Rate</div>
                <div className="text-slate-400">
                  Target transmission rate for the 48-byte DualShock 4 state stream
                </div>
              </div>
              <div className="flex items-center gap-2">
                {[60, 120, 240].map((hz) => (
                  <button
                    key={hz}
                    type="button"
                    onClick={() =>
                      setPairedEndpoint((prev) => ({ ...prev, rateHz: hz }))
                    }
                    className={`px-4 py-2 rounded-xl border font-mono font-bold transition cursor-pointer ${
                      pairedEndpoint.rateHz === hz
                        ? 'bg-sky-500 text-slate-950 border-sky-300'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    {hz} Hz
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* SECTION 4: HAPTICS (Rumble & Button Press Vibration)              */}
        {/* ================================================================= */}
        {menuSection === 'haptics' && (
          <div className="rounded-2xl bg-[#0E1525] border border-slate-800 p-6 space-y-4 text-xs">
            <div>
              <h2 className="text-base font-bold text-white">
                Rumble &amp; Touch Haptics
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Control DualShock 4 force-feedback motor packets from the PC and touch-down haptic pulses.
              </p>
            </div>

            <label className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
              <div>
                <div className="font-bold text-white text-sm">
                  PC DualShock 4 Rumble Vibration (`DS4R`)
                </div>
                <div className="text-slate-400 mt-0.5">
                  Vibrate phone motors when PC games trigger DualShock 4 large/small rumble motors
                </div>
              </div>
              <input
                type="checkbox"
                checked={rumbleEnabled}
                onChange={(e) => setRumbleEnabled(e.target.checked)}
                className="w-4 h-4 accent-sky-400"
              />
            </label>

            <label className="flex items-center justify-between p-4 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
              <div>
                <div className="font-bold text-white text-sm">
                  Haptic Tap on Button Press
                </div>
                <div className="text-slate-400 mt-0.5">
                  Short tactile pulse (`navigator.vibrate(8)`) when pressing face buttons, D-Pad, or bumpers
                </div>
              </div>
              <input
                type="checkbox"
                checked={hapticTapEnabled}
                onChange={() => setHapticTapEnabled((v) => !v)}
                className="w-4 h-4 accent-sky-400"
              />
            </label>
          </div>
        )}

        {/* ================================================================= */}
        {/* SECTION 5: DEVELOPER (Existing Inspector, Tray, Gyro, Source Code)*/}
        {/* ================================================================= */}
        {menuSection === 'developer' && (
          <div className="space-y-5">
            {/* Developer Sub-Navigation & Active Input Source Bar */}
            <div className="rounded-2xl bg-[#0E1525] border border-slate-800 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDevSubTab('inspector')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      devSubTab === 'inspector'
                        ? 'bg-sky-500 text-slate-950'
                        : 'bg-slate-900 text-slate-300 hover:text-white'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    Controller &amp; 120Hz Inspector
                  </button>
                  <button
                    type="button"
                    onClick={() => setDevSubTab('tray_tests')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      devSubTab === 'tray_tests'
                        ? 'bg-violet-400 text-slate-950'
                        : 'bg-slate-900 text-slate-300 hover:text-white'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    PC Tray GUI, Rumble &amp; Test Suite
                  </button>
                  <button
                    type="button"
                    onClick={() => setDevSubTab('gyro')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      devSubTab === 'gyro'
                        ? 'bg-cyan-400 text-slate-950'
                        : 'bg-slate-900 text-slate-300 hover:text-white'
                    }`}
                  >
                    <Compass className="w-3.5 h-3.5" />
                    Gyro Aim &amp; Drift Lab
                  </button>
                  <button
                    type="button"
                    onClick={() => setDevSubTab('code')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      devSubTab === 'code'
                        ? 'bg-emerald-400 text-slate-950'
                        : 'bg-slate-900 text-slate-300 hover:text-white'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    Source Files ({SOURCE_FILES.length})
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setIsPairingModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-sky-300 font-mono text-[11px]"
                >
                  <QrCode className="w-3.5 h-3.5 text-sky-400" />
                  Pair QR: ds4udp://{pairedEndpoint.ip}:{pairedEndpoint.port}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRunSetupAgain}
                    className="px-3 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-xs cursor-pointer"
                  >
                    Run setup again
                  </button>
                  <button
                    type="button"
                    onClick={handleResetSetup}
                    className="px-3 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/50 text-rose-300 font-bold text-xs cursor-pointer"
                  >
                    Reset setup
                  </button>
                </div>
              </div>

              {/* Stream Source Mode Selector */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800 text-xs">
                <span className="text-slate-400 font-mono text-[11px]">
                  ACTIVE INPUT SOURCE:
                </span>
                <button
                  type="button"
                  onClick={() => setSourceMode('interactive')}
                  className={`px-3 py-1 rounded-lg border font-medium transition ${
                    sourceMode === 'interactive'
                      ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  1. Interactive Phone Controller
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode('vigem_test_cycle')}
                  className={`px-3 py-1 rounded-lg border font-medium transition ${
                    sourceMode === 'vigem_test_cycle'
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  2. ViGEmBus Self-Test Cycle (`--test`)
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode('fake_phone_120hz')}
                  className={`px-3 py-1 rounded-lg border font-medium transition ${
                    sourceMode === 'fake_phone_120hz'
                      ? 'bg-violet-500/20 border-violet-400 text-violet-200'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  3. 120Hz Fake-Phone Benchmark (`fake_phone_sender.py`)
                </button>
                {testPhaseLabel && sourceMode !== 'interactive' && (
                  <span className="text-[11px] font-mono text-emerald-300">
                    {testPhaseLabel}
                  </span>
                )}
              </div>
            </div>

            {devSubTab === 'inspector' && (
              <PcReceiverInspector
                latestPacketBytes={latestBytes}
                decodedPacket={decodedPacket}
                receiverStats={receiverStats}
                onInjectOutOfOrder={handleInjectOutOfOrder}
                onInjectStalePacket={handleInjectStalePacket}
                vigemDriverSimulatedInstalled={vigemDriverInstalled}
                onToggleVigemDriver={() => setVigemDriverInstalled((v) => !v)}
              />
            )}

            {devSubTab === 'tray_tests' && (
              <TrayAndTestSuitePanel
                transportKind={transportKind}
                onSetTransportKind={setTransportKind}
                rttMs={rttMs}
                rttHistory={rttHistory}
                pairedEndpoint={pairedEndpoint}
                decodedPacket={decodedPacket}
                rumbleState={rumbleState}
                onChangeRumbleState={setRumbleState}
                autoRumbleOnTriggers={autoRumbleOnTriggers}
                onToggleAutoRumbleOnTriggers={() =>
                  setAutoRumbleOnTriggers((v) => !v)
                }
              />
            )}

            {devSubTab === 'gyro' && (
              <GyroConfigurationPanel
                settings={gyroSettings}
                onChangeSettings={setGyroSettings}
                calibration={calibration}
                onStartCalibration={handleStartCalibration}
                onInjectDriftForTest={handleInjectDriftForTest}
                manualGyroInput={manualGyroInput}
                onChangeManualGyro={setManualGyroInput}
                effectiveGyroRad={{
                  x: liveGyroDisplay.filteredX,
                  y: liveGyroDisplay.filteredY,
                  z: liveGyroDisplay.filteredZ,
                }}
                mappedRightStickDelta={{
                  x: liveGyroDisplay.rsDeltaX,
                  y: liveGyroDisplay.rsDeltaY,
                }}
                isHoldGateSatisfied={isHoldGateSatisfied}
                onToggleHoldActivationButton={toggleHoldActivationButton}
              />
            )}

            {devSubTab === 'code' && <SourceCodeExplorer />}
          </div>
        )}
      </main>

      {/* JSON Layout Profile Export / Import Modal */}
      {jsonModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                Export / Import Layout Profile JSON ({activeProfile.name})
              </h3>
              <button
                type="button"
                onClick={() => setJsonModalOpen(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={12}
              className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 font-mono text-xs text-slate-200 focus:border-sky-400 focus:outline-none"
            />
            {jsonError && (
              <div className="text-xs text-rose-400 font-mono">{jsonError}</div>
            )}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([jsonText], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${activeProfile.id}_layout.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200"
              >
                <Download className="w-3.5 h-3.5" />
                Download .json
              </button>
              <button
                type="button"
                onClick={() => {
                  const ok = handleImportProfileJson(jsonText);
                  if (ok) {
                    setJsonModalOpen(false);
                  } else {
                    setJsonError(
                      'Invalid profile JSON: expected { id, name, controls: [...] }'
                    );
                  }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs"
              >
                <Upload className="w-3.5 h-3.5" />
                Import &amp; Apply Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Code & IP Pairing Modal */}
      <PairingQrModal
        isOpen={isPairingModalOpen}
        onClose={() => setIsPairingModalOpen(false)}
        endpoint={pairedEndpoint}
        onSaveEndpoint={setPairedEndpoint}
      />
    </div>
  );
}
