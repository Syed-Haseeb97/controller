// Mirror of android ProfileSchema (LayoutProfile.kt). Validates exported profile JSON.
export const PROFILE_SCHEMA_VERSION = 1;
export const MAX_ELEMENTS = 64;
export const VALID_TARGETS = [
  'LEFT_STICK', 'RIGHT_STICK', 'L2_TRIGGER', 'R2_TRIGGER', 'BTN_CROSS', 'BTN_CIRCLE', 'BTN_SQUARE',
  'BTN_TRIANGLE', 'BTN_L1', 'BTN_R1', 'BTN_L3', 'BTN_R3', 'BTN_SHARE', 'BTN_OPTIONS', 'BTN_PS',
  'BTN_TOUCHPAD', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT',
] as const;

export type ProfileValidation =
  | { ok: true; warnings: string[] }
  | { ok: false; error: string };

export function validateProfileJson(raw: string): ProfileValidation {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: 'Not valid JSON: ' + (e as Error).message };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'Profile must be a JSON object.' };
  }
  if (typeof data.schema === 'number' && data.schema > PROFILE_SCHEMA_VERSION) {
    return { ok: false, error: `Profile schema ${data.schema} is newer than supported ${PROFILE_SCHEMA_VERSION}.` };
  }
  if (!Array.isArray(data.elements) || data.elements.length === 0) {
    return { ok: false, error: '"elements" must be a non-empty array.' };
  }
  if (data.elements.length > MAX_ELEMENTS) {
    return { ok: false, error: `Too many elements (${data.elements.length}, max ${MAX_ELEMENTS}).` };
  }
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < data.elements.length; i++) {
    const el = data.elements[i];
    if (typeof el !== 'object' || el === null) return { ok: false, error: `Element #${i + 1} is not an object.` };
    if (typeof el.id !== 'string' || el.id === '') return { ok: false, error: `Element #${i + 1} needs a string "id".` };
    if (seen.has(el.id)) return { ok: false, error: `Duplicate element id "${el.id}".` };
    seen.add(el.id);
    if (typeof el.normX !== 'number' || typeof el.normY !== 'number') {
      return { ok: false, error: `Element "${el.id}" needs numeric normX and normY.` };
    }
    if (!VALID_TARGETS.includes(el.target)) {
      return { ok: false, error: `Element "${el.id}" has unknown target "${el.target}".` };
    }
    if (el.normX < 0 || el.normX > 1 || el.normY < 0 || el.normY > 1) warnings.push(`"${el.id}" position clamped to 0..1.`);
    if (typeof el.scale === 'number' && (el.scale < 0.5 || el.scale > 2)) warnings.push(`"${el.id}" scale clamped.`);
    if (typeof el.opacity === 'number' && (el.opacity < 0.1 || el.opacity > 1)) warnings.push(`"${el.id}" opacity clamped.`);
  }
  return { ok: true, warnings };
}
