import { IsString, IsIn } from 'class-validator';

export class CreateWalletDto {
  @IsString()
  @IsIn(['ethereum', 'solana', 'polygon', 'arbitrum'])
  chain: string;
}
