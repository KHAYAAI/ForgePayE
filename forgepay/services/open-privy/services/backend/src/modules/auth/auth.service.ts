import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { User } from './entities/user.entity';
import { SignupDto } from './dto/signup.dto';
import { WorkOsAuthResult } from './workos.service';
import { logger } from '../../common/logger';

@Injectable()
export class AuthService {
  private _supabase: SupabaseClient | null = null;

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private jwtService: JwtService,
  ) {}

  /**
   * Lazily construct the Supabase client so the app (and the WorkOS auth path)
   * does not require Supabase configuration at boot. The Supabase-backed
   * email/password endpoints throw a clear error if it is unconfigured.
   */
  private get supabase(): SupabaseClient {
    if (!this._supabase) {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_KEY;
      if (!url || !key) {
        throw new ServiceUnavailableException(
          'Supabase auth is not configured (use WorkOS auth, or set SUPABASE_URL/SUPABASE_KEY)',
        );
      }
      this._supabase = createClient(url, key);
    }
    return this._supabase;
  }

  async signup(dto: SignupDto) {
    try {
      // Create user in Supabase Auth
      const { data, error } = await this.supabase.auth.admin.createUser({
        email: dto.email,
        password: dto.password,
        email_confirm: false,
      });

      if (error) {
        throw new BadRequestException(`Signup failed: ${error.message}`);
      }

      // Create user profile in database
      const user = this.usersRepository.create({
        id: data.user.id,
        email: dto.email,
        username: dto.username || undefined,
        emailVerified: false,
      });

      await this.usersRepository.save(user);

      logger.info(`User signed up: ${dto.email}`);

      return {
        id: user.id,
        email: user.email,
        message: 'Signup successful. Please check your email for verification.',
      };
    } catch (error) {
      logger.error(`Signup error: ${error.message}`);
      throw error;
    }
  }

  async login(email: string, password: string) {
    try {
      // Authenticate with Supabase
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const user = await this.usersRepository.findOne({ where: { id: data.user.id } });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      const payload = { sub: user.id, email: user.email };
      const token = this.jwtService.sign(payload);

      logger.info(`User logged in: ${email}`);

      return {
        access_token: token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
        },
      };
    } catch (error) {
      logger.error(`Login error: ${error.message}`);
      throw error;
    }
  }

  async validateUser(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return user;
  }

  /**
   * Upsert a local user from a WorkOS AuthKit identity and mint OpenPrivy's own
   * JWT. Matching order: existing WorkOS link → existing email (link it) → new.
   *
   * The local User keeps its own uuid primary key (what wallets/transactions
   * reference); WorkOS' id is stored alongside in workosUserId. This means
   * switching identity providers never rewrites the wallet ownership graph.
   */
  async loginWithWorkOs(
    profile: WorkOsAuthResult,
  ): Promise<{ access_token: string; user: { id: string; email: string } }> {
    let user = await this.usersRepository.findOne({
      where: { workosUserId: profile.workosUserId },
    });

    if (!user) {
      // Link an existing account with the same email, if any.
      user = await this.usersRepository.findOne({
        where: { email: profile.email },
      });
      if (user) {
        user.workosUserId = profile.workosUserId;
      }
    }

    if (!user) {
      user = this.usersRepository.create({
        email: profile.email,
        workosUserId: profile.workosUserId,
        username: profile.firstName || undefined,
        emailVerified: profile.emailVerified,
      });
    } else {
      // Keep verification state in sync with the IdP.
      user.emailVerified = user.emailVerified || profile.emailVerified;
    }

    await this.usersRepository.save(user);

    const token = this.jwtService.sign({ sub: user.id, email: user.email });
    logger.info(`WorkOS login for ${user.email} (${user.id})`);

    return {
      access_token: token,
      user: { id: user.id, email: user.email },
    };
  }
}
