/**
 * Demo Runner - Executes demo scripts with human-like timing
 *
 * Uses PTY (pseudo-terminal) to execute commands with realistic typing simulation.
 */

import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { parseDuration } from '../schema/demo.js';

/**
 * Key code mappings for special keys
 */
const KEY_CODES = {
  'enter': '\r',
  'return': '\r',
  'tab': '\t',
  'escape': '\x1b',
  'esc': '\x1b',
  'backspace': '\x7f',
  'delete': '\x1b[3~',
  'up': '\x1b[A',
  'down': '\x1b[B',
  'right': '\x1b[C',
  'left': '\x1b[D',
  'home': '\x1b[H',
  'end': '\x1b[F',
  'pageup': '\x1b[5~',
  'pagedown': '\x1b[6~',
  'ctrl+c': '\x03',
  'ctrl+d': '\x04',
  'ctrl+z': '\x1a',
  'ctrl+l': '\x0c',
  'ctrl+a': '\x01',
  'ctrl+e': '\x05',
  'ctrl+k': '\x0b',
  'ctrl+u': '\x15',
  'ctrl+w': '\x17',
  'ctrl+r': '\x12',
};

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get a random number within a range
 */
function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Demo Runner class
 */
export class DemoRunner extends EventEmitter {
  constructor(script, options = {}) {
    super();

    this.script = script;
    this.config = script.config;
    this.options = {
      outputDir: options.outputDir || './recordings',
      dryRun: options.dryRun || false,
      verbose: options.verbose || false,
      ...options,
    };

    this.ptyProcess = null;
    this.outputBuffer = '';
    this.timeline = {
      started_at: null,
      steps: [],
    };
    this.startTime = null;
    this.running = false;
    this.currentStep = null;
  }

  /**
   * Get current elapsed time in milliseconds
   */
  elapsed() {
    if (!this.startTime) return 0;
    return Date.now() - this.startTime;
  }

  /**
   * Log a message if verbose mode is enabled
   */
  log(message, ...args) {
    if (this.options.verbose) {
      console.log(`[DemoRunner] ${message}`, ...args);
    }
  }

  /**
   * Start the PTY process
   */
  startPty() {
    if (this.options.dryRun) {
      this.log('Dry run mode - not starting PTY');
      return;
    }

    const shell = this.config.shell || process.env.SHELL || '/bin/bash';

    this.ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: process.cwd(),
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
    });

    this.ptyProcess.onData((data) => {
      this.outputBuffer += data;
      this.emit('output', data);
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this.emit('pty-exit', { exitCode, signal });
    });

    this.log(`Started PTY with shell: ${shell}`);
  }

  /**
   * Stop the PTY process
   */
  stopPty() {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
      this.log('Stopped PTY');
    }
  }

  /**
   * Type text with human-like timing
   */
  async typeText(text) {
    if (this.options.dryRun) {
      this.log(`Would type: "${text}"`);
      const estimatedTime = text.length * (this.config.typing_speed + this.config.typing_variance / 2);
      await sleep(100); // Brief pause in dry run
      return;
    }

    for (const char of text) {
      // Calculate delay with variance
      const baseDelay = this.config.typing_speed;
      const variance = this.config.typing_variance;
      const delay = randomInRange(baseDelay - variance, baseDelay + variance);

      // Add extra pause for certain characters (like thinking)
      let extraPause = 0;
      if (char === ' ') {
        extraPause = randomInRange(0, 50);
      } else if (char === '.' || char === ',') {
        extraPause = randomInRange(50, 150);
      }

      // Write the character
      this.ptyProcess.write(char);

      // Wait before next character
      await sleep(Math.max(10, delay + extraPause));
    }
  }

  /**
   * Send a keypress to the PTY
   */
  async sendKey(key) {
    const keyLower = key.toLowerCase().trim();
    const keyCode = KEY_CODES[keyLower];

    if (this.options.dryRun) {
      this.log(`Would send key: ${key}`);
      return;
    }

    if (keyCode) {
      this.ptyProcess.write(keyCode);
    } else if (key.length === 1) {
      this.ptyProcess.write(key);
    } else {
      throw new Error(`Unknown key: ${key}`);
    }
  }

  /**
   * Clear the terminal
   */
  async clearTerminal() {
    if (this.options.dryRun) {
      this.log('Would clear terminal');
      return;
    }

    this.ptyProcess.write('\x1b[2J\x1b[H'); // Clear screen and move cursor to top
    this.outputBuffer = '';
  }

  /**
   * Wait for a condition in the output
   */
  async waitFor(condition, timeout = 30000) {
    if (this.options.dryRun) {
      this.log(`Would wait for: ${condition}`);
      return true;
    }

    const startWait = Date.now();

    // Parse the condition
    const containsMatch = condition.match(/output_contains\s*\(\s*["'](.+?)["']\s*\)/);
    const exitCodeMatch = condition.match(/exit_code\s*\(\s*(\d+)\s*\)/);
    const fileExistsMatch = condition.match(/file_exists\s*\(\s*["'](.+?)["']\s*\)/);

    while (Date.now() - startWait < timeout) {
      if (containsMatch) {
        const searchText = containsMatch[1];
        if (this.outputBuffer.includes(searchText)) {
          this.log(`Found "${searchText}" in output`);
          return true;
        }
      } else if (exitCodeMatch) {
        // For exit code, we need to wait for the command to complete
        // This is a simplification - in reality we'd need more sophisticated tracking
        // For now, we wait for the shell prompt to reappear
        if (this.outputBuffer.match(/[$#>]\s*$/)) {
          return true;
        }
      } else if (fileExistsMatch) {
        const fs = await import('fs/promises');
        try {
          await fs.access(fileExistsMatch[1]);
          return true;
        } catch {
          // File doesn't exist yet
        }
      }

      await sleep(100);
    }

    throw new Error(`Timeout waiting for: ${condition}`);
  }

  /**
   * Execute a single step
   */
  async executeStep(step, index) {
    this.currentStep = step;
    const stepStart = this.elapsed();

    this.emit('step-start', {
      step,
      index,
      timestamp: stepStart,
    });

    this.log(`Executing step ${index} (${step.id}): ${step.type}`);

    // Record step in timeline
    const timelineStep = {
      id: step.id,
      type: step.type,
      started_at: stepStart,
      marker: step.marker,
      prompt: step.prompt || null,
      prompt_after: step.prompt_after || null,
      edit_hint: step.edit_hint || null,
    };

    try {
      switch (step.type) {
        case 'pause':
          await sleep(step.duration_ms);
          break;

        case 'command':
          // Clear output buffer before command
          this.outputBuffer = '';

          // Type the command
          await this.typeText(step.text);

          // Press enter
          await this.sendKey('enter');

          // Wait for completion if specified
          if (step.wait_for) {
            await this.waitFor(step.wait_for, step.timeout_ms);
          } else {
            // Default: wait for the command to complete (shell prompt returns)
            await sleep(this.config.post_command_pause);
          }

          // Post-output pause for readability
          if (step.post_output_pause !== false) {
            await sleep(this.config.post_output_pause);
          }
          break;

        case 'type':
          await this.typeText(step.text);
          break;

        case 'keypress':
          await this.sendKey(step.key);
          if (step.pause_after) {
            await sleep(parseDuration(step.pause_after));
          } else {
            await sleep(200); // Brief pause after keypress
          }
          break;

        case 'wait':
          await this.waitFor(step.wait_for, step.timeout_ms);
          break;

        case 'clear':
          await this.clearTerminal();
          await sleep(500);
          break;
      }

      timelineStep.ended_at = this.elapsed();
      timelineStep.success = true;

    } catch (error) {
      timelineStep.ended_at = this.elapsed();
      timelineStep.success = false;
      timelineStep.error = error.message;
      throw error;
    }

    this.timeline.steps.push(timelineStep);

    this.emit('step-end', {
      step,
      index,
      timestamp: timelineStep.ended_at,
      duration: timelineStep.ended_at - stepStart,
      success: timelineStep.success,
    });

    this.currentStep = null;
  }

  /**
   * Run the complete demo script
   */
  async run() {
    if (this.running) {
      throw new Error('Demo is already running');
    }

    this.running = true;
    this.startTime = Date.now();
    this.timeline.started_at = new Date().toISOString();
    this.timeline.steps = [];

    this.emit('start', {
      script: this.script,
      timestamp: 0,
    });

    try {
      // Start PTY
      this.startPty();

      // Wait for shell to be ready
      if (!this.options.dryRun) {
        await sleep(500);
      }

      // Execute each step
      for (let i = 0; i < this.script.steps.length; i++) {
        const step = this.script.steps[i];
        await this.executeStep(step, i);
      }

      this.emit('complete', {
        timeline: this.timeline,
        duration: this.elapsed(),
      });

    } catch (error) {
      this.emit('error', {
        error,
        step: this.currentStep,
        timestamp: this.elapsed(),
      });
      throw error;

    } finally {
      this.stopPty();
      this.running = false;
    }

    return this.timeline;
  }

  /**
   * Abort the running demo
   */
  abort() {
    if (!this.running) return;

    this.emit('abort', {
      timestamp: this.elapsed(),
      step: this.currentStep,
    });

    this.stopPty();
    this.running = false;
  }

  /**
   * Get the current timeline (even while running)
   */
  getTimeline() {
    return { ...this.timeline };
  }

  /**
   * Get markers from the timeline
   */
  getMarkers() {
    return this.timeline.steps
      .filter(step => step.prompt || step.prompt_after)
      .map(step => ({
        id: step.id,
        marker: step.marker,
        prompt: step.prompt,
        prompt_after: step.prompt_after,
        started_at: step.started_at,
        ended_at: step.ended_at,
      }));
  }
}

export default DemoRunner;
