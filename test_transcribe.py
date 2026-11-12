import os
import sys
import traceback

try:
    from faster_whisper import WhisperModel
    base_dir = r"D:\Apps\video export\frame-maker\models\base"
    print(f"Loading model from: {base_dir} (exists={os.path.exists(base_dir)})")
    model = WhisperModel(base_dir, device="cpu", compute_type="int8")
    print("Model loaded successfully! Transcribing uploads/it-s-a-random (1).mp3...")
    audio_file = r"D:\Apps\video export\frame-maker\uploads\it-s-a-random (1).mp3"
    segments, info = model.transcribe(audio_file, beam_size=5, word_timestamps=True, vad_filter=True)
    for seg in segments:
        print(f"[{seg.start:.2f} -> {seg.end:.2f}] {seg.text}")
    print("Transcription Done!")
except Exception as e:
    traceback.print_exc()

