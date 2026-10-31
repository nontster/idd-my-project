import { expect, test } from '@jest/globals';
import { apiRequest, startAcceptanceApp, startGateway, type TestGateway } from '../../support/acceptance-app';
import { createIdentityFixtures } from '../../support/identity-fixtures';

test('issued credentials authorize two warm gateways, then lose access immediately after revocation without secret leakage', async () => {
  const identities=createIdentityFixtures();
  const app = await startAcceptanceApp({},identities);
  const gateways: TestGateway[] = [];
  try {
    const created = await apiRequest(app.url, '/v1/api-keys', app.developerToken, {}, app.tenantId);
    // The first intended RED is missing successful scoped issuance. Never print the body.
    expect(created.status).toBe(201);
    const raw = created.body.apiKey;
    expect(typeof raw === 'string' && /^[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{43}$/.test(raw)).toBe(true);
    const secret = raw as string;
    expect(created.body.tenantId === app.tenantId).toBe(true);
    expect(created.body.prefix === secret.slice(0, 8)).toBe(true);
    expect(created.body.status === 'active').toBe(true);
    expect(app.logs.every(line => !line.includes(secret))).toBe(true);

    const listed=await fetch(app.url+'/v1/api-keys',{headers:{authorization:`Bearer ${identities.colleagueToken}`,'x-tenant-id':app.tenantId}});
    expect(listed.status).toBe(200);
    const collection=await listed.json() as {items:{keyId:string;prefix:string}[]};
    expect(collection.items.length).toBe(1);expect(JSON.stringify(collection).includes(secret)).toBe(false);
    const selected=collection.items[0];expect(selected.keyId===created.body.keyId&&selected.prefix===secret.slice(0,8)).toBe(true);

    gateways.push(await startGateway(app), await startGateway(app));
    for (const gateway of gateways) {
      const admitted = await apiRequest(gateway.url, '/admit', app.serviceToken, { apiKey: secret, expectedTenantId: app.tenantId });
      expect(admitted.status).toBe(200);
      expect(gateway.cacheSize() > 0).toBe(true);
      expect(JSON.stringify(admitted.body).includes(secret)).toBe(false);
    }

    const revoked = await apiRequest(app.url, '/v1/api-keys/revocations', identities.colleagueToken, { keyId: selected.keyId }, app.tenantId);
    expect(revoked.status).toBe(200);
    expect(revoked.body.status === 'revoked').toBe(true);
    expect(JSON.stringify(revoked.body).includes(secret)).toBe(false);
    for (const gateway of gateways) {
      const denied = await apiRequest(gateway.url, '/admit', app.serviceToken, { apiKey: secret, expectedTenantId: app.tenantId });
      expect(denied.status).toBe(403);
      expect(JSON.stringify(denied.body).includes(secret)).toBe(false);
    }
    expect(app.logs.every(line => !line.includes(secret))).toBe(true);
  } finally {
    for (const gateway of gateways) await gateway.close();
    await app.close();
  }
}, 15000);
