import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

process.env.DB_PATH = join(tmpdir(), `nassa-test-${randomBytes(4).toString('hex')}.db`);
