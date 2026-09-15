// How the three device-code boxes behave and how their value is read. Shared by the lock
// screen and every device-code modal, so a code typed in one reads exactly like a code typed
// in another. The value is read at submit time and handed on; nothing here keeps it.
import { isDevicePin, joinDevicePinGroups } from '../security/device-pin';

export const INVALID_PIN = 'Enter exactly nine digits.';
export const PIN_MISMATCH = 'The two codes do not match.';

export function readPinField(container: ParentNode, name: string): string {
  const inputs = container.querySelectorAll<HTMLInputElement>(`[data-pin-field="${name}"] .device-pin-group`);
  return joinDevicePinGroups(Array.from(inputs, (input) => input.value));
}

// A new code and its confirmation, checked in the order a person would want to hear about them.
export function readNewPin(container: ParentNode): { pin: string } | { error: string } {
  const pin = readPinField(container, 'new');
  if (!isDevicePin(pin)) return { error: INVALID_PIN };
  return pin === readPinField(container, 'confirm') ? { pin } : { error: PIN_MISMATCH };
}

// Boxes accept digits only and move on when full. A paste of exactly nine digits fills all
// three; anything else pasted is refused rather than cleaned up into a code nobody typed.
export function bindPinFields(container: ParentNode): void {
  container.querySelectorAll<HTMLElement>('.device-pin').forEach((field) => {
    const inputs = Array.from(field.querySelectorAll<HTMLInputElement>('.device-pin-group'));
    inputs.forEach((input, index) => {
      input.addEventListener('input', () => {
        input.value = input.value.replace(/[^0-9]/g, '').slice(0, 3);
        if (input.value.length === 3) inputs[index + 1]?.focus();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && !input.value) inputs[index - 1]?.focus();
      });
      input.addEventListener('paste', (event) => {
        const text = event.clipboardData?.getData('text') ?? '';
        event.preventDefault();
        if (!isDevicePin(text)) return;
        inputs.forEach((box, boxIndex) => { box.value = text.slice(boxIndex * 3, boxIndex * 3 + 3); });
        inputs[2]?.focus();
      });
    });
  });
}
