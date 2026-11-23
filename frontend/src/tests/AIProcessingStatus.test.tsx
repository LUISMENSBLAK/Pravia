import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
  it('shows elapsed time rather than an invented percentage/ETA and clears timer on unmount', () => {
    vi.useFakeTimers();
    const { unmount }=render(<AIProcessingStatus expanded label="Proyectando escritura con IA" detail="Contraste de fuentes e indicaciones."/>);
    expect(screen.getByText('Tiempo transcurrido: 0:00')).toBeInTheDocument();
    act(()=>vi.advanceTimersByTime(65000));expect(screen.getByText('Tiempo transcurrido: 1:05')).toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent('1:05');
    expect(screen.getByText(/datos no acreditados/)).toBeInTheDocument();
    unmount();expect(vi.getTimerCount()).toBe(0);vi.useRealTimers();
  });
});
