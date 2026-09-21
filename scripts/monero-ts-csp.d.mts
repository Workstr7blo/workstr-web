export function isMoneroGenUtils(id: string): boolean;
export function patchMoneroGenUtils(code: string): string;
export function moneroTsCspPlugin(options?: { bundler?: boolean }): { name: string; enforce?: 'pre'; transform(code: string, id: string): { code: string; map: null } | null };
