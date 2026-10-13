import {
  Body,
  Controller,
  ForbiddenException,
  GoneException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { UserTenantsService } from '../user-tenants/user-tenants.service';
import {
  AcceptPortalInvitationDto,
  ChangePasswordDto,
  CreateLoginUserDto,
  CreatePortalInvitationDto,
} from './users.dto';
import { checkIfPasswordMatch, hashPassword } from './users.type';
import { reply } from '../../app/utils/reply';
import { config } from '../../app/config';
import { validation_login_cookie_setting } from '../../app/utils/cookies';
import { CheckUserService, JwtToken } from './middleware/check-user.service';
import { UserAuthGuard } from './middleware';
import { UsersService } from './users.service';
import { PortalInvitationsService } from './portal-invitations.service';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { RequestPortalAccessLinkDto } from './users.dto';

interface AuthenticatedRequest extends Request {
  user: { id: string; tenantId: string };
}

@Controller()
export class UsersAuthController {
  constructor(
    private readonly usersService: UsersService,
    private readonly checkUserService: CheckUserService,
    private readonly userTenantsService: UserTenantsService,
    private readonly portalInvitations: PortalInvitationsService,
  ) {}

  @Post('/auth/portal/invitations')
  createInvitation(
    @Body() body: CreatePortalInvitationDto,
    @Headers('x-portal-provisioning-key') provisioningKey?: string,
  ) {
    return this.portalInvitations.inviteContact(body, provisioningKey);
  }

  @Post('/auth/portal/activation-requests')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900000 } })
  async requestPortalActivation(
    @Res() response: Response,
    @Body() body: RequestPortalAccessLinkDto,
  ) {
    await this.portalInvitations.requestActivation(body.email);
    return reply({
      res: response,
      httpStatusCode: HttpStatus.ACCEPTED,
      results: {
        message:
          'If your email belongs to an eligible client Contact, an activation link will be sent.',
      },
    });
  }

  @Post('/auth/portal/password-reset-requests')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 900000 } })
  async requestPortalPasswordReset(
    @Res() response: Response,
    @Body() body: RequestPortalAccessLinkDto,
  ) {
    await this.portalInvitations.requestPasswordReset(body.email);
    return reply({
      res: response,
      httpStatusCode: HttpStatus.ACCEPTED,
      results: {
        message:
          'If an eligible portal account exists for that email, a reset link will be sent.',
      },
    });
  }

  @Post('/auth/portal/password-resets')
  createPasswordResetInvitation(
    @Body() body: CreatePortalInvitationDto,
    @Headers('x-portal-provisioning-key') provisioningKey?: string,
  ) {
    return this.portalInvitations.issuePasswordReset(body, provisioningKey);
  }

  @Post('/auth/portal/invitations/accept')
  async acceptInvitation(
    @Res() response: Response,
    @Body() body: AcceptPortalInvitationDto,
  ) {
    const user = await this.portalInvitations.accept(body.token, body.password);
    const token = await this.checkUserService.createTokenCookie(
      { userId: user.id } as JwtToken,
      Number(config.cookie_access.user.accessExpireLogin),
    );
    response.cookie(
      config.cookie_access.user.nameLogin,
      token,
      validation_login_cookie_setting,
    );
    return reply({
      res: response,
      results: {
        message: 'Portal account is ready.',
        user: { id: user.id, email: user.email, username: user.username },
      },
    });
  }

  @Post('/auth/login')
  async login(@Res() response: Response, @Body() body: CreateLoginUserDto) {
    const email = body.email.trim().toLocaleLowerCase();
    const user = await this.usersService.findOneBy({ email });
    if (!user || !(await checkIfPasswordMatch(user.password, body.password))) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const token = await this.checkUserService.createTokenCookie(
      { userId: user.id } as JwtToken,
      Number(config.cookie_access.user.accessExpireLogin),
    );
    response.cookie(
      config.cookie_access.user.nameLogin,
      token,
      validation_login_cookie_setting,
    );
    return reply({
      res: response,
      results: {
        message: 'User logged in successfully.',
        user: { id: user.id, email: user.email, username: user.username },
      },
    });
  }

  @Get('/me/tenant')
  @UseGuards(UserAuthGuard)
  async getMe(@Res() response: Response, @Req() request: AuthenticatedRequest) {
    const user = await this.usersService.findMe({ userId: request.user.id });
    if (!user) throw new UnauthorizedException('Invalid user.');

    const membership = await this.userTenantsService.findOneBy({
      userId: user.id,
      tenantId: request.user.tenantId,
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this tenant.');
    }

    return reply({
      res: response,
      results: { ...user, role: membership.role },
    });
  }

  @Get('/users')
  @UseGuards(UserAuthGuard)
  async listTenantUsers(
    @Res() response: Response,
    @Req() request: AuthenticatedRequest,
  ) {
    const users = await this.usersService.findAll({
      tenantId: request.user.tenantId,
    });
    return reply({ res: response, results: users });
  }

  @Put('/auth/password')
  @UseGuards(UserAuthGuard)
  async changePassword(
    @Res() response: Response,
    @Req() request: AuthenticatedRequest,
    @Body() body: ChangePasswordDto,
  ) {
    const user = await this.usersService.findOneBy({ userId: request.user.id });
    if (
      !user ||
      !(await checkIfPasswordMatch(user.password, body.currentPassword))
    ) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    await this.usersService.updateOne(
      { userId: user.id },
      { password: await hashPassword(body.newPassword) },
    );
    return reply({ res: response, results: 'Password changed successfully.' });
  }

  @Get('/auth/logout')
  async logout(@Res() response: Response) {
    response.clearCookie(
      config.cookie_access.user.nameLogin,
      validation_login_cookie_setting,
    );
    return reply({ res: response, results: 'User logged out.' });
  }
}
