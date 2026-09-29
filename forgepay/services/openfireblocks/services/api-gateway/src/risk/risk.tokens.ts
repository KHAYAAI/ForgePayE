// Lives in its own file: risk.service imports this token and risk.module imports
// risk.service, so defining it in risk.module made it undefined at load time.
export const REDIS_CLIENT = 'REDIS_CLIENT';
