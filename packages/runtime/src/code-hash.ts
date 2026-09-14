import { createHash } from 'node:crypto';
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('NON_JSON_VALUE');
  return result;
}
export const sha256 = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
export const hashObject = (value: unknown) => sha256(stableJson(value));
