/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { describe, it, expect } from 'vitest';
import { classifyJobTitle } from '../../../lib/services/regionalData/jobTitles.js';

// Headlines are real, from Jobindex on 2026-10-04.
describe('classifyJobTitle', () => {
  it.each([
    'Ernæringsassistent søges til Mad & Ernæring, AUH',
    'Økonoma eller ernæringsassistent til Nøddebo børnehave',
    'Faglært køkken-/ernæringsassistent',
    'Ernæringsassistenter til kantinen på Regionsgården – Center for Ejendomme',
    'Kokke, Cater, Smørrebrødsjomfruer & Ernæringsassistent søges',
    'Vi søger en køkkenassistent i Aalestrup',
    'Køkkenleder/-ernæringsassistent søges til Den Selvejende Institution Bramsnæs',
  ])('counts "%s" as the profession itself', (headline) => {
    expect(classifyJobTitle(headline)).toBe('exact');
  });

  it.each([
    'Køkkenmedarbejder',
    '2 køkkenmedarbejdere',
    'Køkkenmedarbejder til Børnehuset ved Volden på 30 timer om ugen',
    'Køkkenmedhjælper',
    'Køkkenfaglig medarbejder',
    'Kostfaglig eneansvarlig til Børnehuset Mælkevejen',
    'Kok eller kvalificeret madhåndværker',
    'Ny kollega til køkken og patientrestaurant',
    'Personale søges til Køkkenet på Esbjerg sygehus',
    'Askov Højskole og Efterskole søger madglad ildsjæl',
    'Medarbejder til produktionskøkkenet på Lokalcenter Rosengård søges',
    'Vil du lave mad, der virkelig betyder noget?',
    'Faglært med passion for mad? Bliv en del af vores kantineteam i psykiatrien i Roskilde',
  ])('counts "%s" as other kitchen work', (headline) => {
    expect(classifyJobTitle(headline)).toBe('kitchen');
  });

  it.each([
    'Tre ernæringsassistentelever til Københavns Kommune',
    'Elevstilling som Ernæringsassistent ved Aktivitetsområde Vest, Bangsbo',
    'Bliv ernæringsassistent-elev: Vil du lære et madfag, der gør en forskel hver eneste dag?',
    'Caterelev',
    'Gastronomelev med speciale i smørrebrød og catering søges!',
    'Start din karriere som kostfaglig elev i Forsvarets Kantiner ved Beredskabsstyrelsen i Bir',
    'Puiaq søger en Praktikant, en Ernæringshjælper eller Ernæringsassistent',
  ])('leaves out the apprentice post "%s"', (headline) => {
    expect(classifyJobTitle(headline)).toBeNull();
  });

  it.each([
    'Kantineleder søges til barselsvikariat ca. 1 år på Trekronerskolen',
    'Souschef med flair for ledelse og udvikling til Forsvarets Kantiner på Dragon Kasernen',
    'Funktionsleder for måltidsværtskab og satellitkøkkener',
    'Husassistent til opvasketeamet i Køkkenet på Bispebjerg Hospital',
    'Vil du være koordinator i et køkken, der er gennemsyret af økologi og bæredygtighed?',
  ])('leaves out the management or cleaning post "%s"', (headline) => {
    expect(classifyJobTitle(headline)).toBeNull();
  });

  it.each([
    'Social- og sundhedsassistent til Plejecenter Trye',
    'Sygeplejerske søges til hjemmeplejedistrikt Bredsten',
    'Pædagog til Hald Ege Børnehus, vuggestuen',
    'Gruppeleder til Solgården',
  ])('ignores the unrelated "%s"', (headline) => {
    expect(classifyJobTitle(headline)).toBeNull();
  });

  it('does not take "elevernes" for an apprentice post', () => {
    expect(classifyJobTitle('Ernæringsassistent til elevernes frokost')).toBe('exact');
  });

  it('copes with nothing', () => {
    expect(classifyJobTitle('')).toBeNull();
    expect(classifyJobTitle(null)).toBeNull();
    expect(classifyJobTitle(undefined)).toBeNull();
    expect(classifyJobTitle(42)).toBeNull();
  });
});
