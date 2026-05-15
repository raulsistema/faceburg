export const DEFAULT_ORDER_NOTIFICATION_SOUND = 'red_chicken';

export const ORDER_NOTIFICATION_SOUND_OPTIONS = [
  {
    id: 'counter_siren',
    label: 'Sirene de balcao',
    description: 'Toque alto, longo e chamativo para ambiente com movimento.',
  },
  {
    id: 'maximum_alarm',
    label: 'Alarme maximo',
    description: 'O mais forte da lista, feito para chamar atencao na hora.',
  },
  {
    id: 'red_chicken',
    label: 'Campainha',
    description: 'Som original Red Chicken do Sistemas na Web.',
  },
  {
    id: 'blue_bell',
    label: 'Campainha rapida',
    description: 'Som original Blue Bell do Sistemas na Web.',
  },
  {
    id: 'tort_white',
    label: 'Tort White',
    description: 'Som original Tort White do Sistemas na Web.',
  },
  {
    id: 'ifood',
    label: 'Ifood',
    description: 'Som original Ifood do Sistemas na Web.',
  },
] as const;

export type OrderNotificationSound = (typeof ORDER_NOTIFICATION_SOUND_OPTIONS)[number]['id'];

type SoundStep = {
  frequency: number;
  offset: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
};

const ORDER_NOTIFICATION_SOUND_IDS = new Set<string>(
  ORDER_NOTIFICATION_SOUND_OPTIONS.map((option) => option.id),
);

const EXTERNAL_ORDER_AUDIO_URLS: Partial<Record<OrderNotificationSound, string>> = {
  blue_bell: 'https://sistemasnaweb.com.br/audio/camp1.mp3',
  red_chicken: 'https://sistemasnaweb.com.br/audio/camp2.mp3',
  tort_white: 'https://sistemasnaweb.com.br/audio/camp3.mp3',
  ifood: 'https://sistemasnaweb.com.br/audio/camp4.mp3',
};

const EXTERNAL_ORDER_AUDIO_LAYERS: Partial<Record<OrderNotificationSound, number>> = {
  red_chicken: 3,
};
const activeExternalAudios = new Set<HTMLAudioElement>();

export function normalizeOrderNotificationSound(value: unknown): OrderNotificationSound {
  const candidate = String(value || '').trim();
  return ORDER_NOTIFICATION_SOUND_IDS.has(candidate)
    ? (candidate as OrderNotificationSound)
    : DEFAULT_ORDER_NOTIFICATION_SOUND;
}

export function getOrderNotificationSoundLabel(value: unknown) {
  const normalized = normalizeOrderNotificationSound(value);
  return ORDER_NOTIFICATION_SOUND_OPTIONS.find((option) => option.id === normalized)?.label || 'Campainha';
}

function getSoundPattern(sound: OrderNotificationSound): SoundStep[] {
  if (sound === 'counter_siren') {
    return Array.from({ length: 12 }, (_, index) => ({
      frequency: index % 2 === 0 ? 1240 : 720,
      offset: index * 0.18,
      duration: 0.14,
      gain: 0.16,
      type: 'sawtooth' as OscillatorType,
    }));
  }

  if (sound === 'maximum_alarm') {
    return Array.from({ length: 16 }, (_, index) => ({
      frequency: index % 2 === 0 ? 1380 : 480,
      offset: index * 0.13,
      duration: 0.1,
      gain: 0.2,
      type: 'square' as OscillatorType,
    }));
  }

  if (sound === 'red_chicken') {
    return Array.from({ length: 24 }, (_, index) => ({
      frequency: index % 2 === 0 ? 1568 : 1180,
      offset: index * 0.075,
      duration: 0.045,
      gain: index % 4 === 0 ? 0.24 : 0.2,
      type: index % 2 === 0 ? ('square' as OscillatorType) : ('triangle' as OscillatorType),
    }));
  }

  if (sound === 'blue_bell') {
    return [
      { frequency: 988, offset: 0, duration: 0.22, gain: 0.09, type: 'sine' },
      { frequency: 1318, offset: 0.18, duration: 0.26, gain: 0.08, type: 'sine' },
      { frequency: 1661, offset: 0.42, duration: 0.34, gain: 0.07, type: 'sine' },
      { frequency: 1318, offset: 0.82, duration: 0.2, gain: 0.06, type: 'triangle' },
    ];
  }

  if (sound === 'tort_white') {
    return [
      { frequency: 620, offset: 0, duration: 0.12, gain: 0.13, type: 'sawtooth' },
      { frequency: 1040, offset: 0.13, duration: 0.12, gain: 0.13, type: 'sawtooth' },
      { frequency: 1540, offset: 0.26, duration: 0.16, gain: 0.12, type: 'square' },
      { frequency: 760, offset: 0.55, duration: 0.12, gain: 0.13, type: 'sawtooth' },
      { frequency: 1280, offset: 0.68, duration: 0.12, gain: 0.13, type: 'sawtooth' },
      { frequency: 1840, offset: 0.81, duration: 0.2, gain: 0.12, type: 'square' },
    ];
  }

  if (sound === 'ifood') {
    return [
      { frequency: 880, offset: 0, duration: 0.1, gain: 0.12, type: 'triangle' },
      { frequency: 1175, offset: 0.12, duration: 0.1, gain: 0.12, type: 'triangle' },
      { frequency: 1568, offset: 0.24, duration: 0.16, gain: 0.12, type: 'triangle' },
      { frequency: 1175, offset: 0.52, duration: 0.1, gain: 0.12, type: 'square' },
      { frequency: 1568, offset: 0.64, duration: 0.22, gain: 0.13, type: 'square' },
    ];
  }

  return Array.from({ length: 6 }, (_, index) => ({
    frequency: index % 2 === 0 ? 880 : 660,
    offset: index * 0.22,
    duration: 0.14,
    gain: 0.16,
    type: 'square' as OscillatorType,
  }));
}

function playExternalOrderNotificationSound(sound: OrderNotificationSound, onFallback: () => void) {
  const audioUrl = EXTERNAL_ORDER_AUDIO_URLS[sound];
  if (!audioUrl || typeof Audio === 'undefined') return false;
  try {
    const layerCount = EXTERNAL_ORDER_AUDIO_LAYERS[sound] || 1;
    let fallbackStarted = false;
    const startFallback = () => {
      if (fallbackStarted) return;
      fallbackStarted = true;
      onFallback();
    };

    for (let index = 0; index < layerCount; index += 1) {
      const audio = new Audio(audioUrl);
      audio.volume = index === 0 ? 1 : 0.82;
      audio.preload = 'auto';
      activeExternalAudios.add(audio);
      const releaseAudio = () => activeExternalAudios.delete(audio);
      audio.addEventListener('ended', releaseAudio, { once: true });
      audio.addEventListener('error', releaseAudio, { once: true });
      const playPromise = audio.play();
      if (playPromise) {
        playPromise.catch(() => {
          releaseAudio();
          if (index === 0) startFallback();
        });
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function scheduleOrderNotificationSound(
  ctx: AudioContext,
  sound: OrderNotificationSound,
) {
  const scheduleGeneratedSound = () => {
    const startAt = ctx.currentTime + 0.02;

    for (const step of getSoundPattern(sound)) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = step.type || 'square';
      osc.frequency.value = step.frequency;
      gain.gain.value = step.gain ?? 0.07;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const from = startAt + step.offset;
      const peakGain = step.gain ?? 0.07;
      const attackEnd = from + Math.min(0.012, step.duration / 4);
      const releaseStart = from + Math.max(0.018, step.duration - 0.035);
      gain.gain.setValueAtTime(0.0001, from);
      gain.gain.exponentialRampToValueAtTime(peakGain, attackEnd);
      gain.gain.setValueAtTime(peakGain, releaseStart);
      gain.gain.exponentialRampToValueAtTime(0.0001, from + step.duration);
      osc.start(from);
      osc.stop(from + step.duration);
    }
  };

  if (playExternalOrderNotificationSound(sound, scheduleGeneratedSound)) return;

  scheduleGeneratedSound();
}
