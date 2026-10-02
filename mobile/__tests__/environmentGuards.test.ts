import { evaluateEnvironment, projectRefOfKey } from '../config/environmentGuards';

const DEV_REF = 'devref1234567890abcd';
const jwtFor = (ref: string) =>
  ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ iss: 'supabase', ref, role: 'anon' })).toString('base64url'), 'sig'].join('.');

const devOk = {
  variant: 'development',
  supabaseUrl: `https://${DEV_REF}.supabase.co`,
  supabaseAnonKey: jwtFor(DEV_REF),
  revenueCatKey: 'test_abc',
  devProjectRef: DEV_REF,
  requireComplete: true,
};
const prodOk = {
  variant: 'production',
  supabaseUrl: 'https://prodprojectref000000.supabase.co',
  supabaseAnonKey: jwtFor('prodprojectref000000'),
  revenueCatKey: 'appl_abc',
  devProjectRef: DEV_REF,
  requireComplete: true,
};

describe('evaluateEnvironment: development variant', () => {
  it('accepts the correct development settings', () => {
    expect(evaluateEnvironment(devOk)).toEqual({ errors: [], warnings: [] });
  });

  it.each([
    ['URL', { supabaseUrl: undefined }],
    ['anon key', { supabaseAnonKey: undefined }],
    ['RevenueCat key', { revenueCatKey: undefined }],
    ['everything', { supabaseUrl: '', supabaseAnonKey: '', revenueCatKey: '' }],
  ])('refuses a missing %s when completeness is required', (_label, override) => {
    const { errors } = evaluateEnvironment({ ...devOk, ...override });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/missing/);
  });

  it('only warns about missing settings in a lenient (local eas CLI) evaluation', () => {
    const result = evaluateEnvironment({ ...devOk, supabaseUrl: undefined, revenueCatKey: undefined, requireComplete: false });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it('refuses a production (or any other) backend URL even in lenient mode', () => {
    expect(evaluateEnvironment({ ...devOk, supabaseUrl: prodOk.supabaseUrl }).errors[0]).toMatch(/another host/);
    expect(evaluateEnvironment({ ...devOk, supabaseUrl: prodOk.supabaseUrl, requireComplete: false }).errors).toHaveLength(1);
    // lookalike host that merely contains the dev ref
    expect(evaluateEnvironment({ ...devOk, supabaseUrl: `https://${DEV_REF}.supabase.co.evil.example` }).errors).toHaveLength(1);
    expect(evaluateEnvironment({ ...devOk, supabaseUrl: `https://evil.example/${DEV_REF}.supabase.co` }).errors).toHaveLength(1);
  });

  it('refuses an anon key that belongs to a different project', () => {
    const { errors } = evaluateEnvironment({ ...devOk, supabaseAnonKey: prodOk.supabaseAnonKey });
    expect(errors[0]).toMatch(/different Supabase project/);
  });

  it('refuses a non-Test-Store RevenueCat key', () => {
    expect(evaluateEnvironment({ ...devOk, revenueCatKey: 'appl_prod' }).errors[0]).toMatch(/Test Store/);
    expect(evaluateEnvironment({ ...devOk, revenueCatKey: 'goog_prod' }).errors).toHaveLength(1);
  });
});

describe('evaluateEnvironment: production variant', () => {
  it('accepts the correct production settings', () => {
    expect(evaluateEnvironment(prodOk)).toEqual({ errors: [], warnings: [] });
  });

  it('refuses the dev backend and a dev-project anon key', () => {
    expect(evaluateEnvironment({ ...prodOk, supabaseUrl: devOk.supabaseUrl }).errors).toHaveLength(1);
    expect(evaluateEnvironment({ ...prodOk, supabaseAnonKey: devOk.supabaseAnonKey }).errors).toHaveLength(1);
  });

  it('refuses a Test Store RevenueCat key', () => {
    expect(evaluateEnvironment({ ...prodOk, revenueCatKey: 'test_abc' }).errors[0]).toMatch(/Test Store/);
  });

  it('keeps tolerating missing settings (unchanged pre-guard behavior)', () => {
    expect(evaluateEnvironment({ ...prodOk, supabaseUrl: undefined, supabaseAnonKey: undefined, revenueCatKey: undefined })).toEqual({
      errors: [],
      warnings: [],
    });
  });
});

describe('evaluateEnvironment: variant', () => {
  it('refuses an unknown variant', () => {
    expect(evaluateEnvironment({ ...devOk, variant: 'staging' }).errors[0]).toMatch(/unknown app variant/);
  });
});

describe('projectRefOfKey', () => {
  it('reads the ref claim from a legacy JWT key', () => {
    expect(projectRefOfKey(jwtFor('abc'))).toBe('abc');
  });
  it('returns null for new-style or undecodable keys', () => {
    expect(projectRefOfKey('sb_publishable_xxx')).toBeNull();
    expect(projectRefOfKey('eyJnotbase64.@@@.x')).toBeNull();
    expect(projectRefOfKey(undefined)).toBeNull();
  });
});
