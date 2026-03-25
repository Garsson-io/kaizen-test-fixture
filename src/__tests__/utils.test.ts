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
    expect(result).toBe(1);
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
});
