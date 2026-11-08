/**
 * Struktura uczelni do pelnej bazy testowej (orientacyjnie wg UMG, stan 2024/25):
 * wydzialy, kierunki, specjalnosci, programy (kod, poziom, tryb, liczba semestrow),
 * liczby studentow wydzialow (gov.pl, zal. 4, stan na 31.12.2024) i siatki godzin.
 *
 * Programy "real" sa w programy.json (sparsowane z publikowanych planow studiow WN i WM —
 * zrodla w polu `source`). Programy "gen" (WE, WZNJ: brak tabel godzin w publikacjach albo
 * strona niedostepna) generujemy z pul nazw przedmiotow ponizej — to dane orientacyjne.
 */

export type Mode = 'FULL_TIME' | 'PART_TIME';
export type Level = 'BACHELOR' | 'MASTER';

export interface SpecDef {
  short: string;
  name: string;
}

export interface ProgramDef {
  code: string;
  field: string; // shortName kierunku
  level: Level;
  mode: Mode;
  semesters: number;
  /** real = programy.json; gen = generator z pul nazw. */
  source: 'real' | 'gen';
  specs: SpecDef[];
  /** Nabor lutowy (II stopien) — dodatkowe roczniki startujace semestrem letnim. */
  summerIntake?: boolean;
  /** Wzgledna wielkosc naboru (przy podziale studentow wydzialu). */
  weight?: number;
}

export interface GridDef {
  blocks: [string, string][];
  days: { day: string; from: string | null; to: string | null }[];
}

export interface FacultyDef {
  short: string;
  name: string;
  students: { FULL_TIME: number; PART_TIME: number };
  fields: { short: string; name: string }[];
  grids: Record<Mode, GridDef>;
  buildings: string[];
}

const hourly = (from: number, to: number): [string, string][] =>
  Array.from({ length: to - from }, (_, i) => [`${String(from + i).padStart(2, '0')}:00`, `${String(from + i + 1).padStart(2, '0')}:00`]);

const pad = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Bloki 45 min od podanych startow. */
const blocks45 = (starts: string[]): [string, string][] =>
  starts.map((s) => {
    const [h, m] = s.split(':').map(Number);
    return [s, pad(h! * 60 + m! + 45)];
  });

const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].map((day) => ({ day, from: null, to: null }));
const ZJAZD = (fridayFrom: string) => [
  { day: 'FRIDAY', from: fridayFrom, to: null },
  { day: 'SATURDAY', from: null, to: null },
  { day: 'SUNDAY', from: null, to: null },
];

// Niestacjonarne WM/WN: 45 min + 5 min przerwy, przerwa obiadowa 12:55-13:30.
const NS_45_5 = blocks45([
  '08:00', '08:50', '09:40', '10:30', '11:20', '12:10',
  '13:30', '14:20', '15:10', '16:00', '16:50', '17:40', '18:30', '19:20',
]);

export const FACULTIES: FacultyDef[] = [
  {
    short: 'WE',
    name: 'Wydział Elektryczny',
    students: { FULL_TIME: 485, PART_TIME: 341 },
    fields: [
      { short: 'ET', name: 'Elektrotechnika' },
      { short: 'EiT', name: 'Elektronika i Telekomunikacja' },
      { short: 'INF', name: 'Informatyka' },
      { short: 'STI', name: 'Systemy Teleinformatyczne' },
    ],
    grids: {
      // 45 min, starty o :15 (07:15-08:00 ... 19:15-20:00)
      FULL_TIME: { blocks: blocks45(Array.from({ length: 13 }, (_, i) => `${String(7 + i).padStart(2, '0')}:15`)), days: WEEKDAYS },
      PART_TIME: { blocks: hourly(8, 21), days: ZJAZD('15:00') },
    },
    buildings: ['Budynek C (WE)', 'Budynek D (WE)'],
  },
  {
    short: 'WM',
    name: 'Wydział Mechaniczny',
    students: { FULL_TIME: 422, PART_TIME: 205 },
    fields: [
      { short: 'MiBM', name: 'Mechanika i Budowa Maszyn' },
      { short: 'EDST', name: 'Eksploatacja i Diagnostyka Systemów Technicznych' },
    ],
    grids: {
      FULL_TIME: { blocks: hourly(7, 19), days: WEEKDAYS },
      PART_TIME: { blocks: NS_45_5, days: ZJAZD('16:00') },
    },
    buildings: ['Budynek A (WM)', 'Hala Laboratoryjna (WM)'],
  },
  {
    short: 'WN',
    name: 'Wydział Nawigacyjny',
    students: { FULL_TIME: 967, PART_TIME: 299 },
    fields: [
      { short: 'NAW', name: 'Nawigacja' },
      { short: 'TR', name: 'Transport' },
    ],
    grids: {
      // pary 2 x 45 min: 07:30, 09:15, 11:00, 12:45, 14:30, 16:15, 18:00
      FULL_TIME: {
        blocks: ['07:30', '09:15', '11:00', '12:45', '14:30', '16:15', '18:00'].flatMap((s) => {
          const [h, m] = s.split(':').map(Number);
          const t = h! * 60 + m!;
          return [[pad(t), pad(t + 45)], [pad(t + 45), pad(t + 90)]] as [string, string][];
        }),
        days: WEEKDAYS,
      },
      PART_TIME: { blocks: NS_45_5, days: ZJAZD('16:00') },
    },
    buildings: ['Budynek B (WN)', 'Centrum Symulatorowe (WN)'],
  },
  {
    short: 'WZNJ',
    name: 'Wydział Zarządzania i Nauk o Jakości',
    students: { FULL_TIME: 721, PART_TIME: 208 },
    fields: [
      { short: 'ZAR', name: 'Zarządzanie' },
      { short: 'NoJ', name: 'Nauki o Jakości' },
      { short: 'IJ', name: 'Inżynieria Jakości' },
    ],
    grids: {
      FULL_TIME: { blocks: hourly(7, 20), days: WEEKDAYS },
      PART_TIME: { blocks: hourly(8, 20), days: ZJAZD('15:00') },
    },
    buildings: ['Budynek E (WZNJ)', 'Budynek F (WZNJ)'],
  },
];

// ─── Programy ────────────────────────────────────────────────

const S = (short: string, name: string): SpecDef => ({ short, name });

const MIBM_SPECS = [
  S('TRUOiP', 'Technologia Remontów Urządzeń Okrętowych i Portowych'),
  S('IEI', 'Inżynieria Eksploatacji Instalacji'),
  S('IP', 'Inżynieria Produkcji'),
];
const EDST_SPECS = [S('DUT', 'Diagnostyka Urządzeń Technicznych'), S('ZEEW', 'Zarządzanie Eksploatacją Elektrowni Wiatrowych')];
const NAW2_SPECS = [
  S('TO', 'Technologie Offshorowe'),
  S('EZ', 'Eksploatacja Zbiornikowców'),
  S('MSI', 'Morskie Systemy Informacyjne'),
  S('ZBTM', 'Zarządzanie Bezpieczeństwem w Transporcie Morskim'),
  S('APSE', 'Administrowanie Polską Strefą Ekonomiczną'),
  S('PHiON', 'Pomiary Hydrograficzne i Oznakowanie Nawigacyjne'),
  S('ŻA', 'Żegluga Arktyczna'),
];
const TR1_SPECS = [S('TiL', 'Transport i Logistyka'), S('EST', 'Eksploatacja Systemów Transportowych')];
const TR2_SPECS = [
  S('MSTiL', 'Morskie Systemy Transportowe i Logistyczne'),
  S('LSO', 'Logistyka w Sektorze Offshore'),
  S('ESTiL', 'Eksploatacja Systemów Transportowych i Logistycznych'),
  S('ZIiŚTŚ', 'Zarządzanie Infrastrukturą i Środkami Transportu Śródlądowego'),
];
const ET1_SPECS = [S('EAO', 'Elektroautomatyka Okrętowa'), S('KSS', 'Komputerowe Systemy Sterowania')];
const EIT1_SPECS = [S('EM', 'Elektronika Morska'), S('SiST', 'Systemy i Sieci Teleinformatyczne')];
const INF1_SPECS = [S('AIR', 'Aplikacje Internetu Rzeczy'), S('AIiM', 'Aplikacje Internetowe i Mobilne')];
const ET2_SPECS = [S('EA', 'Elektroautomatyka'), S('KSS', 'Komputerowe Systemy Sterowania'), S('OZE', 'Odnawialne Źródła Energii i Elektromobilność')];
const EIT2S_SPECS = [S('AiBSI', 'Automatyka i Bezpieczeństwo Systemów Informatycznych'), S('EiAM', 'Elektronika i Automatyka Morska'), S('SE', 'Systemy Elektroniczne')];
const EIT2N_SPECS = [S('SiST', 'Systemy i Sieci Teleinformatyczne'), S('SE', 'Systemy Elektroniczne')];
const STI2_SPECS = [S('APD', 'Analiza i Przetwarzanie Danych'), S('BTD', 'Bezpieczeństwo Transmisji Danych')];
const ZAR1_SPECS = [S('EM', 'Ekonomia Menedżerska'), S('MiH', 'Marketing i Handel'), S('STiL', 'Systemy Transportowe i Logistyczne'), S('TiH', 'Turystyka i Hotelarstwo')];
const ZAR2_SPECS = [S('ZO', 'Zarządzanie Organizacjami'), S('RiZF', 'Rachunkowość i Zarządzanie Finansami')];
const NOJ1_SPECS = [S('MP', 'Menedżer Produktu'), S('ZJT', 'Zarządzanie Jakością Towarów')];
const IJ2_SPECS = [S('MSZ', 'Menedżer Systemów Zarządzania'), S('MUD', 'Menedżer Usług Dietetycznych'), S('OWiGO', 'Ochrona Wód i Gospodarka Odpadami')];

export const PROGRAMS: ProgramDef[] = [
  // WN — programy z wn.umg.edu.pl/karty/siatki
  { code: 'NAW-S1', field: 'NAW', level: 'BACHELOR', mode: 'FULL_TIME', semesters: 8, source: 'real', specs: [], weight: 2.2 },
  { code: 'NAW-N1', field: 'NAW', level: 'BACHELOR', mode: 'PART_TIME', semesters: 8, source: 'real', specs: [], weight: 1.4 },
  { code: 'NAW-S2', field: 'NAW', level: 'MASTER', mode: 'FULL_TIME', semesters: 3, source: 'real', specs: NAW2_SPECS, summerIntake: true },
  { code: 'NAW-N2', field: 'NAW', level: 'MASTER', mode: 'PART_TIME', semesters: 3, source: 'real', specs: NAW2_SPECS.filter((s) => ['TO', 'ZBTM'].includes(s.short)), summerIntake: true },
  { code: 'TR-S1', field: 'TR', level: 'BACHELOR', mode: 'FULL_TIME', semesters: 7, source: 'real', specs: TR1_SPECS, weight: 1.6 },
  { code: 'TR-N1', field: 'TR', level: 'BACHELOR', mode: 'PART_TIME', semesters: 7, source: 'real', specs: TR1_SPECS, weight: 1.2 },
  { code: 'TR-S2', field: 'TR', level: 'MASTER', mode: 'FULL_TIME', semesters: 3, source: 'real', specs: TR2_SPECS, summerIntake: true },
  { code: 'TR-N2', field: 'TR', level: 'MASTER', mode: 'PART_TIME', semesters: 3, source: 'real', specs: TR2_SPECS, summerIntake: true },
  // WM — PDF-y z wm.umg.edu.pl/rok-akademicki-2025-2026
  { code: 'MIBM-S1', field: 'MiBM', level: 'BACHELOR', mode: 'FULL_TIME', semesters: 7, source: 'real', specs: MIBM_SPECS },
  { code: 'MIBM-N1', field: 'MiBM', level: 'BACHELOR', mode: 'PART_TIME', semesters: 7, source: 'real', specs: MIBM_SPECS },
  { code: 'ESO-S1', field: 'MiBM', level: 'BACHELOR', mode: 'FULL_TIME', semesters: 8, source: 'real', specs: [], weight: 1.4 },
  { code: 'ESO-N1', field: 'MiBM', level: 'BACHELOR', mode: 'PART_TIME', semesters: 8, source: 'real', specs: [], weight: 0.6 },
  { code: 'MIBM-S2', field: 'MiBM', level: 'MASTER', mode: 'FULL_TIME', semesters: 3, source: 'real', specs: [], summerIntake: true },
  { code: 'MIBM-N2', field: 'MiBM', level: 'MASTER', mode: 'PART_TIME', semesters: 3, source: 'real', specs: [], summerIntake: true },
  { code: 'EDST-S1', field: 'EDST', level: 'BACHELOR', mode: 'FULL_TIME', semesters: 7, source: 'real', specs: EDST_SPECS },
  { code: 'EDST-N1', field: 'EDST', level: 'BACHELOR', mode: 'PART_TIME', semesters: 7, source: 'real', specs: EDST_SPECS },
  // WE — generowane (PDF-y programow nie maja tabel godzin)
  { code: 'ET-S1', field: 'ET', level: 'BACHELOR', mode: 'FULL_TIME', semesters: 7, source: 'gen', specs: ET1_SPECS },
  { code: 'ET-N1', field: 'ET', level: 'BACHELOR', mode: 'PART_TIME', semesters: 8, source: 'gen', specs: ET1_SPECS },
  { code: 'EIT-S1', field: 'EiT', level: 'BACHELOR', mode: 'FULL_TIME', semesters: 7, source: 'gen', specs: EIT1_SPECS },
  { code: 'EIT-N1', field: 'EiT', level: 'BACHELOR', mode: 'PART_TIME', semesters: 8, source: 'gen', specs: EIT1_SPECS },
  { code: 'INF-S1', field: 'INF', level: 'BACHELOR', mode: 'FULL_TIME', semesters: 7, source: 'gen', specs: INF1_SPECS, weight: 1.3 },
  { code: 'ET-S2', field: 'ET', level: 'MASTER', mode: 'FULL_TIME', semesters: 3, source: 'gen', specs: ET2_SPECS },
  { code: 'ET-N2', field: 'ET', level: 'MASTER', mode: 'PART_TIME', semesters: 4, source: 'gen', specs: ET2_SPECS },
  { code: 'EIT-S2', field: 'EiT', level: 'MASTER', mode: 'FULL_TIME', semesters: 3, source: 'gen', specs: EIT2S_SPECS },
  { code: 'EIT-N2', field: 'EiT', level: 'MASTER', mode: 'PART_TIME', semesters: 4, source: 'gen', specs: EIT2N_SPECS },
  { code: 'STI-S2', field: 'STI', level: 'MASTER', mode: 'FULL_TIME', semesters: 3, source: 'gen', specs: STI2_SPECS },
  // WZNJ — generowane (strona wydzialu niedostepna z poprawnym TLS)
  { code: 'ZAR-S1', field: 'ZAR', level: 'BACHELOR', mode: 'FULL_TIME', semesters: 6, source: 'gen', specs: ZAR1_SPECS, weight: 1.6 },
  { code: 'ZAR-N1', field: 'ZAR', level: 'BACHELOR', mode: 'PART_TIME', semesters: 6, source: 'gen', specs: ZAR1_SPECS, weight: 1.2 },
  { code: 'ZAR-S2', field: 'ZAR', level: 'MASTER', mode: 'FULL_TIME', semesters: 4, source: 'gen', specs: ZAR2_SPECS },
  { code: 'ZAR-N2', field: 'ZAR', level: 'MASTER', mode: 'PART_TIME', semesters: 4, source: 'gen', specs: ZAR2_SPECS },
  { code: 'NOJ-S1', field: 'NoJ', level: 'BACHELOR', mode: 'FULL_TIME', semesters: 6, source: 'gen', specs: NOJ1_SPECS },
  { code: 'NOJ-N1', field: 'NoJ', level: 'BACHELOR', mode: 'PART_TIME', semesters: 6, source: 'gen', specs: NOJ1_SPECS },
  { code: 'IJ-S2', field: 'IJ', level: 'MASTER', mode: 'FULL_TIME', semesters: 3, source: 'gen', specs: IJ2_SPECS },
  { code: 'IJ-N2', field: 'IJ', level: 'MASTER', mode: 'PART_TIME', semesters: 3, source: 'gen', specs: IJ2_SPECS },
];

// ─── Pule nazw przedmiotow dla programow generowanych ────────

export const COMMON_BACHELOR_TECH = ['Matematyka', 'Fizyka', 'Grafika inżynierska', 'Podstawy informatyki', 'Ochrona własności intelektualnej', 'Bezpieczeństwo pracy i ergonomia'];
export const COMMON_BACHELOR_ECON = ['Matematyka w ekonomii', 'Statystyka opisowa', 'Mikroekonomia', 'Makroekonomia', 'Prawo gospodarcze', 'Ochrona własności intelektualnej'];

export const FIELD_POOLS: Record<string, { bachelor: string[]; master: string[] }> = {
  ET: {
    bachelor: [
      'Podstawy elektrotechniki', 'Teoria obwodów', 'Metrologia elektryczna', 'Elektronika analogowa', 'Technika cyfrowa',
      'Maszyny elektryczne', 'Energoelektronika', 'Napęd elektryczny', 'Urządzenia elektryczne', 'Sieci i systemy elektroenergetyczne',
      'Elektrotechnika okrętowa', 'Podstawy automatyki', 'Materiałoznawstwo elektryczne', 'Technika wysokich napięć', 'Mikroprocesory',
      'Sterowniki programowalne', 'Pomiary wielkości nieelektrycznych', 'Elektroenergetyka', 'Instalacje elektryczne', 'Teoria pola elektromagnetycznego',
      'Programowanie strukturalne', 'Elektrotermia', 'Systemy pomiarowe', 'Kompatybilność elektromagnetyczna', 'Ochrona przeciwporażeniowa',
    ],
    master: [
      'Metody numeryczne w elektrotechnice', 'Zaawansowane układy napędowe', 'Sterowanie optymalne', 'Jakość energii elektrycznej', 'Diagnostyka maszyn elektrycznych',
      'Modelowanie systemów dynamicznych', 'Przekształtniki energoelektroniczne', 'Systemy wbudowane', 'Inteligentne sieci elektroenergetyczne', 'Metodologia badań naukowych',
    ],
  },
  EiT: {
    bachelor: [
      'Podstawy elektroniki', 'Teoria sygnałów', 'Układy elektroniczne', 'Technika mikrofalowa', 'Podstawy telekomunikacji',
      'Anteny i propagacja fal', 'Cyfrowe przetwarzanie sygnałów', 'Technika cyfrowa', 'Systemy mikroprocesorowe', 'Sieci komputerowe',
      'Miernictwo elektroniczne', 'Podstawy radiokomunikacji', 'Elektroakustyka', 'Optoelektronika', 'Systemy transmisji danych',
      'Elektroniczne urządzenia nawigacyjne', 'Programowanie obiektowe', 'Podstawy automatyki', 'Układy programowalne', 'Telekomunikacja morska',
      'Systemy operacyjne', 'Bazy danych', 'Technika światłowodowa', 'Teoria informacji i kodowania', 'Projektowanie układów elektronicznych',
    ],
    master: [
      'Zaawansowane przetwarzanie sygnałów', 'Systemy radiokomunikacyjne', 'Bezpieczeństwo sieci', 'Systemy wbudowane czasu rzeczywistego', 'Modelowanie układów elektronicznych',
      'Sieci bezprzewodowe', 'Metody sztucznej inteligencji', 'Kompatybilność elektromagnetyczna', 'Systemy radarowe', 'Metodologia badań naukowych',
    ],
  },
  INF: {
    bachelor: [
      'Wstęp do programowania', 'Algorytmy i struktury danych', 'Matematyka dyskretna', 'Programowanie obiektowe', 'Architektura komputerów',
      'Systemy operacyjne', 'Bazy danych', 'Sieci komputerowe', 'Inżynieria oprogramowania', 'Programowanie aplikacji internetowych',
      'Języki i paradygmaty programowania', 'Grafika komputerowa', 'Systemy wbudowane', 'Programowanie aplikacji mobilnych', 'Bezpieczeństwo systemów informatycznych',
      'Sztuczna inteligencja', 'Technologie chmurowe', 'Testowanie oprogramowania', 'Interakcja człowiek-komputer', 'Programowanie współbieżne',
      'Logika dla informatyków', 'Analiza danych', 'Zarządzanie projektem informatycznym', 'Administrowanie systemami', 'Kompilatory',
    ],
    master: ['Uczenie maszynowe', 'Systemy rozproszone', 'Architektura oprogramowania', 'Metodologia badań naukowych'],
  },
  STI: {
    bachelor: [],
    master: [
      'Zaawansowane sieci komputerowe', 'Kryptografia', 'Eksploracja danych', 'Systemy rozproszone', 'Teoria informacji',
      'Uczenie maszynowe', 'Bezpieczeństwo systemów teleinformatycznych', 'Przetwarzanie danych w chmurze', 'Systemy czasu rzeczywistego', 'Metodologia badań naukowych',
    ],
  },
  ZAR: {
    bachelor: [
      'Podstawy zarządzania', 'Marketing', 'Rachunkowość finansowa', 'Finanse przedsiębiorstwa', 'Zarządzanie zasobami ludzkimi',
      'Ekonomika przedsiębiorstw', 'Badania marketingowe', 'Zachowania organizacyjne', 'Zarządzanie strategiczne', 'Logistyka',
      'Prawo pracy', 'Bankowość', 'Systemy informatyczne w zarządzaniu', 'Rachunek kosztów', 'Komunikacja w biznesie',
      'Negocjacje', 'Zarządzanie projektami', 'Handel międzynarodowy', 'Analiza ekonomiczna', 'Etyka biznesu',
      'Socjologia organizacji', 'Przedsiębiorczość', 'Zarządzanie jakością',
    ],
    master: [
      'Zarządzanie zmianą', 'Ekonometria', 'Zarządzanie wartością przedsiębiorstwa', 'Rachunkowość zarządcza', 'Przywództwo',
      'Analiza strategiczna', 'Zarządzanie ryzykiem', 'Zarządzanie innowacjami', 'Seminarium magisterskie przygotowawcze', 'Metodologia badań naukowych',
    ],
  },
  NoJ: {
    bachelor: [
      'Podstawy towaroznawstwa', 'Chemia ogólna', 'Biologia', 'Zarządzanie jakością', 'Metrologia',
      'Opakowania i przechowalnictwo', 'Analiza instrumentalna', 'Normalizacja i certyfikacja', 'Mikrobiologia', 'Ocena sensoryczna',
      'Statystyczne sterowanie procesem', 'Ekologia i ochrona środowiska', 'Systemy zarządzania bezpieczeństwem żywności', 'Projektowanie produktu', 'Badania marketingowe',
      'Prawo żywnościowe', 'Logistyka', 'Technologia żywności', 'Audyt systemów zarządzania', 'Zachowania konsumentów',
    ],
    master: [],
  },
  IJ: {
    bachelor: [],
    master: [
      'Zaawansowane metody zarządzania jakością', 'Lean management', 'Inżynieria niezawodności', 'Projektowanie eksperymentów', 'Zintegrowane systemy zarządzania',
      'Zarządzanie ryzykiem', 'Analiza procesów', 'Metody doskonalenia jakości', 'Ocena zgodności', 'Metodologia badań naukowych',
    ],
  },
};

/** Przedmioty specjalnosciowe: nazwa specjalnosci + temat (orientacyjnie). */
export const SPEC_TOPICS = [
  'Wprowadzenie do specjalności', 'Projekt specjalnościowy', 'Laboratorium specjalnościowe', 'Systemy i urządzenia', 'Modelowanie i symulacja',
  'Eksploatacja i diagnostyka', 'Metody projektowania', 'Wybrane zagadnienia', 'Technologie i narzędzia', 'Praktikum specjalnościowe',
  'Zarządzanie w obszarze', 'Seminarium specjalnościowe',
];

// ─── Nazwiska prowadzacych (FIKCYJNE: losowe zestawienia popularnych imion i nazwisk) ───

export const FIRST_NAMES_F = ['Anna', 'Maria', 'Katarzyna', 'Małgorzata', 'Agnieszka', 'Barbara', 'Ewa', 'Krystyna', 'Elżbieta', 'Magdalena', 'Joanna', 'Monika', 'Aleksandra', 'Beata', 'Dorota', 'Justyna', 'Marta', 'Iwona', 'Karolina', 'Natalia'];
export const FIRST_NAMES_M = ['Piotr', 'Krzysztof', 'Andrzej', 'Tomasz', 'Paweł', 'Michał', 'Marcin', 'Jakub', 'Adam', 'Marek', 'Łukasz', 'Grzegorz', 'Mateusz', 'Wojciech', 'Mariusz', 'Dariusz', 'Zbigniew', 'Jerzy', 'Maciej', 'Rafał'];
export const LAST_NAMES = [
  'Nowak', 'Wiśniewsk', 'Wójcik', 'Kowalczyk', 'Kamińsk', 'Lewandowsk', 'Zielińsk', 'Szymańsk', 'Woźniak', 'Dąbrowsk',
  'Kozłowsk', 'Jankowsk', 'Mazur', 'Kwiatkowsk', 'Krawczyk', 'Piotrowsk', 'Grabowsk', 'Nowakowsk', 'Pawłowsk', 'Michalsk',
  'Nowick', 'Adamczyk', 'Dudek', 'Zając', 'Wieczorek', 'Jabłońsk', 'Król', 'Majewsk', 'Olszewsk', 'Jaworsk',
  'Wróbel', 'Malinowsk', 'Pawlak', 'Witkowsk', 'Walczak', 'Stępień', 'Górsk', 'Rutkowsk', 'Michalak', 'Sikora',
  'Ostrowsk', 'Baran', 'Duda', 'Szewczyk', 'Tomaszewsk', 'Pietrzak', 'Marciniak', 'Wróblewsk', 'Zalewsk', 'Jakubowsk',
];
