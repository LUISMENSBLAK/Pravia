import { Worker } from 'node:worker_threads';

/** Keep the original HEIF in private Storage. Decode only a derivative for analysis,
 * outside the HTTP event loop, with bounded dimensions, time and output size. */
export async function assistantImageForAnalysis(buffer: Buffer, mimeType: string) {
  if (!['image/heic', 'image/heif'].includes(mimeType)) return { buffer, mimeType };
  const jpeg = await new Promise<Buffer>((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const decode = require(workerData.decoder);
        const images = await decode.all({ buffer: Buffer.from(workerData.buffer) });
        try {
          if (images.length !== 1) throw Error('HEIF_MULTIPLE_IMAGES');
          const image = images[0];
          if (!image.width || !image.height || image.width * image.height > 24000000) throw Error('HEIF_DIMENSIONS_LIMIT');
          const decoded = await image.decode();
          const result = require(workerData.encoder).encode(decoded, 92).data;
          if (result.length > 52428800) throw Error('HEIF_OUTPUT_LIMIT');
          parentPort.postMessage(result);
        } finally { images.dispose(); }
      })().catch(() => { process.exitCode = 1; });
    `, { eval: true, workerData: { buffer, decoder: require.resolve('heic-decode'), encoder: require.resolve('jpeg-js') }, resourceLimits: { maxOldGenerationSizeMb: 192 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('No se pudo convertir la foto HEIC/HEIF dentro del tiempo permitido. Exporta una copia JPG o PNG.')); }, 30_000);
    worker.once('message', data => { clearTimeout(timer); void worker.terminate(); resolve(Buffer.from(data)); });
    worker.once('error', () => { clearTimeout(timer); reject(new Error('No se pudo leer la foto HEIC/HEIF. Exporta una copia JPG o PNG.')); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('HEIC/HEIF no legible o fuera del límite seguro (una imagen, hasta 24 megapíxeles). Exporta una copia JPG o PNG.')); });
  });
  return { buffer: jpeg, mimeType: 'image/jpeg' };
}
