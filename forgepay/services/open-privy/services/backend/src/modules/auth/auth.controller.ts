import {
  Controller,
  Post,
  Body,
  HttpCode,
  UseGuards,
  Get,
  Req,
  Res,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import * as crypto from 'crypto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { WorkOsService } from './workos.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

const SESSION_COOKIE = 'op_session';
const STATE_COOKIE = 'op_oauth_state';

function cookieSecure(): boolean {
  return (
    process.env.SESSION_COOKIE_SECURE === 'true' ||
    process.env.NODE_ENV === 'production'
  );
}

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private workosService: WorkOsService,
  ) {}

  @Post('signup')
  @HttpCode(201)
  async signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  // ---- WorkOS AuthKit (SSO / email / social) --------------------------------

  /**
   * Start the AuthKit login. Returns the hosted-login URL for the SPA to send
   * the browser to, and sets a short-lived state cookie for CSRF protection.
   */
  @Get('workos/authorize')
  async workosAuthorize(
    @Res({ passthrough: true }) res: Response,
    @Query('organization_id') organizationId?: string,
  ) {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: cookieSecure(),
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000, // 10 minutes
      path: '/',
    });

    const url = this.workosService.getAuthorizationUrl(state, organizationId);
    return { url };
  }

  /**
   * AuthKit redirects here with an authorization code. We validate state,
   * exchange the code for the user profile, mint our own JWT, drop it in an
   * httpOnly session cookie, and bounce the browser back to the app.
   */
  @Get('workos/callback')
  async workosCallback(
    @Req() req: any,
    @Res() res: Response,
    @Query('code') code: string,
    @Query('state') state: string,
  ) {
    const expectedState = req.cookies?.[STATE_COOKIE];
    if (!code || !state || !expectedState || state !== expectedState) {
      throw new UnauthorizedException('Invalid OAuth state or missing code');
    }
    res.clearCookie(STATE_COOKIE, { path: '/' });

    const profile = await this.workosService.authenticateWithCode(code);
    const { access_token } = await this.authService.loginWithWorkOs(profile);

    res.cookie(SESSION_COOKIE, access_token, {
      httpOnly: true,
      secure: cookieSecure(),
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24h, matches JWT expiry
      path: '/',
    });

    const redirectTo =
      process.env.WORKOS_POST_LOGIN_REDIRECT || 'http://localhost:3000/dashboard';
    return res.redirect(redirectTo);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() req: any) {
    const user = await this.authService.validateUser(req.user.userId);
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { message: 'Logged out successfully' };
  }
}
