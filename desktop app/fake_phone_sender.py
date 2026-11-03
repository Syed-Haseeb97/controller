#!/usr/bin/env python3
"""
120Hz Fake-Phone UDP Sender & Latency/Jitter Benchmark
======================================================
Generates synthetic 48-byte DualShock 4 packets (`<IQHhhhhBBffffff`) at 120Hz
(8.333ms period) to test `ds4_udp_receiver.py` without needing a physical phone.
Also supports optional fault injection (out-of-order and stale packets) and
prints real-time send timing, loop latency, and p99 jitter statistics.

Usage:
  python fake_phone_sender.py --host 127.0.0.1 --port 26760 --rate 120
"""

from __future__ import annotations

import argparse
import math
import random
import socket
import statistics
import struct
import time

PACKET_FORMAT = "<IQHhhhhBBffffff"
PACKET_SIZE = struct.calcsize(PACKET_FORMAT)
assert PACKET_SIZE == 48


def build_synthetic_packet(seq: int, t_sec: float, timestamp_us: int) -> bytes:
    """Builds a 48-byte binary controller state packet with smooth figure-8 sticks and gyro."""
    # Cycle through buttons every 250ms
    btn_index = int(t_sec * 4.0) % 16
    buttons = 1 << btn_index

    # Smooth sinusoidal sticks (-32767..32767)
    lx = int(32767.0 * math.sin(t_sec * 2.0))
    ly = int(32767.0 * math.cos(t_sec * 2.0))
    rx = int(32767.0 * math.sin(t_sec * 3.5))
    ry = int(32767.0 * math.cos(t_sec * 1.75))

    # Analog triggers (0..255)
    l2 = int((math.sin(t_sec * 1.5) * 0.5 + 0.5) * 255)
    r2 = int((math.cos(t_sec * 1.5) * 0.5 + 0.5) * 255)

    # Simulated 3-axis gyroscope (rad/s) & 3-axis accelerometer (m/s^2)
    gyro_x = 0.85 * math.sin(t_sec * 5.0)
    gyro_y = 0.65 * math.cos(t_sec * 4.0)
    gyro_z = 1.20 * math.sin(t_sec * 3.0)
    accel_x = 0.15 * math.sin(t_sec * 1.2)
    accel_y = 0.20 * math.cos(t_sec * 1.2)
    accel_z = 9.81

    return struct.pack(
        PACKET_FORMAT,
        seq,
        timestamp_us,
        buttons,
        lx,
        ly,
        rx,
        ry,
        l2,
        r2,
        gyro_x,
        gyro_y,
        gyro_z,
        accel_x,
        accel_y,
        accel_z,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="120Hz Fake-Phone UDP Sender & Latency Tester")
    parser.add_argument("--host", default="127.0.0.1", help="Target PC receiver IP (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=26760, help="Target UDP port (default: 26760)")
    parser.add_argument("--rate", type=int, default=120, help="Send frequency in Hz (default: 120)")
    parser.add_argument(
        "--inject-faults",
        action="store_true",
        help="Occasionally inject out-of-order and stale packets to verify receiver filtering",
    )
    args = parser.parse_args()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    target = (args.host, args.port)
    period_s = 1.0 / float(args.rate)

    print("=====================================================================")
    print(f" FAKE-PHONE 120Hz UDP SENDER -> {args.host}:{args.port}")
    print(f" Packet Format : {PACKET_FORMAT} ({PACKET_SIZE} bytes little-endian)")
    print(f" Target Rate   : {args.rate} Hz ({period_s * 1000.0:.3f} ms frame budget)")
    print("=====================================================================")

    seq = 1
    start_time = time.perf_counter()
    next_deadline = start_time
    stat_start = start_time

    frame_intervals_ms: list[float] = []
    send_durations_us: list[float] = []
    last_send_t = start_time

    try:
        while True:
            now = time.perf_counter()
            elapsed = now - start_time
            timestamp_us = int(elapsed * 1_000_000)

            pkt = build_synthetic_packet(seq, elapsed, timestamp_us)

            t0 = time.perf_counter()
            sock.sendto(pkt, target)
            t1 = time.perf_counter()

            # Optional fault injection to verify receiver out-of-order / stale rejection
            if args.inject_faults and seq % 240 == 0 and seq > 5:
                stale_pkt = build_synthetic_packet(seq - 3, elapsed - 0.080, timestamp_us - 80_000)
                sock.sendto(stale_pkt, target)

            send_durations_us.append((t1 - t0) * 1_000_000.0)
            frame_intervals_ms.append((t0 - last_send_t) * 1000.0)
            last_send_t = t0
            seq += 1

            # Report latency & frame pacing stats every 1.0 second
            if (t1 - stat_start) >= 1.0 and len(frame_intervals_ms) > 2:
                actual_hz = len(frame_intervals_ms) / (t1 - stat_start)
                mean_dt = statistics.mean(frame_intervals_ms)
                stdev_dt = statistics.stdev(frame_intervals_ms)
                sorted_dt = sorted(frame_intervals_ms)
                p99_dt = sorted_dt[int(0.99 * (len(sorted_dt) - 1))]
                mean_syscall_us = statistics.mean(send_durations_us)

                print(
                    f"[Sender Stats] Seq: {seq:7d} | Rate: {actual_hz:6.1f} Hz | "
                    f"Interval avg: {mean_dt:5.2f}ms (sd: {stdev_dt:4.2f}ms, p99: {p99_dt:5.2f}ms) | "
                    f"UDP sendto(): {mean_syscall_us:5.1f} us"
                )
                frame_intervals_ms.clear()
                send_durations_us.clear()
                stat_start = t1

            # High-precision spin-assisted sleep for 120Hz (8.333ms) pacing on Windows
            next_deadline += period_s
            remaining = next_deadline - time.perf_counter()
            if remaining > 0.002:
                time.sleep(remaining - 0.0015)
            while time.perf_counter() < next_deadline:
                pass

    except KeyboardInterrupt:
        print("\n[Fake-Phone Sender] Stopped.")
    finally:
        sock.close()


if __name__ == "__main__":
    main()
