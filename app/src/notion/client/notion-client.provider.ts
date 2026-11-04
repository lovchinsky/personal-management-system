import { Provider } from '@nestjs/common';
import { Client } from '@notionhq/client';
import { notionConfig, type NotionConfig } from './notion.config';

/**
 * The official client as a provider. The token and the version come from the `notion` config
 * namespace, not from constants: the credential belongs to the installation, as does the binding.
 *
 * The provider's injection token is the class itself, so a consumer injects `Client` without
 * `@Inject`.
 */
export const notionClientProvider: Provider = {
  provide: Client,
  inject: [notionConfig.KEY],
  useFactory: (notion: NotionConfig): Client =>
    new Client({ auth: notion.apiToken, notionVersion: notion.apiVersion }),
};
