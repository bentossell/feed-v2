# DemoScript

AI-directed video demo system - execute demo scripts with human-like timing and synchronized teleprompter.

## Overview

DemoScript separates concerns for recording developer tool demos:

1. **Agent performs the demo** - no mistakes, reproducible, controllable timing
2. **Agent controls the teleprompter** - synced to demo timeline, tells human when to speak
3. **Human provides narration** - only job is to talk naturally when prompted
4. **Edit is mostly automated** - zooms, cuts, and pacing are pre-planned

## Installation

```bash
cd demoscript
npm install
```

## Quick Start

1. **Validate a demo script:**
   ```bash
   npm run start -- validate examples/hello-world.yaml
   ```

2. **Run a demo (dry run):**
   ```bash
   npm run start -- run examples/hello-world.yaml --dry-run
   ```

3. **Run a demo with teleprompter:**
   ```bash
   npm run start -- run examples/hello-world.yaml --prompter
   ```
   Then open http://localhost:3456 in a browser positioned near your camera.

4. **Start teleprompter standalone:**
   ```bash
   npm run start -- prompter --timeline ./recordings/demo-timeline.json
   ```

## Demo Script Format

Demo scripts are YAML files with the following structure:

```yaml
meta:
  title: "My Demo"
  estimated_duration: 90s

config:
  typing_speed: 80ms      # base ms between keystrokes
  typing_variance: 30ms   # random variance for realism
  post_command_pause: 1s  # pause after each command
  post_output_pause: 2s   # pause after significant output

steps:
  - id: intro
    type: pause
    duration: 2s
    marker: speech
    prompt: "Hey, let me show you something cool."

  - id: run_command
    type: command
    text: "echo 'Hello World'"
    marker: silence
    edit_hint: zoom_region(terminal)
```

### Step Types

| Type       | Description                                     |
|------------|-------------------------------------------------|
| `command`  | Type and execute a shell command                |
| `pause`    | Wait for specified duration                     |
| `type`     | Type text without executing (for inputs, forms) |
| `keypress` | Single key or combo (enter, ctrl+c, etc.)       |
| `wait`     | Wait for condition (output, file exists, etc.)  |
| `clear`    | Clear terminal                                  |

### Markers

| Marker          | Meaning                                        |
|-----------------|------------------------------------------------|
| `speech`        | Human should be talking during this step       |
| `silence`       | Let the screen breathe, no talking             |
| `speech_during` | Talk while action happens (for short commands) |

### Edit Hints

| Hint                | Meaning                                      |
|---------------------|----------------------------------------------|
| `zoom_region(area)` | Zoom into terminal, browser, specific coords |
| `speed(multiplier)` | Speed up this section in edit                |
| `cut_if_long`       | If this takes >Xs, consider cutting          |
| `highlight(region)` | Draw attention to area                       |

## Output Files

When you run a demo, DemoScript produces:

- `demo-timeline.json` - Actual timestamps of everything that happened
- `demo-markers.json` - Speech/silence cues with timestamps
- `demo-edit-hints.json` - Edit suggestions from the script

## CLI Reference

```bash
# Validate a script
demoscript validate <script.yaml> [-v|--verbose]

# Run a demo
demoscript run <script.yaml> [options]
  -o, --output <dir>       Output directory (default: ./recordings)
  -n, --name <name>        Base name for output files (default: demo)
  --dry-run                Print what would happen without executing
  --prompter               Start teleprompter server
  --prompter-port <port>   Teleprompter port (default: 3456)
  -v, --verbose            Show detailed output

# Start teleprompter
demoscript prompter [options]
  -p, --port <port>        Server port (default: 3456)
  -t, --timeline <file>    Load timeline file
  --sync                   Wait for live sync from runner

# Show timeline info
demoscript info <timeline.json>
```

## Teleprompter Controls

- **Space** - Play/Pause
- **R** - Reset to beginning
- **←/→** - Seek ±5 seconds

## Examples

See the `examples/` directory for sample demo scripts:

- `hello-world.yaml` - Simple test demo
- `terminal-basics.yaml` - Basic terminal commands (works anywhere)
- `factory-cli-install.yaml` - Factory CLI installation demo

## Architecture

```
demoscript/
├── src/
│   ├── cli.js           # CLI entrypoint
│   ├── index.js         # Public API
│   ├── runner/          # Demo execution engine
│   │   └── runner.js    # PTY control, typing simulation
│   ├── prompter/        # Teleprompter server
│   │   └── server.js    # HTTP + WebSocket server
│   ├── timeline/        # Timeline/marker handling
│   │   └── timeline.js  # Load/save/query timelines
│   └── schema/          # YAML schema definitions
│       └── demo.js      # Parse and validate scripts
├── static/              # Teleprompter web UI
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── examples/            # Example demo scripts
```

## Roadmap

- [ ] Phase 3: Edit tool integration (ffmpeg wrapper)
- [ ] Phase 4: AI script generation
- [ ] Phase 5: TTS integration

## License

MIT
