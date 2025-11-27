/**
 * Terminal Recorder - Captures terminal output and renders to video
 *
 * Uses ffmpeg to render terminal frames directly to video.
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

/**
 * Strip ANSI escape codes from text
 */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '')  // OSC sequences
            .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '') // Other sequences
            .replace(/[\x00-\x09\x0b-\x1f]/g, ''); // Control chars except newline
}

/**
 * Terminal frame - represents terminal state at a point in time
 */
class TerminalFrame {
  constructor(timestamp, content, cols = 120, rows = 30) {
    this.timestamp = timestamp;
    this.content = content;
    this.cols = cols;
    this.rows = rows;
  }

  /**
   * Get lines of terminal content, cleaned and padded
   */
  getLines() {
    const clean = stripAnsi(this.content);
    const lines = clean.split('\n').slice(-this.rows);

    // Pad to full height
    while (lines.length < this.rows) {
      lines.push('');
    }

    // Truncate/pad each line to cols width
    return lines.map(line => {
      if (line.length > this.cols) {
        return line.substring(0, this.cols);
      }
      return line.padEnd(this.cols);
    });
  }
}

/**
 * Terminal Recorder class
 */
export class TerminalRecorder {
  constructor(options = {}) {
    this.options = {
      fps: options.fps || 10,
      width: options.width || 1280,
      height: options.height || 720,
      cols: options.cols || 100,
      rows: options.rows || 28,
      fontSize: options.fontSize || 18,
      fontFamily: options.fontFamily || 'monospace',
      bgColor: options.bgColor || '#1e1e1e',
      fgColor: options.fgColor || '#d4d4d4',
      padding: options.padding || 40,
      ...options,
    };

    this.frames = [];
    this.outputBuffer = '';
    this.startTime = null;
    this.recording = false;
  }

  /**
   * Start recording
   */
  start() {
    this.startTime = Date.now();
    this.frames = [];
    this.outputBuffer = '';
    this.recording = true;

    // Capture initial frame
    this.captureFrame();
  }

  /**
   * Add output to the buffer and capture frame
   */
  addOutput(data) {
    if (!this.recording) return;

    this.outputBuffer += data;
    this.captureFrame();
  }

  /**
   * Capture current terminal state as a frame
   */
  captureFrame() {
    if (!this.recording) return;

    const timestamp = Date.now() - this.startTime;
    const frame = new TerminalFrame(
      timestamp,
      this.outputBuffer,
      this.options.cols,
      this.options.rows
    );
    this.frames.push(frame);
  }

  /**
   * Stop recording
   */
  stop() {
    this.recording = false;
    // Capture final frame
    this.captureFrame();
  }

  /**
   * Get duration in milliseconds
   */
  getDuration() {
    if (this.frames.length === 0) return 0;
    return this.frames[this.frames.length - 1].timestamp;
  }

  /**
   * Render frames to video using ffmpeg
   */
  async render(outputPath) {
    if (this.frames.length === 0) {
      throw new Error('No frames to render');
    }

    const duration = this.getDuration();
    const { width, height, fps, bgColor, fgColor, fontSize, padding, cols, rows } = this.options;

    // Create temporary directory for frame data
    const tempDir = path.join(path.dirname(outputPath), '.temp-frames');
    await fs.mkdir(tempDir, { recursive: true });

    try {
      // Write frame data as text files
      const frameFiles = [];
      for (let i = 0; i < this.frames.length; i++) {
        const frame = this.frames[i];
        const lines = frame.getLines();
        const frameFile = path.join(tempDir, `frame-${i.toString().padStart(6, '0')}.txt`);
        await fs.writeFile(frameFile, lines.join('\n'));
        frameFiles.push({
          file: frameFile,
          timestamp: frame.timestamp,
          lines,
        });
      }

      // Create a concat file for ffmpeg with frame durations
      const concatFile = path.join(tempDir, 'concat.txt');
      let concatContent = '';

      for (let i = 0; i < frameFiles.length; i++) {
        const frame = frameFiles[i];
        const nextFrame = frameFiles[i + 1];
        const frameDuration = nextFrame
          ? (nextFrame.timestamp - frame.timestamp) / 1000
          : 0.5; // Last frame shows for 0.5s

        // Create a simple image for this frame using ffmpeg
        const frameImg = path.join(tempDir, `frame-${i.toString().padStart(6, '0')}.png`);

        // Build drawtext filter for each line
        const lineHeight = fontSize * 1.4;
        const startY = padding;

        let drawTextFilters = [];
        const lines = frame.lines;

        for (let j = 0; j < Math.min(lines.length, rows); j++) {
          const line = lines[j];
          if (line.trim()) {
            // Escape special characters for ffmpeg
            const escapedLine = line
              .replace(/\\/g, '\\\\')
              .replace(/'/g, "'\\''")
              .replace(/:/g, '\\:')
              .replace(/%/g, '\\%');

            drawTextFilters.push(
              `drawtext=text='${escapedLine}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf:fontsize=${fontSize}:fontcolor=${fgColor}:x=${padding}:y=${startY + j * lineHeight}`
            );
          }
        }

        const filterComplex = drawTextFilters.length > 0
          ? drawTextFilters.join(',')
          : `drawtext=text=' ':fontsize=${fontSize}:fontcolor=${fgColor}:x=0:y=0`;

        // Generate frame image
        await new Promise((resolve, reject) => {
          const args = [
            '-f', 'lavfi',
            '-i', `color=c=${bgColor.replace('#', '0x')}:s=${width}x${height}:d=1`,
            '-vf', filterComplex,
            '-frames:v', '1',
            '-y',
            frameImg,
          ];

          const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
          let stderr = '';
          proc.stderr.on('data', (data) => { stderr += data; });
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg frame render failed: ${stderr}`));
          });
        });

        concatContent += `file '${frameImg}'\n`;
        concatContent += `duration ${frameDuration}\n`;
      }

      // Add last frame again (ffmpeg concat needs it)
      const lastFrameImg = path.join(tempDir, `frame-${(frameFiles.length - 1).toString().padStart(6, '0')}.png`);
      concatContent += `file '${lastFrameImg}'\n`;

      await fs.writeFile(concatFile, concatContent);

      // Render final video
      await new Promise((resolve, reject) => {
        const args = [
          '-f', 'concat',
          '-safe', '0',
          '-i', concatFile,
          '-vf', `fps=${fps}`,
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-preset', 'fast',
          '-crf', '23',
          '-y',
          outputPath,
        ];

        console.log('Rendering video...');
        const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', (data) => {
          stderr += data;
          // Show progress
          const match = stderr.match(/time=(\d+:\d+:\d+\.\d+)/);
          if (match) {
            process.stdout.write(`\rEncoding: ${match[1]}   `);
          }
        });
        proc.on('close', (code) => {
          console.log('');
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg video render failed: ${stderr.slice(-500)}`));
        });
      });

      console.log(`Video saved to: ${outputPath}`);

    } finally {
      // Cleanup temp directory
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

export default TerminalRecorder;
