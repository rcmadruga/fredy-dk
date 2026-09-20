/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UDDANNELSESSTATISTIK_API_KEY_ENV } from '../../../lib/services/regionalData/constants.js';
import {
  hasApiKey,
  readApiKey,
  fetchSchoolStats,
  joinSchoolStats,
  parseDanishNumber,
  recentSchoolYears,
} from '../../../lib/services/regionalData/schoolClient.js';

const originalEnv = process.env[UDDANNELSESSTATISTIK_API_KEY_ENV];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  delete process.env[UDDANNELSESSTATISTIK_API_KEY_ENV];
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalEnv === undefined) {
    delete process.env[UDDANNELSESSTATISTIK_API_KEY_ENV];
  } else {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = originalEnv;
  }
});

describe('readApiKey', () => {
  it('strips the quotes and whitespace that come in with an env file or a wrapped paste', () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = ' "abc.def \n ghi.jkl" ';
    expect(readApiKey()).toBe('abc.defghi.jkl');
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = "'abc.def.ghi'";
    expect(readApiKey()).toBe('abc.def.ghi');
  });

  it('leaves a clean key alone, and reads nothing as nothing', () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = 'abc.def.ghi';
    expect(readApiKey()).toBe('abc.def.ghi');
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = '  ""  ';
    expect(readApiKey()).toBeNull();
    delete process.env[UDDANNELSESSTATISTIK_API_KEY_ENV];
    expect(readApiKey()).toBeNull();
  });

  it('is what is sent as the bearer token', async () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = '"abc.def \n ghi"';
    fetch.mockResolvedValue({ ok: true, json: async () => [] });
    await fetchSchoolStats();
    const [, options] = fetch.mock.calls.find(([url]) => String(url).includes('uddannelsesstatistik'));
    expect(options.headers.Authorization).toBe('Bearer abc.defghi');
  });
});

describe('hasApiKey', () => {
  it('is false when the env var is not set', () => {
    expect(hasApiKey()).toBe(false);
  });

  it('is false for a blank value', () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = '   ';
    expect(hasApiKey()).toBe(false);
  });

  it('is true once a key is set', () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = 'test-key';
    expect(hasApiKey()).toBe(true);
  });
});

// The shapes below are copied from the live API (POST /Api/v1/statistik), not invented: bracketed
// dimension keys, measures under their bare names, and figures written the Danish way.
const ID = '[Institution].[Institutionsnummer].[Institutionsnummer]';
const NAME = '[Institution].[Institution].[Institution]';
const YEAR = '[Skoleår].[Skoleår].[Skoleår]';
const AFD = '[Institution].[Afdelingsnummer].[Afdelingsnummer]';

const inclusionRow = (id, name, year, values = {}) => ({
  [ID]: id,
  [NAME]: name,
  [YEAR]: year,
  Inklusionsgrad: '',
  'Andel der modtager seg specialundervisning': '',
  'Antal elever': '',
  ...values,
});
const gradeRow = (id, year, grade) => ({ [AFD]: id, [YEAR]: year, Karaktergennemsnit: grade });

const place = (overrides = {}) => ({
  lat: 55.69,
  lng: 12.58,
  type: 'Folkeskoler',
  address: 'Øster Voldgade 15, 1350 København K',
  website: 'https://example.dk/',
  active: true,
  ...overrides,
});

describe('parseDanishNumber', () => {
  it('reads the way the API writes figures', () => {
    expect(parseDanishNumber('83,9 %')).toBe(83.9);
    expect(parseDanishNumber('7,7')).toBe(7.7);
    expect(parseDanishNumber('505')).toBe(505);
    expect(parseDanishNumber('1.234,5')).toBe(1234.5);
  });

  it('says "no figure" with null, never with 0', () => {
    expect(parseDanishNumber('')).toBeNull();
    expect(parseDanishNumber(null)).toBeNull();
    expect(parseDanishNumber('n/a')).toBeNull();
    expect(parseDanishNumber('0,0 %')).toBe(0);
  });
});

describe('recentSchoolYears', () => {
  it('starts the school year in August', () => {
    expect(recentSchoolYears(new Date(2026, 8, 20))).toEqual(['2026/2027', '2025/2026', '2024/2025']);
    expect(recentSchoolYears(new Date(2026, 6, 31))).toEqual(['2025/2026', '2024/2025', '2023/2024']);
  });
});

describe('joinSchoolStats', () => {
  it('places a school by its institution number and carries its inclusion figures', () => {
    const [school] = joinSchoolStats({
      inclusionRows: [
        inclusionRow('101003', 'Nyboder Skole', '2025/2026', {
          Inklusionsgrad: '83,7 %',
          'Andel der modtager seg specialundervisning': '16,3 %',
          'Antal elever': '429',
        }),
      ],
      gradeRows: [gradeRow('101003', '2025/2026', '8,0')],
      register: new Map([['101003', place()]]),
    });

    expect(school).toEqual({
      id: '101003',
      name: 'Nyboder Skole',
      lat: 55.69,
      lng: 12.58,
      schoolType: 'Folkeskoler',
      isSpecialSchool: false,
      inclusionPct: 83.7,
      specialClassPct: 16.3,
      pupils: 429,
      gradeAverage: 8,
      schoolYear: '2025/2026',
      gradeYear: '2025/2026',
      address: 'Øster Voldgade 15, 1350 København K',
      website: 'https://example.dk/',
    });
  });

  it('marks a special school as one, so the map can show the offer rather than a 0 % score', () => {
    const [school] = joinSchoolStats({
      inclusionRows: [inclusionRow('101093', 'Skolen i Charlottegården', '2025/2026', { 'Antal elever': '190' })],
      gradeRows: [],
      register: new Map([['101093', place({ type: 'Specialskoler for børn' })]]),
    });

    expect(school.isSpecialSchool).toBe(true);
    expect(school.pupils).toBe(190);
    expect(school.inclusionPct).toBeNull();
  });

  it.each(['Behandlings- og specialundervisningstilbud', 'Uddannelsesinstitutioner for unge med særlige behov'])(
    'treats "%s" as special-needs provision too',
    (type) => {
      const [school] = joinSchoolStats({
        inclusionRows: [inclusionRow('9', 'X', '2025/2026', { 'Antal elever': '10' })],
        gradeRows: [],
        register: new Map([['9', place({ type })]]),
      });
      expect(school.isSpecialSchool).toBe(true);
    },
  );

  it('does not let a newer year with nothing in it hide an older one that has figures', () => {
    const [school] = joinSchoolStats({
      inclusionRows: [
        inclusionRow('1', 'S', '2024/2025', { Inklusionsgrad: '90,0 %', 'Antal elever': '300' }),
        inclusionRow('1', 'S', '2025/2026'),
      ],
      gradeRows: [],
      register: new Map([['1', place()]]),
    });

    expect(school.inclusionPct).toBe(90);
    expect(school.schoolYear).toBe('2024/2025');
  });

  it('takes the newest year that has figures', () => {
    const [school] = joinSchoolStats({
      inclusionRows: [
        inclusionRow('1', 'S', '2023/2024', { Inklusionsgrad: '80,0 %' }),
        inclusionRow('1', 'S', '2025/2026', { Inklusionsgrad: '95,0 %' }),
        inclusionRow('1', 'S', '2024/2025', { Inklusionsgrad: '90,0 %' }),
      ],
      gradeRows: [],
      register: new Map([['1', place()]]),
    });

    expect(school.inclusionPct).toBe(95);
  });

  it('reports the grade average with its own year, which can lag the inclusion figures', () => {
    const [school] = joinSchoolStats({
      inclusionRows: [inclusionRow('1', 'S', '2025/2026', { Inklusionsgrad: '95,0 %' })],
      gradeRows: [gradeRow('1', '2024/2025', '7,5'), gradeRow('1', '2025/2026', '')],
      register: new Map([['1', place()]]),
    });

    expect(school.gradeAverage).toBe(7.5);
    expect(school.gradeYear).toBe('2024/2025');
    expect(school.schoolYear).toBe('2025/2026');
  });

  it('leaves out a school the register has no position for, and one it has closed', () => {
    const schools = joinSchoolStats({
      inclusionRows: [
        inclusionRow('1', 'Unplaced', '2025/2026', { Inklusionsgrad: '90,0 %' }),
        inclusionRow('2', 'Closed', '2025/2026', { Inklusionsgrad: '90,0 %' }),
        inclusionRow('3', 'Open', '2025/2026', { Inklusionsgrad: '90,0 %' }),
      ],
      gradeRows: [],
      register: new Map([
        ['2', place({ active: false })],
        ['3', place()],
      ]),
    });

    expect(schools.map((school) => school.id)).toEqual(['3']);
  });

  it('leaves out an institution that has no figure at all', () => {
    const schools = joinSchoolStats({
      inclusionRows: [inclusionRow('1', 'Empty', '2025/2026')],
      gradeRows: [],
      register: new Map([['1', place()]]),
    });

    expect(schools).toEqual([]);
  });
});

describe('fetchSchoolStats', () => {
  const registerBody = [
    {
      institutionNumber: 101003,
      institutionType: 'Folkeskoler',
      latitude: 55.69,
      longitude: 12.58,
      address: 'Øster Voldgade 15',
      postalCode: '1350',
      postalDistrict: 'København K',
      website: 'nyboderskole.aula.dk',
      activeCodeName: 'Aktiv tællingsmæssigt for Danmarks Statistik',
    },
  ];

  /** Answers each of the three upstream calls by URL and, for the two cube queries, by table. */
  const answer =
    ({ inclusion, grades, register = registerBody } = {}) =>
    async (url, options) => {
      if (String(url).includes('institutionsregisteret')) return { ok: true, json: async () => register };
      const body = JSON.parse(options.body);
      if (body.underemne === 'ELEVEX') return inclusion ?? { ok: true, json: async () => [] };
      return grades ?? { ok: true, json: async () => [] };
    };

  it('makes no request at all without a key - the whole point of the graceful degradation', async () => {
    const result = await fetchSchoolStats();

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends the key as a bearer token, and asks for the tables that hold inclusion and grades', async () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = 'secret-key';
    fetch.mockImplementation(answer());

    await fetchSchoolStats();

    const cubeCalls = fetch.mock.calls.filter(([url]) => String(url).includes('uddannelsesstatistik'));
    expect(cubeCalls).toHaveLength(2);
    for (const [, options] of cubeCalls) {
      expect(options.headers.Authorization).toBe('Bearer secret-key');
    }
    const bodies = cubeCalls.map(([, options]) => JSON.parse(options.body));
    expect(bodies.map((body) => body.underemne).sort()).toEqual(['ELEVEX', 'OVERSKO']);
    expect(bodies.every((body) => body.område === 'GS')).toBe(true);
    expect(bodies.every((body) => body.filtre['[Skoleår].[Skoleår]'].length === 3)).toBe(true);
  });

  it('joins what the API answers with the register into placed schools', async () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = 'secret-key';
    fetch.mockImplementation(
      answer({
        inclusion: {
          ok: true,
          json: async () => [inclusionRow('101003', 'Nyboder Skole', '2025/2026', { Inklusionsgrad: '83,7 %' })],
        },
      }),
    );

    const schools = await fetchSchoolStats();

    expect(schools).toHaveLength(1);
    expect(schools[0]).toMatchObject({
      id: '101003',
      name: 'Nyboder Skole',
      lat: 55.69,
      inclusionPct: 83.7,
      website: 'https://nyboderskole.aula.dk/',
      address: 'Øster Voldgade 15, 1350 København K',
    });
  });

  it('still returns the schools when only the grade average could not be had', async () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = 'secret-key';
    fetch.mockImplementation(
      answer({
        inclusion: {
          ok: true,
          json: async () => [inclusionRow('101003', 'Nyboder Skole', '2025/2026', { Inklusionsgrad: '83,7 %' })],
        },
        grades: { ok: false, status: 500 },
      }),
    );

    const schools = await fetchSchoolStats();

    expect(schools).toHaveLength(1);
    expect(schools[0].gradeAverage).toBeNull();
  });

  it('resolves to null when the inclusion table cannot be had', async () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = 'secret-key';
    fetch.mockImplementation(answer({ inclusion: { ok: false, status: 401 } }));

    await expect(fetchSchoolStats()).resolves.toBeNull();
  });

  it('resolves to null when the register cannot be had, since nothing could be placed', async () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = 'secret-key';
    fetch.mockImplementation(async (url, options) =>
      String(url).includes('institutionsregisteret') ? { ok: false, status: 503 } : answer()(url, options),
    );

    await expect(fetchSchoolStats()).resolves.toBeNull();
  });

  it('resolves to null rather than throwing when the request itself fails', async () => {
    process.env[UDDANNELSESSTATISTIK_API_KEY_ENV] = 'secret-key';
    fetch.mockRejectedValue(new Error('network down'));

    await expect(fetchSchoolStats()).resolves.toBeNull();
  });
});
