/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { buildSchoolPopupHtml, buildTaxPopupHtml } from '../../ui/src/components/map/regionalPopups.js';

// Echoes the key, so an assertion can say which label a line carries without depending on wording.
const t = (key) => key;

const ordinary = {
  name: 'Nyboder Skole',
  schoolType: 'Folkeskoler',
  isSpecialSchool: false,
  inclusionPct: 83.7,
  specialClassPct: 16.3,
  pupils: 429,
  gradeAverage: 8,
  schoolYear: '2025/2026',
  gradeYear: '2024/2025',
  address: 'Øster Voldgade 15, 1350 København K',
  website: 'https://nyboderskole.aula.dk/',
};

describe('buildSchoolPopupHtml', () => {
  it('shows the inclusion figures of an ordinary school, with the years they are from', () => {
    const html = buildSchoolPopupHtml(ordinary, t);

    expect(html).toContain('Nyboder Skole');
    expect(html).toContain('map.schoolPopupInclusionPct: 83.7%');
    expect(html).toContain('map.schoolPopupSpecialClassPct: 16.3%');
    expect(html).toContain('map.schoolPopupPupils: 429');
    expect(html).toContain('map.schoolPopupGradeAverage: 8.0 (2024/2025)');
    expect(html).toContain('map.schoolPopupYear: 2025/2026');
  });

  it('leads a special school with what it is and shows no inclusion score for it', () => {
    const html = buildSchoolPopupHtml(
      {
        ...ordinary,
        isSpecialSchool: true,
        schoolType: 'Specialskoler for børn',
        inclusionPct: 0,
        specialClassPct: 100,
      },
      t,
    );

    expect(html).toContain('map.schoolPopupSpecialSchool');
    expect(html).toContain('Specialskoler for børn');
    expect(html).not.toContain('map.schoolPopupInclusionPct');
    expect(html).not.toContain('0.0%');
  });

  it('says n/a for a figure it has none of, and leaves out a grade average that does not exist', () => {
    const html = buildSchoolPopupHtml({ ...ordinary, inclusionPct: null, gradeAverage: null }, (key) =>
      key === 'common.na' ? 'n/a' : key,
    );

    expect(html).toContain('map.schoolPopupInclusionPct: n/a');
    expect(html).not.toContain('map.schoolPopupGradeAverage');
  });

  it('escapes everything that came from the register', () => {
    const html = buildSchoolPopupHtml(
      { ...ordinary, name: '<img src=x onerror=alert(1)>', address: '<script>x</script>', schoolType: '"><b>' },
      t,
    );

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('links a website only when it is http(s)', () => {
    expect(buildSchoolPopupHtml(ordinary, t)).toContain('href="https://nyboderskole.aula.dk/"');
    expect(buildSchoolPopupHtml(ordinary, t)).toContain('rel="noopener noreferrer"');
    expect(buildSchoolPopupHtml({ ...ordinary, website: 'javascript:alert(1)' }, t)).not.toContain('<a ');
    expect(buildSchoolPopupHtml({ ...ordinary, website: null }, t)).not.toContain('<a ');
  });
});

describe('buildTaxPopupHtml', () => {
  it('shows both rates, and escapes the kommune name', () => {
    const html = buildTaxPopupHtml({ name: 'Ærø <b>', kommuneskatPct: 24.5, grundskyldPromille: 6 }, t);

    expect(html).toContain('map.taxPopupKommuneskat: 24.5%');
    expect(html).toContain('map.taxPopupGrundskyld: 6.0‰');
    expect(html).toContain('Ærø &lt;b&gt;');
  });
});
