import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssistantMarkdown } from '../features/assistant/components/AssistantMarkdown';

describe('presentación Markdown de PRAVIA IA', () => {
  it('renderiza énfasis, listas, numeración, saltos y enlaces sin mostrar marcadores crudos', () => {
    const { container } = render(<AssistantMarkdown content={'**Pendientes de hoy**\n\n1. Revisar *expediente*.\n2. Confirmar firma.\n\n[Ver agenda](/agenda)'} />);
    expect(screen.getByText('Pendientes de hoy').tagName).toBe('STRONG');
    expect(screen.getByText('expediente').tagName).toBe('EM');
    expect(container.querySelector('ol')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver agenda' })).toHaveAttribute('href', '/agenda');
    expect(container.textContent).not.toContain('**');
  });

  it('no interpreta HTML ni protocolos inseguros', () => {
    const { container } = render(<AssistantMarkdown content={'<img src=x onerror=alert(1)>\n\n[Ejecutar](javascript:alert(1))'} />);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ejecutar' })).not.toBeInTheDocument();
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
  });
});
