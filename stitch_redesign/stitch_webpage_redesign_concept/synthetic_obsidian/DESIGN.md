---
name: Synthetic Obsidian
colors:
  surface: '#12131b'
  surface-dim: '#12131b'
  surface-bright: '#383842'
  surface-container-lowest: '#0d0e16'
  surface-container-low: '#1a1b23'
  surface-container: '#1e1f28'
  surface-container-high: '#292932'
  surface-container-highest: '#33343d'
  on-surface: '#e3e1ed'
  on-surface-variant: '#c7c4d7'
  inverse-surface: '#e3e1ed'
  inverse-on-surface: '#2f3039'
  outline: '#908fa0'
  outline-variant: '#464554'
  surface-tint: '#c0c1ff'
  primary: '#c0c1ff'
  on-primary: '#1000a9'
  primary-container: '#8083ff'
  on-primary-container: '#0d0096'
  inverse-primary: '#494bd6'
  secondary: '#d0bcff'
  on-secondary: '#3c0091'
  secondary-container: '#571bc1'
  on-secondary-container: '#c4abff'
  tertiary: '#4cd7f6'
  on-tertiary: '#003640'
  tertiary-container: '#009eb9'
  on-tertiary-container: '#002f38'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#e9ddff'
  secondary-fixed-dim: '#d0bcff'
  on-secondary-fixed: '#23005c'
  on-secondary-fixed-variant: '#5516be'
  tertiary-fixed: '#acedff'
  tertiary-fixed-dim: '#4cd7f6'
  on-tertiary-fixed: '#001f26'
  on-tertiary-fixed-variant: '#004e5c'
  background: '#12131b'
  on-background: '#e3e1ed'
  surface-variant: '#33343d'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-md:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.03em
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.01em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-dense: 0.5rem
  margin: 1.5rem
  margin-compact: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system establishes an ultra-refined, high-productivity creative workspace tailored for automated AI video pipelines, generative sequencing, and precision audio-visual rendering. It marries technical density with cinematic elegance.

### Audience & Mood
Engineered for technical video creators, AI storytellers, prompt engineers, and visual automation professionals. The interface exudes absolute control, computational power, and low eye-fatigue ergonomics during extended dark-room editing sessions. The atmosphere is nocturnal, focused, and electrified by luminescent micro-feedback.

### Design Movement & Aesthetic
- **Cyber-Tactile Glassmorphism & Tonal Layering**: Deep navy-tinted charcoal backgrounds paired with translucent obsidian card plates.
- **Precision Dark UI**: Strict boundary architecture using 1px stroke definitions, discrete surface elevations, and focused luminance hierarchy rather than excessive diffuse drop shadows.
- **Electric Accent Signals**: Laser-focused indigo, violet, and telemetry accents (cyan, emerald, amber, rose) providing immediate state clarity without visual pollution.

## Colors

The palette relies on deliberate contrast steps across deep blue-black surfaces, accented by high-energy optical wavelengths for active and rendering states.

### Surface System
- **Canvas Base (`#0b0c14`)**: Deepest void obsidian base.
- **Surface Level 1 (`#131524`)**: Primary module containers, panels, and asset trays.
- **Surface Level 2 (`#181b30`)**: Elevated controls, drop areas, nested card blocks, track headers.
- **Surface Level 3 / Input (`#0e101d`)**: Recessed troughs, editable inputs, scrub tracks, and code/script views.
- **Border Crisp (`#1c1f36`)**: Baseline structural divider.
- **Border Active / Focus (`#31375d`)**: Hovered or interactive boundary delimiter.

### Accent & Telemetry Scale
- **Primary Indigo (`#6366f1`)**: Primary actions, playback heads, dynamic focus outlines.
- **Secondary Violet (`#8b5cf6`)**: AI generation states, gradient transitions, secondary tags.
- **Telemetry Cyan (`#06b6d4`)**: Image tracks, timeline timestamps, audio waveform spikes.
- **Telemetry Emerald (`#10b981`)**: Video tracks, successful compilation, valid ready-states.
- **Telemetry Amber (`#f59e0b`)**: Warnings, processing latency, gap flags.
- **Telemetry Rose (`#f43f5e`)**: Destructive actions, render errors, clip drop triggers.

## Typography

The type hierarchy creates visual structure across dense editing suites:
- **Plus Jakarta Sans** delivers modern geometric clarity for structural section headers and studio module counters.
- **Inter** provides neutral legibility across high-density configuration dropdowns, labels, and status summaries.
- **JetBrains Mono** delivers fixed-width precision for timestamp metadata, timecode counters `(00:03.12)`, video encoding diagnostics, file paths, and syntax scripting blocks.

## Layout & Spacing

The studio operates on a high-density, modular stack optimized for desktop interfaces.

### Grid & Composition
- **Structural Canvas**: Max-width container (`1440px` to `1800px`) centered or fluidly expanded to ultrawide canvas edges.
- **Vertical Sequencer**: Modular stacked containers (Media, Render Parameters, Captioning & Script, Timeline Sequencer, Export Pipeline) with a strict vertical rhythm governed by `space-lg` (`20px`).
- **Control Matrices**: Internal settings use 2-column or 4-column balanced inline grids utilizing `gutter` (`16px`) and `space-md` gaps.
- **Responsive Flexion**: Sub-containers shift from a 4-column property configuration on widescreen displays (`> 1280px`) to 2-column layouts on compact screens (`< 1024px`).

## Elevation & Depth

Visual hierarchy is maintained via luminescence and tonal separation rather than heavy diffused shadows.

### Elevation Levels
- **Canvas Base (`#0b0c14`)**: Absolute ground level. Flat, absorbs ambient light.
- **Container Level 1 (`#131524`)**: 1px solid `#1c1f36` outline border. Inset shadow: `none`. Subtle ambient depth: `0 4px 20px -2px rgba(0, 0, 0, 0.45)`.
- **Raised Controls & Cards (`#181b30`)**: Outlined by `#242845`. Hover state activates top edge highlight (`border-top: 1px solid rgba(255, 255, 255, 0.08)`).
- **Active / Focused Interactive Elements**: Electric indigo/violet outer edge glow: `0 0 16px -2px rgba(99, 102, 241, 0.35)`.
- **Recessed Wells (Waveforms, Code Panes, Dropzones)**: Background `#0e101d` with `box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5)`.

## Shapes

The interface balances sharp technological precision with tactile softness.
- **Outer System Panels**: `rounded-xl` (`12px` to `16px`) to separate structural workspaces.
- **Interactive Controls (Inputs, Selectors, Buttons)**: `rounded-md` (`8px`) for immediate affordance and click accuracy.
- **Status Pills, Track Chips, Mode Badges**: `rounded-full` (`9999px`) to distinguish categorical tags from interactive form inputs.
- **Drop Troughs & Script Windows**: `rounded-lg` (`10px`).

## Components

### Buttons
- **Primary Action (Render / Generate)**: Gradient fill `linear-gradient(135deg, #6366f1, #8b5cf6)`, crisp white typography (`#ffffff`), `box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4)`. Transitions to high-luminance lift on hover.
- **Secondary / Utility**: Surface `#1a1d33`, border `1px solid #282d4d`, text `#c7d2fe`. On hover: border `#6366f1`, text `#ffffff`.
- **Icon / Ghost**: Transparent fill, text `#94a3b8`, hover text `#ffffff`, background `rgba(255, 255, 255, 0.04)`.

### Form Controls & Select Inputs
- **Select Trigger / Input Box**: Recessed fill `#0e101d`, border `1px solid #1c1f36`, height `38px`, text `#f8fafc`. Label placed above in micro-uppercase (`11px`, tracking `0.05em`, color `#64748b`).
- **Focus State**: Border color `#6366f1` with `0 0 0 1px #6366f1`.

### Preset Chips & Caption Styles
- **Inactive Preset**: Surface `#131524`, border `1px dashed #282d4b`, title in center, subtle caption subtitle.
- **Active Preset**: Border `1px solid #6366f1`, elevated gradient rim, highlight badge or typography glow matching preview aesthetics.

### Timeline & Waveform Tracks
- **Track Lane**: Background `#0f111f`, border `1px solid #1a1d33`, track header with badge indicator (Audio / Voiceover / Video / FX).
- **Waveform Canvas**: Cyan `#06b6d4` telemetry visualization rendered over recessed dark lanes.
- **Clip Blocks**: Rounded `#1e223d` slabs with colored category edge bars (Blue for Image, Green for Video, Purple for Transitions).

### Modular Glass Dropzones
- Dashed border `1.5px dashed #2f3559`, background `rgba(19, 21, 36, 0.5)` with `backdrop-filter: blur(8px)`.
- Animated upload icon hovering above mono-styled naming format guides.