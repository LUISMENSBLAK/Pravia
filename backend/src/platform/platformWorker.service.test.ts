import { describe, expect, it, vi } from 'vitest';
import { currentActorContext } from '../auth/actorContext';
import { PlatformWorkerService } from './platformWorker.service';

describe('PlatformWorkerService tenant context', () => {
  it('claims globally and processes the claimed job in its explicit organization', async () => {
    const organizationId = '00000000-0000-4000-8000-000000000910';
    const worker = new PlatformWorkerService({} as any);
    const seen: Array<{ step: string; organizationId?: string; platformOperation?: string }> = [];
    const capture = (step: string) => {
      const context = currentActorContext();
      seen.push({ step, organizationId: context?.organizationId, platformOperation: context?.platformOperation });
    };

    (worker as any).jobs = {
      claimNext: vi.fn(async () => {
        capture('claim');
        return {
          id: 'job-1', organization_id: organizationId, job_type: 'EXPORT', progress: 0,
          payload_ref: { exportJobId: 'export-1' },
        };
      }),
      heartbeat: vi.fn(),
      complete: vi.fn(async () => { capture('complete'); }),
      fail: vi.fn(),
    };
    (worker as any).exports = {
      process: vi.fn(async () => { capture('process'); }),
    };

    await expect(worker.runOnce({ workerId: 'worker-1', globalConcurrency: 2, perTenantConcurrency: 1 }))
      .resolves.toEqual({ id: 'job-1', status: 'COMPLETED' });

    expect(seen).toEqual([
      { step: 'claim', organizationId: '', platformOperation: 'PLATFORM_JOB_CLAIM' },
      { step: 'process', organizationId, platformOperation: undefined },
      { step: 'complete', organizationId, platformOperation: undefined },
    ]);
  });
});
