export async function settleMiDiaSource<T>(promise: Promise<T>, timeoutMs = 15_000): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('MI_DIA_SOURCE_TIMEOUT')), timeoutMs);
  });
  try {
    return { ok: true, value: await Promise.race([promise, deadline]) };
  } catch (error) {
    console.error('Mi Día source read failed', error);
    return { ok: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
