// Web Audio Synthesizer for Game Sound Effects (SFX)
var audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function tone(freq, startOffset, duration, type = "sine", gain = 0.25) {
  try {
    const c = getAudioContext();
    const osc = c.createOscillator();
    const g = c.createGain();

    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = 0;

    osc.connect(g).connect(c.destination);

    const t0 = c.currentTime + startOffset;

    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
    g.gain.linearRampToValueAtTime(0, t0 + duration);

    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  } catch (err) {
    console.warn("Tone generation failed:", err);
  }
}

var SFX = {
  goal_red() {
    tone(880, 0, 0.15);
    tone(1175, 0.15, 0.25);
  },

  goal_blue() {
    tone(660, 0, 0.15);
    tone(880, 0.15, 0.25);
  },

  kick_fired() {
    tone(220, 0, 0.08, "square", 0.15);
  },

  emp_fired() {
    tone(120, 0, 0.3, "sawtooth", 0.2);
    tone(90, 0.1, 0.3, "sawtooth", 0.2);
  },

  intense_start() {
    tone(440, 0, 0.1, "square", 0.1);
    tone(440, 0.2, 0.1, "square", 0.1);
  },

  intense_end() {},

  match_start() {
    tone(523, 0, 0.15);
    tone(659, 0.15, 0.15);
    tone(784, 0.3, 0.3);
  },

  match_end() {
    tone(784, 0, 0.2);
    tone(784, 0.25, 0.2);
    tone(784, 0.5, 0.4);
    tone(523, 1.0, 0.2);
    tone(659, 1.2, 0.2);
    tone(784, 1.4, 0.5);
  },

  warmup() {},
};

function playAudioEvent(event) {
  try {
    if (SFX[event]) {
      SFX[event]();
    }
  } catch (err) {
    console.warn("Audio error playing event " + event + ":", err);
  }
}

// Unlock audio context on user interaction
document.addEventListener("click", () => {
  try {
    const audio = getAudioContext();
    if (audio.state === "suspended") {
      audio.resume();
    }
  } catch(e) {}
}, { once: true });

// Listen to incoming audio events from WS and play matching SFX
if (typeof bus !== 'undefined') {
  bus.on('audio_event', (msg) => {
    if (msg && msg.event) {
      playAudioEvent(msg.event);
    }
  });
}
