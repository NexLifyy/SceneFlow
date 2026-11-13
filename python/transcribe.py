"""
transcribe.py — faster-whisper transcription helper with word-level timestamps & VAD filtering
"""

import sys
import os
import json
import argparse
import time

def parse_args():
    parser = argparse.ArgumentParser(description="Transcribe voiceover audio using faster-whisper")
    parser.add_argument("--audio", required=True, help="Path to voiceover audio file")
    parser.add_argument("--model", default="base", help="Model name or local model directory path")
    parser.add_argument("--models-dir", default="models", help="Directory where models are stored")
    parser.add_argument("--language", default="auto", help="Language code or 'auto'")
    parser.add_argument("--output", help="Optional path to write output JSON")
    return parser.parse_args()

def main():
    args = parse_args()
    audio_path = os.path.abspath(args.audio)
    
    if not os.path.exists(audio_path):
        print(json.dumps({"type": "error", "message": f"Audio file not found: {audio_path}"}), flush=True)
        sys.exit(1)

    # Resolve model path
    model_name_or_path = args.model
    local_model_dir = os.path.join(os.path.abspath(args.models_dir), args.model)
    if os.path.exists(local_model_dir):
        model_name_or_path = local_model_dir

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({
            "type": "error",
            "message": "faster-whisper is not installed. Please run setup-whisper.bat or 'pip install faster-whisper torch'."
        }), flush=True)
        sys.exit(2)

    # Detect CUDA GPU or CPU
    device = "cpu"
    compute_type = "int8"
    try:
        import torch
        if torch.cuda.is_available():
            device = "cuda"
            compute_type = "float16"
    except Exception:
        pass

    print(json.dumps({
        "type": "info",
        "device": device,
        "compute_type": compute_type,
        "model": model_name_or_path
    }), flush=True)

    try:
        start_time = time.time()
        model = WhisperModel(
            model_name_or_path,
            device=device,
            compute_type=compute_type,
            download_root=os.path.abspath(args.models_dir)
        )
    except Exception as e:
        print(json.dumps({
            "type": "error",
            "message": f"Failed to load AI model '{args.model}': {str(e)}"
        }), flush=True)
        sys.exit(3)

    try:
        lang = None if args.language == "auto" else args.language
        segments, info = model.transcribe(
            audio_path,
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500),
            language=lang
        )

        total_duration = info.duration or 0
        words = []
        raw_segments = []

        print(json.dumps({
            "type": "start",
            "language": info.language,
            "language_probability": info.language_probability,
            "duration": total_duration
        }), flush=True)

        for segment in segments:
            seg_words = []
            if segment.words:
                for w in segment.words:
                    word_obj = {
                        "word": w.word,
                        "start": round(w.start, 3),
                        "end": round(w.end, 3),
                        "probability": round(w.probability, 3)
                    }
                    words.append(word_obj)
                    seg_words.append(word_obj)
            elif segment.text and segment.text.strip():
                raw_words = segment.text.strip().split()
                if raw_words:
                    seg_dur = max(0.1, segment.end - segment.start)
                    dur_per_word = seg_dur / len(raw_words)
                    for idx, rw in enumerate(raw_words):
                        w_start = segment.start + idx * dur_per_word
                        w_end = segment.start + (idx + 1) * dur_per_word
                        word_obj = {
                            "word": rw,
                            "start": round(w_start, 3),
                            "end": round(w_end, 3),
                            "probability": 0.9
                        }
                        words.append(word_obj)
                        seg_words.append(word_obj)

            raw_segments.append({
                "id": segment.id,
                "start": round(segment.start, 3),
                "end": round(segment.end, 3),
                "text": segment.text.strip(),
                "words": seg_words
            })

            # Progress update for long audio
            if total_duration > 0:
                pct = min(100, round((segment.end / total_duration) * 100, 1))
                elapsed = time.time() - start_time
                eta = round((elapsed / max(0.01, segment.end)) * (total_duration - segment.end)) if segment.end > 0 else 0
                print(json.dumps({
                    "type": "progress",
                    "percent": pct,
                    "processedSec": round(segment.end, 1),
                    "totalSec": round(total_duration, 1),
                    "etaSec": max(0, eta)
                }), flush=True)

        result = {
            "type": "done",
            "language": info.language,
            "duration": round(total_duration, 2),
            "words": words,
            "segments": raw_segments,
            "totalWords": len(words)
        }

        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)

        print(json.dumps(result, ensure_ascii=False), flush=True)

    except Exception as e:
        print(json.dumps({
            "type": "error",
            "message": f"Transcription error: {str(e)}"
        }), flush=True)
        sys.exit(4)

if __name__ == "__main__":
    main()
