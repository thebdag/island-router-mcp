#!/usr/bin/env python3
"""
island_router.py — Reusable Island Router 2.3.2 CLI client via paramiko.

Usage:
    export ROUTER_PASS='YOUR_ROUTER_PASSWORD'
    python3 island_router.py

Or import as a module:
    from island_router import connect_router, run_command, disconnect
"""

import paramiko
import time
import os
import sys
from typing import Optional

# ─── Connection defaults ──────────────────────────────────────────────────────
ROUTER_HOST = os.environ.get("ROUTER_HOST", "192.168.2.1")
ROUTER_PORT = int(os.environ.get("ROUTER_PORT", "22"))
ROUTER_USER = os.environ.get("ROUTER_USER", "admin")
ROUTER_PASS = os.environ.get("ROUTER_PASS")       # Required — never hardcode

# ─── CLI prompt detection ─────────────────────────────────────────────────────
PROMPT_SUFFIXES = ("#", ">", "$ ")

# Pager prompts the router shows mid-output — we auto-dismiss with a space
PAGER_PROMPTS = ("(press RETURN)", "--More--", "--- more ---", "Press any key")


# ─── Core connection ──────────────────────────────────────────────────────────

def connect_router(
    host: str = ROUTER_HOST,
    port: int = ROUTER_PORT,
    username: str = ROUTER_USER,
    password: Optional[str] = ROUTER_PASS,
    key_file: Optional[str] = None,
    timeout: int = 10,
) -> tuple[paramiko.SSHClient, paramiko.Channel]:
    """
    Establish a persistent interactive shell to the Island Router CLI.

    The Island Router uses a stateful proprietary CLI, so we need
    invoke_shell() — not exec_command() — to maintain session context.

    Returns:
        (client, shell): active SSHClient and interactive channel
    """
    if not password and not key_file:
        raise ValueError(
            "ROUTER_PASS environment variable is not set. "
            "Export it before running: export ROUTER_PASS='yourpassword'"
        )

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    connect_kwargs = dict(
        hostname=host,
        port=port,
        username=username,
        timeout=timeout,
        look_for_keys=key_file is not None,
        allow_agent=False,
    )

    if key_file:
        connect_kwargs["key_filename"] = os.path.expanduser(key_file)
    else:
        connect_kwargs["password"] = password
        connect_kwargs["look_for_keys"] = False

    client.connect(**connect_kwargs)

    # Wide terminal so output isn't line-wrapped mid-token
    shell = client.invoke_shell(width=220, height=50)
    time.sleep(1.5)   # Allow banner/MOTD to arrive
    _drain(shell)     # Discard banner
    return client, shell


def disconnect(client: paramiko.SSHClient) -> None:
    """Cleanly close the SSH connection."""
    try:
        client.close()
    except Exception:
        pass


# ─── I/O helpers ─────────────────────────────────────────────────────────────

def _drain(shell: paramiko.Channel, timeout: float = 0.5) -> str:
    """Read all pending data from the shell buffer."""
    shell.settimeout(timeout)
    buf = b""
    try:
        while True:
            chunk = shell.recv(8192)
            if not chunk:
                break
            buf += chunk
    except Exception:
        pass
    return buf.decode("utf-8", errors="replace")


def run_command(
    shell: paramiko.Channel,
    cmd: str,
    wait: float = 1.5,
    strip_prompt: bool = True,
    max_pages: int = 20,
) -> str:
    """
    Send one command to the router CLI and return its output.

    Automatically dismisses pager prompts ("press RETURN", "--More--")
    so multi-page output is fully captured without interleaving.

    Args:
        shell:       Active paramiko shell channel
        cmd:         CLI command (no trailing newline)
        wait:        Seconds to wait before reading (increase for slow commands)
        strip_prompt: Remove prompt/command-echo lines from output
        max_pages:   Max pager pages to auto-advance (safety limit)

    Returns:
        Command output as a string
    """
    shell.send(cmd + "\n")
    time.sleep(wait)

    all_output = ""
    for _ in range(max_pages):
        chunk = _drain(shell)
        all_output += chunk

        # Check if we're sitting at a pager prompt
        chunk_lower = chunk.lower()
        hit_pager = any(p.lower() in chunk_lower for p in PAGER_PROMPTS)
        if not hit_pager:
            break
        # Dismiss the pager with a space (advances one page)
        shell.send(" ")
        time.sleep(0.8)

    if not strip_prompt:
        return all_output.strip()

    lines = all_output.splitlines()
    filtered = []
    for line in lines:
        stripped = line.strip()
        # Skip echoed command line
        if stripped == cmd.strip():
            continue
        # Skip CLI prompt lines
        if any(stripped.endswith(p) for p in PROMPT_SUFFIXES):
            continue
        # Skip pager prompt lines
        if any(p.lower() in stripped.lower() for p in PAGER_PROMPTS):
            continue
        filtered.append(line)

    return "\n".join(filtered).strip()


def run_commands(
    shell: paramiko.Channel,
    commands: list[tuple[str, float]],
) -> dict[str, str]:
    """
    Run multiple (command, wait) pairs and return a dict of results.

    Args:
        shell: Active paramiko shell channel
        commands: List of (command_string, wait_seconds) tuples

    Returns:
        Dict mapping command string to output
    """
    results = {}
    for cmd, wait in commands:
        print(f"  → {cmd}")
        results[cmd] = run_command(shell, cmd, wait=wait)
    return results


# ─── High-level operations ────────────────────────────────────────────────────

def explore_router(verbose: bool = True) -> dict[str, str]:
    """
    Read-only exploration of router state.
    Safe to run at any time — no config changes.

    Returns:
        Dict with keys like 'version', 'running_cfg', 'interfaces', etc.
    """
    client, shell = connect_router()
    try:
        if verbose:
            print(f"✓ Connected to {ROUTER_HOST} as {ROUTER_USER}")

        safe_commands = [
            ("version",        "show version",            2.0),
            ("hardware",       "show hardware",           2.0),
            ("running_cfg",    "show running-config",     3.0),
            ("startup_cfg",    "show startup-config",     3.0),
            ("interfaces",     "show interface summary",  2.0),
            ("ip_interface",   "show ip interface",       2.0),
            ("ip_routes",      "show ip routes",          2.0),
            ("ip_neighbors",   "show ip neighbors",       2.0),
            ("ip_sockets",     "show ip sockets",         2.0),
            ("dhcp_reserves",  "show ip dhcp-reservations", 2.0),
            ("vpns",           "show vpns",               2.0),
            ("ntp",            "show ntp",                2.0),
            ("clock",          "show clock",              1.5),
            ("log",            "show log",                2.0),
            ("stats",          "show stats",              2.0),
            ("free_space",     "show free-space",         1.5),
            ("packages",       "show packages",           2.0),
            ("users",          "show users",              1.5),
        ]

        results = {}
        for key, cmd, wait in safe_commands:
            if verbose:
                print(f"  Running: {cmd}")
            results[key] = run_command(shell, cmd, wait=wait)

        return results
    finally:
        disconnect(client)


def quick_status() -> dict[str, str]:
    """Fast subset of explore_router for common monitoring use cases."""
    client, shell = connect_router()
    try:
        return {
            "version":    run_command(shell, "show version",           wait=2.0),
            "interfaces": run_command(shell, "show interface summary", wait=2.0),
            "ip_routes":  run_command(shell, "show ip routes",         wait=2.0),
            "vpns":       run_command(shell, "show vpns",              wait=2.0),
            "clock":      run_command(shell, "show clock",             wait=1.5),
            # show log may be paginated — allow up to 5 pages
            "log":        run_command(shell, "show log",               wait=3.0, max_pages=5),
        }
    finally:
        disconnect(client)


def apply_config(
    changes: list[str],
    persist: bool = False,
    dry_run: bool = False,
) -> dict[str, str]:
    """
    Apply configuration changes inside configure terminal.

    ⚠️  Changes are NOT persistent unless persist=True AND user confirms.

    Args:
        changes:  List of CLI config-mode commands
        persist:  If True, prompt user to run 'write memory'
        dry_run:  If True, print commands but don't send them

    Returns:
        Dict with 'outputs' (per-command results) and 'running_config'
    """
    if dry_run:
        print("DRY RUN — commands that would be applied:")
        for cmd in changes:
            print(f"  {cmd}")
        return {}

    client, shell = connect_router()
    try:
        print("Entering configure terminal...")
        run_command(shell, "configure terminal", wait=1.0)

        outputs = {}
        for cmd in changes:
            print(f"  Applying: {cmd}")
            out = run_command(shell, cmd, wait=1.5)
            outputs[cmd] = out
            if out:
                print(f"    → {out}")

        run_command(shell, "end", wait=1.0)
        print("Exited config mode.")

        # Always verify before deciding to persist
        running_cfg = run_command(shell, "show running-config", wait=3.0)

        if persist:
            print("\n--- Current running-config ---")
            print(running_cfg)
            print("\n" + "─" * 60)
            confirm = input(
                "⚠️  Type 'yes' to persist with 'write memory' (anything else cancels): "
            )
            if confirm.strip().lower() == "yes":
                result = run_command(shell, "write memory", wait=3.0)
                print(f"✓ Persisted: {result}")
            else:
                print("✗ Changes NOT persisted — will be lost on reload.")
        else:
            print("\n⚠️  Changes are active but NOT persisted.")
            print("   Review running-config and re-run with persist=True to save.")

        return {"outputs": outputs, "running_config": running_cfg}
    finally:
        disconnect(client)


def backup_config(destination_url: str) -> str:
    """
    Copy running config to an external server via write network.

    URL format: scheme://[user[:pass]@]host[:port]/path
    Supported schemes: scp, sftp, tftp, ftp, http

    Example:
        backup_config("scp://backup@192.168.1.100/backups/router.cfg")
    """
    client, shell = connect_router()
    try:
        cmd = f"write network {destination_url}"
        print(f"Running: {cmd}")
        return run_command(shell, cmd, wait=8.0)
    finally:
        disconnect(client)


def ping_from_router(host: str, count: int = 4) -> str:
    """Send a ping from the router to the given host."""
    client, shell = connect_router()
    try:
        cmd = f"ping {host}"
        return run_command(shell, cmd, wait=max(count * 1.5, 3.0))
    finally:
        disconnect(client)


# ─── CLI entry point ──────────────────────────────────────────────────────────

def _print_section(title: str, content: str) -> None:
    print(f"\n{'═' * 60}")
    print(f"  {title}")
    print(f"{'═' * 60}")
    if content:
        print(content)
    else:
        print("  (no output)")


def main() -> None:
    """Interactive CLI mode: run a quick status check and print results."""
    if not ROUTER_PASS:
        print("ERROR: ROUTER_PASS environment variable is not set.")
        print("  export ROUTER_PASS='yourpassword'")
        sys.exit(1)

    print(f"Island Router CLI — connecting to {ROUTER_HOST}:{ROUTER_PORT}")
    print(f"User: {ROUTER_USER}")
    print()

    try:
        status = quick_status()
        _print_section("Version", status.get("version", ""))
        _print_section("Interfaces", status.get("interfaces", ""))
        _print_section("IP Routes", status.get("ip_routes", ""))
        _print_section("VPNs", status.get("vpns", ""))
        _print_section("Clock", status.get("clock", ""))
        _print_section("Recent Log", status.get("log", "")[:1500] + "…")
        print(f"\n{'═' * 60}")
        print("Done. All commands were read-only — no changes made.")
    except paramiko.AuthenticationException:
        print("ERROR: Authentication failed. Check ROUTER_PASS and username.")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
