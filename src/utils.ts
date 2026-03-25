/**
 * Count items in an array matching a predicate.
 */
export function countMatching<T>(items: T[], predicate: (item: T) => boolean): number {
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    if (predicate(items[i])) count++;
  }
  return count;
}

/**
 * Compute the arithmetic mean of an array of numbers.
 */
export function average(numbers: number[]): number {
  if (numbers.length === 0) throw new Error('average requires at least one number');
  const sum = numbers.reduce((acc, n) => acc + n, 0);
  return sum / numbers.length;
}
