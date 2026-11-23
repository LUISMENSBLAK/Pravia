import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCanonicalRefresh } from '../services/api/useCanonicalRefresh';

describe('canonical domain invalidation',()=>{
  it('sólo reconsulta su dominio y cancela solicitudes sustituidas o desmontadas',()=>{
    const refresh=vi.fn();const {unmount}=renderHook(()=>useCanonicalRefresh('comparecientes',refresh));
    act(()=>window.dispatchEvent(new CustomEvent('pravia:data-changed',{detail:{scope:'agenda'}})));
    expect(refresh).not.toHaveBeenCalled();
    act(()=>window.dispatchEvent(new CustomEvent('pravia:data-changed',{detail:{scope:'comparecientes'}})));
    const first=refresh.mock.calls[0][0] as AbortSignal;expect(first.aborted).toBe(false);
    act(()=>window.dispatchEvent(new CustomEvent('pravia:data-changed',{detail:{path:'/comparecientes/p?x=1'}})));
    expect(first.aborted).toBe(true);expect(refresh).toHaveBeenCalledTimes(2);
    const last=refresh.mock.calls[1][0] as AbortSignal;unmount();expect(last.aborted).toBe(true);
  });
});
