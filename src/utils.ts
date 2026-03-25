/**
 * Count items in an array matching a predicate.
 */
export function countMatching<T>(items: T[], predicate: (item: T) => boolean): number {
  return items.filter(predicate).length;
}

/**
 * Compute the arithmetic mean of an array of numbers.
 */
export function average(numbers: number[]): number {
  if (numbers.length === 0) throw new Error('average of empty array');
  const sum = numbers.reduce((acc, n) => acc + n, 0);
  return sum / numbers.length;
}
