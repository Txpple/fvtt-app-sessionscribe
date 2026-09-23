#!/usr/bin/env python
"""transcribe.py: the scribe's one Python step, per-track faster-whisper with VAD.

Run as a detached job by fvtt-app-sessionscribe's transcribe-recording tool (src/jobs.ts), with
the transcription venv's interpreter (scripts/setup.ps1 builds it):

  transcribe --session-dir D [--model M] [--device auto|cuda|cpu] [--language en] [--fresh]
  smoke [clip]                verify faster-whisper loads on CUDA (setup.ps1 runs this)

Ported from session_scribe.py (fvtt-mcp-dnd5e), which also fetched and aligned; those are
TypeScript now. What changed here: each track's segments are written the moment the track
finishes (audio/.jobs/transcribe.tracks/), so a crash or a killed run resumes where it stopped
instead of losing the lot, and the job status file (SCRIBE_JOB_STATUS, the src/jobs.ts contract)
says which track is running. transcript-segments.json is assembled at the end, in the shape
build-transcript reads: {model, device, tracks: [{file, speaker, segments: [{start, end, text}]}]}.
"""

import argparse
import datetime as dt
import json
import os
import re
import site
import sys
import time
from pathlib import Path

AUDIO_EXTS = {".flac", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".wav", ".mp3"}
STARTED_AT = dt.datetime.now(dt.timezone.utc)


def iso(t: dt.datetime) -> str:
    return t.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def write_json(path: Path, data, indent=2) -> None:
    """Atomic: a reader never sees half a file."""
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, indent=indent), encoding="utf-8")
    os.replace(tmp, path)


def status(state: str, step: str, progress: str | None = None, **extra) -> None:
    """The job status file, when run as a job (a bare CLI run has none)."""
    target = os.environ.get("SCRIBE_JOB_STATUS")
    if not target:
        return
    body = {"kind": "transcribe", "state": state, "step": step, "pid": os.getpid(),
            "startedAt": iso(STARTED_AT), "updatedAt": iso(dt.datetime.now(dt.timezone.utc))}
    if progress:
        body["progress"] = progress
    body.update(extra)
    write_json(Path(target), body)


def log(line: str) -> None:
    print(f"[{iso(dt.datetime.now(dt.timezone.utc))}] {line}", flush=True)


# --- CUDA DLL bootstrap -------------------------------------------------------

def add_nvidia_dlls() -> list[str]:
    """Register pip-installed NVIDIA DLL dirs. ctranslate2 resolves cuBLAS by bare LoadLibrary
    name, which ignores add_dll_directory, so the dirs must also be on PATH."""
    added = []
    for sp in site.getsitepackages():
        nvidia = Path(sp) / "nvidia"
        if not nvidia.is_dir():
            continue
        for bin_dir in nvidia.glob("*/bin"):
            if hasattr(os, "add_dll_directory"):
                os.add_dll_directory(str(bin_dir))
            added.append(str(bin_dir))
    os.environ["PATH"] = os.pathsep.join(added + [os.environ.get("PATH", "")])
    return added


def load_model(model_name: str, device: str):
    from faster_whisper import WhisperModel

    if device in ("auto", "cuda"):
        try:
            return WhisperModel(model_name, device="cuda", compute_type="float16"), "cuda/float16"
        except Exception as e:
            if device == "cuda":
                raise
            log(f"CUDA unavailable ({e!r}); falling back to CPU int8 (slower)")
    return WhisperModel(model_name, device="cpu", compute_type="int8"), "cpu/int8"


# --- transcription ------------------------------------------------------------

def track_speaker(path: Path, users: list[dict]) -> str:
    """`N-name.flac` → craig-info.json's label for track N, else the file's own name part."""
    m = re.match(r"^(\d+)[-_](.+)$", path.stem)
    if m:
        idx = int(m.group(1))
        for u in users:
            if u.get("track") == idx and u.get("name"):
                return u["name"]
        return m.group(2)
    return path.stem


def cmd_transcribe(args) -> int:
    sdir = Path(args.session_dir)
    tracks_dir = sdir / "audio" / "tracks"
    files = sorted(p for p in tracks_dir.rglob("*") if p.suffix.lower() in AUDIO_EXTS)
    if not files:
        raise SystemExit(f"No audio tracks under {tracks_dir}: run fetch-recording first.")

    meta = {}
    info_path = sdir / "craig-info.json"
    if info_path.exists():
        meta = json.loads(info_path.read_text(encoding="utf-8"))
    users = meta.get("users", [])

    partial = sdir / "audio" / ".jobs" / "transcribe.tracks"
    partial.mkdir(parents=True, exist_ok=True)
    if args.fresh:
        for f in partial.glob("*.json"):
            f.unlink()

    status("running", "loading", f"model {args.model}")
    add_nvidia_dlls()
    log(f"Loading model {args.model} ...")
    model, device = load_model(args.model, args.device)
    log(f"Model on {device}; {len(files)} tracks")

    out_tracks = []
    total_segments = 0
    t_all = time.time()
    for i, path in enumerate(files, 1):
        speaker = track_speaker(path, users)
        done_file = partial / f"{path.stem}.json"
        if done_file.exists():
            track = json.loads(done_file.read_text(encoding="utf-8"))
            if track.get("model") == args.model:
                log(f"  {path.name} [{speaker}]: resumed ({len(track['segments'])} segments)")
                out_tracks.append({"file": path.name, "speaker": speaker, "segments": track["segments"]})
                total_segments += len(track["segments"])
                continue
        status("running", "transcribing", f"track {i}/{len(files)}: {path.name} ({speaker})")
        t0 = time.time()
        segments, seg_info = model.transcribe(str(path), vad_filter=True, language=args.language or None)
        segs = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
                for s in segments if s.text.strip()]
        write_json(done_file, {"model": args.model, "device": device, "segments": segs}, indent=1)
        log(f"  {path.name} [{speaker}]: {len(segs)} segments, "
            f"{seg_info.duration:.0f}s audio in {time.time() - t0:.0f}s")
        out_tracks.append({"file": path.name, "speaker": speaker, "segments": segs})
        total_segments += len(segs)

    target = sdir / "transcript-segments.json"
    write_json(target, {"model": args.model, "device": device, "tracks": out_tracks}, indent=1)
    log(f"Wrote {target}")
    status("done", "done", result={"file": str(target), "tracks": len(out_tracks),
                                   "segments": total_segments, "model": args.model,
                                   "device": device, "seconds": round(time.time() - t_all)})
    return 0


def cmd_smoke(args) -> int:
    dirs = add_nvidia_dlls()
    print(f"NVIDIA DLL dirs: {len(dirs)}")
    model, device = load_model("tiny", "auto")
    print(f"Model loaded on: {device}")
    if args.audio:
        segments, info = model.transcribe(args.audio, vad_filter=True)
        print(f"Audio: {info.duration:.1f}s, language={info.language}")
        for seg in segments:
            print(f"  [{seg.start:6.2f} -> {seg.end:6.2f}] {seg.text}")
    print("SMOKE TEST OK" if device.startswith("cuda") else "SMOKE TEST OK (CPU ONLY)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="transcribe")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("smoke", help="verify the CUDA transcription stack")
    p.add_argument("audio", nargs="?", help="optional test clip to transcribe")
    p.set_defaults(fn=cmd_smoke)

    p = sub.add_parser("transcribe", help="transcribe every track with faster-whisper")
    p.add_argument("--session-dir", required=True)
    p.add_argument("--model", default="large-v3-turbo")
    p.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    p.add_argument("--language", default="en", help="empty string = autodetect")
    p.add_argument("--fresh", action="store_true", help="ignore tracks finished by an earlier run")
    p.set_defaults(fn=cmd_transcribe)

    args = ap.parse_args()
    try:
        return args.fn(args)
    except BaseException as e:  # noqa: BLE001 — every ending must reach the status file
        if isinstance(e, SystemExit) and e.code in (0, None):
            raise
        message = str(e) if not isinstance(e, KeyboardInterrupt) else "interrupted"
        log(f"failed: {message}")
        status("failed", "failed", error=message)
        return 1


if __name__ == "__main__":
    sys.exit(main())
