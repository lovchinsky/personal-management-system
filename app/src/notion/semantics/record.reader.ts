import { Injectable } from '@nestjs/common';
import { CanonicalType } from '../binding/binding.schema';
import { BodyReader } from '../client/body/body.reader';
import { PageReader } from '../client/page.reader';
import { DecodedRecord } from './decoded-record';
import { SemanticAdapter } from './semantic.adapter';

/**
 * Reads and decodes one Notion record through the canonical model.
 *
 * The body is read on demand, not always. Reading it costs separate requests, one per block with
 * children, and a detector that needs only the status has no reason to pay for prose. A body
 * that was not read yields `unread` for the prose semantics. That is more honest than `absent`,
 * which would assert emptiness.
 *
 * The consumers are the gate, which reads the created world through the canonical model, and the
 * detectors (`docs/5-plan.md`). The class exists for them.
 */
@Injectable()
export class NotionRecordReader {
  constructor(
    private readonly pages: PageReader,
    private readonly bodies: BodyReader,
    private readonly adapter: SemanticAdapter,
  ) {}

  async read<T extends CanonicalType>(
    type: T,
    pageId: string,
    options: { readonly withBody?: boolean } = {},
  ): Promise<DecodedRecord<T>> {
    const page = await this.pages.page(pageId);
    const body = options.withBody === true ? await this.bodies.body(pageId) : undefined;

    return this.adapter.decode(type, page, body);
  }
}
