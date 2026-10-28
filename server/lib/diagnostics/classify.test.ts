import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { ServarrRelease } from '@server/lib/diagnostics/classify';
import {
  classifyRejection,
  classifyReleases,
} from '@server/lib/diagnostics/classify';
import { DiagnosisCategory } from '@server/lib/diagnostics/types';

// Real Radarr v5 search results (trimmed, no indexer links) for stuck requests.
const fixture = (name: string): ServarrRelease[] =>
  JSON.parse(
    readFileSync(join(__dirname, 'fixtures', `radarr-${name}.json`), 'utf-8')
  );

describe('classifyRejection', () => {
  it('groups Radarr/Sonarr messages', () => {
    assert.equal(
      classifyRejection(
        'Unknown Movie. Unable to identify correct movie using release name.'
      ),
      'other_title'
    );
    assert.equal(classifyRejection('Wrong season'), 'other_title');
    assert.equal(
      classifyRejection('Bluray-720p is not wanted in profile'),
      'quality'
    );
    assert.equal(
      classifyRejection(
        '1.2 GB is smaller than minimum allowed 3.1 GB (for Movie)'
      ),
      'quality'
    );
    assert.equal(
      classifyRejection('English is wanted, but found Chinese'),
      'language'
    );
    assert.equal(
      classifyRejection('Existing file meets cutoff: WEB 1080p'),
      'existing'
    );
    assert.equal(
      classifyRejection('Not enough seeders: 0. Minimum seeders: 1'),
      'dead'
    );
    assert.equal(classifyRejection('Release is blocklisted'), 'other');
  });
});

describe('classifyReleases', () => {
  it('finds grabbable releases that were never grabbed (Hoodwinked!)', () => {
    const { category, summary } = classifyReleases(fixture('hoodwinked'));
    assert.equal(category, DiagnosisCategory.READY_TO_GRAB);
    assert.equal(summary.acceptable, 3);
  });

  it('reports no results when every hit is another title (Kaaka Muttai)', () => {
    const { category, summary } = classifyReleases(fixture('kaaka-muttai'));
    assert.equal(category, DiagnosisCategory.NO_RESULTS);
    assert.equal(summary.results, 0);
  });

  it('reports no results for an empty search', () => {
    assert.equal(
      classifyReleases(fixture('sebastian')).category,
      DiagnosisCategory.NO_RESULTS
    );
  });

  it('reports language when only foreign-language releases exist (18x2)', () => {
    const { category, summary } = classifyReleases(fixture('18x2'));
    assert.equal(category, DiagnosisCategory.LANGUAGE_UNMET);
    assert.deepEqual(summary.languagesFound, ['Chinese']);
    assert.equal(summary.bestAlternative?.languages[0], 'Chinese');
  });

  it('treats copies that are only too small as unusable (Harold & Kumar)', () => {
    // Both copies are 114-244 MB: fakes, which no fallback profile would take.
    const { category } = classifyReleases(fixture('harold-kumar'));
    assert.equal(category, DiagnosisCategory.OTHER_REJECTED);
  });

  it('prefers a real lower-quality copy over a fake (Hoodwinked!)', () => {
    const quality = fixture('hoodwinked').filter((r) => !r.approved);
    const { category, summary } = classifyReleases(quality);
    assert.equal(category, DiagnosisCategory.QUALITY_UNMET);
    assert.ok(summary.bestAlternative);
    assert.ok(summary.bestAlternative.size > 1e9);
  });

  it('counts wrong-language, lower-quality copies as a language problem (Tamizh Padam 2)', () => {
    const { category, summary } = classifyReleases(fixture('tamizh-padam-2'));
    assert.equal(category, DiagnosisCategory.LANGUAGE_UNMET);
    assert.deepEqual(summary.languagesFound, ['Tamil']);
  });

  it('keeps not-released ahead of grabbable releases (The Odyssey)', () => {
    const { category, summary } = classifyReleases(fixture('the-odyssey'), {
      released: false,
    });
    assert.equal(category, DiagnosisCategory.NOT_RELEASED);
    assert.equal(summary.acceptable, 1);
  });

  it('never lets other titles count towards results (Hanuman Ansh)', () => {
    const { summary } = classifyReleases(fixture('hanuman-ansh'), {
      released: false,
    });
    assert.ok(summary.results < 10);
  });
});
