import { describe, expect, it } from 'vitest';
import assert, { AssertionError, equal, ok, strictEqual } from '../src/shims/node-assert';

describe('browser assert shim', () => {
  it('behaves like callable node assert for browserified dependencies', () => {
    expect(() => assert(true)).not.toThrow();
    expect(() => ok(1)).not.toThrow();
    expect(() => strictEqual('x', 'x')).not.toThrow();
    expect(() => equal(1, '1')).not.toThrow();
    expect(() => assert(false, 'boom')).toThrow(AssertionError);
    expect(() => assert(false, 'boom')).toThrow('boom');
  });
});
