import React from 'react';
import {
  Activity,
  AlertTriangle,
  Binary,
  CheckCircle2,
  Cpu,
  Gamepad2,
  ShieldAlert,
  Sliders,
} from 'lucide-react';
import {
  BUTTON_METADATA,
  DecodedPacket,
  getPacketFieldSlices,
  int16ToDs4Byte,
} from '../protocol/ds4Packet';

export interface ReceiverStats {
  acceptedPackets: number;
  droppedOutOfOrder: number;
  droppedStale: number;
  actualHz: number;
  avgLatencyMs: number;
  p99JitterMs: number;
  lastSeq: number;
}

interface PcReceiverInspectorProps {
  latestPacketBytes: Uint8Array;
  decodedPacket: DecodedPacket;
  receiverStats: ReceiverStats;
  onInjectOutOfOrder: () => void;
  onInjectStalePacket: () => void;
  vigemDriverSimulatedInstalled: boolean;
  onToggleVigemDriver: () => void;
}

export const PcReceiverInspector: React.FC<PcReceiverInspectorProps> = ({
  latestPacketBytes,
  decodedPacket,
  receiverStats,
  onInjectOutOfOrder,
  onInjectStalePacket,
  vigemDriverSimulatedInstalled,
  onToggleVigemDriver,
}) => {
  const slices = getPacketFieldSlices(decodedPacket);

  // Map byte index (0..47) to its slice color
  const getByteColorClass = (byteIdx: number): string => {
    for (const s of slices) {
      if (byteIdx >= s.offset && byteIdx < s.offset + s.length) {
        return s.colorClass;
      }
    }
    return 'text-slate-400 border-slate-700 bg-slate-900';
  };

  const ds4LxByte = int16ToDs4Byte(decodedPacket.lx);
  const ds4LyByte = int16ToDs4Byte(decodedPacket.ly);
  const ds4RxByte = int16ToDs4Byte(decodedPacket.rx);
  const ds4RyByte = int16ToDs4Byte(decodedPacket.ry);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* LEFT COLUMN (7 cols): 48-Byte Binary Packet Dissector & UDP Receiver Filter */}
      <div className="lg:col-span-7 flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Binary className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-white">
              48-Byte Binary UDP Packet Wire Inspector
            </h3>
            <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 font-mono text-[11px] text-sky-300">
              struct: &lt;IQHhhhhBBffffff
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onInjectOutOfOrder}
              className="px-2.5 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[11px] font-mono transition"
              title="Send a packet with seq = currentSeq - 3 to test receiver out-of-order rejection"
            >
              + Inject Out-of-Order
            </button>
            <button
              type="button"
              onClick={onInjectStalePacket}
              className="px-2.5 py-1 rounded-md bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 text-[11px] font-mono transition"
              title="Send a packet delayed by > 50ms to test receiver stale timestamp rejection"
            >
              + Inject Stale (&gt;35ms)
            </button>
          </div>
        </div>

        {/* Field Breakdown Legend */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {slices.map((s) => (
            <div
              key={s.name}
              className={`rounded-lg border px-2.5 py-1.5 text-xs ${s.colorClass}`}
            >
              <div className="flex items-center justify-between font-mono text-[10px] opacity-80">
                <span>
                  [{s.offset}..{s.offset + s.length - 1}] {s.structCode}
                </span>
                <span>{s.cType}</span>
              </div>
              <div className="font-semibold truncate mt-0.5">{s.name}</div>
              <div className="font-mono text-[11px] truncate opacity-95">
                {s.formattedValue}
              </div>
            </div>
          ))}
        </div>

        {/* Live 48-Byte Little-Endian Hex Matrix */}
        <div className="rounded-xl bg-slate-950/90 border border-slate-800/90 p-3">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-2">
            <span>LIVE LITTLE-ENDIAN HEX PAYLOAD (48 BYTES / 384 BITS)</span>
            <span>
              Accepted: <strong className="text-emerald-400">{receiverStats.acceptedPackets}</strong>{' '}
              | Drop OOO: <strong className="text-amber-400">{receiverStats.droppedOutOfOrder}</strong>{' '}
              | Drop Stale: <strong className="text-rose-400">{receiverStats.droppedStale}</strong>
            </span>
          </div>
          <div className="grid grid-cols-8 sm:grid-cols-16 gap-1 font-mono text-[11px]">
            {Array.from(latestPacketBytes).map((byte, idx) => (
              <div
                key={idx}
                className={`rounded border px-1 py-1 text-center ${getByteColorClass(idx)}`}
                title={`Offset +${idx} (0x${idx.toString(16).padStart(2, '0')}): 0x${byte
                  .toString(16)
                  .padStart(2, '0')
                  .toUpperCase()} (${byte})`}
              >
                {byte.toString(16).padStart(2, '0').toUpperCase()}
              </div>
            ))}
          </div>
        </div>

        {/* Receiver Telemetry Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
          <div className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2">
            <div className="text-[10px] text-slate-400">UDP STREAM RATE</div>
            <div className="text-sm font-bold text-sky-400">
              {receiverStats.actualHz.toFixed(1)} Hz
            </div>
          </div>
          <div className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2">
            <div className="text-[10px] text-slate-400">FRAME INTERVAL / P99</div>
            <div className="text-sm font-bold text-emerald-400">
              {receiverStats.avgLatencyMs.toFixed(2)}ms / {receiverStats.p99JitterMs.toFixed(2)}ms
            </div>
          </div>
          <div className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2">
            <div className="text-[10px] text-slate-400">GYRO (RAD/S)</div>
            <div className="text-sm font-bold text-cyan-400 truncate">
              {decodedPacket.gyroX.toFixed(2)}, {decodedPacket.gyroY.toFixed(2)},{' '}
              {decodedPacket.gyroZ.toFixed(2)}
            </div>
          </div>
          <div className="rounded-lg bg-slate-950/70 border border-slate-800 px-3 py-2">
            <div className="text-[10px] text-slate-400">ACCEL (M/S²)</div>
            <div className="text-sm font-bold text-teal-400 truncate">
              {decodedPacket.accelX.toFixed(1)}, {decodedPacket.accelY.toFixed(1)},{' '}
              {decodedPacket.accelZ.toFixed(1)}
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN (5 cols): Windows ViGEmBus DualShock 4 (`joy.cpl` / gamepad-tester.com) */}
      <div className="lg:col-span-5 flex flex-col justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Gamepad2 className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">
              Windows ViGEmBus Virtual DS4 Output
            </h3>
          </div>

          <button
            type="button"
            onClick={onToggleVigemDriver}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-mono transition ${
              vigemDriverSimulatedInstalled
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-rose-500/20 border-rose-500/50 text-rose-200'
            }`}
            title="Click to preview the missing ViGEmBus driver diagnostic message"
          >
            {vigemDriverSimulatedInstalled ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ViGEmBus: READY
              </>
            ) : (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                ViGEmBus: MISSING
              </>
            )}
          </button>
        </div>

        {!vigemDriverSimulatedInstalled ? (
          <div className="rounded-xl bg-rose-950/40 border border-rose-500/50 p-3.5 text-xs text-rose-200 font-mono space-y-2">
            <div className="font-bold text-rose-300 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              [CRITICAL ERROR] Could not create Virtual DualShock 4 (ViGEmBus missing)
            </div>
            <p className="text-[11px] text-rose-200/90 leading-relaxed">
              vgamepad failed to connect to Nefarius Virtual Gamepad Emulation Bus driver.
            </p>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-rose-100">
              <li>
                Download <span className="underline">ViGEmBus_Setup_x64.exe</span> from
                github.com/nefarius/ViGEmBus/releases/latest
              </li>
              <li>Run installer as Administrator on Windows 10/11.</li>
              <li>
                Verify in Device Manager &rarr; System devices &rarr; &quot;Nefarius Virtual
                Gamepad Emulation Bus&quot;.
              </li>
              <li>
                Install Python package: <code>pip install vgamepad qrcode[pil]</code>
              </li>
            </ol>
          </div>
        ) : (
          <>
            {/* 16-Bit Button Matrix (`gamepad-tester.com` / `joy.cpl` layout) */}
            <div>
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-2">
                <span>16-BUTTON BITMASK (B0..B15)</span>
                <span>
                  0b{decodedPacket.buttonsMask.toString(2).padStart(16, '0')}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {BUTTON_METADATA.map((b) => {
                  const active = (decodedPacket.buttonsMask & b.mask) !== 0;
                  return (
                    <div
                      key={b.bit}
                      className={`rounded-lg border px-2 py-1.5 flex items-center justify-between text-[11px] font-mono transition ${
                        active
                          ? 'bg-sky-500/25 border-sky-400 text-white font-bold shadow-sm shadow-sky-500/30'
                          : 'bg-slate-950/70 border-slate-800/80 text-slate-400'
                      }`}
                    >
                      <span>B{b.bit}</span>
                      <span className="text-xs">{b.shortLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ViGEmBus Mapped Axes (0..255 DS4 Byte Scale + Normalized Axes) */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-2.5">
                <div className="text-[10px] font-mono text-slate-400 mb-1">
                  AXIS 0/1 • LEFT STICK (DS4 0..255)
                </div>
                <div className="text-xs font-mono text-slate-200 flex justify-between">
                  <span>LX: {ds4LxByte}</span>
                  <span>LY: {ds4LyByte}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full rounded bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-violet-400"
                    style={{ width: `${(ds4LxByte / 255) * 100}%` }}
                  />
                </div>
              </div>

              <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-2.5">
                <div className="text-[10px] font-mono text-slate-400 mb-1">
                  AXIS 2/3 • RIGHT STICK (DS4 0..255)
                </div>
                <div className="text-xs font-mono text-slate-200 flex justify-between">
                  <span>RX: {ds4RxByte}</span>
                  <span>RY: {ds4RyByte}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full rounded bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-cyan-400"
                    style={{ width: `${(ds4RxByte / 255) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            {/* L2 / R2 Analog Trigger Bars */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-2.5">
                <div className="flex justify-between text-[10px] font-mono text-slate-400 mb-1">
                  <span>L2 TRIGGER (UINT8)</span>
                  <span className="text-rose-300">{decodedPacket.l2} / 255</span>
                </div>
                <div className="h-2 w-full rounded bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-rose-500 transition-all"
                    style={{ width: `${(decodedPacket.l2 / 255) * 100}%` }}
                  />
                </div>
              </div>

              <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-2.5">
                <div className="flex justify-between text-[10px] font-mono text-slate-400 mb-1">
                  <span>R2 TRIGGER (UINT8)</span>
                  <span className="text-rose-300">{decodedPacket.r2} / 255</span>
                </div>
                <div className="h-2 w-full rounded bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-rose-500 transition-all"
                    style={{ width: `${(decodedPacket.r2 / 255) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
