#!/usr/bin/env python3
import sys
import uuid
from pathlib import Path

# optional: import torch only to check CUDA/MPS availability
try:
    import torch
except Exception:
    torch = None

from faster_whisper import WhisperModel
import ffmpeg

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
# Whisper model initialization
# -------------------------------
def init_whisper(model_name="tiny", device=None):

    whisper_models = [
        "tiny", "tiny.en", "base", "base.en", "small", "small.en",
        "medium", "medium.en", "large", "large-v1", "large-v2",
        "large-v3", "distil-small-v2", "distil-large-v3", "large-v3-turbo"
    ]
    if model_name not in whisper_models:
        raise ValueError(f"Model {model_name} not available. Choose from: {whisper_models}")

    if device is None:
        device = get_device()

    # choose compute_type based on device
    # - GPU: float16 is usually best
    # - MPS: float16 may or may not be supported, fallback to float32
    # - CPU: int8_float32 is fastest for quantized CPU inference
    if device == "cuda":
        compute_type = "float16"
    elif device == "mps":
        # mps precision support varies; float32 is safer
        compute_type = "float32"
    else:
        compute_type = "int8_float32"

    print(f"Loading model {model_name} on {device} ({compute_type})...")
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    return model

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
def transcribe(file_path: str, model: WhisperModel | None, language="de", beam_size=1, task="transcribe") -> str:
    if model is None:
        raise Exception("model parameter cant be none")
    wav_path = ensure_wav(file_path)
    print(f"Running transcription on: {wav_path}")

    # faster-whisper transcribe returns (segments, info)
    segments, info = model.transcribe(
        wav_path,
        beam_size=beam_size,
        language=language,          # force German ("de")
        task=task,                  # "transcribe" (speech->text) or "translate"
        condition_on_previous_text=False
    )

    # join segment texts. Keep the timing info in case you need it (info contains language/confidence)
    text = "".join(segment.text for segment in segments)
    return text

# -------------------------------
# Optional: simple language detect run
# -------------------------------
def detect_language(file_path: str, model: WhisperModel):
    wav_path = ensure_wav(file_path)
    # task="transcribe" with language=None will let model auto-detect; info.language contains detected language
    _, info = model.transcribe(wav_path, language=None, task="transcribe", condition_on_previous_text=False)
    return info.language if hasattr(info, "language") else None

# -------------------------------
# CLI entrypoint
# -------------------------------
def main(argv):
    if len(argv) < 2:
        print("Usage: python transcribe.py /path/to/audio.webm [--model small] [--device auto|cpu|cuda|mps] [--lang de] [--beam 1]")
        return 1

    input_file = argv[1]
    # defaults
    model_name = "tiny"
    device_arg = "auto"
    lang = "de"
    beam = 1

    # parse simple flags
    i = 2
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
            return 2

    # select device
    if device_arg == "auto":
        device = None
    else:
        device = device_arg

    
    model = init_whisper(model_name=model_name, device=device)

    # optional: show detected language if you want to debug auto-detect
    # detected = detect_language(input_file, model)
    # print("Detected language:", detected)

    result = transcribe(input_file, model, language=lang, beam_size=beam)
    print("\n----- TRANSCRIPTION -----\n")
    print(result)
    return 0

if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
