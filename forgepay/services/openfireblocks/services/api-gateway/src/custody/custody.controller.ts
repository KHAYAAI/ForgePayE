import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsBoolean, IsEmail, IsIn, IsObject, IsOptional, IsString, Matches } from 'class-validator';
import { AdminGuard } from '../auth/admin.guard';
import { ActorAssertionGuard } from '../auth/actor-assertion';
import { CustodyService, ProposalKind } from './custody.service';

class BootstrapSignerDto {
  @IsEmail() email: string;
  @IsOptional() @IsString() name?: string;
  /** Ed25519 public key (hex) and a signature, by that key, of the enrolment statement (see scripts/signer-cli.ts). */
  @IsOptional() @IsString() publicKey?: string;
  @IsOptional() @IsString() pop?: string;
}

class ProposeDto {
  @IsIn(['add_signer', 'remove_signer', 'set_threshold', 'rotate_key', 'set_signer_key']) kind: ProposalKind;
  @IsObject() payload: Record<string, any>;
}

class VoteDto {
  @IsBoolean() approve: boolean;
  /** The signer's Ed25519 signature (hex) over the vote; required when signatures are required. */
  @IsOptional() @IsString() signature?: string;
}

class TransferDto {
  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'to must be a 20-byte hex address' }) to: string;
  @IsString() amountEth: string;
}

class IssueKeyDto {
  @IsString() name: string;
}

function requireActor(actor: string | undefined): string {
  if (!actor || !actor.includes('@')) {
    throw new BadRequestException('x-actor-email header is required: every custody action is attributed to a person');
  }
  return actor.toLowerCase();
}

// Custody governance for one workspace, called by a trusted operator console
// (admin key) on behalf of a named person. Exempt from the per-IP throttle:
// one console serves every workspace from a single address.
@Controller('admin/customers/:customerId/custody')
@UseGuards(AdminGuard, ActorAssertionGuard)
@SkipThrottle()
export class CustodyController {
  constructor(private readonly custody: CustodyService) {}

  @Get('console')
  summary(@Param('customerId') customerId: string) {
    return this.custody.consoleSummary(customerId);
  }

  @Post('signers/bootstrap')
  bootstrap(@Param('customerId') customerId: string, @Body() dto: BootstrapSignerDto) {
    return this.custody.bootstrapSigner(customerId, dto.email.toLowerCase(), dto.name, dto.publicKey, dto.pop);
  }

  @Post('proposals')
  propose(
    @Param('customerId') customerId: string,
    @Headers('x-actor-email') actor: string,
    @Body() dto: ProposeDto,
  ) {
    return this.custody.propose(customerId, requireActor(actor), dto.kind, dto.payload);
  }

  @Post('proposals/:proposalId/votes')
  vote(
    @Param('customerId') customerId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Headers('x-actor-email') actor: string,
    @Body() dto: VoteDto,
  ) {
    return this.custody.vote(customerId, proposalId, requireActor(actor), dto.approve, dto.signature);
  }

  @Post('proposals/:proposalId/retry')
  retry(
    @Param('customerId') customerId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Headers('x-actor-email') actor: string,
  ) {
    return this.custody.retryTransfer(customerId, proposalId, requireActor(actor));
  }

  @Post('transfers')
  transfer(
    @Param('customerId') customerId: string,
    @Headers('x-actor-email') actor: string,
    @Body() dto: TransferDto,
  ) {
    return this.custody.initiateTransfer(customerId, requireActor(actor), dto.to, dto.amountEth);
  }

  @Post('transfers/:requestId/rebroadcast')
  rebroadcast(
    @Param('customerId') customerId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Headers('x-actor-email') actor: string,
  ) {
    return this.custody.rebroadcastTransfer(customerId, requestId, requireActor(actor));
  }

  @Post('keys/retire-stale')
  retireStale(
    @Param('customerId') customerId: string,
    @Headers('x-actor-email') actor: string,
  ) {
    return this.custody.retireStaleShares(customerId, requireActor(actor));
  }

  @Post('api-keys')
  issueKey(
    @Param('customerId') customerId: string,
    @Headers('x-actor-email') actor: string,
    @Body() dto: IssueKeyDto,
  ) {
    return this.custody.issueApiKey(customerId, requireActor(actor), dto.name);
  }

  @Delete('api-keys/:keyId')
  revokeKey(
    @Param('customerId') customerId: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
    @Headers('x-actor-email') actor: string,
  ) {
    return this.custody.revokeApiKey(customerId, requireActor(actor), keyId);
  }
}
