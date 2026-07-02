import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createClient } from '@supabase/supabase-js';
import { User } from './entities/user.entity';
import { SignupDto } from './dto/signup.dto';
import { logger } from '../../common/logger';

@Injectable()
export class AuthService {
  private supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
  );

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private jwtService: JwtService,
  ) {}

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
        username: dto.username || null,
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
}
