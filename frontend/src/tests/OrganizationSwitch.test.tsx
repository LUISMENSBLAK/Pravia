import { render, screen } from '@testing-library/react';
import { useState, type PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';

const tenantState = vi.hoisted(() => ({ organizationId: 'org-a', mounts: 0 }));

vi.mock('../features/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: PropsWithChildren) => children,
  useAuth: () => ({
    user: { organization: { id: tenantState.organizationId, name: tenantState.organizationId } },
    logout: vi.fn(),
    switchOrganization: vi.fn(),
  }),
}));

vi.mock('../features/assistant/AssistantProvider', () => ({
  AssistantProvider: ({ children }: PropsWithChildren) => {
    const [instance] = useState(() => ++tenantState.mounts);
    return <div data-testid="assistant-instance">{instance}{children}</div>;
  },
}));

vi.mock('../components/layout/AppShell', () => ({ AppShell: () => <span>shell</span> }));

import { TenantScopedShell } from '../app/App';

describe('cambio de organización', () => {
  it('remonta el estado contextual y PRAVIA IA al cambiar de tenant', () => {
    tenantState.organizationId = 'org-a'; tenantState.mounts = 0;
    const view = render(<TenantScopedShell />);
    expect(screen.getByTestId('assistant-instance')).toHaveTextContent('1');
    tenantState.organizationId = 'org-b';
    view.rerender(<TenantScopedShell />);
    expect(screen.getByTestId('assistant-instance')).toHaveTextContent('2');
  });
});
