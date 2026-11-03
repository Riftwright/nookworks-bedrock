"""Zip the packs into dist/Nookworks.mcaddon (double-click it on Windows to import into Minecraft).
Run tools/convert.py first (without --dev: the tests stay out)."""
import zipfile
from paths import ROOT, BP, RP

def main():
    if (BP / "scripts/test").exists():
        raise SystemExit("packs were built with --dev; run tools/convert.py without it first")
    out = ROOT / "dist/Nookworks.mcaddon"
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for pack in (BP, RP):
            for f in pack.rglob("*"):
                if f.is_file():
                    z.write(f, f"{pack.name}/{f.relative_to(pack).as_posix()}")
    print(out, round(out.stat().st_size / 1e6, 1), "MB")

if __name__ == "__main__":
    main()
