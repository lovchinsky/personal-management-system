import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { OauthServer } from './oauth-server';

/**
 * Without the endpoint address or the owner passphrase the authorization server does not exist: its
 * routes answer as if they were not there. A consent page without a passphrase and metadata
 * without an issuer would be a promise the App will not keep.
 */
@Injectable()
export class OauthEnabledGuard implements CanActivate {
  constructor(private readonly server: OauthServer) {}

  canActivate(): boolean {
    if (!this.server.enabled) {
      throw new NotFoundException();
    }

    return true;
  }
}
