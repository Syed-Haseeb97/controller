import React, { useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Download,
  FileCode,
  Terminal,
  Wrench,
} from 'lucide-react';
import { SOURCE_FILES, SourceFileEntry } from '../data/sourceFiles';

export const SourceCodeExplorer: React.FC = () => {
  const [selectedFileId, setSelectedFileId] = useState<string>(SOURCE_FILES[0].id);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeFile: SourceFileEntry =
    SOURCE_FILES.find((f) => f.id === selectedFileId) ?? SOURCE_FILES[0];

  const handleCopy = async (file: SourceFileEntry) => {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopiedId(file.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // ignore clipboard error
    }
  };

  const handleDownload = (file: SourceFileEntry) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pythonFiles = SOURCE_FILES.filter(
    (f) => f.category === 'Windows Python (ViGEmBus)'
  );
  const androidFiles = SOURCE_FILES.filter(
    (f) => f.category === 'Android Kotlin + Compose'
  );

  return (
    <div className="space-y-4">
      {/* Windows ViGEmBus Installation & Verification Quick-Start Banner */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-white mb-3">
          <Wrench className="w-4 h-4 text-sky-400" />
          Windows 10/11 ViGEmBus Setup &amp; Hardware Verification Guide
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 space-y-1.5">
            <div className="font-mono text-[11px] text-sky-400 font-bold">
              STEP 1: INSTALL VIGEMBUS DRIVER
            </div>
            <p className="text-slate-300 leading-relaxed">
              Download and run{' '}
              <code className="text-sky-300">ViGEmBus_Setup_x64.exe</code> as
              Administrator from{' '}
              <span className="font-mono text-slate-200">
                github.com/nefarius/ViGEmBus/releases/latest
              </span>
              , then install Python packages:
            </p>
            <pre className="rounded bg-slate-900 px-2.5 py-1.5 font-mono text-[11px] text-emerald-300 overflow-x-auto">
              pip install vgamepad qrcode[pil]
            </pre>
          </div>

          <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 space-y-1.5">
            <div className="font-mono text-[11px] text-emerald-400 font-bold">
              STEP 2: VERIFY IN JOY.CPL &amp; GAMEPAD-TESTER
            </div>
            <p className="text-slate-300 leading-relaxed">
              Run the hardware self-test mode to cycle every button, 8-way D-pad, dual
              analog sticks, and L2/R2 triggers while watching{' '}
              <code className="text-emerald-300">joy.cpl</code> or{' '}
              <code className="text-emerald-300">gamepad-tester.com</code>:
            </p>
            <pre className="rounded bg-slate-900 px-2.5 py-1.5 font-mono text-[11px] text-emerald-300 overflow-x-auto">
              python pc_server/ds4_udp_receiver.py --test
            </pre>
          </div>

          <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 space-y-1.5">
            <div className="font-mono text-[11px] text-violet-400 font-bold">
              STEP 3: 120HZ RECEIVER &amp; FAKE-PHONE BENCHMARK
            </div>
            <p className="text-slate-300 leading-relaxed">
              Start the UDP receiver (prints the QR code for Android pairing) or run
              the 120Hz synthetic phone benchmark in a second terminal:
            </p>
            <pre className="rounded bg-slate-900 px-2.5 py-1.5 font-mono text-[11px] text-violet-300 overflow-x-auto">
              python pc_server/ds4_udp_receiver.py --port 26760{'\n'}
              python pc_server/fake_phone_sender.py --rate 120
            </pre>
          </div>
        </div>
      </div>

      {/* File Browser + Full Code Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Sidebar File Tree */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 space-y-4">
          <div>
            <div className="px-2 py-1 text-[11px] font-mono uppercase tracking-wider text-sky-400 font-semibold">
              Windows Python (ViGEmBus + 120Hz UDP)
            </div>
            <div className="mt-1 space-y-1">
              {pythonFiles.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => setSelectedFileId(file.id)}
                  className={`w-full text-left px-3 py-2 rounded-xl border text-xs transition flex items-center justify-between ${
                    selectedFileId === file.id
                      ? 'bg-sky-500/15 border-sky-500/50 text-white font-semibold'
                      : 'bg-slate-950/50 border-slate-800/80 text-slate-300 hover:bg-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate font-mono">
                    <Terminal className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    {file.path}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="px-2 py-1 text-[11px] font-mono uppercase tracking-wider text-emerald-400 font-semibold">
              Android Kotlin + Jetpack Compose App
            </div>
            <div className="mt-1 space-y-1">
              {androidFiles.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => setSelectedFileId(file.id)}
                  className={`w-full text-left px-3 py-2 rounded-xl border text-xs transition flex items-center justify-between ${
                    selectedFileId === file.id
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-white font-semibold'
                      : 'bg-slate-950/50 border-slate-800/80 text-slate-300 hover:bg-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate font-mono">
                    <FileCode className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    {file.filename}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Code Content Pane */}
        <div className="lg:col-span-8 rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-900 border-b border-slate-800">
            <div>
              <div className="font-mono text-xs font-bold text-white flex items-center gap-2">
                <Code2 className="w-4 h-4 text-sky-400" />
                {activeFile.path}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">{activeFile.summary}</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopy(activeFile)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition"
              >
                {copiedId === activeFile.id ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-300" />
                    Copy Code
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleDownload(activeFile)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-xs font-medium text-sky-200 transition"
              >
                <Download className="w-3.5 h-3.5" />
                Download {activeFile.filename}
              </button>
            </div>
          </div>

          <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto max-h-[540px] leading-relaxed">
            <code>{activeFile.content}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
