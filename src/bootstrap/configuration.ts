export interface Configuration { gatewayValidationTimeoutMs: number; validationTimeoutMs: number; identityTimeoutMs: number; managementTimeoutMs: number; }
export function configuration(input: Record<string, unknown> = {}): Configuration {
  const defaults: Configuration = {gatewayValidationTimeoutMs:500,validationTimeoutMs:200,identityTimeoutMs:100,managementTimeoutMs:2000};
  const values = Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,input[key] === undefined ? value : input[key]])) as unknown as Configuration;
  if (!Object.values(values).every(n=>Number.isFinite(n)&&Number.isInteger(n)&&n>0)
    || values.identityTimeoutMs>values.validationTimeoutMs || values.validationTimeoutMs>=values.gatewayValidationTimeoutMs || values.identityTimeoutMs>values.managementTimeoutMs)
    throw Object.assign(new Error('Invalid lifecycle configuration.'),{code:'INVALID_CONFIGURATION'});
  return Object.freeze(values);
}
