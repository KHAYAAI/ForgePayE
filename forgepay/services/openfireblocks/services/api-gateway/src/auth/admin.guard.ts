import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { timingSafeEqual } from 'crypto';

// Guards admin-only endpoints (customer provisioning) with a static admin token
// from ADMIN_API_KEY. In production this is replaced by Keycloak-issued admin
// JWTs; the static token keeps Phase 1 self-contained.
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) {
      // Fail closed: no admin token configured means no admin access.
      throw new UnauthorizedException('admin API not configured');
    }
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['authorization'];
    const token = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : (req.headers['x-admin-key'] as string | undefined);

    const a = Buffer.from(token ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('invalid admin token');
    }
    return true;
  }
}
