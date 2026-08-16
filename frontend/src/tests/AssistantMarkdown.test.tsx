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

  it('TEST 9 renderiza tablas GFM reales, seguras y sin pipes visibles', () => {
    const content = '| Folio | Pendiente | Estado |\n|---|---|---|\n| **EXP-2026-0042** | Identificación | Urgente |\n| EXP-2026-0043 | Firma | Mañana |';
    const { container } = render(<AssistantMarkdown content={content} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(screen.getByText('EXP-2026-0042').tagName).toBe('STRONG');
    expect(screen.getByRole('region', { name: 'Tabla de resultados' })).toHaveAttribute('tabindex', '0');
    expect(container.textContent).not.toContain('|');
    expect(container.textContent).not.toContain('---');
  });

  it('mantiene HTML de una celda como texto y no lo ejecuta', () => {
    const { container } = render(<AssistantMarkdown content={'| Dato | Valor |\n|---|---|\n| Riesgo | <img src=x onerror=alert(1)> |'} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  it('TEST 10 conserva completa una respuesta ejecutiva larga', () => {
    const sections = Array.from({ length: 40 }, (_value, index) => `## Sección ${index + 1}\n\n- Dato real ${index + 1}`).join('\n\n');
    render(<AssistantMarkdown content={sections} />);
    expect(screen.getByText('Sección 1')).toBeInTheDocument();
    expect(screen.getByText('Dato real 40')).toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(40);
  });
});
