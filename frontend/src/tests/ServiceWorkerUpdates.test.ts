import { describe, expect, it, vi } from 'vitest';
import { listenForServiceWorkerUpdate } from '../services/serviceWorkerUpdates';

const container = (controlled: boolean) => Object.assign(new EventTarget(), { controller: controlled ? {} as ServiceWorker : null });
describe('actualización PWA sin perder formularios en la primera instalación', () => {
  it('no recarga cuando el worker reclama por primera vez una página sin controlador', () => {
    const target = container(false); const reload = vi.fn();
    listenForServiceWorkerUpdate(target, reload);
    target.controller = {} as ServiceWorker;
    target.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
  });
  it('recarga una sola vez al sustituir un controlador ya existente', () => {
    const target = container(true); const reload = vi.fn();
    listenForServiceWorkerUpdate(target, reload);
    target.dispatchEvent(new Event('controllerchange')); target.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('permite retirar el listener sin nuevas recargas', () => {
    const target = container(true); const reload = vi.fn();
    const remove = listenForServiceWorkerUpdate(target, reload); remove();
    target.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
  });
});
