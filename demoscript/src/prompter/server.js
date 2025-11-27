/**
 * Teleprompter Server - Web-based teleprompter with WebSocket sync
 */

import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { loadTimeline, getSpeechCues, getCueAtTime, getNextCue } from '../timeline/timeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Serve static files from the static directory
 */
async function serveStatic(req, res) {
  const staticDir = path.join(__dirname, '..', '..', 'static');
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(staticDir, filePath);

  const extMap = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };

  const ext = path.extname(filePath);
  const contentType = extMap[ext] || 'text/plain';

  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    res.writeHead(404);
    res.end('Not found');
  }
}

/**
 * Teleprompter Server class
 */
export class PrompterServer {
  constructor(options = {}) {
    this.options = {
      port: options.port || 3456,
      host: options.host || 'localhost',
      ...options,
    };

    this.server = null;
    this.wss = null;
    this.clients = new Set();

    // State
    this.timeline = null;
    this.cues = [];
    this.currentTime = 0;
    this.isPlaying = false;
    this.playbackInterval = null;
  }

  /**
   * Start the server
   */
  async start() {
    // Create HTTP server
    this.server = http.createServer(async (req, res) => {
      // CORS headers for development
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // API endpoints
      if (req.url === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.getState()));
        return;
      }

      // Static files
      await serveStatic(req, res);
    });

    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);

      // Send current state on connect
      ws.send(JSON.stringify({
        type: 'init',
        ...this.getState(),
      }));

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleMessage(ws, data);
        } catch (err) {
          console.error('Invalid message:', err);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });

    // Start listening
    return new Promise((resolve) => {
      this.server.listen(this.options.port, this.options.host, () => {
        console.log(`Teleprompter running at http://${this.options.host}:${this.options.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop() {
    this.stopPlayback();

    if (this.wss) {
      this.wss.close();
    }

    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(resolve);
      });
    }
  }

  /**
   * Get current state
   */
  getState() {
    const currentCue = this.timeline ? getCueAtTime(this.timeline, this.currentTime) : null;
    const nextCue = this.timeline ? getNextCue(this.timeline, this.currentTime) : null;

    // Find current speech cue
    let currentSpeechCue = null;
    for (const cue of this.cues) {
      if (this.currentTime >= cue.started_at && this.currentTime <= cue.ended_at) {
        currentSpeechCue = cue;
        break;
      }
    }

    // Find next speech cue
    let nextSpeechCue = null;
    for (const cue of this.cues) {
      if (cue.started_at > this.currentTime) {
        nextSpeechCue = cue;
        break;
      }
    }

    return {
      currentTime: this.currentTime,
      isPlaying: this.isPlaying,
      hasTimeline: !!this.timeline,
      totalDuration: this.timeline ? this.timeline.steps[this.timeline.steps.length - 1]?.ended_at || 0 : 0,
      currentCue: currentSpeechCue,
      nextCue: nextSpeechCue,
      progress: currentSpeechCue ? {
        elapsed: this.currentTime - currentSpeechCue.started_at,
        remaining: currentSpeechCue.ended_at - this.currentTime,
        fraction: (this.currentTime - currentSpeechCue.started_at) / (currentSpeechCue.ended_at - currentSpeechCue.started_at),
      } : null,
    };
  }

  /**
   * Broadcast state to all clients
   */
  broadcast(type = 'update') {
    const message = JSON.stringify({
      type,
      ...this.getState(),
    });

    for (const client of this.clients) {
      if (client.readyState === 1) { // OPEN
        client.send(message);
      }
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(ws, data) {
    switch (data.type) {
      case 'play':
        this.startPlayback();
        break;

      case 'pause':
        this.stopPlayback();
        break;

      case 'seek':
        this.seek(data.time);
        break;

      case 'reset':
        this.reset();
        break;

      case 'load':
        if (data.timelinePath) {
          this.loadFromFile(data.timelinePath);
        }
        break;
    }
  }

  /**
   * Load timeline from a file
   */
  async loadFromFile(filePath) {
    try {
      this.timeline = await loadTimeline(filePath);
      this.cues = getSpeechCues(this.timeline);
      this.currentTime = 0;
      this.isPlaying = false;
      this.broadcast('loaded');
      console.log(`Loaded timeline: ${filePath}`);
    } catch (err) {
      console.error('Failed to load timeline:', err);
    }
  }

  /**
   * Load timeline from object (for live sync with runner)
   */
  loadTimeline(timeline) {
    this.timeline = timeline;
    this.cues = getSpeechCues(timeline);
    this.broadcast('loaded');
  }

  /**
   * Update current time (for live sync)
   */
  updateTime(time) {
    this.currentTime = time;
    this.broadcast();
  }

  /**
   * Start playback (for preview mode)
   */
  startPlayback() {
    if (this.isPlaying) return;
    if (!this.timeline) return;

    this.isPlaying = true;
    const startTime = Date.now() - this.currentTime;

    this.playbackInterval = setInterval(() => {
      this.currentTime = Date.now() - startTime;

      const totalDuration = this.timeline.steps[this.timeline.steps.length - 1]?.ended_at || 0;
      if (this.currentTime >= totalDuration) {
        this.stopPlayback();
        this.currentTime = totalDuration;
      }

      this.broadcast();
    }, 50); // Update every 50ms

    this.broadcast('play');
  }

  /**
   * Stop playback
   */
  stopPlayback() {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }

    this.broadcast('pause');
  }

  /**
   * Seek to a specific time
   */
  seek(time) {
    this.currentTime = Math.max(0, time);
    this.broadcast('seek');
  }

  /**
   * Reset to beginning
   */
  reset() {
    this.stopPlayback();
    this.currentTime = 0;
    this.broadcast('reset');
  }

  /**
   * Step-specific events (for live sync with runner)
   */
  onStepStart(step, timestamp) {
    this.currentTime = timestamp;
    this.broadcast('step-start');
  }

  onStepEnd(step, timestamp) {
    this.currentTime = timestamp;
    this.broadcast('step-end');
  }
}

export default PrompterServer;
