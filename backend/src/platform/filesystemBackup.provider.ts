import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IndependentBackupProvider } from './backup.service';
import { PlatformDomainError } from './platform.errors';

const hashFile = async (filename: string) => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filename)) digest.update(chunk as Buffer);
  return digest.digest('hex');
};

const boundedRoot = (value: string, label: string) => {
  if (!value || !path.isAbsolute(value) || path.resolve(value) === path.parse(value).root) {
    throw new PlatformDomainError('BACKUP_PATH_INVALID', `${label} debe ser una ruta absoluta y acotada.`, 500);
  }
  return path.resolve(value);
};

/**
 * Local certification adapter. backupRoot must be a different bounded root
 * from the source and restore roots, which lets QA prove copy + isolated
 * restore + byte-for-byte verification without claiming an external provider.
 */
export class FilesystemIndependentBackupProvider implements IndependentBackupProvider {
  readonly code = 'FILESYSTEM_QA_INDEPENDENT';
  readonly independentFromPrimary = true;

  constructor(private readonly options: {
    backupRoot: string;
    restoreRoot: string;
    sourceResolver: (input: { organizationId?: string; scope: string }) => Promise<string>;
  }) {}

  private roots() {
    const backupRoot = boundedRoot(this.options.backupRoot, 'backupRoot');
    const restoreRoot = boundedRoot(this.options.restoreRoot, 'restoreRoot');
    if (backupRoot === restoreRoot || backupRoot.startsWith(`${restoreRoot}${path.sep}`) || restoreRoot.startsWith(`${backupRoot}${path.sep}`)) {
      throw new PlatformDomainError('BACKUP_PATH_NOT_INDEPENDENT', 'Backup y restore deben usar raíces aisladas.', 409);
    }
    return { backupRoot, restoreRoot };
  }

  async create(input: { backupRunId: string; organizationId?: string; scope: string }) {
    const { backupRoot } = this.roots();
    const source = path.resolve(await this.options.sourceResolver({ organizationId: input.organizationId, scope: input.scope }));
    const metadata = await stat(source);
    if (!metadata.isFile() || metadata.size <= 0) throw new PlatformDomainError('BACKUP_SOURCE_INVALID', 'La fuente del backup no es un archivo verificable.', 422);
    const directory = path.join(backupRoot, input.backupRunId);
    await mkdir(backupRoot, { recursive: true });
    await mkdir(directory, { recursive: false });
    const destination = path.join(directory, 'payload.bin');
    await copyFile(source, destination);
    const [sourceSha, backupSha] = await Promise.all([hashFile(source), hashFile(destination)]);
    if (sourceSha !== backupSha) throw new PlatformDomainError('BACKUP_HASH_MISMATCH', 'La copia de backup no coincide con el original.', 502);
    const manifest = {
      version: 1, backupRunId: input.backupRunId, organizationId: input.organizationId || null,
      scope: input.scope, bytes: metadata.size, sha256: sourceSha, payload: 'payload.bin', createdAt: new Date().toISOString(),
    };
    const manifestFilename = path.join(directory, 'manifest.json');
    await writeFile(manifestFilename, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    return { bytes: BigInt(metadata.size), manifestRef: manifestFilename, restorePointRef: destination, checksumSha256: sourceSha };
  }

  async restoreAndVerify(input: { backupRunId: string; restorePointRef: string; checksumSha256: string }) {
    const { backupRoot, restoreRoot } = this.roots();
    const expectedSource = path.join(backupRoot, input.backupRunId, 'payload.bin');
    if (path.resolve(input.restorePointRef) !== expectedSource) throw new PlatformDomainError('BACKUP_RESTORE_POINT_INVALID', 'El punto de restauración no pertenece al backup.', 409);
    const manifest = JSON.parse(await readFile(path.join(backupRoot, input.backupRunId, 'manifest.json'), 'utf8')) as any;
    if (manifest.backupRunId !== input.backupRunId || manifest.sha256 !== input.checksumSha256) {
      throw new PlatformDomainError('BACKUP_MANIFEST_MISMATCH', 'El manifiesto no corresponde al backup solicitado.', 409);
    }
    const drillId = randomUUID();
    const directory = path.join(restoreRoot, drillId);
    await mkdir(directory, { recursive: true });
    const restored = path.join(directory, 'payload-restored.bin');
    await copyFile(expectedSource, restored);
    const restoredSha = await hashFile(restored);
    const result = restoredSha === input.checksumSha256 ? 'PASS' as const : 'FAIL' as const;
    const report = { version: 1, backupRunId: input.backupRunId, drillId, isolated: true, expectedSha256: input.checksumSha256, restoredSha256: restoredSha };
    const reportRef = path.join(directory, 'restore-report.json');
    await writeFile(reportRef, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    return { result, sampleCount: 1, reportRef, details: report };
  }
}
