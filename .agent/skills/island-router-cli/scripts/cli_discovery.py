#!/usr/bin/env python3
"""
cli_discovery.py — Exhaustively discover all Island Router CLI commands
by programmatically walking the `?` help system in both EXEC and CONFIG modes.

Smartly detects repeating enum patterns (like day-of-week selectors) and
stops recursing once the pattern is identified.

Usage:
    export ROUTER_PASS='your-router-password'
    python3 scripts/cli_discovery.py

Output:
    scripts/cli_discovery_results.json
"""

import os
import re
import json
import time
import sys
from typing import Dict, List, Any, Set, Optional, Tuple
import paramiko

# ─── Config ───────────────────────────────────────────────────────────────────
ROUTER_HOST = os.environ.get("ROUTER_IP") or os.environ.get("ROUTER_HOST") or "192.168.2.1"
ROUTER_PASS = os.environ.get("ROUTER_PASS")
ROUTER_USER = os.environ.get("ROUTER_USER", "admin")
ROUTER_PORT = int(os.environ.get("ROUTER_PORT", "22"))

PROMPT_SUFFIXES = ("#", ">", "$ ")
PAGER_PROMPTS = ("(press RETURN)", "--More--", "--- more ---", "Press any key")

# Maximum recursion depth
MAX_DEPTH = 4

# Commands that are dangerous to recurse into
SKIP_COMMANDS = {
    "exit", "end", "logout", "quit", "reload", "reboot",
    "write", "erase", "format", "delete", "copy", "restore",
    "upgrade", "downgrade", "halt", "shutdown",
}

# Commands to record but not recurse deeper
LEAF_COMMANDS = {
    "ping", "traceroute", "telnet", "ssh",
}

# Tokens to ignore from help output
IGNORE_TOKENS = {"?", "<cr>", "|"}


def connect(host=ROUTER_HOST, port=ROUTER_PORT, username=ROUTER_USER,
            password=ROUTER_PASS, timeout=30, max_retries=5):
    """Open SSH interactive shell to the router with retry/backoff."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    for attempt in range(1, max_retries + 1):
        try:
            print(f"  Connection attempt {attempt}/{max_retries}...")
            client.connect(hostname=host, port=port, username=username,
                           password=password, look_for_keys=False,
                           allow_agent=False, timeout=timeout,
                           banner_timeout=30)
            shell = client.invoke_shell(width=220, height=50)
            time.sleep(2.0)
            drain(shell)
            return client, shell
        except (paramiko.SSHException, EOFError, OSError) as e:
            if attempt == max_retries:
                raise
            wait = min(10 * attempt, 60)
            print(f"  ⚠ Attempt {attempt} failed ({e}), retrying in {wait}s...")
            time.sleep(wait)


def drain(shell, timeout=0.5):
    """Read all pending data from the shell."""
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


def send_cmd(shell, cmd, wait=1.5):
    """Send a command and read back its full output."""
    shell.send(cmd + "\n")
    time.sleep(wait)

    output = ""
    for _ in range(20):
        chunk = drain(shell)
        output += chunk
        if any(p.lower() in chunk.lower() for p in PAGER_PROMPTS):
            shell.send(" ")
            time.sleep(0.8)
        else:
            break
    return output


def send_help(shell, prefix=""):
    """Send '<prefix> ?' and parse the help output."""
    query = f"{prefix} ?" if prefix else "?"
    raw = send_cmd(shell, query, wait=1.5)

    entries = []
    seen = set()
    for line in raw.splitlines():
        m = re.match(r"^\s{2,}(\S+)\s{2,}(.+)$", line)
        if m:
            cmd, desc = m.group(1).strip(), m.group(2).strip()
            if cmd.lower() in IGNORE_TOKENS or cmd == "?" or cmd.startswith("?"):
                continue
            if cmd.lower() in seen:
                continue
            seen.add(cmd.lower())
            entries.append({"name": cmd, "desc": desc})
    return entries


def get_child_names(entries):
    """Extract just the command names as a frozenset for pattern detection."""
    return frozenset(e["name"].lower() for e in entries)


def crawl(shell, path=None, depth=0, visited=None, parent_child_sig=None):
    """
    Recursively explore commands from the current prefix.
    
    Detects repeating patterns: if a child's subcommands have the same
    signature as the parent, mark it as a repeating enum and stop.
    """
    if path is None:
        path = []
    if visited is None:
        visited = set()

    prefix = " ".join(path)
    key = prefix.lower().strip()
    if key in visited:
        return {}
    visited.add(key)

    if depth > MAX_DEPTH:
        return {}

    indent = "  " * depth
    label = prefix if prefix else "(root)"
    print(f"{indent}→ {label}")

    entries = send_help(shell, prefix)
    this_sig = get_child_names(entries)

    # If this node's children match the parent's children signature,
    # it's a repeating enum (like day-of-week selectors). Stop here.
    if parent_child_sig is not None and this_sig == parent_child_sig and depth > 1:
        print(f"{indent}  [repeating enum detected — pruning]")
        node = {}
        for entry in entries:
            node[entry["name"]] = {"desc": entry["desc"], "args": {}, "_repeating": True}
        return node

    node = {}
    for entry in entries:
        name = entry["name"]
        desc = entry["desc"]

        if name.lower() in SKIP_COMMANDS:
            node[name] = {"desc": desc, "args": {}, "_skipped": "dangerous"}
            continue

        if name.lower() in LEAF_COMMANDS:
            node[name] = {"desc": desc, "args": {}, "_leaf": True}
            continue

        if name.startswith("<") or name.startswith("["):
            node[name] = {"desc": desc, "args": {}}
            continue

        child_path = path + [name]
        child_key = " ".join(child_path).lower()

        if child_key not in visited:
            children = crawl(shell, child_path, depth + 1, visited,
                             parent_child_sig=this_sig)
            node[name] = {"desc": desc, "args": children}
        else:
            node[name] = {"desc": desc, "args": {}}

    return node


def count_cmds(tree):
    """Recursively count all commands in the tree."""
    n = 0
    for v in tree.values():
        n += 1
        if isinstance(v, dict) and "args" in v:
            n += count_cmds(v["args"])
    return n


def flatten_tree(tree, prefix=""):
    """Flatten the tree into a list of (full_command, description) tuples."""
    results = []
    for name, info in sorted(tree.items()):
        full = f"{prefix} {name}".strip() if prefix else name
        desc = info.get("desc", "")
        results.append((full, desc))
        if "args" in info and info["args"]:
            results.extend(flatten_tree(info["args"], full))
    return results


def main():
    if not ROUTER_PASS:
        print("ERROR: ROUTER_PASS not set in environment.")
        sys.exit(1)

    print(f"Connecting to {ROUTER_HOST}:{ROUTER_PORT} as {ROUTER_USER}...")
    client, shell = connect()
    print("✓ Connected\n")

    try:
        send_cmd(shell, "terminal length 0", wait=1.0)

        # ── EXEC mode ─────────────────────────────────────────────────
        print("=" * 60)
        print("  EXEC Mode Command Discovery")
        print("=" * 60)
        exec_tree = crawl(shell)

        # ── CONFIG mode ───────────────────────────────────────────────
        print("\n" + "=" * 60)
        print("  Entering CONFIG mode...")
        print("=" * 60)
        send_cmd(shell, "configure terminal", wait=1.5)

        # Reset visited so config mode commands can overlap
        print("\n" + "=" * 60)
        print("  CONFIG Mode Command Discovery")
        print("=" * 60)
        config_tree = crawl(shell)

        send_cmd(shell, "end", wait=1.0)

        # ── Save results ──────────────────────────────────────────────
        results = {
            "router_host": ROUTER_HOST,
            "discovered_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "exec_mode": exec_tree,
            "config_mode": config_tree,
        }

        outfile = os.path.join(os.path.dirname(__file__), "cli_discovery_results.json")
        with open(outfile, "w") as f:
            json.dump(results, f, indent=2)

        print(f"\n✓ Discovery complete — saved to {outfile}")
        print(f"  EXEC commands:   {count_cmds(exec_tree)}")
        print(f"  CONFIG commands: {count_cmds(config_tree)}")

        # Also output flat list for quick reference
        flat_exec = flatten_tree(exec_tree)
        flat_config = flatten_tree(config_tree)
        flat_file = os.path.join(os.path.dirname(__file__), "cli_commands_flat.txt")
        with open(flat_file, "w") as f:
            f.write("=== EXEC MODE COMMANDS ===\n\n")
            for cmd, desc in flat_exec:
                f.write(f"  {cmd:<50s} {desc}\n")
            f.write(f"\n=== CONFIG MODE COMMANDS ===\n\n")
            for cmd, desc in flat_config:
                f.write(f"  {cmd:<50s} {desc}\n")
        print(f"  Flat reference:  {flat_file}")

    finally:
        try:
            client.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
