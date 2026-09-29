import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt, JwtFromRequestFunction } from 'passport-jwt';
import { Request } from 'express';
import { getJwtSecret } from '../../../config/secrets';

/** Read the JWT from the httpOnly session cookie set by the WorkOS callback. */
const fromSessionCookie: JwtFromRequestFunction = (req: Request) => {
  return req?.cookies?.op_session ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      // Accept either an Authorization: Bearer header (API clients / SPA
      // localStorage) or the op_session cookie (WorkOS browser flow).
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        fromSessionCookie,
      ]),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: any) {
    return { userId: payload.sub, email: payload.email };
  }
}
