const presets = [
  { id: 'soft', label: '말랑', squash: 0.22, restore: 0.16, bounce: 0.76 },
  { id: 'stretchy', label: '쫀득', squash: 0.36, restore: 0.075, bounce: 0.48 },
  { id: 'bouncy', label: '탱탱', squash: 0.12, restore: 0.24, bounce: 1.06 },
  { id: 'fluffy', label: '폭신', squash: 0.30, restore: 0.11, bounce: 0.62 },
  { id: 'saggy', label: '물컹', squash: 0.34, restore: 0.06, bounce: 0.32 },
];

let soundEnabled = true;
let soundContext;
const hapticSupported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

export function getPresets() { return presets; }
export function isSoundEnabled() { return soundEnabled; }
export function toggleSound() { soundEnabled = !soundEnabled; return soundEnabled; }

export function sound(type = 'press', force = 0.5) {
  if (!soundEnabled || typeof window === 'undefined') return;
  try {
    soundContext ??= new window.AudioContext();
    if (soundContext.state === 'suspended') soundContext.resume();
    const now = soundContext.currentTime;
    const oscillator = soundContext.createOscillator();
    const gain = soundContext.createGain();
    const notes = { press: [400, 245], stretch: [230, 145], release: [300, 520], hit: [190, 105] };
    const [start, end] = notes[type] || notes.press;
    oscillator.type = type === 'stretch' ? 'sine' : 'triangle';
    oscillator.frequency.setValueAtTime(start * (0.85 + force * 0.45), now);
    oscillator.frequency.exponentialRampToValueAtTime(end * (0.9 + force * 0.25), now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.105 * Math.min(1, 0.3 + force), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
    oscillator.connect(gain).connect(soundContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.18);
  } catch (error) {
    console.debug('Audio unavailable', error);
  }
}

export function haptic(force = 0.5) {
  if (hapticSupported) navigator.vibrate(force > 0.8 ? [16, 14, 20] : Math.round(8 + force * 22));
}
