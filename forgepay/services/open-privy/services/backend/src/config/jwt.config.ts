import { JwtModuleOptions } from '@nestjs/jwt';
import { getJwtSecret } from '../common/crypto/jwt-secret';

export const jwtConfig: JwtModuleOptions = {
  secret: getJwtSecret(),
  signOptions: {
    expiresIn: process.env.JWT_EXPIRATION || '24h',
  },
};
