import { JwtModuleOptions } from '@nestjs/jwt';
import { getJwtSecret } from './secrets';

export const jwtConfig: JwtModuleOptions = {
  secret: getJwtSecret(),
  signOptions: {
    expiresIn: process.env.JWT_EXPIRATION || '24h',
  },
};
