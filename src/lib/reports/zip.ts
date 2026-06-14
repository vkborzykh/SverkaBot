import archiver from 'archiver';
import { PassThrough } from 'stream';

export async function createZip(files: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();

    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));
    passthrough.on('end', () => resolve(Buffer.concat(chunks)));
    passthrough.on('error', reject);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    archive.pipe(passthrough);

    for (const [filename, content] of Object.entries(files)) {
      archive.append(content, { name: filename });
    }

    archive.finalize();
  });
}
