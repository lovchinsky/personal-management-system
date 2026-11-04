import { canonical } from './contracts';
import { skillFiles } from './plugin-files';

const DETECTORS = 'skills/personal-management-system/knowledge/detectors.md';

/**
 * `INV-039` `detectors.md` is a single multi-label ontology. The canonical list of labels is in
 * `contracts/canonical.yaml`, key `detector_labels`.
 *
 * The check is static: the file has a section for every label of the contract, in the order in
 * which the contract declares them, and introduces no label the contract does not have. There is
 * a single detectors file, so there is no second list that could diverge from the first.
 */
describe('INV-039', () => {
  const labels = canonical.detectorLabels();
  const detectors = skillFiles().find((file) => file.path === DETECTORS);

  it('the detectors file exists and there is something to check', () => {
    expect(detectors).toBeDefined();
    expect(labels.length).toBeGreaterThan(0);
  });

  /**
   * The section of each label is headed by the label itself. There are exactly as many sections
   * as the contract has labels, in the contract's order.
   */
  it('the label sections are exactly the contract labels, in the contract order', () => {
    const headings = [...(detectors?.text ?? '').matchAll(/^### ([a-z]+(?:_[a-z]+)*)$/gm)].map(
      (match) => match[1],
    );

    expect(headings).toEqual(labels);
  });

  it('there is one detectors file', () => {
    expect(skillFiles().filter((file) => /detector/i.test(file.path))).toHaveLength(1);
  });
});
