import { parse } from 'yaml';
import { anchorSlug, checkAnchor } from '../../src/knowledge/anchor-page';
import type { GbrainPort } from '../../src/memory/gbrain-client';
import { pageFromContent } from '../fixtures/gbrain-pages.fixture';
import {
  anchorPage,
  found,
  plainPage,
  plantAnchor,
  plantPage,
  type Waiting,
} from './gbrain-fixture';

const NOTION_ID = 'a0865184-6cda-69f0-e8e0-3884c8610ce5';
const COMPACT = 'a08651846cda69f0e8e03884c8610ce5';
const SLUG = anchorSlug('project', NOTION_ID);
const NAMED = `[{"slug":"${SLUG}","title":"x"}]`;

/** A wait without pauses: the test does not wait but counts attempts. */
const WAITING: Waiting = { attempts: 3, pauseMs: 0, sleep: () => Promise.resolve() };

/**
 * Builds a witness port: what was written, what was asked, and what search answers to the nth
 * query.
 */
function port(answers: readonly string[]): {
  port: GbrainPort;
  puts: { slug: string; content: string }[];
  searches: string[];
} {
  const puts: { slug: string; content: string }[] = [];
  const searches: string[] = [];

  return {
    puts,
    searches,
    port: {
      putPage: (slug: string, content: string) => {
        puts.push({ slug, content });

        return Promise.resolve();
      },
      deletePage: () => Promise.resolve(),
      search: (text: string) => {
        searches.push(text);

        return Promise.resolve(answers[Math.min(searches.length, answers.length) - 1] ?? '');
      },
    },
  };
}

describe('a scenario anchor', () => {
  const input = {
    type: 'project',
    notionId: COMPACT,
    title: 'Сайт: "запуск"',
    paragraphs: ['Урок: ескалація дала відповідь того ж дня.', 'Друга нотатка.'],
  } as const;

  it('the slug and content follow the anchor convention: the page conforms to it with no problems', () => {
    const page = anchorPage(input);

    expect(page.slug).toBe(SLUG);
    expect(checkAnchor(pageFromContent(page.slug, page.content))).toEqual([]);
  });

  it('has the hyphenated id in the frontmatter and body, the title as YAML and the paragraphs, and says nothing about the gate', () => {
    const { content } = anchorPage(input);
    const frontmatter: unknown = parse(content.split('---\n')[1] ?? '');

    expect(content).toContain(`notion_id: ${NOTION_ID}`);
    expect(content).toContain(`Notion: ${NOTION_ID}`);
    expect(frontmatter).toMatchObject({ title: 'Сайт: "запуск"', type: 'project' });
    expect(content).toContain('Друга нотатка.');
    expect(content).not.toMatch(/gate/i);
  });
});

describe('a page that is not an anchor', () => {
  it('has only type and title in the frontmatter and, when it mentions an object, its id', () => {
    const { content } = plainPage({
      slug: 'lessons/a',
      type: 'note',
      title: 'Урок',
      paragraphs: ['Текст.'],
      mentions: COMPACT,
    });
    const page = pageFromContent('lessons/a', content);

    expect(page.type).toBe('note');
    expect(page.frontmatter).toEqual({});
    expect(page.compiledTruth).toContain(NOTION_ID);
    expect(page.compiledTruth).not.toMatch(/^Notion:/m);
  });
});

describe('waiting for a page in search', () => {
  it('asks until the answer names the page', async () => {
    const seen = port(['[]', '[]', NAMED]);

    await found(seen.port, NOTION_ID, WAITING, SLUG);

    expect(seen.searches).toEqual([NOTION_ID, NOTION_ID, NOTION_ID]);
  });

  it('a slug in another case is named too', async () => {
    await expect(found(port([NAMED.toUpperCase()]).port, NOTION_ID, WAITING, SLUG)).resolves.toBe(
      undefined,
    );
  });

  it('beyond the attempt limit it fails with the start of the last answer', async () => {
    const seen = port(['[{"slug":"projects/other"}]']);

    await expect(found(seen.port, NOTION_ID, WAITING, SLUG)).rejects.toThrow(
      /after 3 attempts: \[\{"slug":"projects\/other"\}\]/,
    );
    expect(seen.searches).toHaveLength(3);
  });
});

describe('writing a project anchor', () => {
  const INPUT = { notionId: COMPACT, projectName: 'Сайт', paragraphs: ['Нотатка світу.'] };

  it('the anchor remembers exactly what the world named', async () => {
    const seen = port([NAMED]);

    await plantAnchor(seen.port, { gbrainPages: [] }, INPUT, WAITING);

    expect(seen.puts[0]?.content).toContain('Нотатка світу.');
  });

  it('writes one page under the slug derived from the id and waits until search finds it by the project id', async () => {
    const seen = port([NAMED]);

    await expect(plantAnchor(seen.port, { gbrainPages: [] }, INPUT, WAITING)).resolves.toBe(SLUG);

    expect(seen.puts.map((put) => put.slug)).toEqual([SLUG]);
    expect(seen.searches).toEqual([NOTION_ID]);
  });

  /**
   * A write the client did not wait for may be completed by GBrain later, so the slug must be in
   * the register before the write, not after it succeeds.
   */
  it('the slug is in the register at the time of the write', async () => {
    const residue: { gbrainPages: string[] } = { gbrainPages: [] };
    const seenAtWrite: string[][] = [];
    const watching: GbrainPort = {
      putPage: () => {
        seenAtWrite.push([...residue.gbrainPages]);

        return Promise.resolve();
      },
      deletePage: () => Promise.resolve(),
      search: () => Promise.resolve(NAMED),
    };

    await plantAnchor(watching, residue, INPUT, WAITING);

    expect(seenAtWrite).toEqual([[SLUG]]);
  });

  it('a write failure does not reach search, but the slug stays in the register', async () => {
    const searches: string[] = [];
    const residue: { gbrainPages: string[] } = { gbrainPages: [] };
    const failing: GbrainPort = {
      putPage: () => Promise.reject(new Error('write refused')),
      deletePage: () => Promise.resolve(),
      search: (text: string) => {
        searches.push(text);

        return Promise.resolve(NAMED);
      },
    };

    await expect(plantAnchor(failing, residue, INPUT, WAITING)).rejects.toThrow('write refused');
    expect(searches).toEqual([]);
    expect(residue.gbrainPages).toEqual([SLUG]);
  });

  /**
   * The write was accepted but search does not see it: the page exists, so cleanup knows about it.
   */
  it('a wait failure leaves the slug in the register', async () => {
    const residue: { gbrainPages: string[] } = { gbrainPages: [] };

    await expect(plantAnchor(port(['[]']).port, residue, INPUT, WAITING)).rejects.toThrow(
      'does not name',
    );
    expect(residue.gbrainPages).toEqual([SLUG]);
  });

  it('when a write is accepted but not yet finished, the scenario does not start until the page is visible', async () => {
    const seen = port(['{"error":"write_pending"}', NAMED]);

    await plantAnchor(seen.port, { gbrainPages: [] }, INPUT, WAITING);

    expect(seen.searches).toHaveLength(2);
  });
});

describe('writing a scenario page', () => {
  const PAGE = {
    slug: 'projects/a08651846cda69f0e8e03884c8610ce5',
    content: '---\ntype: project\n---\n',
    findBy: COMPACT,
  };

  it('writes the page under its slug and waits until search names this slug and no other', async () => {
    const seen = port(['[{"slug":"projects/other"}]', `[{"slug":"${PAGE.slug}"}]`]);
    const residue: { gbrainPages: string[] } = { gbrainPages: [] };

    await plantPage(seen.port, residue, PAGE, WAITING);

    expect(seen.puts).toEqual([{ slug: PAGE.slug, content: PAGE.content }]);
    expect(seen.searches).toEqual([COMPACT, COMPACT]);
    expect(residue.gbrainPages).toEqual([PAGE.slug]);
  });

  it('the slug is in the register even when search never named the page', async () => {
    const residue: { gbrainPages: string[] } = { gbrainPages: [] };

    await expect(plantPage(port(['[]']).port, residue, PAGE, WAITING)).rejects.toThrow(
      /does not name projects\/a08651846cda69f0e8e03884c8610ce5 after 3 attempts/,
    );
    expect(residue.gbrainPages).toEqual([PAGE.slug]);
  });
});
