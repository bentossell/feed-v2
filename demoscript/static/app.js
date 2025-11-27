/**
 * DemoScript Teleprompter Client
 */

class Teleprompter {
  constructor() {
    this.ws = null;
    this.state = {
      currentTime: 0,
      isPlaying: false,
      hasTimeline: false,
      totalDuration: 0,
      currentCue: null,
      nextCue: null,
      progress: null,
    };

    this.elements = {
      status: document.getElementById('status'),
      statusText: document.querySelector('.status-text'),
      markerIndicator: document.getElementById('marker-indicator'),
      markerIcon: document.querySelector('.marker-icon'),
      markerLabel: document.querySelector('.marker-label'),
      promptText: document.querySelector('.prompt-text'),
      progressFill: document.getElementById('progress-fill'),
      progressTime: document.getElementById('progress-time'),
      nextText: document.getElementById('next-text'),
      timeDisplay: document.getElementById('time-display'),
      btnPlay: document.getElementById('btn-play'),
      btnPause: document.getElementById('btn-pause'),
      btnReset: document.getElementById('btn-reset'),
      modal: document.getElementById('load-modal'),
      timelinePath: document.getElementById('timeline-path'),
      btnLoad: document.getElementById('btn-load'),
      btnCancel: document.getElementById('btn-cancel'),
    };

    this.init();
  }

  init() {
    this.connect();
    this.bindEvents();
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.setConnectionStatus(true);
    };

    this.ws.onclose = () => {
      this.setConnectionStatus(false);
      // Attempt reconnect after 2 seconds
      setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };
  }

  setConnectionStatus(connected) {
    this.elements.status.classList.toggle('connected', connected);
    this.elements.statusText.textContent = connected ? 'Connected' : 'Disconnected';
  }

  handleMessage(data) {
    // Update state
    this.state = {
      ...this.state,
      currentTime: data.currentTime ?? this.state.currentTime,
      isPlaying: data.isPlaying ?? this.state.isPlaying,
      hasTimeline: data.hasTimeline ?? this.state.hasTimeline,
      totalDuration: data.totalDuration ?? this.state.totalDuration,
      currentCue: data.currentCue ?? null,
      nextCue: data.nextCue ?? null,
      progress: data.progress ?? null,
    };

    this.render();

    // Play audio cue on certain events
    if (data.type === 'step-start' && data.currentCue?.marker === 'speech') {
      this.playBeep();
    }
  }

  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  bindEvents() {
    this.elements.btnPlay.addEventListener('click', () => {
      this.send('play');
    });

    this.elements.btnPause.addEventListener('click', () => {
      this.send('pause');
    });

    this.elements.btnReset.addEventListener('click', () => {
      this.send('reset');
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (this.state.isPlaying) {
            this.send('pause');
          } else {
            this.send('play');
          }
          break;
        case 'r':
          this.send('reset');
          break;
        case 'ArrowLeft':
          this.send('seek', { time: Math.max(0, this.state.currentTime - 5000) });
          break;
        case 'ArrowRight':
          this.send('seek', { time: this.state.currentTime + 5000 });
          break;
      }
    });
  }

  render() {
    const { currentCue, nextCue, progress, currentTime, totalDuration, hasTimeline } = this.state;

    // Update marker indicator
    if (currentCue) {
      const marker = currentCue.marker || 'silence';
      this.elements.markerIndicator.className = `marker-indicator ${marker}`;

      if (marker === 'speech' || marker === 'speech_during') {
        this.elements.markerIcon.textContent = '🎤';
        this.elements.markerLabel.textContent = marker === 'speech_during' ? 'SPEAK (WHILE ACTION)' : 'SPEAK';
      } else {
        this.elements.markerIcon.textContent = '🔇';
        this.elements.markerLabel.textContent = 'SILENCE';
      }
    } else {
      this.elements.markerIndicator.className = 'marker-indicator silence';
      this.elements.markerIcon.textContent = '⏳';
      this.elements.markerLabel.textContent = 'WAITING';
    }

    // Update prompt text
    if (currentCue && currentCue.text) {
      this.elements.promptText.textContent = currentCue.text;
      this.elements.promptText.classList.remove('silence');
    } else if (currentCue && currentCue.marker === 'silence') {
      this.elements.promptText.textContent = '[silence - let the screen breathe]';
      this.elements.promptText.classList.add('silence');
    } else if (!hasTimeline) {
      this.elements.promptText.textContent = 'Waiting for demo...';
      this.elements.promptText.classList.add('silence');
    } else {
      this.elements.promptText.textContent = '[no active cue]';
      this.elements.promptText.classList.add('silence');
    }

    // Update progress bar
    if (progress) {
      const percent = Math.min(100, progress.fraction * 100);
      this.elements.progressFill.style.width = `${percent}%`;
      this.elements.progressTime.textContent = `${(progress.remaining / 1000).toFixed(1)}s`;
    } else {
      this.elements.progressFill.style.width = '0%';
      this.elements.progressTime.textContent = '';
    }

    // Update next cue preview
    if (nextCue && nextCue.text) {
      this.elements.nextText.textContent = nextCue.text;
    } else if (nextCue && nextCue.marker === 'silence') {
      this.elements.nextText.textContent = '[silence]';
    } else {
      this.elements.nextText.textContent = '[end of demo]';
    }

    // Update time display
    this.elements.timeDisplay.textContent = `${this.formatTime(currentTime)} / ${this.formatTime(totalDuration)}`;
  }

  formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  playBeep() {
    // Create a subtle audio cue for speech markers
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 880; // A5 note
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.2);
    } catch (err) {
      // Audio not available, silently ignore
    }
  }
}

// Initialize teleprompter when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.teleprompter = new Teleprompter();
});
