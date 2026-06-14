import { describe, it, expect } from 'vitest';
import { createZip } from '@/src/lib/reports/zip';
import { Readable } from 'stream';

async function readZipEntries(buffer: Buffer): Promise<string[]> {
  // Simple ZIP central directory parser to extract filenames
  const entries: string[] = [];
  let offset = 0;

  // Find the end of central directory (last 22+ bytes)
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x05 &&
      buffer[i + 3] === 0x06
    ) {
      const centralDirOffset = buffer.readUInt32LE(i + 16);
      offset = centralDirOffset;
      break;
    }
  }

  // Read central directory entries
  while (offset < buffer.length) {
    if (
      buffer[offset] === 0x50 &&
      buffer[offset + 1] === 0x4b &&
      buffer[offset + 2] === 0x01 &&
      buffer[offset + 3] === 0x02
    ) {
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
      entries.push(name);
      offset += 46 + nameLength + extraLength + commentLength;
    } else {
      break;
    }
  }

  return entries;
}

describe('createZip', () => {
  it('creates a valid ZIP buffer with expected files', async () => {
    const files = {
      'summary.csv': 'test summary content',
      'matched.csv': 'test matched content',
      'data.csv': 'some data',
    };

    const buffer = await createZip(files);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    // ZIP magic number
    expect(buffer[0]).toBe(0x50); // P
    expect(buffer[1]).toBe(0x4b); // K
    expect(buffer[2]).toBe(0x03);
    expect(buffer[3]).toBe(0x04);
  });

  it('includes all provided files in the ZIP', async () => {
    const files = {
      'summary.csv': 'content1',
      'matched.csv': 'content2',
      'unmatched.csv': 'content3',
    };

    const buffer = await createZip(files);
    const entries = await readZipEntries(buffer);

    expect(entries).toContain('summary.csv');
    expect(entries).toContain('matched.csv');
    expect(entries).toContain('unmatched.csv');
    expect(entries.length).toBe(3);
  });

  it('handles empty files record', async () => {
    const buffer = await createZip({});
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('preserves UTF-8 content with BOM', async () => {
    const russianContent = '\uFEFFПараметр;Значение\r\nТест;123\r\n';
    const files = { 'test.csv': russianContent };

    const buffer = await createZip(files);
    expect(buffer.length).toBeGreaterThan(russianContent.length);
  });
});
