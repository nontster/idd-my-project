import { createServer, type Server } from 'node:http';
import { hostIdentity } from '../adapters/identity/host-identity';
import { systemClock } from '../adapters/clock/system-clock';
import { safeLogger } from '../adapters/logging/safe-logger';
import { randomUUID } from 'node:crypto';
import { SqliteSecurityEvents } from '../adapters/sqlite/security-events';
import { SqliteCreationRepository } from '../adapters/sqlite/creation-repository';
import { SqliteUnitOfWork } from '../adapters/sqlite/unit-of-work';
import { NodeKeyCryptography } from '../adapters/crypto/node-key-crypto';
import { DecisionGate } from '../services/decision-gate';
import { SqliteScopedKeyLookup } from '../adapters/sqlite/scoped-key-lookup';
import { ReactivationRejection } from '../services/reactivation-rejection';
import { SecretRetrieval } from '../services/secret-retrieval';
import { SqliteValidationRepository } from '../adapters/sqlite/validation-repository';
import { ValidationService } from '../services/validation';
import { SqliteRevocationRepository } from '../adapters/sqlite/revocation-repository';
import { RevocationService } from '../services/revocation';
import { SqliteListingRepository } from '../adapters/sqlite/listing-repository';
import { ListingService } from '../services/listing';
import { CreationService } from '../services/creation';
import { ManagementAttempts, RequestCoordinator,type Handler,type Operation } from '../services/management-attempt';
import { AuthenticationService } from '../services/authentication';
import { api } from '../routes/api';
import type { Clock } from '../ports/clock';
import type { ListingRepository } from '../ports/key-repository';
import { configuration } from './configuration';
import { openDatabase } from '../adapters/sqlite/database';
import { recover } from '../adapters/sqlite/recovery';

export interface ApplicationOptions {
  databasePath: string;
  log?: (event: Record<string, unknown>) => void;
  identityVerifier?: unknown;
  clock?: unknown;
  host?: string;
  initializeFreshStore?: boolean;
  configuration?: Record<string, unknown>;
  decisionGate?: DecisionGate;
  restoredFromBackup?: boolean;
  listingRepository?: ListingRepository;
}

export function createDevelopmentApplication(options: ApplicationOptions): Server { return compose(options,true); }
export function createApplication(options: ApplicationOptions): Server { return compose(options,false); }
function compose(options: ApplicationOptions, development: boolean): Server {
  const verifier=hostIdentity(options.identityVerifier,development);
  if(!development&&options.initializeFreshStore)throw Object.assign(new Error('Fresh initialization is local-only.'),{code:'INVALID_CONFIGURATION'});
  const settings=configuration(options.configuration);
  const host=options.host ?? '127.0.0.1';
  if(development&&!['127.0.0.1','::1','localhost'].includes(host))throw Object.assign(new Error('Development requires loopback.'),{code:'INVALID_DEVELOPMENT_HOST'});
  if(options.restoredFromBackup)throw Object.assign(new Error('Unsafe restoration is not supported.'),{code:'RECOVERY_UNSAFE'});
  const opened=openDatabase({path:options.databasePath,initializeFreshStore:options.initializeFreshStore});
  if(!opened.ok)throw Object.assign(new Error('Authoritative storage is unavailable.'),{code:'STORE_UNAVAILABLE'});
  const clock=(options.clock as Clock | undefined) ?? systemClock;
  const events=new SqliteSecurityEvents(opened.value.connection);
  if(!recover(opened.value.connection,events,clock).ok){opened.value.close();throw Object.assign(new Error('Authoritative recovery is unsafe.'),{code:'RECOVERY_UNSAFE'});}
  let ready=true;
  const attempts=new ManagementAttempts(events,randomUUID,()=>{
    ready=false;process.stderr.write('{"operation":"audit","code":"OPERATION_UNAVAILABLE"}\n');
  });
  const gate=options.decisionGate ?? new DecisionGate();
  const work=new SqliteUnitOfWork(opened.value.connection);
  const crypto=new NodeKeyCryptography();
  const creation=new CreationService(new SqliteCreationRepository(opened.value.connection),crypto,work,gate,randomUUID,attempts);
  const listing=new ListingService(options.listingRepository ?? new SqliteListingRepository(opened.value.connection));
  const revocation=new RevocationService(new SqliteRevocationRepository(opened.value.connection),work,gate,attempts);
  const validation=new ValidationService(new SqliteValidationRepository(opened.value.connection),crypto,gate,randomUUID);
  const reactivation=new ReactivationRejection(new SqliteScopedKeyLookup(opened.value.connection));
  const retrieval=new SecretRetrieval(new SqliteScopedKeyLookup(opened.value.connection));
  const coordinator=new RequestCoordinator(new AuthenticationService(verifier),serviceHandlers({creation,listing,revocation,validation,reactivation,retrieval}),attempts);
  const server=createServer(api({coordinator,clock,
    ...settings,
    log:safeLogger(options.log ?? (()=>{})),ready:()=>{try{opened.value.connection.prepare('SELECT 1').get();return ready;}catch{return false;}}}));
  server.once('close',()=>{ready=false;opened.value.close();});
  if(development){
    const listen=server.listen.bind(server);
    server.listen=((...args: unknown[])=>{
      const selected=typeof args[0]==='object'&&args[0]!==null?(args[0] as {host?:unknown}).host:typeof args[1]==='string'?args[1]:undefined;
      if(!['127.0.0.1','::1','localhost'].includes(selected as string))throw Object.assign(new Error('Development requires explicit loopback.'),{code:'INVALID_DEVELOPMENT_HOST'});
      return (listen as (...parameters: unknown[])=>Server)(...args);
    }) as Server['listen'];
  }
  return server;
}

export interface HandlerServices {
  creation:Pick<CreationService,'create'>; listing:Pick<ListingService,'list'>;
  revocation:Pick<RevocationService,'revoke'>; validation:Pick<ValidationService,'validate'>;
  reactivation:Pick<ReactivationRejection,'reject'>; retrieval:Pick<SecretRetrieval,'reject'>;
}
export function serviceHandlers(services:HandlerServices):Record<Operation,Handler>{
  const {creation,listing,revocation,validation,reactivation,retrieval}=services;
  return {
    create:async input=>{
      if(!input.session.tenantId||!input.attempt)return {ok:false,code:'E-08'};
      return creation.create({principal:input.session.principal,tenantId:input.session.tenantId},input.attempt.value.attemptId,input.context,input.attempt);
    },
    list:async input=>input.session.tenantId?listing.list({principal:input.session.principal,tenantId:input.session.tenantId},input.context):{ok:false,code:'E-14'},
    revoke:async input=>input.session.tenantId&&input.attempt?revocation.revoke({principal:input.session.principal,tenantId:input.session.tenantId},input.body.keyId,input.attempt.value.attemptId,input.context,input.attempt):{ok:false,code:'E-09'},
    validate:async input=>input.session.tenantId?validation.validate({principal:input.session.principal,tenantId:input.session.tenantId},input.body.apiKey,input.body.requestId as string,input.context):{ok:false,code:'E-10'},
    reactivate:async input=>input.session.tenantId?reactivation.reject({principal:input.session.principal,tenantId:input.session.tenantId},input.keyId,input.context):{ok:false,code:'OPERATION_UNAVAILABLE'},
    retrieve:async input=>input.session.tenantId?retrieval.reject({principal:input.session.principal,tenantId:input.session.tenantId},input.keyId,input.context):{ok:false,code:'OPERATION_UNAVAILABLE'},
  };
}
