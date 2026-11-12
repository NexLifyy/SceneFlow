import sys
import traceback

print("Step 1: import ctranslate2")
import ctranslate2

print("Step 2: ctranslate2.models.Whisper with default computation")
try:
    whisper_model = ctranslate2.models.Whisper(r"d:\Apps\video export\frame-maker\models\base", device="cpu", compute_type="default")
    print("Success with default!")
except Exception as e:
    print("Exception in step 2:")
    traceback.print_exc()

print("Step 2b: ctranslate2.models.Whisper with float32")
try:
    whisper_model = ctranslate2.models.Whisper(r"d:\Apps\video export\frame-maker\models\base", device="cpu", compute_type="float32")
    print("Success with float32!")
except Exception as e:
    print("Exception in step 2b:")
    traceback.print_exc()
