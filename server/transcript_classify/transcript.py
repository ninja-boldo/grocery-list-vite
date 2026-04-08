#!/usr/bin/env python3
# transcript.py – Audio transcription via Groq Whisper.
# Supports .wav, .webm, .mp3, .m4a, .ogg input files.

import sys
import uuid
from pathlib import Path

import ffmpeg
from groq import Groq


# ─── Format conversion ────────────────────────────────────────────────────────

SUPPORTED_FORMATS = {".wav", ".webm", ".mp3", ".m4a", ".ogg"}


def ensure_wav(input_path: str, temp_dir: Path | None = None) -> str:
    """Convert any supported audio format to 16 kHz mono WAV. WAV files pass through."""
    path = Path(input_path)

    if path.suffix.lower() == ".wav":
        return str(path)

    if path.suffix.lower() not in SUPPORTED_FORMATS:
        raise ValueError(
            f"Unsupported format '{path.suffix}'. Supported: {', '.join(sorted(SUPPORTED_FORMATS))}"
        )

    out_dir = temp_dir or (Path(__file__).parent / "uploads")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{uuid.uuid4()}.wav"

    (
        ffmpeg.input(str(path))
        .output(str(out_path), format="wav", acodec="pcm_s16le", ac=1, ar=16000)
        .overwrite_output()
        .run(capture_stdout=True, capture_stderr=True)
    )
    return str(out_path)


# ─── Transcription ────────────────────────────────────────────────────────────


def transcribe(file_path: str, language: str = "de") -> str:
    """Transcribe an audio file using Groq Whisper (cloud)."""
    wav_path = ensure_wav(file_path)
    client = Groq()

    with open(wav_path, "rb") as f:
        result = client.audio.transcriptions.create(
            file=(wav_path, f.read()),
            model="whisper-large-v3-turbo",
            temperature=0,
            response_format="verbose_json",
        )
    return result.text


# ─── CLI ──────────────────────────────────────────────────────────────────────


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(
            f"Usage: python transcript.py /path/to/audio[{'/'.join(sorted(SUPPORTED_FORMATS))}]"
        )
        return 1

    text = transcribe(argv[1])
    print("\n----- TRANSCRIPTION -----\n")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
