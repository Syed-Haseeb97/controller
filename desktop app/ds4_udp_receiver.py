#!/usr/bin/env python3
"""
DualShock 4 Virtual Controller & 120Hz UDP Receiver (Windows / ViGEmBus)
========================================================================

INSTALLATION & PREREQUISITES (Windows 10/11 x64):
-------------------------------------------------
1. Install the ViGEmBus Kernel Driver:
   - Download the latest `ViGEmBus_Setup_x64.exe` installer from:
     https://github.com/nefarius/ViGEmBus/releases/latest
   - Run the installer as Administrator and reboot if prompted.
   - Verify in Device Manager -> "System devices" -> "Nefarius Virtual Gamepad Emulation Bus".

2. Install Python dependencies:
   pip install vgamepad qrcode[pil]

3. Verify your virtual DualShock 4:
   - Press Win + R, type `joy.cpl`, and press Enter ("Set up USB game controllers").
   - Or open https://hardwaretester.com/gamepad (gamepad-tester.com) in Chrome/Edge.

USAGE:
------
  # Hardware self-test mode (cycles all buttons, both sticks, triggers, and D-pad):
  python ds4_udp_receiver.py --test

  # Live 120Hz UDP receiver mode (prints ASCII + GUI QR code with IP & port):
  python ds4_udp_receiver.py --port 26760

  # Automatic USB (`adb reverse`) + Wi-Fi dual-transport mode with bi-directional rumble:
  python ds4_udp_receiver.py --port 26760 --usb-port 26761
"""

from __future__ import annotations

import argparse
import collections
import gc
import hmac
import math
import os
import secrets
import shutil
import socket
import subprocess
import struct
import sys
import threading
import time
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Binary Packet Specification (48 Bytes, Little-Endian `<IQIhhhhBBffffff`)
# ---------------------------------------------------------------------------
# Offset  Type     Field        Description
# 0       uint32   seq          Monotonically increasing sequence number
# 4       uint64   timestamp_us Sender monotonic timestamp in microseconds
# 12      uint32   buttons      16-bit button bitmask (padded to uint32 for alignment)
# 16      int16    lx           Left stick X  (-32768 to 32767)
# 18      int16    ly           Left stick Y  (-32768 to 32767, +up or standard axis)
# 20      int16    rx           Right stick X (-32768 to 32767)
# 22      int16    ry           Right stick Y (-32768 to 32767)
# 24      uint8    l2           Left trigger analog  (0 to 255)
# 25      uint8    r2           Right trigger analog (0 to 255)
# 26..27  --       --           (Note: struct format `<IQIhhhhBBffffff` is tightly packed = 50 bytes,
#                                or `<IQHhhhhBBffffff` = 48 bytes! Let's use `<IQHhhhhBBffffff` = 48 bytes exact)
#
# Exact 48-byte layout (`<IQHhhhhBBffffff`):
#   I (4B) : seq            (uint32)          [0..4]
#   Q (8B) : timestamp_us   (uint64)          [4..12]
#   H (2B) : buttons        (uint16 bitmask)  [12..14]
#   h (2B) : lx             (int16)           [14..16]
#   h (2B) : ly             (int16)           [16..18]
#   h (2B) : rx             (int16)           [18..20]
#   h (2B) : ry             (int16)           [20..22]
#   B (1B) : l2             (uint8)           [22..23]
#   B (1B) : r2             (uint8)           [23..24]
#   f (4B) : gyro_x         (float32, rad/s)  [24..28]
#   f (4B) : gyro_y         (float32, rad/s)  [28..32]
#   f (4B) : gyro_z         (float32, rad/s)  [32..36]
#   f (4B) : accel_x        (float32, m/s^2)  [36..40]
#   f (4B) : accel_y        (float32, m/s^2)  [40..44]
#   f (4B) : accel_z        (float32, m/s^2)  [44..48]
# Total = 4 + 8 + 2 + 8 + 2 + 12 + 12 = 48 bytes.

PACKET_FORMAT = "<IQHhhhhBBffffff"
PACKET_SIZE = struct.calcsize(PACKET_FORMAT)
assert PACKET_SIZE == 48, f"Expected 48-byte packet, got {PACKET_SIZE}"

# ---------------------------------------------------------------------------
# Downstream Feedback & RTT Echo Packet (16 Bytes, Little-Endian `<IQBBBB`)
# Sent from PC -> Phone to deliver:
#   1. Round-Trip Time (RTT) echo of the phone's `seq` and `timestamp_us`
#   2. DualShock 4 Rumble (`large_motor` 0..255, `small_motor` 0..255)
#   3. DS4 Lightbar accent (`led_r`, `led_b`)
# ---------------------------------------------------------------------------
FEEDBACK_FORMAT = "<IQBBBB"
FEEDBACK_SIZE = struct.calcsize(FEEDBACK_FORMAT)
assert FEEDBACK_SIZE == 16, f"Expected 16-byte feedback packet, got {FEEDBACK_SIZE}"

# 16-bit Button Bitmask Constants
BTN_CROSS      = 1 << 0   # 0x0001
BTN_CIRCLE     = 1 << 1   # 0x0002
BTN_SQUARE     = 1 << 2   # 0x0004
BTN_TRIANGLE   = 1 << 3   # 0x0008
BTN_L1         = 1 << 4   # 0x0010
BTN_R1         = 1 << 5   # 0x0020
BTN_PS         = 1 << 6   # 0x0040 (DS4 special button: PS / Home)
BTN_TOUCHPAD   = 1 << 7   # 0x0080 (DS4 special button: touchpad click)
# NOTE: L2/R2 have NO digital bit on the wire. The PC derives the DS4 L2/R2 digital
# buttons from the analog trigger bytes (l2/r2 > TRIGGER_DIGITAL_THRESHOLD).
TRIGGER_DIGITAL_THRESHOLD = 10
BTN_SHARE      = 1 << 8   # 0x0100 (Select / Share)
BTN_OPTIONS    = 1 << 9   # 0x0200 (Start / Options)
BTN_L3         = 1 << 10  # 0x0400
BTN_R3         = 1 << 11  # 0x0800
BTN_DPAD_UP    = 1 << 12  # 0x1000
BTN_DPAD_DOWN  = 1 << 13  # 0x2000
BTN_DPAD_LEFT  = 1 << 14  # 0x4000
BTN_DPAD_RIGHT = 1 << 15  # 0x8000


@dataclass
class ControllerPacket:
    seq: int
    timestamp_us: int
    buttons: int
    lx: int
    ly: int
    rx: int
    ry: int
    l2: int
    r2: int
    gyro_x: float
    gyro_y: float
    gyro_z: float
    accel_x: float
    accel_y: float
    accel_z: float

    @classmethod
    def unpack(cls, data: bytes) -> "ControllerPacket":
        if len(data) != PACKET_SIZE:
            raise ValueError(f"Invalid packet length: {len(data)} (expected {PACKET_SIZE})")
        return cls(*struct.unpack(PACKET_FORMAT, data))


@dataclass
class RumbleState:
    large_motor: int = 0
    small_motor: int = 0
    led_r: int = 0
    led_g: int = 120
    led_b: int = 255
    updated_at: float = 0.0

    def pack_feedback(self, echo_seq: int, echo_timestamp_us: int) -> bytes:
        return struct.pack(
            FEEDBACK_FORMAT,
            echo_seq & 0xFFFFFFFF,
            echo_timestamp_us & 0xFFFFFFFFFFFFFFFF,
            max(0, min(255, self.large_motor)),
            max(0, min(255, self.small_motor)),
            max(0, min(255, self.led_r)),
            max(0, min(255, self.led_b)),
        )


class AdbUsbTunnelManager:
    """
    Polls `adb devices` in a background thread. When an Android device is plugged in via USB,
    automatically runs `adb -s <serial> reverse tcp:<usb_port> tcp:<usb_port>` so the phone
    can connect to `127.0.0.1:<usb_port>` over USB with zero manual IP entry.
    """

    def __init__(self, usb_port: int = 26761, adb_path_getter=None) -> None:
        self.usb_port = usb_port
        self._adb_path_getter = adb_path_getter   # callable -> resolved adb path or None
        self.adb_missing = False
        self.connected_serial: str | None = None
        self.tunnel_active: bool = False
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._poll_loop, name="AdbReverseMonitor", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def _poll_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                adb_exe = (self._adb_path_getter() if callable(self._adb_path_getter) else None) or find_adb()
                if not adb_exe:
                    self.adb_missing = True
                    self.tunnel_active = False
                    self._stop_event.wait(2.0)
                    continue
                self.adb_missing = False
                res = subprocess.run(
                    [adb_exe, "devices"],
                    capture_output=True,
                    text=True,
                    timeout=2.0,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                serials: list[str] = []
                for line in res.stdout.splitlines()[1:]:
                    parts = line.strip().split()
                    if len(parts) >= 2 and parts[1] == "device":
                        serials.append(parts[0])

                if serials:
                    serial = serials[0]
                    if serial != self.connected_serial or not self.tunnel_active:
                        rev = subprocess.run(
                            [
                                adb_exe,
                                "-s",
                                serial,
                                "reverse",
                                f"tcp:{self.usb_port}",
                                f"tcp:{self.usb_port}",
                            ],
                            capture_output=True,
                            text=True,
                            timeout=2.0,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                        )
                        if rev.returncode == 0:
                            self.connected_serial = serial
                            self.tunnel_active = True
                            print(
                                f"\n[USB Auto-Tunnel] Phone '{serial}' detected via USB! "
                                f"`adb reverse tcp:{self.usb_port} tcp:{self.usb_port}` active."
                            )
                else:
                    if self.tunnel_active:
                        print("\n[USB Auto-Tunnel] USB phone unplugged. Falling back to Wi-Fi UDP.")
                    self.connected_serial = None
                    self.tunnel_active = False
            except FileNotFoundError:
                self.tunnel_active = False
            except Exception:
                pass

            self._stop_event.wait(1.5)


# -----------------------------------------------------------------------------
# Virtual DS4 driver probe. Every VDS4Gamepad() is a REAL controller on the Windows
# device list, so the probe must never create more than one:
#   * at most ONE probe device exists (cached in _PROBE_PAD, guarded by a lock)
#   * later probes (e.g. the wizard's "Try again" / 2 s auto re-check) REUSE it
#   * `release=True` drops a probe-created device immediately (status-only checks)
#   * a failed VDS4Gamepad() creates nothing, so retrying cannot leak devices
# -----------------------------------------------------------------------------
_PROBE_LOCK = threading.Lock()
_PROBE_PAD = None


def probe_virtual_ds4_driver(existing_gamepad=None, release: bool = False):
    """
    Returns `(ok, message, vg_module, gamepad_or_None)`.
    The returned gamepad is the single shared device: callers adopt it as their gamepad.
    """
    global _PROBE_PAD
    try:
        import vgamepad as vg
    except Exception as exc:
        return False, f"vgamepad import failed ({type(exc).__name__}: {exc}). Run: pip install vgamepad", None, None

    with _PROBE_LOCK:
        pad = existing_gamepad if existing_gamepad is not None else _PROBE_PAD
        if pad is not None:
            _PROBE_PAD = pad
            return True, "Virtual DualShock 4 (VDS4Gamepad) is active on ViGEmBus.", vg, pad
        try:
            created = vg.VDS4Gamepad()  # exactly one creation attempt per call, never in a loop
        except Exception as exc:
            return False, f"VDS4Gamepad() failed ({type(exc).__name__}: {exc}). Install ViGEmBus driver.", vg, None
        if release:
            del created  # unplugged immediately when the last reference goes away
            gc.collect()
            return True, "Virtual DualShock 4 (VDS4Gamepad) probe succeeded; device released.", vg, None
        _PROBE_PAD = created
        return True, "Virtual DualShock 4 (VDS4Gamepad) created successfully.", vg, created


def release_probe_pad() -> None:
    """Drops the shared probe device (callers must also drop their own reference)."""
    global _PROBE_PAD
    with _PROBE_LOCK:
        _PROBE_PAD = None
    gc.collect()


def import_vgamepad_or_explain():
    """Imports vgamepad and initializes VX360/VDS4Gamepad with clear ViGEmBus error messages."""
    try:
        import vgamepad as vg
    except ImportError as exc:
        print("\n[ERROR] Python package 'vgamepad' is not installed.", file=sys.stderr)
        print("Fix this by running:", file=sys.stderr)
        print("    pip install vgamepad qrcode[pil]\n", file=sys.stderr)
        raise SystemExit(1) from exc

    try:
        gamepad = vg.VDS4Gamepad()
        return vg, gamepad
    except Exception as exc:
        print("\n" + "=" * 74, file=sys.stderr)
        print(" [CRITICAL ERROR] Could not create Virtual DualShock 4 (ViGEmBus missing)", file=sys.stderr)
        print("=" * 74, file=sys.stderr)
        print(f"Underlying error: {exc}\n", file=sys.stderr)
        print("How to fix this on Windows 10/11:", file=sys.stderr)
        print("  1. Download ViGEmBus_Setup_x64.exe from:", file=sys.stderr)
        print("     https://github.com/nefarius/ViGEmBus/releases/latest", file=sys.stderr)
        print("  2. Run the installer as Administrator.", file=sys.stderr)
        print("  3. Reboot Windows if the bus driver does not immediately start.", file=sys.stderr)
        print("  4. Check Device Manager -> 'System devices' ->", file=sys.stderr)
        print("     'Nefarius Virtual Gamepad Emulation Bus'.", file=sys.stderr)
        print("=" * 74 + "\n", file=sys.stderr)
        raise SystemExit(2) from exc


def int16_to_ds4_byte(val: int) -> int:
    """
    Converts signed int16 (-32768..32767) to DualShock 4 unsigned byte axis (0..255, 128=center).
    """
    clamped = max(-32768, min(32767, val))
    normalized = (clamped + 32768) / 65535.0
    return max(0, min(255, int(round(normalized * 255.0))))


def resolve_dpad_direction(vg, buttons: int):
    """Maps the 4 D-pad bits in the bitmask to vgamepad DS4_DPAD_DIRECTIONS."""
    up = bool(buttons & BTN_DPAD_UP)
    down = bool(buttons & BTN_DPAD_DOWN)
    left = bool(buttons & BTN_DPAD_LEFT)
    right = bool(buttons & BTN_DPAD_RIGHT)

    D = vg.DS4_DPAD_DIRECTIONS
    if up and right:
        return D.DS4_BUTTON_DPAD_NORTHEAST
    if up and left:
        return D.DS4_BUTTON_DPAD_NORTHWEST
    if down and right:
        return D.DS4_BUTTON_DPAD_SOUTHEAST
    if down and left:
        return D.DS4_BUTTON_DPAD_SOUTHWEST
    if up:
        return D.DS4_BUTTON_DPAD_NORTH
    if down:
        return D.DS4_BUTTON_DPAD_SOUTH
    if left:
        return D.DS4_BUTTON_DPAD_WEST
    if right:
        return D.DS4_BUTTON_DPAD_EAST
    return D.DS4_BUTTON_DPAD_NONE


def apply_packet_to_ds4(vg, gamepad, pkt: ControllerPacket) -> None:
    """Applies a decoded ControllerPacket to the ViGEmBus VDS4Gamepad instance."""
    gamepad.reset()

    B = vg.DS4_BUTTONS
    button_map = (
        (BTN_CROSS, B.DS4_BUTTON_CROSS),
        (BTN_CIRCLE, B.DS4_BUTTON_CIRCLE),
        (BTN_SQUARE, B.DS4_BUTTON_SQUARE),
        (BTN_TRIANGLE, B.DS4_BUTTON_TRIANGLE),
        (BTN_L1, B.DS4_BUTTON_SHOULDER_LEFT),
        (BTN_R1, B.DS4_BUTTON_SHOULDER_RIGHT),
        (BTN_SHARE, B.DS4_BUTTON_SHARE),
        (BTN_OPTIONS, B.DS4_BUTTON_OPTIONS),
        (BTN_L3, B.DS4_BUTTON_THUMB_LEFT),
        (BTN_R3, B.DS4_BUTTON_THUMB_RIGHT),
    )

    for mask, ds4_btn in button_map:
        if pkt.buttons & mask:
            gamepad.press_button(button=ds4_btn)

    # L2/R2 digital buttons are derived from the analog triggers (no wire bit)
    if pkt.l2 > TRIGGER_DIGITAL_THRESHOLD:
        gamepad.press_button(button=B.DS4_BUTTON_TRIGGER_LEFT)
    if pkt.r2 > TRIGGER_DIGITAL_THRESHOLD:
        gamepad.press_button(button=B.DS4_BUTTON_TRIGGER_RIGHT)

    # DS4 special buttons (PS + touchpad click) use their own bits
    SP = vg.DS4_SPECIAL_BUTTONS
    if pkt.buttons & BTN_PS:
        gamepad.press_special_button(special_button=SP.DS4_SPECIAL_BUTTON_PS)
    if pkt.buttons & BTN_TOUCHPAD:
        gamepad.press_special_button(special_button=SP.DS4_SPECIAL_BUTTON_TOUCHPAD)

    # D-Pad
    gamepad.directional_pad(direction=resolve_dpad_direction(vg, pkt.buttons))

    # Analog sticks (0..255 with 128 center)
    gamepad.left_joystick(
        x_value=int16_to_ds4_byte(pkt.lx),
        y_value=int16_to_ds4_byte(pkt.ly),
    )
    gamepad.right_joystick(
        x_value=int16_to_ds4_byte(pkt.rx),
        y_value=int16_to_ds4_byte(pkt.ry),
    )

    # Analog triggers (0..255)
    gamepad.left_trigger(value=max(0, min(255, pkt.l2)))
    gamepad.right_trigger(value=max(0, min(255, pkt.r2)))

    gamepad.update()


def run_test_mode(vg, gamepad) -> None:
    """
    Interactive hardware verification loop for gamepad-tester.com and Windows `joy.cpl`.
    Cycles through every DS4 button, D-pad direction, analog stick circle, and trigger ramp.
    """
    print("\n=====================================================================")
    print(" VIRTUAL DUALSHOCK 4 TEST MODE ACTIVE")
    print(" -> Open Windows 'Set up USB game controllers' (Win+R -> joy.cpl)")
    print(" -> Or open https://hardwaretester.com/gamepad in your browser")
    print(" Press Ctrl+C at any time to stop.")
    print("=====================================================================\n")

    B = vg.DS4_BUTTONS
    S = vg.DS4_SPECIAL_BUTTONS
    D = vg.DS4_DPAD_DIRECTIONS

    button_sequence = [
        ("Cross (A)", B.DS4_BUTTON_CROSS),
        ("Circle (B)", B.DS4_BUTTON_CIRCLE),
        ("Square (X)", B.DS4_BUTTON_SQUARE),
        ("Triangle (Y)", B.DS4_BUTTON_TRIANGLE),
        ("L1 (Left Shoulder)", B.DS4_BUTTON_SHOULDER_LEFT),
        ("R1 (Right Shoulder)", B.DS4_BUTTON_SHOULDER_RIGHT),
        ("L2 Digital", B.DS4_BUTTON_TRIGGER_LEFT),
        ("R2 Digital", B.DS4_BUTTON_TRIGGER_RIGHT),
        ("Share (Select)", B.DS4_BUTTON_SHARE),
        ("Options (Start)", B.DS4_BUTTON_OPTIONS),
        ("L3 (Left Stick Click)", B.DS4_BUTTON_THUMB_LEFT),
        ("R3 (Right Stick Click)", B.DS4_BUTTON_THUMB_RIGHT),
    ]

    dpad_sequence = [
        ("D-Pad UP (North)", D.DS4_BUTTON_DPAD_NORTH),
        ("D-Pad UP-RIGHT (NorthEast)", D.DS4_BUTTON_DPAD_NORTHEAST),
        ("D-Pad RIGHT (East)", D.DS4_BUTTON_DPAD_EAST),
        ("D-Pad DOWN-RIGHT (SouthEast)", D.DS4_BUTTON_DPAD_SOUTHEAST),
        ("D-Pad DOWN (South)", D.DS4_BUTTON_DPAD_SOUTH),
        ("D-Pad DOWN-LEFT (SouthWest)", D.DS4_BUTTON_DPAD_SOUTHWEST),
        ("D-Pad LEFT (West)", D.DS4_BUTTON_DPAD_WEST),
        ("D-Pad UP-LEFT (NorthWest)", D.DS4_BUTTON_DPAD_NORTHWEST),
    ]

    try:
        cycle = 1
        while True:
            print(f"--- Starting Verification Cycle #{cycle} ---")

            # 1. Cycle standard buttons
            for label, btn in button_sequence:
                print(f"  [Button] Pressing {label}...")
                gamepad.reset()
                gamepad.press_button(button=btn)
                gamepad.update()
                time.sleep(0.28)
                gamepad.reset()
                gamepad.update()
                time.sleep(0.08)

            # Special PS + Touchpad click test
            for label, sbtn in [("PS Home Button", S.DS4_SPECIAL_BUTTON_PS), ("Touchpad Click", S.DS4_SPECIAL_BUTTON_TOUCHPAD)]:
                print(f"  [Special] Pressing {label}...")
                gamepad.reset()
                gamepad.press_special_button(special_button=sbtn)
                gamepad.update()
                time.sleep(0.28)
                gamepad.reset()
                gamepad.update()
                time.sleep(0.08)

            # 2. Cycle all 8 D-Pad directions
            for label, dpad_dir in dpad_sequence:
                print(f"  [D-Pad]  {label}...")
                gamepad.reset()
                gamepad.directional_pad(direction=dpad_dir)
                gamepad.update()
                time.sleep(0.22)
            gamepad.reset()
            gamepad.update()

            # 3. Sweep Left & Right Analog Sticks in smooth 360-degree circles
            print("  [Sticks] Sweeping Left & Right analog sticks 360 degrees...")
            steps = 90
            for i in range(steps):
                angle = (2.0 * math.pi * i) / steps
                lx = int(128 + 127 * math.cos(angle))
                ly = int(128 + 127 * math.sin(angle))
                rx = int(128 + 127 * math.cos(-angle))
                ry = int(128 + 127 * math.sin(-angle))
                gamepad.left_joystick(x_value=lx, y_value=ly)
                gamepad.right_joystick(x_value=rx, y_value=ry)
                gamepad.update()
                time.sleep(0.016)
            gamepad.reset()
            gamepad.update()

            # 4. Ramp L2 and R2 Analog Triggers 0 -> 255 -> 0
            print("  [Triggers] Ramping L2 & R2 triggers 0 -> 255 -> 0...")
            for val in range(0, 256, 5):
                gamepad.left_trigger(value=val)
                gamepad.right_trigger(value=255 - val)
                gamepad.update()
                time.sleep(0.01)
            for val in range(0, 256, 5):
                gamepad.left_trigger(value=255 - val)
                gamepad.right_trigger(value=val)
                gamepad.update()
                time.sleep(0.01)

            gamepad.reset()
            gamepad.update()
            print(f"--- Cycle #{cycle} Complete ---\n")
            cycle += 1
            time.sleep(0.5)
    except KeyboardInterrupt:
        gamepad.reset()
        gamepad.update()
        print("\n[Test Mode] Stopped cleanly. Virtual DS4 reset to neutral.")


def get_local_lan_ip() -> str:
    """Detects the primary LAN IPv4 address for pairing."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def generate_pairing_token() -> str:
    """Generates a random 16-hex-character (64-bit) pairing token."""
    return secrets.token_hex(8)


def build_pairing_uri(ip: str, port: int, token: str) -> str:
    """Builds the `ds4udp://ip:port?token=...` URI encoded into the pairing QR code."""
    return f"ds4udp://{ip}:{port}?token={token}"


def print_pairing_qr(ip: str, port: int, token: str = "") -> None:
    """Prints a terminal QR code encoding `ds4udp://<ip>:<port>?token=<token>`."""
    uri = build_pairing_uri(ip, port, token) if token else f"ds4udp://{ip}:{port}"
    print("\n=====================================================================")
    print(" PAIR ANDROID CONTROLLER VIA QR CODE OR MANUAL IP")
    print(f" Pairing Payload : {uri}")
    print(f" Host IP Address : {ip}")
    print(f" UDP Port        : {port}")
    if token:
        print(f" Pairing Token   : {token}")
    print("=====================================================================")
    try:
        import qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(uri)
        qr.make(fit=True)
        qr.print_ascii(invert=True)
    except ImportError:
        print(" (Install `qrcode[pil]` to render the ASCII QR code in terminal)")
    print("=====================================================================\n")


def register_ds4_rumble_callback(gamepad, rumble_state: RumbleState, on_rumble_event=None) -> None:
    """
    Subscribes to ViGEmBus DualShock 4 force-feedback / rumble / lightbar notifications
    from Windows games and updates `rumble_state` for immediate transmission to the phone.
    """
    def _callback(client, target, large_motor, small_motor, led_number, user_data):
        rumble_state.large_motor = int(large_motor)
        rumble_state.small_motor = int(small_motor)
        rumble_state.updated_at = time.perf_counter()
        if on_rumble_event is not None:
            on_rumble_event(int(large_motor), int(small_motor))

    try:
        gamepad.register_notification(callback_function=_callback)
    except Exception as exc:
        print(f"[Rumble Warning] Could not register ViGEmBus notification callback: {exc}")


# =============================================================================
# SAFETY: neutral state
# =============================================================================
def neutralize_gamepad(gamepad) -> None:
    """All buttons (incl. PS / touchpad special buttons) released, sticks centred, triggers 0."""
    try:
        gamepad.reset()   # zeroes the whole DS4 report: buttons, specials, sticks, triggers, d-pad
        gamepad.update()
    except Exception:
        pass


# =============================================================================
# REAL RTT MEASUREMENT (ping/pong on the SAME transport; 48-byte layout unchanged)
# -----------------------------------------------------------------------------
#  PC -> phone  : a normal 16-byte feedback-sized frame `<IQBBBB` with
#                 echo_seq = PING_SEQ (0xFFFFFFFF), timestamp = PC monotonic microseconds,
#                 last two bytes = ping id (little endian).
#  phone -> PC  : a normal 48-byte frame with seq = PING_SEQ, timestamp = the PC timestamp
#                 echoed verbatim, `buttons` field = ping id; every other field is zero.
#  PC           : rtt = now_monotonic_us - echoed_timestamp. No clocks are compared across
#                 devices, no baselines or estimates exist: until the first pong arrives the
#                 UI shows "—". Pongs never reach the controller state.
#  The sentinel is never a real sequence number (it would take ~414 days at 120 Hz).
# =============================================================================
PING_SEQ = 0xFFFFFFFF
# Duplicate-stream guard only: phones send on ONE transport at a time, so switching USB<->Wi-Fi
# may lose at most about one 120 Hz frame (8.3 ms).
USB_PRIORITY_WINDOW_S = 0.009
PING_INTERVAL_S = 0.5
RTT_MAX_VALID_MS = 5000.0


def monotonic_us() -> int:
    return time.perf_counter_ns() // 1000


class RttMonitor:
    """Thread-safe real RTT tracker fed only by genuine pong frames."""

    def __init__(self, window_s: float = 60.0, interval_s: float = PING_INTERVAL_S) -> None:
        self._lock = threading.Lock()
        self.window_s = window_s
        self.interval_s = interval_s
        self._samples: collections.deque[tuple[float, float, str]] = collections.deque()  # (wall_s, ms, transport)
        self._next_id = 0
        self._last_ping_wall = 0.0

    def ping_due(self, now_wall: float | None = None) -> bool:
        now_wall = time.monotonic() if now_wall is None else now_wall
        return (now_wall - self._last_ping_wall) >= self.interval_s

    def make_ping(self, now_wall: float | None = None, now_us: int | None = None) -> bytes:
        with self._lock:
            self._next_id = (self._next_id + 1) & 0xFFFF
            self._last_ping_wall = time.monotonic() if now_wall is None else now_wall
            ping_id = self._next_id
        ts = monotonic_us() if now_us is None else now_us
        return struct.pack("<IQBBBB", PING_SEQ, ts, 0, 0, ping_id & 0xFF, (ping_id >> 8) & 0xFF)

    @staticmethod
    def is_pong(pkt: "ControllerPacket") -> bool:
        return pkt.seq == PING_SEQ

    def handle_pong(self, pkt: "ControllerPacket", transport: str, now_us: int | None = None,
                    now_wall: float | None = None) -> float | None:
        """Returns the RTT in ms if `pkt` is a valid pong, else None."""
        if not self.is_pong(pkt):
            return None
        now_us = monotonic_us() if now_us is None else now_us
        ms = (now_us - pkt.timestamp_us) / 1000.0
        if ms < 0.0 or ms > RTT_MAX_VALID_MS:
            return None
        now_wall = time.monotonic() if now_wall is None else now_wall
        with self._lock:
            self._samples.append((now_wall, ms, transport))
            self._trim(now_wall)
        return ms

    def _trim(self, now_wall: float) -> None:
        while self._samples and (now_wall - self._samples[0][0]) > self.window_s:
            self._samples.popleft()

    def samples(self, now_wall: float | None = None) -> list[tuple[float, float, str]]:
        now_wall = time.monotonic() if now_wall is None else now_wall
        with self._lock:
            self._trim(now_wall)
            return list(self._samples)

    def stats(self, now_wall: float | None = None) -> dict | None:
        """None until a real sample exists; else count/min/avg/p99/latest over the last 60 s."""
        smp = self.samples(now_wall)
        if not smp:
            return None
        vals = sorted(v for _, v, _ in smp)
        p99 = vals[min(len(vals) - 1, max(0, math.ceil(0.99 * len(vals)) - 1))]
        return {"n": len(vals), "min": vals[0], "avg": sum(vals) / len(vals), "p99": p99,
                "latest": smp[-1][1], "transport": smp[-1][2]}

    def clear(self) -> None:
        with self._lock:
            self._samples.clear()


def fmt_ms(value: float | None) -> str:
    """'—' when no real measurement exists."""
    return "—" if value is None else f"{value:.2f} ms"


# =============================================================================
# PAIRING HANDSHAKE (explicit; the 48-byte controller packet is NOT changed)
# -----------------------------------------------------------------------------
#  1. The PC shows a QR code  ds4udp://<ip>:<port>?token=<16 hex chars>.
#  2. The phone FIRST sends one small auth packet:  AUTH_MAGIC + token
#         b"DS4AUTH:" + b"<token>"      (UDP: one datagram; TCP: same bytes + b"\n")
#     It is never 48 bytes long, so it cannot be confused with a controller packet.
#  3. The PC validates the token with hmac.compare_digest (constant time).
#  4. On success the PC accepts controller packets ONLY from that exact
#     (IP, port) pair (UDP), or from that TCP connection (USB). A new valid auth
#     replaces the previous peer; "Reset pairing" issues a new token and revokes all.
#  5. Everything before a valid auth - and every packet from any other IP/port -
#     is dropped without being parsed. The phone repeats the auth packet about once a
#     second so it re-pairs after a PC restart or a source-port change.
# =============================================================================
AUTH_MAGIC = b"DS4AUTH:"
AUTH_NAME_SEP = b"|"
TOKEN_LEN = 16                                  # generate_pairing_token() -> 16 hex chars
NAME_MAX = 20
AUTH_MAX_LEN = len(AUTH_MAGIC) + TOKEN_LEN + 1 + NAME_MAX + 1   # 46 < 48: never a controller packet


def sanitize_phone_name(name: str) -> str:
    keep = "".join(c for c in name if c.isalnum() or c in " -_.")
    return keep.strip()[:NAME_MAX]


def build_auth_packet(token: str, newline: bool = False, name: str = "") -> bytes:
    """Auth packet = AUTH_MAGIC + token [+ "|" + phone name] [+ "\\n" on TCP]."""
    body = AUTH_MAGIC + token.encode("ascii")
    clean = sanitize_phone_name(name).encode("ascii", errors="ignore")
    if clean:
        body += AUTH_NAME_SEP + clean
    return body + (b"\n" if newline else b"")


def parse_auth_fields(data: bytes) -> tuple[bytes, str] | None:
    """Returns (token_bytes, phone_name) if `data` is a well-formed auth packet, else None."""
    if len(data) == PACKET_SIZE or len(data) > AUTH_MAX_LEN or not data.startswith(AUTH_MAGIC):
        return None
    body = data[len(AUTH_MAGIC):].rstrip(b"\r\n")
    token, _, name = body.partition(AUTH_NAME_SEP)
    return token, name.decode("ascii", errors="ignore")


def parse_auth_packet(data: bytes) -> bytes | None:
    fields = parse_auth_fields(data)
    return None if fields is None else fields[0]


def verify_auth_packet(data: bytes, expected_token: str) -> bool:
    provided = parse_auth_packet(data)
    if provided is None or not expected_token:
        return False
    return hmac.compare_digest(provided, expected_token.encode("ascii"))


class PairingGate:
    """
    Thread-safe peer gate implementing steps 3-5 of the handshake above, plus the OPTIONAL
    trust list: when `strict` is on, a phone with the right token is still held in `pending`
    until the user trusts its name in the tray. `revoke_all()` clears trust, drops the peer
    and installs a fresh token.
    """

    def __init__(self, token: str, trusted: list[str] | None = None, strict: bool = False) -> None:
        self._lock = threading.Lock()
        self._token = token
        self._peer: tuple[str, int] | None = None
        self.peer_name = ""
        self.trusted: list[str] = list(trusted or [])
        self.strict = strict
        self.pending: dict[str, tuple[str, int]] = {}
        self.rejected = 0

    @property
    def token(self) -> str:
        return self._token

    @property
    def peer(self) -> tuple[str, int] | None:
        return self._peer

    def reset(self, new_token: str) -> None:
        """'Reset pairing': new token, current peer dropped (trust list kept)."""
        with self._lock:
            self._token = new_token
            self._peer = None
            self.peer_name = ""
            self.pending.clear()

    def revoke_all(self, new_token: str) -> None:
        """'Revoke all': new token, peer dropped, trust list emptied."""
        with self._lock:
            self._token = new_token
            self._peer = None
            self.peer_name = ""
            self.trusted.clear()
            self.pending.clear()

    def trust(self, name: str) -> None:
        with self._lock:
            if name and name not in self.trusted:
                self.trusted.append(name)
            addr = self.pending.pop(name, None)
            if addr is not None:
                self._peer, self.peer_name = addr, name

    def untrust(self, name: str) -> None:
        with self._lock:
            if name in self.trusted:
                self.trusted.remove(name)
            if self.peer_name == name:
                self._peer, self.peer_name = None, ""

    def admit_name(self, name: str) -> bool:
        """For TCP/USB streams: True if this phone name may connect (non-strict => always)."""
        with self._lock:
            return (not self.strict) or (name in self.trusted)

    def on_datagram(self, data: bytes, addr: tuple[str, int]) -> str:
        """Classifies a datagram: 'auth_ok' | 'auth_pending' | 'auth_bad' | 'packet_ok' | 'packet_rejected' | 'junk'."""
        if len(data) == PACKET_SIZE:
            with self._lock:
                if self._peer is not None and tuple(addr[:2]) == self._peer:
                    return "packet_ok"
                self.rejected += 1
            return "packet_rejected"
        fields = parse_auth_fields(data)
        if fields is None:
            return "junk"
        _tok, name = fields
        with self._lock:
            if not verify_auth_packet(data, self._token):
                self.rejected += 1
                return "auth_bad"
            if self.strict and name not in self.trusted:
                self.pending[name or "(unnamed phone)"] = (addr[0], addr[1])
                return "auth_pending"
            self._peer = (addr[0], addr[1])
            self.peer_name = name
            return "auth_ok"


def run_usb_tcp_server(
    usb_port: int,
    packet_queue_callback,
    rumble_state: RumbleState,
    stop_event: threading.Event,
    expected_token_getter=None,
    rtt_monitor: "RttMonitor | None" = None,
    name_gate=None,
    idle_timeout_s: float = 2.0,
    on_idle=None,
) -> None:
    """
    Dedicated low-latency TCP server bound to `127.0.0.1:<usb_port>` for `adb reverse` USB mode.
    Reads 48-byte packets with `TCP_NODELAY` and writes back 16-byte rumble + RTT echo frames.
    If `expected_token_getter` returns a non-empty token, the stream must start with the auth
    line (AUTH_MAGIC + token [+ "|name"] + newline, see PAIRING HANDSHAKE).
    `name_gate(name) -> bool` optionally enforces the trust list. `rtt_monitor` adds real
    ping/pong RTT measurement on this stream. `on_idle()` is called when the stream goes
    quiet for `idle_timeout_s` (caller neutralizes the gamepad).
    """
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", usb_port))
    srv.listen(1)
    srv.settimeout(0.5)

    while not stop_event.is_set():
        try:
            conn, _ = srv.accept()
        except socket.timeout:
            continue
        except Exception:
            break

        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        conn.settimeout(0.25)
        print(f"\n[Transport Switch] Active Transport -> USB (adb reverse 127.0.0.1:{usb_port})")
        buf = bytearray()
        expected_token = expected_token_getter() if callable(expected_token_getter) else ""
        authenticated = not bool(expected_token)
        auth_token_snapshot = expected_token
        last_rx = time.monotonic()
        try:
            while not stop_event.is_set():
                current_tok = expected_token_getter() if callable(expected_token_getter) else ""
                if current_tok != auth_token_snapshot:
                    break  # pairing was reset -> drop the session immediately
                if authenticated and rtt_monitor is not None and rtt_monitor.ping_due():
                    conn.sendall(rtt_monitor.make_ping())
                try:
                    chunk = conn.recv(512)
                except socket.timeout:
                    if (time.monotonic() - last_rx) > idle_timeout_s:
                        if on_idle is not None:
                            on_idle()
                        break
                    continue
                if not chunk:
                    break
                last_rx = time.monotonic()
                buf.extend(chunk)
                if not authenticated:
                    # First bytes on a USB stream must be the auth line.
                    if b"\n" not in buf:
                        if len(buf) > AUTH_MAX_LEN or not AUTH_MAGIC.startswith(bytes(buf[:8])):
                            break  # not an auth packet -> reject stream
                        continue
                    line, _, remainder = bytes(buf).partition(b"\n")
                    if not verify_auth_packet(line + b"\n", current_tok):
                        break
                    name = (parse_auth_fields(line + b"\n") or (b"", ""))[1]
                    if name_gate is not None and not name_gate(name):
                        break  # strict trust list: phone not trusted
                    authenticated = True
                    buf.clear()
                    buf.extend(remainder)
                while len(buf) >= PACKET_SIZE:
                    raw_pkt = bytes(buf[:PACKET_SIZE])
                    del buf[:PACKET_SIZE]
                    pkt = ControllerPacket.unpack(raw_pkt)
                    if pkt.seq == PING_SEQ:
                        if rtt_monitor is not None:
                            rtt_monitor.handle_pong(pkt, "USB")
                        continue
                    packet_queue_callback(pkt, "USB")
                    conn.sendall(rumble_state.pack_feedback(pkt.seq, pkt.timestamp_us))
        except Exception:
            pass
        finally:
            conn.close()
            print("\n[Transport Switch] USB stream closed -> Standby for Wi-Fi UDP or USB reconnect.")
    srv.close()


def run_udp_receiver(
    vg,
    gamepad,
    bind_ip: str,
    port: int,
    stale_timeout_ms: float,
    usb_port: int = 26761,
    enable_auto_adb: bool = True,
    pairing_token: str = "",
) -> None:
    """
    High-frequency UDP receiver loop:
    - Parses the 48-byte binary packet
    - Discards out-of-order packets (seq <= last_seq)
    - Discards stale packets whose sender timestamp lags behind the latest timestamp
      or when the sender stream resets after inactivity
    - Updates the ViGEmBus DualShock 4 immediately
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((bind_ip, port))
    sock.settimeout(0.25)

    rumble_state = RumbleState()
    register_ds4_rumble_callback(gamepad, rumble_state)

    stop_event = threading.Event()
    adb_manager = AdbUsbTunnelManager(usb_port=usb_port)
    if enable_auto_adb:
        adb_manager.start()

    lan_ip = get_local_lan_ip() if bind_ip == "0.0.0.0" else bind_ip
    active_token = pairing_token or generate_pairing_token()
    print_pairing_qr(lan_ip, port, active_token)
    gate = PairingGate(active_token)
    rtt_monitor = RttMonitor()

    last_seq: int | None = None
    last_sender_ts_us: int | None = None
    last_recv_wall_s: float = 0.0
    active_transport: str = "WIFI"

    accepted = 0
    dropped_ooo = 0
    dropped_stale = 0
    dropped_malformed = 0
    stat_window_start = time.perf_counter()
    jitter_accum_us = 0.0
    prev_interarrival_us: float | None = None

    stale_threshold_us = int(stale_timeout_ms * 1000.0)

    def handle_usb_packet(pkt: ControllerPacket, transport_label: str) -> None:
        nonlocal last_seq, last_sender_ts_us, last_recv_wall_s, accepted, active_transport
        active_transport = transport_label
        last_seq = pkt.seq
        last_sender_ts_us = pkt.timestamp_us
        last_recv_wall_s = time.perf_counter()
        accepted += 1
        apply_packet_to_ds4(vg, gamepad, pkt)

    usb_thread = threading.Thread(
        target=run_usb_tcp_server,
        args=(usb_port, handle_usb_packet, rumble_state, stop_event, lambda: active_token, rtt_monitor,
              None, 2.0, lambda: neutralize_gamepad(gamepad)),
        name="UsbTcpReceiver",
        daemon=True,
    )
    usb_thread.start()

    print(f"[UDP Receiver] Listening on {bind_ip}:{port} (Packet size: {PACKET_SIZE} bytes)...")

    try:
        while True:
            now_s = time.perf_counter()
            try:
                data, addr = sock.recvfrom(256)
            except socket.timeout:
                # Neutralize controller if no packet arrived for > 500ms (safety watchdog)
                if last_recv_wall_s > 0 and (now_s - last_recv_wall_s) > 0.5:
                    neutralize_gamepad(gamepad)
                    last_seq = None
                    last_sender_ts_us = None
                    last_recv_wall_s = 0.0
                    print("\n[Watchdog] Stream idle > 500ms. Resetting DS4 state & sequence tracker.")
                continue

            verdict = gate.on_datagram(data, addr)
            if verdict in ("auth_ok", "auth_pending", "auth_bad"):
                continue
            if verdict != "packet_ok":
                dropped_malformed += 1
                continue

            pkt = ControllerPacket.unpack(data)
            if pkt.seq == PING_SEQ:       # pong: real RTT sample, never controller input
                rtt_monitor.handle_pong(pkt, "WIFI")
                continue
            if gate.peer is not None and rtt_monitor.ping_due():
                try:
                    sock.sendto(rtt_monitor.make_ping(), gate.peer)
                except Exception:
                    pass

            if active_transport == "USB" and (now_s - last_recv_wall_s) < USB_PRIORITY_WINDOW_S:
                continue
            active_transport = "WIFI"

            # Handle new session or sequence wrap-around after stream pause
            if last_seq is not None:
                # 1. Out-of-order check
                if pkt.seq <= last_seq and (last_seq - pkt.seq) < 1_000_000:
                    dropped_ooo += 1
                    continue

                # 2. Stale check using sender microsecond delta vs wall-clock arrival delta
                if last_sender_ts_us is not None:
                    sender_delta_us = pkt.timestamp_us - last_sender_ts_us
                    wall_delta_us = int((now_s - last_recv_wall_s) * 1_000_000)
                    # If packet experienced excessive queuing delay relative to expected arrival
                    if (wall_delta_us - sender_delta_us) > stale_threshold_us:
                        dropped_stale += 1
                        last_seq = pkt.seq
                        last_sender_ts_us = pkt.timestamp_us
                        last_recv_wall_s = now_s
                        continue

                    if prev_interarrival_us is not None:
                        jitter_accum_us += abs(wall_delta_us - sender_delta_us)
                    prev_interarrival_us = float(wall_delta_us)

            last_seq = pkt.seq
            last_sender_ts_us = pkt.timestamp_us
            last_recv_wall_s = now_s
            accepted += 1

            apply_packet_to_ds4(vg, gamepad, pkt)

            try:
                sock.sendto(rumble_state.pack_feedback(pkt.seq, pkt.timestamp_us), addr)
            except Exception:
                pass

            elapsed = now_s - stat_window_start
            if elapsed >= 1.0:
                hz = accepted / elapsed
                avg_jitter_ms = (jitter_accum_us / max(1, accepted)) / 1000.0
                print(
                    f"\r[{active_transport:4s} 120Hz] Rate: {hz:6.1f} Hz | Seq: {pkt.seq:8d} | "
                    f"LX/LY: ({pkt.lx:6d},{pkt.ly:6d}) RX/RY: ({pkt.rx:6d},{pkt.ry:6d}) | "
                    f"GyroZ: {pkt.gyro_z:+6.2f} | Jitter: {avg_jitter_ms:4.2f}ms | "
                    f"Drop(OOO:{dropped_ooo} Stale:{dropped_stale})",
                    end="",
                    flush=True,
                )
                accepted = 0
                jitter_accum_us = 0.0
                stat_window_start = now_s

    except KeyboardInterrupt:
        neutralize_gamepad(gamepad)
        print("\n[UDP Receiver] Shutting down cleanly.")
    finally:
        stop_event.set()
        adb_manager.stop()
        sock.close()


PLATFORM_TOOLS_URL = "https://developer.android.com/tools/releases/platform-tools"
FIREWALL_RULE_NAME = "DS4Bridge120Hz-UDP"


def find_adb(custom_dir: str = "") -> str | None:
    """Resolved adb executable from `custom_dir` (chosen in the tray) or PATH, else None."""
    exe = "adb.exe" if sys.platform == "win32" else "adb"
    if custom_dir:
        cand = os.path.join(custom_dir, exe)
        if os.path.isfile(cand):
            return cand
    return shutil.which("adb")


ADB_HELP = (
    "adb (Android platform-tools) was not found. USB mode needs it.\n"
    f"  1. Download platform-tools: {PLATFORM_TOOLS_URL}\n"
    "  2. Unzip it anywhere (e.g. C:\\platform-tools).\n"
    "  3. In the tray app choose 'Select adb folder' and pick that folder (or add it to PATH).\n"
    "  Wi-Fi mode works without adb."
)


def firewall_manual_command(port: int = 26760) -> str:
    return (f"netsh advfirewall firewall add rule name={FIREWALL_RULE_NAME} dir=in action=allow "
            f"protocol=UDP localport={port}")


def firewall_rule_state(port: int = 26760) -> tuple[str, str]:
    """
    ('present' | 'missing' | 'unknown' | 'n/a', detail). A local check cannot prove the phone can
    reach the PC; the only real proof is receiving the phone's auth packet / a pong.
    """
    if sys.platform != "win32":
        return "n/a", "Windows Firewall check only runs on Windows."
    try:
        res = subprocess.run(
            ["netsh", "advfirewall", "firewall", "show", "rule", f"name={FIREWALL_RULE_NAME}"],
            capture_output=True, text=True, timeout=5.0, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if res.returncode == 0 and FIREWALL_RULE_NAME in res.stdout and str(port) in res.stdout:
            return "present", f"Inbound UDP {port} rule '{FIREWALL_RULE_NAME}' exists."
        return "missing", f"No inbound UDP {port} rule found. Windows may silently block your phone."
    except Exception as exc:  # noqa: BLE001
        return "unknown", f"Could not query the firewall ({type(exc).__name__}: {exc})."


def add_firewall_rule_elevated(port: int = 26760) -> tuple[bool, str]:
    """Shows the Windows admin (UAC) prompt and adds the inbound UDP rule."""
    if sys.platform != "win32":
        return False, "Only available on Windows. Manual command: " + firewall_manual_command(port)
    args = f"advfirewall firewall add rule name={FIREWALL_RULE_NAME} dir=in action=allow protocol=UDP localport={port}"
    ps = f"Start-Process netsh -Verb RunAs -Wait -ArgumentList '{args}'"
    try:
        res = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True,
                             timeout=60.0, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if res.returncode != 0:
            return False, (res.stderr or "Admin prompt was cancelled.").strip() + "\nManual: " + firewall_manual_command(port)
        state, detail = firewall_rule_state(port)
        return state == "present", detail
    except Exception as exc:  # noqa: BLE001
        return False, f"{type(exc).__name__}: {exc}. Manual (admin cmd): {firewall_manual_command(port)}"


def run_self_test(udp_port: int = 26760, usb_port: int = 26761, adb_dir: str = "") -> int:
    """Prints a short health report; returns a process exit code (0 = no FAIL)."""
    rows: list[tuple[str, str, str]] = []

    def add(name: str, status: str, detail: str) -> None:
        rows.append((name, status, detail))

    add("Packet layout", "PASS" if (struct.calcsize("<IQHhhhhBBffffff"), struct.calcsize("<IQBBBB")) == (48, 16) else "FAIL",
        "controller 48 B, feedback 16 B")
    ok, msg, _vg, _pad = probe_virtual_ds4_driver(release=True)   # one device, released immediately
    add("ViGEmBus / vgamepad", "PASS" if ok else "FAIL", msg)
    adb = find_adb(adb_dir)
    add("adb (USB mode)", "PASS" if adb else "WARN", adb or ADB_HELP.splitlines()[0])
    state, detail = firewall_rule_state(udp_port)
    add("Firewall UDP %d" % udp_port, {"present": "PASS", "n/a": "SKIP"}.get(state, "WARN"), detail)
    for proto, port in (("UDP", udp_port), ("TCP", usb_port)):
        sk = socket.socket(socket.AF_INET, socket.SOCK_DGRAM if proto == "UDP" else socket.SOCK_STREAM)
        try:
            sk.bind(("0.0.0.0" if proto == "UDP" else "127.0.0.1", port))
            add(f"{proto} port {port}", "PASS", "free")
        except OSError as exc:
            add(f"{proto} port {port}", "WARN", f"in use ({exc}); is the receiver already running?")
        finally:
            sk.close()
    add("LAN IP", "PASS", get_local_lan_ip())
    print("DS4 Bridge self-test")
    for name, status, detail in rows:
        print(f"  [{status:4s}] {name:22s} {detail}")
    return 1 if any(r[1] == "FAIL" for r in rows) else 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Virtual DualShock 4 ViGEmBus driver + 120Hz UDP binary receiver"
    )
    parser.add_argument("--bind", default="0.0.0.0", help="UDP bind address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=26760, help="UDP listen port (default: 26760)")
    parser.add_argument(
        "--usb-port",
        type=int,
        default=26761,
        help="Localhost TCP port for `adb reverse` USB mode (default: 26761)",
    )
    parser.add_argument(
        "--stale-ms",
        type=float,
        default=35.0,
        help="Discard packets delayed by more than this threshold in ms (default: 35ms)",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="Run cyclic hardware verification mode for gamepad-tester.com and joy.cpl",
    )
    parser.add_argument("--headless", action="store_true",
                        help="Run without any GUI (console receiver; the default for this script)")
    parser.add_argument("--self-test", action="store_true",
                        help="Print a short health report (driver, adb, firewall, ports) and exit")
    parser.add_argument("--adb-dir", default="", help="Folder containing adb(.exe)")
    args, _unknown = parser.parse_known_args()

    if args.self_test:
        sys.exit(run_self_test(args.port, args.usb_port, args.adb_dir))

    vg, gamepad = import_vgamepad_or_explain()

    if args.test:
        run_test_mode(vg, gamepad)
    else:
        run_udp_receiver(vg, gamepad, args.bind, args.port, args.stale_ms, args.usb_port, True)


if __name__ == "__main__":
    main()
