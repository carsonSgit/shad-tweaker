import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import fs from 'fs-extra';
import request from 'supertest';
import parserRouter from '../src/routes/parser.js';

// Paths resolved via relativePath must be relative to process.cwd()
const fixtureRoot = path.join(process.cwd(), 'test', 'fixtures', 'parser');

let savedCwd: string | undefined;
before(() => {
  savedCwd = process.env.SHADCN_TWEAKER_CWD;
  process.env.SHADCN_TWEAKER_CWD = process.cwd();
});
after(() => {
  if (savedCwd === undefined) {
    delete process.env.SHADCN_TWEAKER_CWD;
  } else {
    process.env.SHADCN_TWEAKER_CWD = savedCwd;
  }
});

const app = express();
app.use(express.json());
app.use('/api/parser', parserRouter);

describe('POST /api/parser/analyze', () => {
  it('returns 400 VALIDATION_ERROR when filePath is not a string', async () => {
    const res = await request(app).post('/api/parser/analyze').send({ filePath: 123 });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('returns 400 INVALID_FILE_PATH for traversal paths', async () => {
    const res = await request(app).post('/api/parser/analyze').send({ filePath: '../outside.tsx' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'INVALID_FILE_PATH');
  });

  it('returns 404 FILE_NOT_FOUND for a valid path that does not exist', async () => {
    const res = await request(app)
      .post('/api/parser/analyze')
      .send({ filePath: 'test/fixtures/parser/nonexistent.tsx' });
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'FILE_NOT_FOUND');
  });

  it('returns 200 with parsed result for a valid fixture file', async () => {
    const relPath = path.relative(process.cwd(), path.join(fixtureRoot, 'button.tsx'));
    const res = await request(app)
      .post('/api/parser/analyze')
      .send({ filePath: relPath.replace(/\\/g, '/') });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.parsed);
    assert.ok(Array.isArray(res.body.parsed.components));
  });

  it('returns 400 INVALID_FILE_PATH for empty / whitespace-only filePath', async () => {
    const res = await request(app).post('/api/parser/analyze').send({ filePath: '   ' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'INVALID_FILE_PATH');
  });

  it('returns 400 INVALID_FILE_PATH for non-TSX extension', async () => {
    const res = await request(app)
      .post('/api/parser/analyze')
      .send({ filePath: 'test/fixtures/parser/button.ts' });
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'INVALID_FILE_PATH');
  });

  it('returns 413 FILE_TOO_LARGE for files exceeding 500 KB', async () => {
    const largeFilePath = path.join(fixtureRoot, 'large-file.tsx');
    const relPath = path.relative(process.cwd(), largeFilePath);
    await fs.writeFile(largeFilePath, Buffer.alloc(501 * 1024, 'a'));
    try {
      const res = await request(app)
        .post('/api/parser/analyze')
        .send({ filePath: relPath.replace(/\\/g, '/') });
      assert.equal(res.status, 413);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'FILE_TOO_LARGE');
    } finally {
      await fs.remove(largeFilePath);
    }
  });
});
