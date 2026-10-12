/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreatePortalInvitationDto {
  @IsNotEmpty()
  @IsUUID()
  tenantId: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(40)
  vtigerContactId: string;
}

export class RequestPortalAccessLinkDto {
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class AcceptPortalInvitationDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  token: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(12)
  @MaxLength(100)
  password: string;
}

export class ChangePasswordDto {
  @IsNotEmpty()
  @IsString()
  currentPassword: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(12)
  @MaxLength(100)
  newPassword: string;
}

export class CreateLoginUserDto {
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  password: string;
}

export class GetUsersDto {
  @IsOptional()
  @IsString()
  @IsUUID()
  userId: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  tenantId: string;
}
