import React, { useEffect, useRef, useState } from 'react';
import { DS4_BUTTONS, UI_TRIGGER_FLAGS } from '../protocol/ds4Packet';
import { GyroSettings } from './GyroAndPairingPanels';
import { AssetImage } from './AssetImage';
import {
  BINDING_OPTIONS,
  ControlBindingType,
  ControllerLayoutProfile,
  ControlWidgetLayout,
  getBindingMask,
  resolveControlAssetFilename,
} from '../protocol/layoutProfiles';

export interface TouchInputSnapshot {
  buttonsMask: number;
  leftStick: { x: number; y: number }; // -1..1
  rightStick: { x: number; y: number }; // -1..1
  l2Analog: number; // 0..255
  r2Analog: number; // 0..255
  activeTouchCount: number;
}

export type TransportKind = 'USB' | 'WIFI';

interface AndroidControllerSurfaceProps {
  touchInput: TouchInputSnapshot;
  onChangeTouchInput: React.Dispatch<React.SetStateAction<TouchInputSnapshot>>;
  gyroOffsetNorm: { x: number; y: number };
  gyroActivationMask: number;
  transportKind: TransportKind;
  onToggleTransportKind: () => void;
  rttMs: number;
  hapticTapEnabled: boolean;
  gyroSettings?: GyroSettings;
  onChangeGyroSettings?: React.Dispatch<React.SetStateAction<GyroSettings>>;
  profiles: ControllerLayoutProfile[];
  activeProfileId: string;
  onSelectProfile: (id: string) => void;
  onUpdateActiveProfileControls: (controls: ControlWidgetLayout[]) => void;
  liveStats: { actualHz: number; seq: number };
  initialEditMode?: boolean;
  onBackToMenu: () => void;
  onDisconnect: () => void;
  disabledByAutomation?: boolean;
}

interface StickDragBinding {
  kind: 'leftStick' | 'rightStick';
  centerX: number;
  centerY: number;
  radius: number;
}

/**
 * Screen 2: Pure Full-Viewport Gamepad (`100vw x 100vh`)
 * - Fills the entire viewport (`fixed inset-0 w-screen h-screen`), no page header, no tabs,
 *   no badges, no text above or around it, no scrolling, and no panels below it.
 * - Renders every control from `/assets/<filename>.png` via <AssetImage /> with a visible labeled fallback.
 * - The only extra element is one small semi-transparent gear in the top-right corner (`/assets/ic_settings.png`).
 * - Clicking the gear slides in the 40%-width Settings Side Panel from the right, blocking input underneath
 *   and releasing sticks/buttons to neutral while open.
 */
export const AndroidControllerSurface: React.FC<AndroidControllerSurfaceProps> = ({
  touchInput,
  onChangeTouchInput,
  gyroOffsetNorm,
  gyroActivationMask,
  transportKind,
  onToggleTransportKind,
  rttMs,
  hapticTapEnabled,
  gyroSettings,
  onChangeGyroSettings,
  profiles,
  activeProfileId,
  onSelectProfile,
  onUpdateActiveProfileControls,
  liveStats,
  initialEditMode = false,
  onBackToMenu,
  onDisconnect,
  disabledByAutomation = false,
}) => {
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Multi-touch pointer maps: pointerId -> StickDragBinding or button bitmask
  const stickPointersRef = useRef<Map<number, StickDragBinding>>(new Map());
  const buttonPointersRef = useRef<Map<number, number>>(new Map());

  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState<boolean>(false);

  // Layout Edit Mode State
  const [editMode, setEditMode] = useState<boolean>(initialEditMode);
  const [selectedControlId, setSelectedControlId] = useState<string>('right_stick');
  const [draggingControlId, setDraggingControlId] = useState<string | null>(null);

  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const selectedControl =
    activeProfile.controls.find((c) => c.id === selectedControlId) ??
    activeProfile.controls[0];

  const [latchedButtonsMask] = useState<number>(0);
  const [keyboardMask, setKeyboardMask] = useState<number>(0);
  const [keyboardLeftStick, setKeyboardLeftStick] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });

  // Safety Rule: While the Settings Side Panel is open (or in Edit Layout mode),
  // release sticks and buttons to neutral so the 120Hz sender keeps streaming
  // a released state with zero stuck inputs.
  useEffect(() => {
    if (isSettingsPanelOpen || editMode) {
      stickPointersRef.current.clear();
      buttonPointersRef.current.clear();
      onChangeTouchInput({
        buttonsMask: 0,
        leftStick: { x: 0, y: 0 },
        rightStick: { x: 0, y: 0 },
        l2Analog: 0,
        r2Analog: 0,
        activeTouchCount: 0,
      });
    }
  }, [isSettingsPanelOpen, editMode, onChangeTouchInput]);

  // Recompute combined button mask from all active pointers + latched + keyboard
  const syncButtonsState = (
    nextLatched = latchedButtonsMask,
    nextKbMask = keyboardMask
  ) => {
    let combinedMask = nextLatched | nextKbMask;
    for (const mask of buttonPointersRef.current.values()) {
      combinedMask |= mask;
    }
    const activeCount =
      stickPointersRef.current.size +
      buttonPointersRef.current.size +
      (nextLatched !== 0 ? 1 : 0) +
      (nextKbMask !== 0 ? 1 : 0);

    onChangeTouchInput((prev) => ({
      ...prev,
      buttonsMask: combinedMask,
      l2Analog: combinedMask & UI_TRIGGER_FLAGS.L2_DIG ? 255 : prev.l2Analog > 0 && !(prev.buttonsMask & UI_TRIGGER_FLAGS.L2_DIG) ? prev.l2Analog : 0,
      r2Analog: combinedMask & UI_TRIGGER_FLAGS.R2_DIG ? 255 : prev.r2Analog > 0 && !(prev.buttonsMask & UI_TRIGGER_FLAGS.R2_DIG) ? prev.r2Analog : 0,
      activeTouchCount: activeCount,
    }));
  };

  // Keyboard multi-input support (WASD = Left Stick, Space = L2/Gyro Hold, J/K/L/I = Square/Cross/Circle/Triangle)
  useEffect(() => {
    if (disabledByAutomation || isSettingsPanelOpen || editMode) return;
    const pressedKeys = new Set<string>();

    const updateFromKeys = () => {
      let mask = 0;
      if (pressedKeys.has('KeyJ')) mask |= DS4_BUTTONS.SQUARE;
      if (pressedKeys.has('KeyK')) mask |= DS4_BUTTONS.CROSS;
      if (pressedKeys.has('KeyL')) mask |= DS4_BUTTONS.CIRCLE;
      if (pressedKeys.has('KeyI')) mask |= DS4_BUTTONS.TRIANGLE;
      if (pressedKeys.has('KeyQ')) mask |= DS4_BUTTONS.L1;
      if (pressedKeys.has('KeyE')) mask |= DS4_BUTTONS.R1;
      if (pressedKeys.has('Space')) mask |= gyroActivationMask;
      if (pressedKeys.has('ArrowUp')) mask |= DS4_BUTTONS.DPAD_UP;
      if (pressedKeys.has('ArrowDown')) mask |= DS4_BUTTONS.DPAD_DOWN;
      if (pressedKeys.has('ArrowLeft')) mask |= DS4_BUTTONS.DPAD_LEFT;
      if (pressedKeys.has('ArrowRight')) mask |= DS4_BUTTONS.DPAD_RIGHT;

      const lx = (pressedKeys.has('KeyD') ? 1 : 0) - (pressedKeys.has('KeyA') ? 1 : 0);
      const ly = (pressedKeys.has('KeyS') ? 1 : 0) - (pressedKeys.has('KeyW') ? 1 : 0);
      const mag = Math.hypot(lx, ly);
      const normLx = mag > 1 ? lx / mag : lx;
      const normLy = mag > 1 ? ly / mag : ly;

      setKeyboardMask(mask);
      setKeyboardLeftStick({ x: normLx, y: normLy });

      onChangeTouchInput((prev) => {
        let pointerMask = latchedButtonsMask | mask;
        for (const m of buttonPointersRef.current.values()) pointerMask |= m;
        const hasLeftPointer = Array.from(stickPointersRef.current.values()).some(
          (b) => b.kind === 'leftStick'
        );
        return {
          ...prev,
          buttonsMask: pointerMask,
          leftStick: hasLeftPointer ? prev.leftStick : { x: normLx, y: normLy },
          l2Analog: pointerMask & UI_TRIGGER_FLAGS.L2_DIG ? 255 : 0,
          r2Analog: pointerMask & UI_TRIGGER_FLAGS.R2_DIG ? 255 : 0,
        };
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }
      if (
        [
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'KeyJ',
          'KeyK',
          'KeyL',
          'KeyI',
          'KeyQ',
          'KeyE',
          'Space',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
        ].includes(e.code)
      ) {
        e.preventDefault();
        pressedKeys.add(e.code);
        updateFromKeys();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (pressedKeys.has(e.code)) {
        pressedKeys.delete(e.code);
        updateFromKeys();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [disabledByAutomation, isSettingsPanelOpen, editMode, gyroActivationMask, latchedButtonsMask]);

  const handleStickPointerDown = (
    control: ControlWidgetLayout,
    kind: 'leftStick' | 'rightStick',
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (disabledByAutomation || isSettingsPanelOpen) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    if (editMode) {
      setSelectedControlId(control.id);
      setDraggingControlId(control.id);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const binding: StickDragBinding = {
      kind,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      radius: Math.min(rect.width, rect.height) / 2,
    };
    stickPointersRef.current.set(e.pointerId, binding);
    updateStickFromPointer(e.pointerId, e.clientX, e.clientY);
  };

  const updateStickFromPointer = (pointerId: number, clientX: number, clientY: number) => {
    const binding = stickPointersRef.current.get(pointerId);
    if (!binding) return;
    const dx = (clientX - binding.centerX) / binding.radius;
    const dy = (clientY - binding.centerY) / binding.radius;
    const dist = Math.hypot(dx, dy);
    const clampedX = dist > 1 ? dx / dist : dx;
    const clampedY = dist > 1 ? dy / dist : dy;

    onChangeTouchInput((prev) => ({
      ...prev,
      [binding.kind]: { x: clampedX, y: clampedY },
      activeTouchCount:
        stickPointersRef.current.size +
        buttonPointersRef.current.size +
        (latchedButtonsMask !== 0 ? 1 : 0),
    }));
  };

  const handleStickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editMode && draggingControlId) {
      handleEditDragMove(e.clientX, e.clientY);
      return;
    }
    if (!stickPointersRef.current.has(e.pointerId)) return;
    updateStickFromPointer(e.pointerId, e.clientX, e.clientY);
  };

  const handleStickPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editMode) {
      setDraggingControlId(null);
      return;
    }
    const binding = stickPointersRef.current.get(e.pointerId);
    if (!binding) return;
    stickPointersRef.current.delete(e.pointerId);

    onChangeTouchInput((prev) => ({
      ...prev,
      [binding.kind]:
        binding.kind === 'leftStick' ? keyboardLeftStick : { x: 0, y: 0 },
      activeTouchCount:
        stickPointersRef.current.size +
        buttonPointersRef.current.size +
        (latchedButtonsMask !== 0 ? 1 : 0),
    }));
  };

  const handleButtonPointerDown = (
    control: ControlWidgetLayout,
    mask: number,
    e: React.PointerEvent<HTMLButtonElement>
  ) => {
    if (disabledByAutomation || isSettingsPanelOpen) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    if (editMode) {
      setSelectedControlId(control.id);
      setDraggingControlId(control.id);
      return;
    }

    // Trigger optional Haptic Tap on button press
    if (hapticTapEnabled) {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(10);
      }
    }

    buttonPointersRef.current.set(e.pointerId, mask);
    syncButtonsState(latchedButtonsMask, keyboardMask);
  };

  const handleButtonPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (editMode && draggingControlId) {
      handleEditDragMove(e.clientX, e.clientY);
    }
  };

  const handleButtonPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (editMode) {
      setDraggingControlId(null);
      return;
    }
    if (buttonPointersRef.current.has(e.pointerId)) {
      buttonPointersRef.current.delete(e.pointerId);
      syncButtonsState(latchedButtonsMask, keyboardMask);
    }
  };

  const handleEditDragMove = (clientX: number, clientY: number) => {
    if (!draggingControlId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const xPct = Math.max(5, Math.min(95, Math.round(((clientX - rect.left) / rect.width) * 100)));
    const yPct = Math.max(10, Math.min(90, Math.round(((clientY - rect.top) / rect.height) * 100)));
    const nextControls = activeProfile.controls.map((c) =>
      c.id === draggingControlId ? { ...c, xPct, yPct } : c
    );
    onUpdateActiveProfileControls(nextControls);
  };

  const updateSelectedControlField = <K extends keyof ControlWidgetLayout>(
    key: K,
    value: ControlWidgetLayout[K]
  ) => {
    if (!selectedControl) return;
    const nextControls = activeProfile.controls.map((c) =>
      c.id === selectedControl.id ? { ...c, [key]: value } : c
    );
    onUpdateActiveProfileControls(nextControls);
  };

  const isPressed = (mask: number) => (touchInput.buttonsMask & mask) !== 0;

  // Combined Right Stick display (Touch + Gyro offset)
  const effectiveRx = Math.max(-1, Math.min(1, touchInput.rightStick.x + gyroOffsetNorm.x));
  const effectiveRy = Math.max(-1, Math.min(1, touchInput.rightStick.y + gyroOffsetNorm.y));

  return (
    <div
      ref={canvasRef}
      className="fixed inset-0 w-screen h-screen bg-[#060911] overflow-hidden select-none touch-none"
    >
      {/* Render every Image-Based Control from activeProfile.controls */}
      {/* Pressed state scales to 0.92x and lowers alpha (opacity * 0.68) */}
      {activeProfile.controls.map((ctrl) => {
        const isSelectedInEdit = editMode && selectedControlId === ctrl.id;
        const assetFile = resolveControlAssetFilename(ctrl);

        if (ctrl.binding === 'LEFT_STICK' || ctrl.binding === 'RIGHT_STICK') {
          const isLeft = ctrl.binding === 'LEFT_STICK';
          const stickValX = isLeft ? touchInput.leftStick.x : effectiveRx;
          const stickValY = isLeft ? touchInput.leftStick.y : effectiveRy;
          const isDeflected = Math.hypot(stickValX, stickValY) > 0.04;
          const baseSize = 152 * ctrl.scale;
          const capSize = 68 * ctrl.scale;

          return (
            <div
              key={ctrl.id}
              onPointerDown={(e) =>
                handleStickPointerDown(
                  ctrl,
                  isLeft ? 'leftStick' : 'rightStick',
                  e
                )
              }
              onPointerMove={handleStickPointerMove}
              onPointerUp={handleStickPointerUp}
              onPointerCancel={handleStickPointerUp}
              style={{
                left: `${ctrl.xPct}%`,
                top: `${ctrl.yPct}%`,
                width: `${baseSize}px`,
                height: `${baseSize}px`,
                opacity: isDeflected ? ctrl.opacity * 0.68 : ctrl.opacity,
                transform: 'translate(-50%, -50%)',
              }}
              className={`absolute flex items-center justify-center cursor-grab active:cursor-grabbing ${
                isSelectedInEdit ? 'ring-2 ring-amber-400 rounded-full' : ''
              }`}
            >
              {/* Stick Base Image (`/assets/stick_base.png`) */}
              <div className="absolute inset-0">
                <AssetImage
                  filename="stick_base.png"
                  fallbackLabel={ctrl.label}
                  fallbackClassName="rounded-full"
                />
              </div>
              {/* Stick Cap Image (`/assets/stick_cap.png`) */}
              <div
                style={{
                  width: `${capSize}px`,
                  height: `${capSize}px`,
                  transform: `translate(${stickValX * (baseSize * 0.28)}px, ${
                    stickValY * (baseSize * 0.28)
                  }px) scale(${isDeflected ? 0.92 : 1.0})`,
                }}
                className="relative z-10 pointer-events-none transition-transform duration-75"
              >
                <AssetImage
                  filename="stick_cap.png"
                  fallbackLabel={ctrl.label}
                  fallbackClassName="rounded-full bg-slate-800/95 border-slate-500"
                />
              </div>
            </div>
          );
        }

        const mask = getBindingMask(ctrl.binding);
        const active = isPressed(mask);
        const isTrigger =
          ctrl.binding === 'L2_TRIGGER' || ctrl.binding === 'R2_TRIGGER';
        const isTouchpad = ctrl.id === 'touchpad';
        const isSystemSmall = ['share', 'options', 'l3', 'r3', 'ps'].includes(
          ctrl.id
        );
        const isFaceCircle = [
          'triangle',
          'cross',
          'square',
          'circle',
          'ps',
        ].includes(ctrl.id);

        const widthPx =
          (isTouchpad ? 160 : isTrigger ? 102 : isSystemSmall ? 64 : 66) *
          ctrl.scale;
        const heightPx =
          (isTouchpad ? 68 : isTrigger ? 54 : isSystemSmall ? 40 : 66) *
          ctrl.scale;

        return (
          <button
            key={ctrl.id}
            type="button"
            onPointerDown={(e) => handleButtonPointerDown(ctrl, mask, e)}
            onPointerMove={handleButtonPointerMove}
            onPointerUp={handleButtonPointerUp}
            onPointerCancel={handleButtonPointerUp}
            style={{
              left: `${ctrl.xPct}%`,
              top: `${ctrl.yPct}%`,
              width: `${widthPx}px`,
              height: `${heightPx}px`,
              opacity: active ? ctrl.opacity * 0.68 : ctrl.opacity,
              transform: `translate(-50%, -50%) scale(${active ? 0.92 : 1.0})`,
            }}
            className={`absolute p-0 bg-transparent border-0 transition-transform duration-75 ${
              isSelectedInEdit ? 'ring-2 ring-amber-400 rounded-xl' : ''
            }`}
          >
            <AssetImage
              filename={assetFile}
              fallbackLabel={ctrl.label}
              fallbackClassName={isFaceCircle ? 'rounded-full' : 'rounded-xl'}
            />
          </button>
        );
      })}

      {/* Compact Floating Edit Mode Bar (Only when Edit Layout is active) */}
      {editMode && selectedControl && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center gap-3 rounded-xl bg-slate-900/95 border border-amber-400 px-4 py-2 text-xs shadow-2xl"
        >
          <span className="font-mono text-amber-300 font-semibold">
            {selectedControl.label}
          </span>
          <label className="flex items-center gap-1.5 text-slate-300">
            <span>Size</span>
            <input
              type="range"
              min={0.6}
              max={1.75}
              step={0.05}
              value={selectedControl.scale}
              onChange={(e) =>
                updateSelectedControlField('scale', parseFloat(e.target.value))
              }
              className="w-20 accent-amber-400"
            />
          </label>
          <label className="flex items-center gap-1.5 text-slate-300">
            <span>Alpha</span>
            <input
              type="range"
              min={0.2}
              max={1.0}
              step={0.05}
              value={selectedControl.opacity}
              onChange={(e) =>
                updateSelectedControlField('opacity', parseFloat(e.target.value))
              }
              className="w-20 accent-amber-400"
            />
          </label>
          <select
            value={selectedControl.binding}
            onChange={(e) =>
              updateSelectedControlField(
                'binding',
                e.target.value as ControlBindingType
              )
            }
            className="rounded bg-slate-950 border border-slate-700 px-2 py-1 text-amber-200 font-mono text-[11px]"
          >
            {BINDING_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setEditMode(false)}
            className="px-3 py-1 rounded-lg bg-amber-400 text-slate-950 font-bold"
          >
            Save Layout
          </button>
        </div>
      )}

      {/* ONLY EXTRA ELEMENT ON GAMEPAD SCREEN: One small semi-transparent gear in the top-right corner */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsSettingsPanelOpen((v) => !v);
        }}
        style={{ opacity: isSettingsPanelOpen ? 0.92 : 0.42 }}
        title="/assets/ic_settings.png"
        className="absolute top-4 right-4 z-40 w-9 h-9 p-0 bg-transparent border-0 transition hover:opacity-90"
      >
        <AssetImage
          filename="ic_settings.png"
          fallbackLabel="ic_settings"
          fallbackClassName="rounded-lg"
        />
      </button>

      {/* TOUCH-BLOCKING SCRIM + 40%-WIDTH SLIDE-IN SETTINGS SIDE PANEL */}
      {isSettingsPanelOpen && (
        <>
          {/* Scrim consumes all pointer events so touches never leak to the gamepad underneath */}
          <div
            onPointerDown={(e) => {
              e.stopPropagation();
              setIsSettingsPanelOpen(false);
            }}
            className="absolute inset-0 z-30 bg-black/60"
          />

          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute top-0 right-0 bottom-0 z-40 w-[40%] min-w-[260px] max-w-[440px] bg-[#0E1525]/95 border-l border-slate-800 p-5 flex flex-col justify-between text-xs shadow-2xl"
          >
            <div className="space-y-4">
              {/* USB / Wi-Fi Mini Badge + Latency */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 pr-10">
                <button
                  type="button"
                  onClick={onToggleTransportKind}
                  className="inline-flex items-center gap-2 font-mono font-bold text-xs"
                >
                  <div className="w-5 h-5">
                    <AssetImage
                      filename={
                        transportKind === 'USB'
                          ? 'ic_badge_usb.png'
                          : 'ic_badge_wifi.png'
                      }
                      fallbackLabel={transportKind === 'USB' ? 'USB' : 'WiFi'}
                      fallbackClassName="rounded"
                    />
                  </div>
                  <span
                    className={
                      transportKind === 'USB'
                        ? 'text-emerald-300'
                        : 'text-sky-300'
                    }
                  >
                    {transportKind} • {rttMs.toFixed(2)}ms (Simulated)
                  </span>
                </button>
                <span className="font-mono text-[11px] text-slate-400">
                  {Math.round(liveStats.actualHz)}Hz (Sim)
                </span>
              </div>

              {/* Gyro Toggle & Sensitivity */}
              {gyroSettings && onChangeGyroSettings && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-white font-semibold">Gyro Aim</span>
                    <input
                      type="checkbox"
                      checked={gyroSettings.enabled}
                      onChange={(e) =>
                        onChangeGyroSettings((s) => ({
                          ...s,
                          enabled: e.target.checked,
                        }))
                      }
                      className="accent-cyan-400"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-slate-300 mb-1">
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
                        onChangeGyroSettings((s) => ({
                          ...s,
                          sensitivity: parseFloat(e.target.value),
                        }))
                      }
                      className="w-full accent-cyan-400"
                    />
                  </div>
                </div>
              )}

              {/* Profile Switcher */}
              <div className="space-y-2">
                <div className="text-white font-semibold">Layout Profile</div>
                <div className="flex flex-wrap gap-1.5">
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onSelectProfile(p.id)}
                      className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold ${
                        activeProfileId === p.id
                          ? 'bg-sky-500 text-slate-950 border-sky-300'
                          : 'bg-slate-900 border-slate-700 text-slate-300'
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Edit Layout Button */}
              <button
                type="button"
                onClick={() => {
                  setIsSettingsPanelOpen(false);
                  setEditMode(true);
                }}
                className="w-full py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
              >
                Edit Layout
              </button>
            </div>

            {/* Back to Menu & Disconnect */}
            <div className="space-y-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsSettingsPanelOpen(false);
                  onBackToMenu();
                }}
                className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium"
              >
                Back to Menu
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSettingsPanelOpen(false);
                  onDisconnect();
                }}
                className="w-full py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold"
              >
                Disconnect
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
