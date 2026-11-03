"""Run the packs on a local Bedrock Dedicated Server (in .bds/, git-ignored) and report what the server says.

    python tools/convert.py --dev          # packs with the test scripts
    python tools/bds.py run                # fresh test world, load, run every test, stop
    python tools/bds.py run --keep         # keep the world from the last run
    python tools/bds.py run --cmd "scriptevent nookworks:test sifter"   # commands after start (default: all tests)

Prints content-log errors (bad JSON, unknown components, script errors) and the test lines."""
import json, os, re, shutil, subprocess, sys, threading, time
from paths import ROOT, BP, RP
from convert import stable_uuid, VERSION

BDS = ROOT / ".bds"
LEVEL = "nwtest"

def install_packs(keep):
    for kind, src in (("behavior", BP), ("resource", RP)):
        dst = BDS / f"development_{kind}_packs" / src.name
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
    world = BDS / "worlds" / LEVEL
    if world.exists() and not keep:
        shutil.rmtree(world)
    world.mkdir(parents=True, exist_ok=True)
    (world / "world_behavior_packs.json").write_text(json.dumps([{"pack_id": stable_uuid("bp"), "version": VERSION}]))
    (world / "world_resource_packs.json").write_text(json.dumps([{"pack_id": stable_uuid("rp"), "version": VERSION}]))
    props = (BDS / "server.properties").read_text(encoding="utf8")
    def setp(k, v):
        nonlocal props
        if re.search(rf"^{k}=", props, re.M):
            props = re.sub(rf"^{k}=.*$", f"{k}={v}", props, flags=re.M)
        else:
            props += f"\n{k}={v}\n"
    setp("level-name", LEVEL)
    setp("level-type", "FLAT")
    setp("gamemode", "creative")
    setp("online-mode", "false")
    setp("content-log-file-enabled", "true")
    setp("content-log-console-output-enabled", "true")
    setp("server-port", "19232")
    setp("server-portv6", "19233")
    setp("allow-cheats", "true")
    setp("allow-list", "false")
    (BDS / "server.properties").write_text(props, encoding="utf8")
    cfg = BDS / "config/default/permissions.json"
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text(json.dumps({"allowed_modules": ["@minecraft/server-gametest", "@minecraft/server",
                                                   "@minecraft/server-ui", "@minecraft/server-admin",
                                                   "@minecraft/server-net"]}))

def run(cmds, keep=False, timeout=600):
    install_packs(keep)
    exe = BDS / "bedrock_server.exe"
    p = subprocess.Popen([str(exe)], cwd=BDS, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, encoding="utf8", errors="replace", bufsize=1)
    lines = []
    started = threading.Event()
    done = threading.Event()
    def reader():
        for line in p.stdout:
            line = line.rstrip()
            lines.append(line)
            if "Server started" in line:
                started.set()
            if "[nookworks-test] DONE" in line:
                done.set()
            if re.search(r"ERROR|WARN|error|nookworks|Exception|failed", line) and "Opening level" not in line:
                print(line, flush=True)
    t = threading.Thread(target=reader, daemon=True)
    t.start()
    if not started.wait(180):
        print("server did not start")
    else:
        time.sleep(3)
        for c in cmds:
            p.stdin.write(c + "\n"); p.stdin.flush()
            time.sleep(1)
        if any("nookworks:test" in c for c in cmds):
            done.wait(timeout)
        else:
            time.sleep(10)
    try:
        p.stdin.write("stop\n"); p.stdin.flush()
        p.wait(30)
    except Exception:
        p.kill()
    (ROOT / ".cache").mkdir(exist_ok=True)
    (ROOT / ".cache/bds_last.log").write_text("\n".join(lines), encoding="utf8")
    fails = [l for l in lines if "[nookworks-test] FAIL" in l]
    passes = [l for l in lines if "[nookworks-test] PASS" in l]
    print(f"\n{len(passes)} passed, {len(fails)} failed (full log .cache/bds_last.log)")
    return not fails

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] != "run":
        print(__doc__); sys.exit(1)
    cmds = [a for i, a in enumerate(args) if i > 0 and args[i - 1] == "--cmd"] or ["scriptevent nookworks:test all"]
    ok = run(cmds, keep="--keep" in args)
    sys.exit(0 if ok else 1)
