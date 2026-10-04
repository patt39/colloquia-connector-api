import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Res,
  Headers,
  Get,
  UseGuards,
  Put,
  Param,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import { UserTenantsService } from '../user-tenants/user-tenants.service';
import type { Response } from 'express';
import { UsersService } from './users.service';
import { TenantsService } from '../tenants/tenants.service';
import {
  CreateLoginUserDto,
  RegisterUserDto,
  ResetPasswordUserDto,
  UpdateResetPasswordUserDto,
} from './users.dto';
import { checkIfPasswordMatch, hashPassword } from './users.type';
import { reply } from '../../app/utils/reply';
import { config } from '../../app/config';
import {
  validation_login_cookie_setting,
  validation_verify_cookie_setting,
} from '../../app/utils/cookies';
import { CheckUserService, JwtToken } from './middleware/check-user.service';
import { UserAuthGuard } from './middleware';

@Controller()
export class UsersAuthController {
  constructor(
    private readonly usersService: UsersService,
    private readonly checkUserService: CheckUserService,
    private readonly tenantsService: TenantsService,
    private readonly userTenantsService: UserTenantsService,
  ) {}

  /** Post one User */
  @Post(`/auth/register`)
  async createOne(@Res() res: Response, @Body() body: RegisterUserDto) {
    const { email, password, username, tenantName } = body;

    const findOneUser = await this.usersService.findOneBy({ email });
    if (findOneUser)
      throw new HttpException(
        `Email ${email} already exists please change`,
        HttpStatus.FOUND,
      );

    const hashedPassword = String(await hashPassword(password));

    const tenant = await this.tenantsService.createOne({
      name: tenantName,
    });

    const user = await this.usersService.createOne({
      password: hashedPassword,
      email: email.toLocaleLowerCase(),
      username: username,
      tenantId: tenant.id,
    });

    return reply({
      res,
      results: {
        message: 'User created successfully',
        user: user,
      },
    });
  }

  /** Login user */
  @Post(`/auth/login`)
  async createOneLogin(
    @Res() res: Response,
    @Body() body: CreateLoginUserDto,
    @Headers('origin') origin: string,
  ) {
    const { email, password } = body;

    const findOneUser = await this.usersService.findOneBy({
      email,
    });
    if (!findOneUser)
      throw new HttpException(`Invalid credentials`, HttpStatus.NOT_FOUND);
    if (!(await checkIfPasswordMatch(findOneUser?.password, password)))
      throw new HttpException(`Invalid credentials`, HttpStatus.NOT_FOUND);

    const tokenUser = await this.checkUserService.createTokenCookie(
      { userId: findOneUser.id } as JwtToken,
      config.cookie_access.user.accessExpireLogin,
    );

    res.cookie(
      config.cookie_access.user.nameLogin,
      tokenUser,
      validation_login_cookie_setting,
    );
    return reply({
      res,
      results: {
        message: 'User logged in successfully',
        url: origin,
      },
    });
  }

  /** Get one User */
  @Get(`/me/tenant`)
  @UseGuards(UserAuthGuard)
  async getMe(@Res() res, @Req() req) {
    const { user } = req;
    const findOneUser = await this.usersService.findMe({
      userId: user.id,
    });
    if (!findOneUser)
      throw new HttpException(`Invalid user`, HttpStatus.NOT_FOUND);

    const userTenant = await this.userTenantsService.findOneBy({
      userId: findOneUser.id,
      tenantId: user?.tenantId,
    });

    if (!userTenant) {
      throw new ForbiddenException(
        'You are not a member of the current tenant',
      );
    }

    return reply({
      res,
      results: {
        ...findOneUser,
        role: userTenant.role,
      },
    });
  }

  /** Get tenaant Users */
  @Get(`/users`)
  @UseGuards(UserAuthGuard)
  async findAll(@Res() res) {
    const { user } = res.req;

    const users = await this.usersService.findAll({
      tenantId: user?.tenantId,
    });

    return reply({ res, results: users });
  }

  /** Reset password user */
  @Post(`/auth/reset-password`)
  async resetPassword(@Res() res, @Body() body: ResetPasswordUserDto) {
    const { email } = body;

    const findOneUser = await this.usersService.findOneBy({
      email,
    });
    if (!findOneUser)
      throw new HttpException(
        `User email ${email} invalid`,
        HttpStatus.NOT_FOUND,
      );

    const token = await this.checkUserService.createTokenCookie(
      { userId: findOneUser.id } as JwtToken,
      config.cookie_access.user.accessExpireVerify,
    );

    return reply({ res, results: token });
  }

  /** Password reset token */
  @Put(`/password/:token/update`)
  async updatePassword(
    @Res() res: Response,
    @Body() body: UpdateResetPasswordUserDto,
    @Param('token') token: string,
  ) {
    const { password } = body;

    const payload = await this.checkUserService.verifyTokenCookie(token);
    const findOneUser = await this.usersService.findOneBy({
      userId: payload?.userId,
    });
    if (!findOneUser)
      throw new HttpException(`User  invalid`, HttpStatus.NOT_FOUND);
    await this.usersService.updateOne(
      { userId: findOneUser?.id },
      { password: await hashPassword(password) },
    );

    return reply({ res, results: 'Password updated' });
  }

  /** Logout user */
  @Get(`/auth/logout`)
  async logout(@Res() res: Response) {
    res.clearCookie(
      config.cookie_access.user.nameLogin,
      validation_login_cookie_setting,
    );
    res.clearCookie(
      config.cookie_access.user.nameVerify,
      validation_verify_cookie_setting,
    );

    return reply({ res, results: 'User logout successfully' });
  }
}
