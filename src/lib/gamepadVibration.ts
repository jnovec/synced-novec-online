export interface GamepadVibrationOptions {
  duration?: number;
  strongMagnitude?: number;
  weakMagnitude?: number;
}

interface DualRumbleActuator {
  playEffect?: (type: 'dual-rumble', params: {
    duration: number;
    startDelay: number;
    strongMagnitude: number;
    weakMagnitude: number;
  }) => Promise<unknown>;
  pulse?: (value: number, duration: number) => Promise<unknown>;
  reset?: () => Promise<unknown>;
}

export type GamepadWithVibration = Gamepad & {
  vibrationActuator?: DualRumbleActuator;
  hapticActuators?: DualRumbleActuator[];
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const audioLevelToVibration = (rms: number, sensitivity = 1, noiseGate = 0.025): number => {
  const level = Math.max(0, rms - noiseGate) / Math.max(0.001, 1 - noiseGate);
  return clamp01(Math.pow(level * Math.max(0.1, sensitivity), 0.72));
};

export const findVibrationGamepad = (): GamepadWithVibration | null => {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
  const gamepads = getConnectedGamepads();
  return gamepads.find((gamepad) => Boolean(gamepad.vibrationActuator || gamepad.hapticActuators?.length)) ?? null;
};

export const getConnectedGamepads = (): GamepadWithVibration[] => {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
  return Array.from(navigator.getGamepads()).filter(
    (gamepad): gamepad is GamepadWithVibration => Boolean(gamepad?.connected)
  );
};

export const gamepadSupportsVibration = (gamepad: GamepadWithVibration): boolean =>
  Boolean(gamepad.vibrationActuator || gamepad.hapticActuators?.length);

export const vibrateGamepad = async (
  gamepad: GamepadWithVibration,
  options: GamepadVibrationOptions = {}
): Promise<boolean> => {
  const duration = Math.max(0, options.duration ?? 90);
  const strongMagnitude = clamp01(options.strongMagnitude ?? 0);
  const weakMagnitude = clamp01(options.weakMagnitude ?? strongMagnitude);
  const actuator = gamepad.vibrationActuator ?? gamepad.hapticActuators?.[0];
  if (!actuator) return false;

  if (actuator.playEffect) {
    await actuator.playEffect('dual-rumble', { duration, startDelay: 0, strongMagnitude, weakMagnitude });
    return true;
  }
  if (actuator.pulse) {
    await actuator.pulse(Math.max(strongMagnitude, weakMagnitude), duration);
    return true;
  }
  return false;
};

export const stopGamepadVibration = async (gamepad: GamepadWithVibration | null): Promise<void> => {
  const actuator = gamepad?.vibrationActuator ?? gamepad?.hapticActuators?.[0];
  if (!actuator) return;
  if (actuator.reset) await actuator.reset();
  else if (gamepad) await vibrateGamepad(gamepad, { duration: 1, strongMagnitude: 0, weakMagnitude: 0 });
};
