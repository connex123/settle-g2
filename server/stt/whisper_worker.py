# Local speech-to-text worker (faster-whisper, CPU). Reads one JSON line per job: {"wav": path}; writes {"text": ...}.
# Free and private: audio never leaves the server.
import sys, json, os, wave
import numpy as np
from faster_whisper import WhisperModel
model = WhisperModel(os.environ.get("SETTLE_WHISPER_MODEL", "base.en"), device="cpu", compute_type="int8")
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    try:
        job = json.loads(line)
        with wave.open(job["wav"]) as w:
            audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        segs, _ = model.transcribe(audio, language="en", beam_size=1, vad_filter=True,
                                   initial_prompt="pay half, pay two, pay 0.5 TON, decline, later")
        print(json.dumps({"text": " ".join(s.text.strip() for s in segs).strip()}), flush=True)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
