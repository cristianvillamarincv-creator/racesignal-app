export function evaluateEnvironment(input: {
  variant: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  revenueCatKey?: string;
  devProjectRef: string;
  requireComplete: boolean;
}): { errors: string[]; warnings: string[] };
export function hostOf(url: string | undefined): string | null;
export function projectRefOfKey(key: string | undefined): string | null;
