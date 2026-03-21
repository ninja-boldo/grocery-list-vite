#!/usr/bin/env python3
import sys
import uuid
from pathlib import Path

# optional: import torch only to check CUDA/MPS availability
try:
    import torch
except Exception:
    torch = None

import ffmpeg
from groq import Groq
        
# -------------------------------
# Device selection
# -------------------------------
def get_device(prefer_gpu=True):
    # prefer_gpu=True will try CUDA then MPS (Apple Silicon) then CPU
    if not prefer_gpu:
        return "cpu"
    if torch is not None:
        if torch.cuda.is_available():
            return "cuda"
        # MPS (Apple Silicon) support
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "cpu"
    return "cpu"



# -------------------------------
# WebM → WAV conversion
# -------------------------------
def webm_to_wav(input_path: str, output_path: str, sample_rate=16000):
    # Use ffmpeg to convert to mono PCM WAV at sample_rate
    # This function raises CalledProcessError on failure
    (
        ffmpeg
        .input(input_path)
        .output(
            output_path,
            format='wav',
            acodec='pcm_s16le',
            ac=1,       # mono
            ar=sample_rate
        )
        .overwrite_output()
        .run(capture_stdout=True, capture_stderr=True)
    )

# -------------------------------
# Ensure WAV file
# -------------------------------
def ensure_wav(input_path: str, temp_dir: Path | None = None) -> str:
    input_path = str(input_path)
    if input_path.lower().endswith(".wav"):
        return input_path
    if input_path.lower().endswith(".webm") or input_path.lower().endswith(".mp3") or input_path.lower().endswith(".m4a") or input_path.lower().endswith(".ogg"):
        if temp_dir is None:
            temp_dir = Path(__file__).parent / "uploads"
        temp_dir.mkdir(parents=True, exist_ok=True)
        output_path = temp_dir / f"{uuid.uuid4()}.wav"
        webm_to_wav(input_path, str(output_path))
        return str(output_path)
    raise Exception("Only .wav, .webm, .mp3, .m4a, and .ogg files are supported at the moment")

# -------------------------------
# Transcription (German by default)
# -------------------------------
def transcribe(file_path: str, language="de", beam_size=1, task="transcribe", cloud=True) -> str:
    print(f"filepath: {file_path} and cloud={cloud}")

    print("using the cloud whisper model")
    client = Groq()

    with open(file_path, "rb") as file:
        transcription = client.audio.transcriptions.create(
        file=(file_path, file.read()),
        model="whisper-large-v3-turbo",
        temperature=0,
        response_format="verbose_json",
        )
    return transcription.text
            
# -------------------------------
# CLI entrypoint
# -------------------------------
def main(argv):
    if len(argv) < 2:
        print("Usage: python transcribe.py /path/to/audio.webm [--model small] [--device auto|cpu|cuda|mps] [--lang de] [--beam 1]")
        return 1

    input_file = argv[1]
    # defaults
    '''model_name = "tiny"
    device_arg = "auto"'''
    lang = "de"
    beam = 1

    # parse simple flags
    '''i = 2
    while i < len(argv):
        a = argv[i]
        if a == "--model" and i+1 < len(argv):
            model_name = argv[i+1]
            i += 2
        elif a == "--device" and i+1 < len(argv):
            device_arg = argv[i+1]
            i += 2
        elif a == "--lang" and i+1 < len(argv):
            lang = argv[i+1]
            i += 2
        elif a == "--beam" and i+1 < len(argv):
            beam = int(argv[i+1])
            i += 2
        else:
            print(f"Unknown/invalid arg: {a}")
            return 2'''


    

    # optional: show detected language if you want to debug auto-detect
    # detected = detect_language(input_file, model)
    # print("Detected language:", detected)

    result = transcribe(input_file, language=lang, beam_size=beam)
    print("\n----- TRANSCRIPTION -----\n")
    print(result)
    return 0

if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
