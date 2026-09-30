import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AIProcessingStatus } from '../components/feedback/AIProcessingStatus';

describe('AIProcessingStatus', () => {
  it('announces a real in-progress operation without inventing a percentage', () => {
    render(<AIProcessingStatus label="Extrayendo datos" detail="Leyendo fuentes seleccionadas." />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Extrayendo datos');
    expect(status).toHaveTextContent('Leyendo fuentes seleccionadas.');
    expect(status).not.toHaveTextContent('%');
  });
});
