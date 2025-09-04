import sys
from faster_whisper import WhisperModel


def get_device():
    os = sys.platform
    if os not in ["windows", "linux"]:
        return "cpu" # currently there is no metal support :(
    return "cpu"

def init_whisper(model_name="large-v3"):
    whisper_models = ["tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en", "large", "large-v1", "large-v2", "large-v3", "distil-small-v2", "distil-large-v3"]

    if model_name not in whisper_models:
        raise Exception(f"the searched for model {model_name} isnt one of the available ones:\n{whisper_models}")
    
    model = WhisperModel(model_name, device=get_device(), compute_type="float32")
    return model

def transcribe(file_path, model, batch_size=8):
    segments, info = model.transcribe(file_path, beam_size=batch_size, language="de", task="transcribe", condition_on_previous_text=False)
    
    transcribed_text = ""
    for segment in segments:
        #print("[%.2fs -> %.2fs] %s" % (segment.start, segment.end, segment.text))
        transcribed_text += segment.text
    return transcribed_text