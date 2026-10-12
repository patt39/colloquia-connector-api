import { ServiceCategory } from '../../app/database/prisma';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
  MaxLength,
} from 'class-validator';

export class CreateServiceRequestDto {
  @IsEnum(ServiceCategory)
  serviceCategory: ServiceCategory;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  sourceLanguage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  targetLanguage?: string;

  @ValidateIf(
    (dto: CreateServiceRequestDto) =>
      dto.serviceCategory !== ServiceCategory.DOCUMENTS_TRADUCTION,
  )
  @IsDateString()
  requestedFor?: string;

  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}
