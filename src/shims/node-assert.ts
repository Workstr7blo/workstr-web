export interface AssertionErrorOptions {
  message?: string;
  actual?: unknown;
  expected?: unknown;
  operator?: string;
}

export class AssertionError extends Error {
  actual?: unknown;
  expected?: unknown;
  operator?: string;

  constructor(options: AssertionErrorOptions = {}) {
    super(options.message || 'Assertion failed');
    this.name = 'AssertionError';
    this.actual = options.actual;
    this.expected = options.expected;
    this.operator = options.operator;
  }
}

function assert(value: unknown, message?: string | Error): asserts value {
  if (value) return;
  if (message instanceof Error) throw message;
  throw new AssertionError({ message });
}

assert.ok = assert;
assert.equal = (actual: unknown, expected: unknown, message?: string | Error): void => {
  if (actual == expected) return;
  if (message instanceof Error) throw message;
  throw new AssertionError({ actual, expected, operator: '==', message });
};
assert.strictEqual = (actual: unknown, expected: unknown, message?: string | Error): void => {
  if (actual === expected) return;
  if (message instanceof Error) throw message;
  throw new AssertionError({ actual, expected, operator: '===', message });
};
assert.notStrictEqual = (actual: unknown, expected: unknown, message?: string | Error): void => {
  if (actual !== expected) return;
  if (message instanceof Error) throw message;
  throw new AssertionError({ actual, expected, operator: '!==', message });
};
assert.deepStrictEqual = (actual: unknown, expected: unknown, message?: string | Error): void => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  if (message instanceof Error) throw message;
  throw new AssertionError({ actual, expected, operator: 'deepStrictEqual', message });
};
assert.fail = (message?: string | Error): never => {
  if (message instanceof Error) throw message;
  throw new AssertionError({ message });
};

export const ok = assert;
export const equal = assert.equal;
export const strictEqual = assert.strictEqual;
export const notStrictEqual = assert.notStrictEqual;
export const deepStrictEqual = assert.deepStrictEqual;
export const fail = assert.fail;
export default assert;
