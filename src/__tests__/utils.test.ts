import { countMatching, average } from '../utils';

describe('countMatching', () => {
  it('counts items matching a predicate', () => {
    const result = countMatching([2, 4, 5], (n) => n % 2 === 0);
    expect(result).toBe(2);
  });

  it('returns 0 when no items match', () => {
    const result = countMatching([1, 3, 7], (n) => n % 2 === 0);
    expect(result).toBe(0);
  });

  it('works with string predicates', () => {
    const words = ['hello', 'world', 'hi'];
    const result = countMatching(words, (w) => w.startsWith('h'));
    expect(result).toBe(2);
  });

  it('counts all matching elements including the last one', () => {
    // INVARIANT: countMatching must count every element in the array,
    // including the last one — no off-by-one skipping.
    const result = countMatching([2, 4, 6], (n) => n % 2 === 0);
    expect(result).toBe(3);
  });

  it('returns 0 for an empty array', () => {
    expect(countMatching([], () => true)).toBe(0);
  });
});

describe('average', () => {
  it('computes the mean of a list of numbers', () => {
    expect(average([1, 2, 3])).toBe(2);
  });

  it('returns the value itself for a single-element array', () => {
    expect(average([42])).toBe(42);
  });

  it('handles floats correctly', () => {
    expect(average([1.5, 2.5])).toBe(2);
  });

  it('throws for an empty array', () => {
    // INVARIANT: average of an empty array is undefined — must throw, not return NaN.
    expect(() => average([])).toThrow("Cannot compute average of empty array");
  });
});
