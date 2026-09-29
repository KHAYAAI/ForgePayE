// Own file for the same reason as risk/risk.tokens.ts: services import this and
// database.module imports those services, so defining it in the module left it
// undefined when the services' decorators ran.
export const PG_POOL = 'PG_POOL';
