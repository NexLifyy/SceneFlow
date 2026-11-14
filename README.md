# SceneFlow

End-to-end AI video production pipeline: **Voice → Timing → Prompts → Images → Studio**.

## Workflow

1. **Voice** (`/voice`): Generate neural voiceovers with Fish Audio (`s2.1-pro-free` default) and saved Voice IDs.
2. **Timing** (`/timing`): Transcribe voiceovers and split scripts into timed caption blocks (`(m:ss)` and `0_00—0_03.png`).
3. **Prompts** (`/prompts`): Generate styled storyboard image prompts from timestamps using Groq and visual Skills.
4. **Images** (`/images`): Bulk-generate images cleanly from timestamped prompts and load them into Studio.
5. **Studio** (`/studio`): Preview 16:9 canvas, captions, waveforms, timeline clips, and export the final MP4.

## 1-Click Quick Start (Windows)

1. **Install Node.js** (LTS recommended) from [nodejs.org](https://nodejs.org/).
2. **Download SceneFlow**: Click green **Code → Download ZIP** and extract the folder.
3. **Double-click `Start_SceneFlow.cmd`**:
   - Dependencies and FFmpeg are verified and installed automatically on first launch.
   - SceneFlow starts and automatically opens your default browser at **http://localhost:3000**.

## Manual Setup

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

## Requirements

- **Node.js** 18 or later
- No separate FFmpeg install needed — `ffmpeg-static` is bundled.
- GPU encoding (NVIDIA NVENC) used automatically if available; falls back to CPU `libx264`.

## Filename Format

Images are named by their time range on the timeline:

| Filename | Means |
|---|---|
| `0_30—0_33.png` | 0:30 → 0:33 (3 seconds) |
| `1_02—1_05.png` | 1:02 → 1:05 |
| `1_02_30—1_02_33.png` | 1:02:30 → 1:02:33 (hours supported) |
| `cover.png` | No time → placed after timed clips, 3 s each |

**Separators accepted:** em dash `—`, en dash `–`, or regular hyphen `-`.

## Caption Format

Paste timestamped lines into **Prompts** or **Studio**:

```
(0:03) You've been exhausted all day
(0:07) That achiness in your body
(0:12) Switching on like a stadium light
```

Words are spread evenly between timestamps. You can also upload an `.srt` file or send captions directly from **Timing**.

## Project Structure

```
├── server.js                  # Express backend & legacy URL redirects
├── src/
│   ├── parser.js              # Filename → timeline builder
│   ├── renderer.js            # FFmpeg pipeline
│   ├── captions.js            # ASS subtitle generator
│   ├── encoder.js             # GPU/CPU encoder probe
│   ├── timing.js              # Script & timestamp splitting engine
│   ├── prompts_parser.js      # Prompt parser, validator & batcher
│   ├── routes_timing.js       # Timing & Whisper API routes
│   ├── routes_voice.js        # Fish Audio Voice API proxy routes
│   ├── settings.js            # Settings persistence
│   └── history.js             # Export history
├── public/
│   ├── index.html             # SceneFlow SPA (Voice → Timing → Prompts → Images → Studio)
│   ├── css/style.css          # Dark theme stylesheet
│   └── js/
│       ├── app.js             # Main Studio & app bootstrap
│       ├── voice_ui.js        # Voice controller
│       ├── timing_ui.js       # Timing controller & tab router
│       ├── prompts_ui.js      # Prompts & Skills controller
│       └── images_ui.js       # Images controller
├── test/                      # Unit tests
└── data/                      # Runtime settings, history & saved Timing projects
```

## Running Tests

```bash
npm test
```

## Tips

- **200+ images**: The Studio renderer processes clips in batches of 50 to stay fast.
- **Settings**: Click "Save as my settings" in Studio — preferences persist between sessions.
- **History**: Click the History button (or press `H`) to see past exports with open-folder buttons.
