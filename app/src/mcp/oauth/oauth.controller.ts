import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { appConfig, type AppConfig } from '../../config/app.config';
import { DEFAULT_THROTTLE } from '../../config/throttle.config';
import { textsOf, type Texts } from '../../texts/texts';
import { CONSENT_CSP, consentPage, errorPage } from './consent-page';
import { OauthEnabledGuard } from './oauth-enabled.guard';
import { OauthError, OwnerLockedError, OwnerRefusedError } from './oauth-error';
import { OauthServer } from './oauth-server';

/**
 * String parameters of a form or a query; anything that is not a string is a schema refusal, not
 * coercion.
 */
const parameters = z.record(z.string(), z.string());

/** The owner's decision and passphrase that the form sends along with the request parameters. */
const decisionSchema = z.object({
  decision: z.enum(['allow', 'deny']),
  passphrase: z.string().max(256).default(''),
});

/**
 * The App's authorization server for chat (`docs/2-system.md` § “Authentication boundary”,
 * ADR 0021): metadata for the client, registration, the owner's consent, the token endpoint and
 * revocation.
 *
 * Protocol errors are answered with JSON per RFC 6749 and RFC 7591. An OAuth client reads `error`
 * in the body, not the status or the message, so this is an exception to the rule “an HTTP
 * exception without a message”, the same as for webhooks. Tokens are never cached.
 */
@Throttle({ [DEFAULT_THROTTLE]: { limit: 30, ttl: 60_000 } })
@UseGuards(OauthEnabledGuard)
@Controller()
export class OauthController {
  constructor(
    private readonly server: OauthServer,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  @Get('.well-known/oauth-protected-resource')
  resourceMetadata(): object {
    return this.server.protectedResourceMetadata();
  }

  /**
   * Answers at the resource path in `.well-known` (RFC 9728): a client that knows only `/mcp` asks
   * here.
   */
  @Get('.well-known/oauth-protected-resource/mcp')
  mcpResourceMetadata(): object {
    return this.server.protectedResourceMetadata();
  }

  @Get('.well-known/oauth-authorization-server')
  serverMetadata(): object {
    return this.server.authorizationServerMetadata();
  }

  @Post('oauth/register')
  @HttpCode(201)
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<object | undefined> {
    return this.answering(response, () => this.server.register(body));
  }

  @Get('oauth/authorize')
  async consent(@Query() query: unknown, @Res() response: Response): Promise<void> {
    await this.page(response, query, (request, carried) => {
      this.html(response, 200, consentPage(this.texts(), request, carried));
    });
  }

  /**
   * Passphrase guessing is held back not by the throttler but by the lockout after failures
   * (`OwnerLock`): the lockout does not depend on the address the attempts come from.
   */
  @Post('oauth/authorize')
  async decide(@Body() body: unknown, @Res() response: Response): Promise<void> {
    await this.page(response, body, async (request, carried) => {
      const decision = decisionSchema.safeParse(body);

      if (!decision.success) {
        throw new OauthError('invalid_request', z.prettifyError(decision.error));
      }

      if (decision.data.decision === 'deny') {
        response.redirect(303, this.server.deny(request));

        return;
      }

      try {
        response.redirect(303, await this.server.approve(request, decision.data.passphrase));
      } catch (error) {
        const texts = this.texts();

        if (error instanceof OwnerLockedError) {
          response.set('Retry-After', String(error.seconds));
          this.html(
            response,
            429,
            consentPage(texts, request, carried, texts.consent.locked(error.seconds)),
          );

          return;
        }

        if (!(error instanceof OwnerRefusedError)) throw error;

        this.html(response, 403, consentPage(texts, request, carried, texts.consent.refused));
      }
    });
  }

  @Post('oauth/token')
  @HttpCode(200)
  async token(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<object | undefined> {
    return this.answering(response, () => this.server.exchange(body));
  }

  @Post('oauth/revoke')
  @HttpCode(200)
  async revoke(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<object | undefined> {
    return this.answering(response, async () => {
      const token = z.object({ token: z.string().min(1) }).safeParse(body);

      if (!token.success) {
        throw new OauthError('invalid_request', z.prettifyError(token.error));
      }

      await this.server.revoke(token.data.token);

      return {};
    });
  }

  /**
   * Answers with JSON: the result or a protocol error with a body per the RFC. Anything that is
   * not an `OauthError` propagates, because that is a failure, not an answer to the client.
   */
  private async answering(
    response: Response,
    work: () => Promise<object>,
  ): Promise<object | undefined> {
    response.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });

    try {
      return await work();
    } catch (error) {
      if (!(error instanceof OauthError)) throw error;

      response
        .status(error.status)
        .json({ error: error.code, error_description: error.description });

      return undefined;
    }
  }

  /**
   * Handles the consent pages: the request parameters get the same check as on the page, and an
   * error raised before it is known where to return is shown as a page, not a redirect.
   */
  private async page(
    response: Response,
    source: unknown,
    work: (
      request: Awaited<ReturnType<OauthServer['authorizationRequest']>>,
      carried: Readonly<Record<string, string>>,
    ) => void | Promise<void>,
  ): Promise<void> {
    try {
      const carried = parameters.parse(source);

      await work(await this.server.authorizationRequest(carried), carried);
    } catch (error) {
      const refused =
        error instanceof OauthError
          ? error
          : error instanceof z.ZodError
            ? new OauthError('invalid_request', 'the request carries a non-text parameter')
            : null;

      if (refused === null) throw error;

      this.html(response, refused.status, errorPage(this.texts(), refused.description));
    }
  }

  /** Consent pages are in the installation's language (ADR 0042). */
  private texts(): Texts {
    return textsOf(this.app.language);
  }

  private html(response: Response, status: number, body: string): void {
    response
      .status(status)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': CONSENT_CSP,
      })
      .send(body);
  }
}
