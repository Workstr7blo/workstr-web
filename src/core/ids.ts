export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function recordAddress(type: string, id: string): string {
  return `workstr:v2:${type}:${id}`;
}

export function exerciseAddress(slug: string): string {
  return recordAddress('exercise', slug);
}

export function sheetAddress(slug: string): string {
  return recordAddress('sheet', slug);
}

export function sessionAddress(id: string): string {
  return recordAddress('session', id);
}

export const BODYWEIGHT_ADDRESS = 'workstr:v2:bodyweight';
export const SETTINGS_ADDRESS = 'workstr:v2:settings';
export const MANIFEST_ADDRESS = 'workstr:v2:manifest';
