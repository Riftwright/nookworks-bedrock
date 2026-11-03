"""Shared paths. The Java checkout is read only."""
from pathlib import Path
import glob, os

ROOT = Path(__file__).resolve().parent.parent
JAVA = ROOT.parent / "mine_mod"
JRES = JAVA / "src/main/resources"
JASSETS = JRES / "assets/nookworks"
JDATA = JRES / "data"
JSRC = JAVA / "src/main/java/dev/nookworks"
CACHE = ROOT / ".cache"
VANILLA_JAVA = CACHE / "java_vanilla"          # vanilla Java models/blockstates/tags (geometry only, never shipped)
BEDROCK_TEX = CACHE / "bedrock_textures.json"  # list of vanilla Bedrock texture paths (names only)
BP = ROOT / "packs/nookworks_bp"
RP = ROOT / "packs/nookworks_rp"
NS = "nookworks"

def java_client_jar():
    cands = glob.glob(os.path.expanduser("~/.gradle/caches/neoformruntime/artifacts/minecraft_26.3_client.jar"))
    return cands[0] if cands else None

def bedrock_install():
    import subprocess
    out = subprocess.run(["powershell", "-NoProfile", "-c",
                          "(Get-AppxPackage Microsoft.MinecraftUWP).InstallLocation"],
                         capture_output=True, text=True).stdout.strip()
    return Path(out) if out else None
