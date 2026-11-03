#!/usr/bin/env python3
"""
DS4 Bridge 120Hz — Windows System Tray & Compact Telemetry GUI
==============================================================
Turns the DualShock 4 ViGEmBus UDP/USB receiver into a native Windows System Tray
application with a dark-themed telemetry dashboard:
  - Connection status & active transport badge ("USB (adb reverse)" vs "Wi-Fi UDP")
  - Scannable QR code (`ds4udp://<LAN_IP>:26760`)
  - Live DualShock 4 input visualizer (Left/Right sticks, L2/R2 triggers, 16-button bitmask)
  - Real-time rolling Round-Trip Latency (RTT) graph (USB vs Wi-Fi)
  - DualShock 4 Rumble motor feedback monitor (Large & Small motors)
  - "Start with Windows" toggle backed by `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`
  - Single-exe PyInstaller compatibility (`sys.frozen` aware)
"""

from __future__ import annotations

import collections
import hmac
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import tkinter as tk
import webbrowser
from tkinter import filedialog, messagebox, ttk

from ds4_udp_receiver import (
    FEEDBACK_SIZE,
    PACKET_SIZE,
    AdbUsbTunnelManager,
    ControllerPacket,
    RumbleState,
    ADB_HELP,
    PING_SEQ,
    USB_PRIORITY_WINDOW_S,
    PairingGate,
    RttMonitor,
    add_firewall_rule_elevated,
    find_adb,
    firewall_manual_command,
    firewall_rule_state,
    fmt_ms,
    neutralize_gamepad,
    run_self_test,
    probe_virtual_ds4_driver,
    release_probe_pad,
    apply_packet_to_ds4,
    build_pairing_uri,
    generate_pairing_token,
    get_local_lan_ip,
    import_vgamepad_or_explain,
    register_ds4_rumble_callback,
    run_usb_tcp_server,
)

APP_REGISTRY_NAME = "DS4Bridge120Hz"
SETUP_STATE_PATH = os.path.join(os.path.expanduser("~"), ".ds4_bridge_setup.json")
VIGEM_RELEASE_URL = "https://github.com/nefarius/ViGEmBus/releases/latest"
PLATFORM_TOOLS_URL = "https://developer.android.com/tools/releases/platform-tools"
WIZARD_STEPS = 6   # 1 ViGEm, 2 adb, 3 firewall, 4 pair phone, 5 virtual test, 6 finish
STEP_VIGEM, STEP_ADB, STEP_FIREWALL, STEP_PAIR, STEP_TEST, STEP_FINISH = range(1, 7)


def load_setup_state() -> dict:
    """Loads persisted first-run wizard state (`setup_completed`, `setup_current_step`)."""
    default = {
        "setup_completed": False,
        "setup_current_step": 1,
        "adb_dir": "",
        "trusted_phones": [],
        "trust_strict": False,
        "pairing_token": generate_pairing_token(),
    }
    try:
        if os.path.exists(SETUP_STATE_PATH):
            with open(SETUP_STATE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    default.update(data)
    except Exception:
        pass
    default["setup_current_step"] = max(1, min(WIZARD_STEPS, int(default.get("setup_current_step", 1))))
    if not default.get("pairing_token"):
        default["pairing_token"] = generate_pairing_token()
    return default


def save_setup_state(state: dict) -> None:
    """Persists wizard state so quitting mid-way resumes at the last step."""
    try:
        with open(SETUP_STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except Exception:
        pass


def check_adb_available(custom_dir: str = "") -> str | None:
    """Resolved adb path from the chosen folder or PATH (shared with the receiver self-test)."""
    return find_adb(custom_dir)


def open_windows_joy_cpl() -> None:
    """Opens the Windows Game Controllers control panel (`joy.cpl`)."""
    try:
        if sys.platform == "win32":
            os.startfile("joy.cpl")  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["control", "joy.cpl"])
    except Exception:
        pass


def is_start_with_windows_enabled() -> bool:
    """Checks HKCU Run registry key on Windows."""
    if sys.platform != "win32":
        return False
    try:
        import winreg
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_READ,
        ) as key:
            val, _ = winreg.QueryValueEx(key, APP_REGISTRY_NAME)
            return bool(val)
    except Exception:
        return False


def set_start_with_windows(enabled: bool) -> bool:
    """Adds or removes the executable/script in HKCU\\...\\Run."""
    if sys.platform != "win32":
        return False
    try:
        import winreg
        exe_cmd = (
            f'"{sys.executable}"'
            if getattr(sys, "frozen", False)
            else f'"{sys.executable}" "{os.path.abspath(__file__)}"'
        )
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_SET_VALUE,
        ) as key:
            if enabled:
                winreg.SetValueEx(key, APP_REGISTRY_NAME, 0, winreg.REG_SZ, exe_cmd)
            else:
                try:
                    winreg.DeleteValue(key, APP_REGISTRY_NAME)
                except FileNotFoundError:
                    pass
        return True
    except Exception as exc:
        print(f"[Registry Warning] Could not update Start-with-Windows: {exc}")
        return False


class Ds4TrayDashboard:
    def __init__(self, udp_port: int = 26760, usb_port: int = 26761) -> None:
        self.udp_port = udp_port
        self.usb_port = usb_port
        self.lan_ip = get_local_lan_ip()
        self.stop_event = threading.Event()

        self.rumble_state = RumbleState()
        self.driver_ok, self.driver_status_msg, self.vg, self.gamepad = probe_virtual_ds4_driver()
        if self.gamepad is not None:
            register_ds4_rumble_callback(self.gamepad, self.rumble_state)

        # Shared telemetry state updated by receiver threads
        self.setup_state = load_setup_state()
        save_setup_state(self.setup_state)
        self.adb_manager = AdbUsbTunnelManager(
            usb_port=self.usb_port,
            adb_path_getter=lambda: find_adb(self.setup_state.get("adb_dir", "")),
        )
        self.adb_manager.start()
        self.pairing_token: str = str(self.setup_state["pairing_token"])
        self.pairing_gate = PairingGate(
            self.pairing_token,
            trusted=list(self.setup_state.get("trusted_phones", [])),
            strict=bool(self.setup_state.get("trust_strict", False)),
        )
        self.rtt_monitor = RttMonitor(window_s=60.0)
        self.rejected_unauth_packets: int = 0

        self.active_transport = "STANDBY"
        self.connected = False
        self.latest_pkt = ControllerPacket(0, 0, 0, 0, 0, 0, 0, 0, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 9.81)
        self.stream_hz = 0.0
        self.last_packet_wall = 0.0

        # Start background USB & Wi-Fi receiver threads
        threading.Thread(
            target=run_usb_tcp_server,
            args=(
                self.usb_port,
                self._on_packet_received,
                self.rumble_state,
                self.stop_event,
                lambda: self.pairing_token,
                self.rtt_monitor,
                self.pairing_gate.admit_name,
                2.0,
                self._neutralize,
            ),
            daemon=True,
        ).start()
        threading.Thread(target=self._wifi_udp_loop, daemon=True).start()

        # Build Tkinter GUI
        self.root = tk.Tk()
        self.root.title("DS4 Bridge 120Hz — ViGEmBus Tray Controller")
        self.root.geometry("580x460")
        self.root.configure(bg="#070A14")
        self.root.resizable(False, False)
        self.root.protocol("WM_DELETE_WINDOW", self.hide_window_to_tray)

        self.autostart_var = tk.BooleanVar(value=is_start_with_windows_enabled())

        self.wizard_frame: tk.Frame | None = None
        self.dashboard_frame: tk.Frame | None = None

        self._build_ui()
        if not self.setup_state.get("setup_completed", False):
            self.show_setup_wizard(step=self.setup_state.get("setup_current_step", 1))

        self._start_tray_icon()
        self._schedule_ui_refresh()

    def _neutralize(self) -> None:
        """Safety: release every button (incl. PS/touchpad), centre sticks, triggers 0."""
        if self.gamepad is not None:
            neutralize_gamepad(self.gamepad)
        self.connected = False
        self.active_transport = "STANDBY"
        self.stream_hz = 0.0

    def _on_packet_received(self, pkt: ControllerPacket, transport: str) -> None:
        now = time.perf_counter()
        if self.last_packet_wall > 0:
            dt = max(0.0005, now - self.last_packet_wall)
            inst_hz = 1.0 / dt
            self.stream_hz = 0.85 * self.stream_hz + 0.15 * inst_hz
        self.last_packet_wall = now
        self.active_transport = transport
        self.connected = True
        self.latest_pkt = pkt
        if self.vg is not None and self.gamepad is not None:
            apply_packet_to_ds4(self.vg, self.gamepad, pkt)

    def _wifi_udp_loop(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(("0.0.0.0", self.udp_port))
        sock.settimeout(0.25)
        last_seq = -1
        while not self.stop_event.is_set():
            try:
                data, addr = sock.recvfrom(128)
            except socket.timeout:
                # 500 ms watchdog: neutralize inputs + release special buttons
                if self.connected and (time.perf_counter() - self.last_packet_wall) > 0.5:
                    self._neutralize()
                    last_seq = -1
                continue
            verdict = self.pairing_gate.on_datagram(data, addr)
            if verdict in ("auth_bad", "packet_rejected"):
                self.rejected_unauth_packets += 1
            if verdict != "packet_ok":
                continue
            pkt = ControllerPacket.unpack(data)
            if pkt.seq == PING_SEQ:          # pong -> real RTT sample, never controller input
                self.rtt_monitor.handle_pong(pkt, "WIFI")
                continue
            if self.rtt_monitor.ping_due():
                try:
                    sock.sendto(self.rtt_monitor.make_ping(), addr)
                except Exception:
                    pass
            if self.active_transport == "USB" and (time.perf_counter() - self.last_packet_wall) < USB_PRIORITY_WINDOW_S:
                continue
            if pkt.seq <= last_seq and (last_seq - pkt.seq) < 100000:
                continue
            last_seq = pkt.seq
            self._on_packet_received(pkt, "WIFI")
            try:
                sock.sendto(self.rumble_state.pack_feedback(pkt.seq, pkt.timestamp_us), addr)
            except Exception:
                pass
        sock.close()

    def _build_ui(self) -> None:
        self.dashboard_frame = tk.Frame(self.root, bg="#070A14")
        self.dashboard_frame.pack(fill=tk.BOTH, expand=True)

        header = tk.Frame(self.dashboard_frame, bg="#0D1226", padx=14, pady=10)
        header.pack(fill=tk.X)

        tk.Label(
            header,
            text="DS4 Bridge 120Hz • ViGEmBus Tray",
            fg="#F8FAFC",
            bg="#0D1226",
            font=("Segoe UI", 12, "bold"),
        ).pack(side=tk.LEFT)

        self.transport_badge = tk.Label(
            header,
            text="STANDBY",
            fg="#22D3EE",
            bg="#1B2142",
            padx=10,
            pady=3,
            font=("Consolas", 10, "bold"),
        )
        self.transport_badge.pack(side=tk.RIGHT)

        body = tk.Frame(self.dashboard_frame, bg="#070A14", padx=14, pady=10)
        body.pack(fill=tk.BOTH, expand=True)

        # Left Column: Pairing Info & Live Input Canvas
        left = tk.Frame(body, bg="#070A14")
        left.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self.pairing_info_lbl = tk.Label(
            left,
            text=self._format_pairing_label(),
            justify=tk.LEFT,
            fg="#94A3B8",
            bg="#070A14",
            font=("Consolas", 9),
        )
        self.pairing_info_lbl.pack(anchor="w", pady=(0, 8))

        self.input_canvas = tk.Canvas(
            left, width=280, height=150, bg="#0D1226", highlightthickness=1, highlightbackground="#1B2142"
        )
        self.input_canvas.pack(anchor="w", pady=4)

        # Latency Graph Canvas
        tk.Label(
            left,
            text="Measured round-trip latency (ping/pong on the active transport), last 60 s",
            fg="#94A3B8",
            bg="#070A14",
            font=("Segoe UI", 9),
        ).pack(anchor="w", pady=(8, 2))

        self.graph_canvas = tk.Canvas(
            left, width=520, height=90, bg="#0D1226", highlightthickness=1, highlightbackground="#1B2142"
        )
        self.graph_canvas.pack(fill=tk.X, pady=2)
        self.rtt_stats_lbl = tk.Label(
            left, text="RTT —  (no real measurement yet)", fg="#94A3B8", bg="#070A14", font=("Consolas", 9)
        )
        self.rtt_stats_lbl.pack(anchor="w")

        # Footer Controls: Start with Windows toggle & Minimize to Tray
        footer = tk.Frame(self.dashboard_frame, bg="#0D1226", padx=14, pady=8)
        footer.pack(fill=tk.X, side=tk.BOTTOM)

        chk = tk.Checkbutton(
            footer,
            text="Start with Windows",
            variable=self.autostart_var,
            command=lambda: set_start_with_windows(self.autostart_var.get()),
            fg="#E2E8F0",
            bg="#0D1226",
            selectcolor="#1B2142",
            activebackground="#0D1226",
            activeforeground="#FFFFFF",
        )
        chk.pack(side=tk.LEFT)

        tk.Button(
            footer,
            text="Minimize to Tray",
            command=self.hide_window_to_tray,
            bg="#0E7490",
            fg="#FFFFFF",
            relief=tk.FLAT,
            padx=10,
        ).pack(side=tk.RIGHT)

        tk.Button(
            footer,
            text="Run setup again",
            command=lambda: self.show_setup_wizard(step=1),
            bg="#1B2142",
            fg="#E2E8F0",
            relief=tk.FLAT,
            padx=10,
        ).pack(side=tk.RIGHT, padx=(0, 8))

        tk.Button(
            footer,
            text="Reset everything",
            command=self.reset_everything,
            bg="#881337",
            fg="#FECDD3",
            relief=tk.FLAT,
            padx=8,
        ).pack(side=tk.RIGHT, padx=(0, 8))

        tk.Button(
            footer,
            text="Revoke all",
            command=self.revoke_all_phones,
            bg="#881337",
            fg="#FECDD3",
            relief=tk.FLAT,
            padx=8,
        ).pack(side=tk.RIGHT, padx=(0, 8))

        tk.Button(
            footer,
            text="Trusted phones...",
            command=self.open_trust_dialog,
            bg="#1B2142",
            fg="#E2E8F0",
            relief=tk.FLAT,
            padx=8,
        ).pack(side=tk.RIGHT, padx=(0, 8))

        tk.Button(
            footer,
            text="Reset pairing",
            command=self.reset_pairing_token,
            bg="#334155",
            fg="#22D3EE",
            relief=tk.FLAT,
            padx=8,
        ).pack(side=tk.RIGHT, padx=(0, 8))

    def _format_pairing_label(self) -> str:
        uri = build_pairing_uri(self.lan_ip, self.udp_port, self.pairing_token)
        return (
            f"Pairing QR URI  : {uri}\n"
            f"Pairing Token   : {self.pairing_token} | USB Tunnel: 127.0.0.1:{self.usb_port}"
        )

    def reset_pairing_token(self) -> None:
        """Generates a new random pairing token and revokes existing UDP/TCP sessions."""
        self.pairing_token = generate_pairing_token()
        self.pairing_gate.reset(self.pairing_token)
        self.connected = False
        self.active_transport = "STANDBY"
        self.setup_state["pairing_token"] = self.pairing_token
        save_setup_state(self.setup_state)
        if hasattr(self, "pairing_info_lbl"):
            self.pairing_info_lbl.configure(text=self._format_pairing_label())
        if self.wizard_frame is not None and self.setup_state.get("setup_current_step") == STEP_PAIR:
            self.show_setup_wizard(step=STEP_PAIR)

    # =========================================================================
    # FIRST-RUN 5-STEP PC TRAY SETUP WIZARD
    # =========================================================================
    def reset_everything(self) -> None:
        """Explicit full reset (asks first). Re-running the wizard alone keeps all settings."""
        if not messagebox.askyesno(
            "Reset everything",
            "This clears the pairing token, trusted phones, the adb folder and wizard progress, "
            "and disconnects the phone. Continue?",
        ):
            return
        fresh = {
            "setup_completed": False, "setup_current_step": 1, "adb_dir": "",
            "trusted_phones": [], "trust_strict": False, "pairing_token": generate_pairing_token(),
        }
        self.setup_state.clear()
        self.setup_state.update(fresh)
        self.pairing_token = fresh["pairing_token"]
        self.pairing_gate.revoke_all(self.pairing_token)
        self.pairing_gate.strict = False
        self.rtt_monitor.clear()
        self._neutralize()
        save_setup_state(self.setup_state)
        if hasattr(self, "pairing_info_lbl"):
            self.pairing_info_lbl.configure(text=self._format_pairing_label())
        self.show_setup_wizard(step=1)

    def revoke_all_phones(self) -> None:
        """Revoke all: new token, current phone dropped, trust list emptied."""
        self.pairing_token = generate_pairing_token()
        self.pairing_gate.revoke_all(self.pairing_token)
        self.setup_state["pairing_token"] = self.pairing_token
        self.setup_state["trusted_phones"] = []
        save_setup_state(self.setup_state)
        self.rtt_monitor.clear()
        self._neutralize()
        if hasattr(self, "pairing_info_lbl"):
            self.pairing_info_lbl.configure(text=self._format_pairing_label())

    def _persist_trust(self) -> None:
        self.setup_state["trusted_phones"] = list(self.pairing_gate.trusted)
        self.setup_state["trust_strict"] = bool(self.pairing_gate.strict)
        save_setup_state(self.setup_state)

    def open_trust_dialog(self) -> None:
        """Optional trust list: name phones, require approval for new ones, remove or revoke all."""
        win = tk.Toplevel(self.root)
        win.title("Trusted phones")
        win.configure(bg="#0D1226", padx=14, pady=12)
        strict_var = tk.BooleanVar(value=self.pairing_gate.strict)

        def toggle_strict() -> None:
            self.pairing_gate.strict = strict_var.get()
            self._persist_trust()

        tk.Checkbutton(
            win, text="Only allow phones on this list (new phones wait for approval)", variable=strict_var,
            command=toggle_strict, fg="#E2E8F0", bg="#0D1226", selectcolor="#1B2142", activebackground="#0D1226",
        ).pack(anchor="w")
        body = tk.Frame(win, bg="#0D1226")
        body.pack(fill=tk.BOTH, expand=True, pady=8)

        def render() -> None:
            for w in body.winfo_children():
                w.destroy()
            tk.Label(body, text="Trusted", fg="#22D3EE", bg="#0D1226", font=("Segoe UI", 10, "bold")).pack(anchor="w")
            for name in list(self.pairing_gate.trusted) or []:
                row = tk.Frame(body, bg="#0D1226"); row.pack(fill=tk.X)
                tk.Label(row, text=name, fg="#E2E8F0", bg="#0D1226").pack(side=tk.LEFT)
                tk.Button(row, text="Remove", relief=tk.FLAT, bg="#1B2142", fg="#E2E8F0",
                          command=lambda n=name: (self.pairing_gate.untrust(n), self._persist_trust(), render())).pack(side=tk.RIGHT)
            if not self.pairing_gate.trusted:
                tk.Label(body, text="(none)", fg="#94A3B8", bg="#0D1226").pack(anchor="w")
            tk.Label(body, text="Waiting for approval", fg="#FBBF24", bg="#0D1226", font=("Segoe UI", 10, "bold")).pack(anchor="w", pady=(8, 0))
            pend = dict(self.pairing_gate.pending)
            for name, addr in pend.items():
                row = tk.Frame(body, bg="#0D1226"); row.pack(fill=tk.X)
                tk.Label(row, text=f"{name} ({addr[0]})", fg="#E2E8F0", bg="#0D1226").pack(side=tk.LEFT)
                tk.Button(row, text="Trust", relief=tk.FLAT, bg="#0E7490", fg="#FFFFFF",
                          command=lambda n=name: (self.pairing_gate.trust(n), self._persist_trust(), render())).pack(side=tk.RIGHT)
            if not pend:
                tk.Label(body, text="(none)", fg="#94A3B8", bg="#0D1226").pack(anchor="w")
            cur = self.pairing_gate.peer_name or ("(unnamed phone)" if self.pairing_gate.peer else "")
            if cur and cur not in self.pairing_gate.trusted:
                tk.Button(body, text=f"Trust current phone: {cur}", relief=tk.FLAT, bg="#1B2142", fg="#22D3EE",
                          command=lambda: (self.pairing_gate.trust(cur), self._persist_trust(), render())).pack(anchor="w", pady=6)

        render()
        bar = tk.Frame(win, bg="#0D1226"); bar.pack(fill=tk.X)
        tk.Button(bar, text="Refresh", relief=tk.FLAT, bg="#1B2142", fg="#E2E8F0", command=render).pack(side=tk.LEFT)
        tk.Button(bar, text="Revoke all", relief=tk.FLAT, bg="#881337", fg="#FECDD3",
                  command=lambda: (self.revoke_all_phones(), render())).pack(side=tk.RIGHT)

    def show_setup_wizard(self, step: int = 1) -> None:
        step = max(1, min(WIZARD_STEPS, step))
        self.setup_state["setup_current_step"] = step
        save_setup_state(self.setup_state)

        if self.dashboard_frame is not None:
            self.dashboard_frame.pack_forget()
        if self.wizard_frame is not None:
            self.wizard_frame.destroy()

        self.wizard_frame = tk.Frame(self.root, bg="#070A14", padx=20, pady=16)
        self.wizard_frame.pack(fill=tk.BOTH, expand=True)

        # Top Progress Bar ("Step X of 5")
        top = tk.Frame(self.wizard_frame, bg="#070A14")
        top.pack(fill=tk.X, pady=(0, 12))
        tk.Label(
            top,
            text=f"Step {step} of {WIZARD_STEPS}",
            fg="#22D3EE",
            bg="#070A14",
            font=("Consolas", 11, "bold"),
        ).pack(side=tk.LEFT)

        # Step Card Container
        card = tk.Frame(
            self.wizard_frame,
            bg="#0D1226",
            padx=20,
            pady=20,
            highlightthickness=1,
            highlightbackground="#1B2142",
        )
        card.pack(fill=tk.BOTH, expand=True)

        if step == STEP_VIGEM:
            self._build_wizard_step_vigem(card)
        elif step == STEP_ADB:
            self._build_wizard_step_adb(card)
        elif step == STEP_FIREWALL:
            self._build_wizard_step_firewall(card)
        elif step == STEP_PAIR:
            self._build_wizard_step_qr(card)
        elif step == STEP_TEST:
            self._build_wizard_step_test(card)
        elif step == STEP_FINISH:
            self._build_wizard_step_finish(card)

        # Bottom Navigation Bar: Back, Skip, Next
        nav = tk.Frame(self.wizard_frame, bg="#070A14", pady=12)
        nav.pack(fill=tk.X, side=tk.BOTTOM)

        tk.Button(
            nav,
            text="Back",
            state=tk.NORMAL if step > 1 else tk.DISABLED,
            command=lambda: self.show_setup_wizard(step - 1),
            bg="#1B2142",
            fg="#E2E8F0",
            relief=tk.FLAT,
            padx=14,
            pady=6,
        ).pack(side=tk.LEFT)

        tk.Button(
            nav,
            text="Skip",
            command=lambda: self.show_setup_wizard(step + 1) if step < WIZARD_STEPS else self.finish_setup_wizard(),
            bg="#070A14",
            fg="#94A3B8",
            relief=tk.FLAT,
            padx=14,
            pady=6,
        ).pack(side=tk.LEFT, padx=12)

        tk.Button(
            nav,
            text="Next" if step < WIZARD_STEPS else "Finish",
            command=lambda: self.show_setup_wizard(step + 1) if step < WIZARD_STEPS else self.finish_setup_wizard(),
            bg="#0E7490",
            fg="#FFFFFF",
            relief=tk.FLAT,
            padx=18,
            pady=6,
        ).pack(side=tk.RIGHT)

    def _build_wizard_step_vigem(self, parent: tk.Frame) -> None:
        tk.Label(
            parent,
            text="Check ViGEmBus Driver",
            fg="#FFFFFF",
            bg="#0D1226",
            font=("Segoe UI", 14, "bold"),
        ).pack(anchor="w", pady=(0, 8))

        status_lbl = tk.Label(
            parent,
            text="",
            fg="#CBD5E1",
            bg="#0D1226",
            font=("Segoe UI", 10),
            justify=tk.LEFT,
        )
        status_lbl.pack(anchor="w", pady=(0, 12))

        def refresh_vigem_status() -> None:
            if self.wizard_frame is None or self.setup_state.get("setup_current_step") != STEP_VIGEM:
                return
            ok, msg, vg_mod, pad = probe_virtual_ds4_driver(self.gamepad)
            self.driver_ok = ok
            self.driver_status_msg = msg
            if ok and self.gamepad is None and pad is not None:
                self.vg = vg_mod
                self.gamepad = pad
                register_ds4_rumble_callback(self.gamepad, self.rumble_state)
            if ok:
                status_lbl.configure(
                    text=msg,
                    fg="#34D399",
                )
            else:
                status_lbl.configure(
                    text=msg,
                    fg="#FDA4AF",
                )
                self.root.after(2000, refresh_vigem_status)

        refresh_vigem_status()

        btn_row = tk.Frame(parent, bg="#0D1226")
        btn_row.pack(anchor="w", pady=6)
        tk.Button(
            btn_row,
            text="Open ViGEmBus Installer Link",
            command=lambda: webbrowser.open(VIGEM_RELEASE_URL),
            bg="#0E7490",
            fg="#FFFFFF",
            relief=tk.FLAT,
            padx=12,
            pady=6,
        ).pack(side=tk.LEFT, padx=(0, 8))
        tk.Button(
            btn_row,
            text="Try again",
            command=refresh_vigem_status,
            bg="#1B2142",
            fg="#E2E8F0",
            relief=tk.FLAT,
            padx=12,
            pady=6,
        ).pack(side=tk.LEFT)

    def _build_wizard_step_adb(self, parent: tk.Frame) -> None:
        tk.Label(
            parent,
            text="Check ADB for USB Cable Mode",
            fg="#FFFFFF",
            bg="#0D1226",
            font=("Segoe UI", 14, "bold"),
        ).pack(anchor="w", pady=(0, 8))

        status_lbl = tk.Label(
            parent,
            text="",
            fg="#CBD5E1",
            bg="#0D1226",
            font=("Segoe UI", 10),
            justify=tk.LEFT,
        )
        status_lbl.pack(anchor="w", pady=(0, 12))

        def refresh_adb() -> None:
            adb_path = check_adb_available(self.setup_state.get("adb_dir", ""))
            if adb_path:
                status_lbl.configure(text=f"adb found: {adb_path}", fg="#34D399")
            else:
                status_lbl.configure(
                    text=ADB_HELP,
                    fg="#FDA4AF",
                )

        def pick_adb_folder() -> None:
            folder = filedialog.askdirectory(title="Select Android platform-tools folder")
            if folder:
                self.setup_state["adb_dir"] = folder
                save_setup_state(self.setup_state)
                refresh_adb()

        refresh_adb()

        btn_row = tk.Frame(parent, bg="#0D1226")
        btn_row.pack(anchor="w", pady=6)
        tk.Button(
            btn_row,
            text="Download platform-tools",
            command=lambda: webbrowser.open(PLATFORM_TOOLS_URL),
            bg="#0E7490",
            fg="#FFFFFF",
            relief=tk.FLAT,
            padx=12,
            pady=6,
        ).pack(side=tk.LEFT, padx=(0, 8))
        tk.Button(
            btn_row,
            text="Select platform-tools Folder",
            command=pick_adb_folder,
            bg="#1B2142",
            fg="#E2E8F0",
            relief=tk.FLAT,
            padx=12,
            pady=6,
        ).pack(side=tk.LEFT, padx=(0, 8))
        tk.Button(
            btn_row,
            text="Try again",
            command=refresh_adb,
            bg="#1B2142",
            fg="#E2E8F0",
            relief=tk.FLAT,
            padx=12,
            pady=6,
        ).pack(side=tk.LEFT)

    def _build_wizard_step_firewall(self, parent: tk.Frame) -> None:
        tk.Label(parent, text="Windows Firewall (UDP %d)" % self.udp_port, fg="#FFFFFF", bg="#0D1226",
                 font=("Segoe UI", 14, "bold")).pack(anchor="w", pady=(0, 8))
        tk.Label(
            parent,
            text=("Windows blocks unknown incoming UDP by default, so your phone can pair but never stream.\n"
                  "An inbound rule for this app's UDP port fixes that. USB mode does not need it."),
            fg="#CBD5E1", bg="#0D1226", font=("Segoe UI", 10), justify=tk.LEFT,
        ).pack(anchor="w", pady=(0, 8))
        status_lbl = tk.Label(parent, text="", fg="#CBD5E1", bg="#0D1226", font=("Segoe UI", 10), justify=tk.LEFT, wraplength=480)
        status_lbl.pack(anchor="w", pady=(0, 8))

        def refresh() -> None:
            state, detail = firewall_rule_state(self.udp_port)
            seen = self.pairing_gate.peer is not None
            extra = "\nA phone has already reached this PC over Wi-Fi, so inbound UDP works." if seen else ""
            color = {"present": "#34D399", "n/a": "#94A3B8"}.get(state, "#FBBF24")
            status_lbl.configure(text=detail + extra, fg="#34D399" if seen else color)

        def add_rule() -> None:
            ok, msg = add_firewall_rule_elevated(self.udp_port)
            status_lbl.configure(text=msg, fg="#34D399" if ok else "#FDA4AF")

        refresh()
        row = tk.Frame(parent, bg="#0D1226"); row.pack(anchor="w", pady=6)
        tk.Button(row, text="Add firewall rule (admin prompt)", command=add_rule, bg="#0E7490", fg="#FFFFFF",
                  relief=tk.FLAT, padx=12, pady=6).pack(side=tk.LEFT, padx=(0, 8))
        tk.Button(row, text="Try again", command=refresh, bg="#1B2142", fg="#E2E8F0", relief=tk.FLAT, padx=12, pady=6).pack(side=tk.LEFT)
        cmd = firewall_manual_command(self.udp_port)
        tk.Label(parent, text="Manual fallback (run in an Administrator Command Prompt):", fg="#94A3B8", bg="#0D1226",
                 font=("Segoe UI", 9)).pack(anchor="w", pady=(10, 0))
        ent = tk.Entry(parent, width=70, font=("Consolas", 9)); ent.insert(0, cmd); ent.configure(state="readonly"); ent.pack(anchor="w")

    def _build_wizard_step_qr(self, parent: tk.Frame) -> None:
        tk.Label(
            parent,
            text="Pair Your Phone",
            fg="#FFFFFF",
            bg="#0D1226",
            font=("Segoe UI", 14, "bold"),
        ).pack(anchor="w", pady=(0, 6))

        uri = build_pairing_uri(self.lan_ip, self.udp_port, self.pairing_token)
        tk.Label(
            parent,
            text=f"Scan QR or enter URI in the phone app:\n{uri}",
            fg="#22D3EE",
            bg="#0D1226",
            font=("Consolas", 11, "bold"),
            justify=tk.LEFT,
        ).pack(anchor="w", pady=(0, 10))

        paired = self.pairing_gate.peer is not None
        name = self.pairing_gate.peer_name or "phone"
        conn_lbl = tk.Label(
            parent,
            text=("Waiting for a phone to pair..." if not paired and not self.connected
                  else f"Phone paired: {name} ({self.pairing_gate.peer[0] if paired else 'USB'}) via {self.active_transport}"),
            fg="#34D399" if self.connected else "#FBBF24",
            bg="#0D1226",
            font=("Consolas", 10, "bold"),
        )
        conn_lbl.pack(anchor="w", pady=6)

        prow = tk.Frame(parent, bg="#0D1226"); prow.pack(anchor="w", pady=4)
        tk.Button(prow, text="Try again", command=lambda: self.show_setup_wizard(step=STEP_PAIR), bg="#1B2142", fg="#E2E8F0",
                  relief=tk.FLAT, padx=12, pady=6).pack(side=tk.LEFT, padx=(0, 8))
        tk.Button(prow, text="Reset pairing", command=self.reset_pairing_token, bg="#1B2142", fg="#22D3EE",
                  relief=tk.FLAT, padx=12, pady=6).pack(side=tk.LEFT)

    def _build_wizard_step_test(self, parent: tk.Frame) -> None:
        tk.Label(
            parent,
            text="Virtual Controller Test",
            fg="#FFFFFF",
            bg="#0D1226",
            font=("Segoe UI", 14, "bold"),
        ).pack(anchor="w", pady=(0, 8))

        test_lbl = tk.Label(
            parent,
            text="Run a 2-second virtual DualShock 4 test cycle and verify it in Windows Game Controllers.",
            fg="#CBD5E1",
            bg="#0D1226",
            font=("Segoe UI", 10),
        )
        test_lbl.pack(anchor="w", pady=(0, 12))

        def run_quick_test() -> None:
            if self.vg is None or self.gamepad is None:
                test_lbl.configure(
                    text="Cannot run test: Virtual DualShock 4 is not initialized (install ViGEmBus first).",
                    fg="#FDA4AF",
                )
                return
            test_lbl.configure(text="Running --test cycle on virtual DualShock 4...", fg="#22D3EE")

            def _worker() -> None:
                try:
                    B = self.vg.DS4_BUTTONS
                    for btn in (B.DS4_BUTTON_CROSS, B.DS4_BUTTON_CIRCLE, B.DS4_BUTTON_SQUARE, B.DS4_BUTTON_TRIANGLE):
                        self.gamepad.reset()
                        self.gamepad.press_button(button=btn)
                        self.gamepad.update()
                        time.sleep(0.25)
                    S = self.vg.DS4_SPECIAL_BUTTONS
                    for sp in (S.DS4_SPECIAL_BUTTON_PS, S.DS4_SPECIAL_BUTTON_TOUCHPAD):
                        self.gamepad.reset()
                        self.gamepad.press_special_button(special_button=sp)
                        self.gamepad.update()
                        time.sleep(0.25)
                    neutralize_gamepad(self.gamepad)
                    self.root.after(
                        0,
                        lambda: test_lbl.configure(
                            text="Test cycle complete. Virtual DualShock 4 responded.",
                            fg="#34D399",
                        ),
                    )
                except Exception as exc:
                    self.root.after(
                        0,
                        lambda: test_lbl.configure(
                            text=f"Test failed: {type(exc).__name__}: {exc}",
                            fg="#FDA4AF",
                        ),
                    )

            threading.Thread(target=_worker, daemon=True).start()

        btn_row = tk.Frame(parent, bg="#0D1226")
        btn_row.pack(anchor="w", pady=6)
        tk.Button(
            btn_row,
            text="Run Virtual Controller Test (--test)",
            command=run_quick_test,
            bg="#0E7490",
            fg="#FFFFFF",
            relief=tk.FLAT,
            padx=12,
            pady=6,
        ).pack(side=tk.LEFT, padx=(0, 8))
        tk.Button(
            btn_row,
            text="Does it show up in Windows? (Open joy.cpl)",
            command=open_windows_joy_cpl,
            bg="#1B2142",
            fg="#E2E8F0",
            relief=tk.FLAT,
            padx=12,
            pady=6,
        ).pack(side=tk.LEFT)

    def _build_wizard_step_finish(self, parent: tk.Frame) -> None:
        tk.Label(
            parent,
            text="Start with Windows & Finish",
            fg="#FFFFFF",
            bg="#0D1226",
            font=("Segoe UI", 14, "bold"),
        ).pack(anchor="w", pady=(0, 10))

        chk = tk.Checkbutton(
            parent,
            text="Start DS4 Bridge automatically with Windows",
            variable=self.autostart_var,
            command=lambda: set_start_with_windows(self.autostart_var.get()),
            fg="#E2E8F0",
            bg="#0D1226",
            selectcolor="#1B2142",
            activebackground="#0D1226",
            activeforeground="#FFFFFF",
            font=("Segoe UI", 10),
        )
        chk.pack(anchor="w", pady=8)

        tk.Button(
            parent,
            text="Finish Setup",
            command=self.finish_setup_wizard,
            bg="#10B981",
            fg="#062E22",
            font=("Segoe UI", 10, "bold"),
            relief=tk.FLAT,
            padx=16,
            pady=8,
        ).pack(anchor="w", pady=10)

    def finish_setup_wizard(self) -> None:
        self.setup_state["setup_completed"] = True
        self.setup_state["setup_current_step"] = 1
        save_setup_state(self.setup_state)
        if self.wizard_frame is not None:
            self.wizard_frame.destroy()
            self.wizard_frame = None
        if self.dashboard_frame is not None:
            self.dashboard_frame.pack(fill=tk.BOTH, expand=True)

    def _schedule_ui_refresh(self) -> None:
        if self.stop_event.is_set():
            return
        # Update Transport Badge (RTT only from real ping/pong samples; "—" otherwise)
        st = self.rtt_monitor.stats()
        rtt_txt = fmt_ms(st["latest"] if st else None)
        if self.active_transport == "USB":
            self.transport_badge.configure(text=f"USB (adb reverse) • {self.stream_hz:.0f}Hz • RTT {rtt_txt}", fg="#34D399")
        elif self.active_transport == "WIFI":
            self.transport_badge.configure(text=f"Wi-Fi UDP • {self.stream_hz:.0f}Hz • RTT {rtt_txt}", fg="#22D3EE")
        else:
            self.transport_badge.configure(text="STANDBY (Waiting for USB or Wi-Fi)", fg="#94A3B8")
        if st:
            self.rtt_stats_lbl.configure(
                text=f"RTT min {st['min']:.2f} | avg {st['avg']:.2f} | p99 {st['p99']:.2f} ms  (n={st['n']}, last 60 s, {st['transport']})",
                fg="#CBD5E1",
            )
        elif getattr(self.adb_manager, "adb_missing", False):
            self.rtt_stats_lbl.configure(text="RTT —  (no real measurement yet; adb not found, USB unavailable)", fg="#94A3B8")
        else:
            self.rtt_stats_lbl.configure(text="RTT —  (no real measurement yet)", fg="#94A3B8")

        # Redraw Stick & Trigger Visualizer
        c = self.input_canvas
        c.delete("all")
        pkt = self.latest_pkt
        # Left Stick Circle
        c.create_oval(20, 25, 110, 115, outline="#334155", width=2)
        lx_px = 65 + (pkt.lx / 32767.0) * 35
        ly_px = 70 + (pkt.ly / 32767.0) * 35
        c.create_oval(lx_px - 8, ly_px - 8, lx_px + 8, ly_px + 8, fill="#22D3EE", outline="")
        # Right Stick Circle
        c.create_oval(140, 25, 230, 115, outline="#334155", width=2)
        rx_px = 185 + (pkt.rx / 32767.0) * 35
        ry_px = 70 + (pkt.ry / 32767.0) * 35
        c.create_oval(rx_px - 8, ry_px - 8, rx_px + 8, ry_px + 8, fill="#22D3EE", outline="")
        c.create_text(
            135,
            135,
            text=f"Buttons: 0x{pkt.buttons:04X} | L2:{pkt.l2:3d} R2:{pkt.r2:3d} | Rumble L:{self.rumble_state.large_motor}",
            fill="#CBD5E1",
            font=("Consolas", 8),
        )

        # Redraw rolling RTT graph: real samples only, x = age within the last 60 s
        g = self.graph_canvas
        g.delete("all")
        w, h = 520, 90
        samples = self.rtt_monitor.samples()
        if not samples:
            g.create_text(w / 2, h / 2, text="—  waiting for a real RTT measurement", fill="#6B73A3", font=("Consolas", 9))
        else:
            now = time.monotonic()
            vmax = max(2.0, max(v for _, v, _ in samples) * 1.15)
            for frac in (0.5, 1.0):
                gy = h - 4 - (frac * (h - 12))
                g.create_line(0, gy, w, gy, fill="#1B2142")
                g.create_text(w - 4, gy - 2, text=f"{vmax * frac:.1f}", fill="#6B73A3", font=("Consolas", 7), anchor="e")
            coords = []
            for t, v, _tr in samples:
                coords.extend([w - ((now - t) / 60.0) * w, h - 4 - (v / vmax) * (h - 12)])
            if len(coords) >= 4:
                g.create_line(*coords, fill="#34D399" if self.active_transport == "USB" else "#22D3EE", width=2)
            else:
                g.create_oval(coords[0] - 2, coords[1] - 2, coords[0] + 2, coords[1] + 2, fill="#22D3EE", outline="")

        self.root.after(50, self._schedule_ui_refresh)

    def _start_tray_icon(self) -> None:
        try:
            import pystray
            from PIL import Image, ImageDraw

            img = Image.new("RGB", (64, 64), color=(9, 13, 22))
            d = ImageDraw.Draw(img)
            d.ellipse((8, 8, 56, 56), fill=(14, 165, 233))

            menu = pystray.Menu(
                pystray.MenuItem("Open DS4 Bridge Dashboard", lambda: self.root.after(0, self.root.deiconify)),
                pystray.MenuItem("Quit DS4 Bridge", lambda: self.root.after(0, self.shutdown)),
            )
            self.tray_icon = pystray.Icon("DS4Bridge120Hz", img, "DS4 Bridge 120Hz", menu)
            threading.Thread(target=self.tray_icon.run, daemon=True).start()
        except Exception:
            self.tray_icon = None

    def hide_window_to_tray(self) -> None:
        if getattr(self, "tray_icon", None) is not None:
            self.root.withdraw()
        else:
            self.shutdown()

    def shutdown(self) -> None:
        self.stop_event.set()
        self.adb_manager.stop()
        if getattr(self, "tray_icon", None) is not None:
            self.tray_icon.stop()
        if self.gamepad is not None:
            self.gamepad.reset()
            self.gamepad.update()
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


def _cli() -> None:
    import argparse
    ap = argparse.ArgumentParser(description="DS4 Bridge 120Hz tray app")
    ap.add_argument("--headless", action="store_true", help="No GUI: run the console receiver instead")
    ap.add_argument("--self-test", action="store_true", help="Print a health report and exit")
    ap.add_argument("--port", type=int, default=26760)
    ap.add_argument("--usb-port", type=int, default=26761)
    args, rest = ap.parse_known_args()
    if args.self_test:
        sys.exit(run_self_test(args.port, args.usb_port, load_setup_state().get("adb_dir", "")))
    if args.headless:
        from ds4_udp_receiver import main as receiver_main
        sys.argv = [sys.argv[0], "--headless", "--port", str(args.port), "--usb-port", str(args.usb_port)] + rest
        receiver_main()
        return
    Ds4TrayDashboard(udp_port=args.port, usb_port=args.usb_port).run()


if __name__ == "__main__":
    _cli()
