import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevelopmentApplication, type ApplicationOptions } from '../../src/bootstrap/app';
import { createIdentityFixtures } from './identity-fixtures';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Test listener unavailable');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

export async function startAcceptanceApp(overrides: Partial<ApplicationOptions> = {}, identities = createIdentityFixtures()) {
  const directory = await mkdtemp(join(tmpdir(), 'api-key-acceptance-'));
  const logs: string[] = [];
  const databasePath = overrides.databasePath ?? join(directory, 'keys.sqlite');
  const { developerToken, serviceToken } = identities;
  const tenantId = 'tenant-a';
  const server = createDevelopmentApplication({ databasePath, identityVerifier: identities.verifier,
    host: '127.0.0.1', initializeFreshStore: true, log: event => logs.push(JSON.stringify(event)), ...overrides });
  const url = await listen(server);
  return { url, logs, directory, databasePath, developerToken, serviceToken, tenantId,server,
    close: async () => { await close(server); await rm(directory, { recursive: true, force: true }); } };
}

export type TestApp = Awaited<ReturnType<typeof startAcceptanceApp>>;
export type TestGateway = { url: string; cacheSize(): number; close(): Promise<void> };

export async function startGateway(app: TestApp): Promise<TestGateway> {
  const { startGatewayServer }=await import('./gateway-servers');
  return startGatewayServer(app);
}

export async function apiRequest(url: string, path: string, token: string, body: unknown, tenantId?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  if (tenantId !== undefined) headers['x-tenant-id'] = tenantId;
  const response = await fetch(url + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as Record<string, unknown>&{error:{code:string;message:string}}, headers: response.headers };
}
