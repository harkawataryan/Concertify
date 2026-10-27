import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Location of the shared gRPC contract. In the repo it sits two levels above
 * the server package; in the Docker image the server's src/ is at /app/src
 * with proto/ beside it. PROTO_PATH overrides both.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  process.env.PROTO_PATH,
  path.resolve(here, '../../../proto/concertify.proto'),
  path.resolve(here, '../../proto/concertify.proto')
].filter(Boolean);

export const PROTO_PATH = candidates.find((p) => fs.existsSync(p)) || candidates[candidates.length - 1];
