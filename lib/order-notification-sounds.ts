export const DEFAULT_ORDER_NOTIFICATION_SOUND = 'classic';

export const ORDER_NOTIFICATION_SOUND_OPTIONS = [
  {
    id: 'classic',
    label: 'Sirene classica',
    description: 'Alerta forte e facil de perceber na cozinha.',
  },
  {
    id: 'bell',
    label: 'Campainha',
    description: 'Som limpo, curto e menos agressivo.',
  },
  {
    id: 'kitchen',
    label: 'Cozinha rapida',
    description: 'Tres toques secos para ambiente movimentado.',
  },
  {
    id: 'urgent',
    label: 'Urgente',
    description: 'Mais insistente para nao passar pedido novo.',
  },
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

export function normalizeOrderNotificationSound(value: unknown): OrderNotificationSound {
  const candidate = String(value || '').trim();
  return ORDER_NOTIFICATION_SOUND_IDS.has(candidate)
    ? (candidate as OrderNotificationSound)
    : DEFAULT_ORDER_NOTIFICATION_SOUND;
}

export function getOrderNotificationSoundLabel(value: unknown) {
  const normalized = normalizeOrderNotificationSound(value);
  return ORDER_NOTIFICATION_SOUND_OPTIONS.find((option) => option.id === normalized)?.label || 'Sirene classica';
}

function getSoundPattern(sound: OrderNotificationSound): SoundStep[] {
  if (sound === 'bell') {
    return [
      { frequency: 1046, offset: 0, duration: 0.18, gain: 0.08, type: 'sine' },
      { frequency: 1318, offset: 0.16, duration: 0.18, gain: 0.07, type: 'sine' },
      { frequency: 1568, offset: 0.34, duration: 0.24, gain: 0.06, type: 'sine' },
    ];
  }

  if (sound === 'kitchen') {
    return [
      { frequency: 740, offset: 0, duration: 0.08, gain: 0.08, type: 'triangle' },
      { frequency: 740, offset: 0.14, duration: 0.08, gain: 0.08, type: 'triangle' },
      { frequency: 980, offset: 0.28, duration: 0.16, gain: 0.08, type: 'triangle' },
    ];
  }

  if (sound === 'urgent') {
    return Array.from({ length: 8 }, (_, index) => ({
      frequency: index % 2 === 0 ? 1040 : 520,
      offset: index * 0.16,
      duration: 0.1,
      gain: 0.075,
      type: 'square' as OscillatorType,
    }));
  }

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

  return Array.from({ length: 6 }, (_, index) => ({
    frequency: index % 2 === 0 ? 880 : 660,
    offset: index * 0.22,
    duration: 0.14,
    gain: 0.16,
    type: 'square' as OscillatorType,
  }));
}

export function scheduleOrderNotificationSound(
  ctx: AudioContext,
  sound: OrderNotificationSound,
) {
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
    osc.start(from);
    osc.stop(from + step.duration);
  }
}
