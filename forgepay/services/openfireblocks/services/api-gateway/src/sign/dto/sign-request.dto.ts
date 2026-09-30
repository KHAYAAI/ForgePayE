import { IsString, IsNumber, IsOptional, Min, Matches } from 'class-validator';

// Validated request body for POST /sign. ValidationPipe rejects anything that
// does not satisfy these constraints before the controller runs.
export class SignRequestDto {
  // Optional when the gateway has a network RPC (it fills in the node's chain id and
  // rejects a mismatch); required when signing without a network.
  @IsOptional()
  @IsNumber()
  chainId?: number; // 11155111 for Sepolia, 1 for mainnet

  @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'to must be a 20-byte hex address' })
  to: string;

  @IsOptional()
  @IsString()
  data?: string; // 0x-prefixed call data, or omitted for a plain transfer

  @IsOptional()
  @Matches(/^[0-9]+$/, { message: 'value must be a base-10 wei string' })
  value?: string;

  // Optional with a network RPC (estimated, +20%); otherwise 21000 for a plain transfer.
  @IsOptional()
  @IsNumber()
  @Min(21000)
  gasLimit?: number;

  // Legacy fee. Optional when EIP-1559 fields are supplied instead.
  @IsOptional()
  @Matches(/^[0-9]+$/, { message: 'gasPrice must be a base-10 wei string' })
  gasPrice?: string;

  // EIP-1559 dynamic fee (both required together to select the 1559 path).
  @IsOptional()
  @Matches(/^[0-9]+$/, { message: 'maxFeePerGas must be a base-10 wei string' })
  maxFeePerGas?: string;

  @IsOptional()
  @Matches(/^[0-9]+$/, {
    message: 'maxPriorityFeePerGas must be a base-10 wei string',
  })
  maxPriorityFeePerGas?: string;

  // Optional: normally allocated by the gateway at signing time, serially per
  // address (see NonceService). Pass it only to take control of the nonce yourself.
  @IsOptional()
  @IsNumber()
  @Min(0)
  nonce?: number;

  @IsOptional()
  @IsString()
  country?: string; // ISO country code for geographic policy checks
}
