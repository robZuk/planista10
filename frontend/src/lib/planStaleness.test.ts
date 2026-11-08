import { describe, expect, it } from 'vitest';
import { staleMessage } from './planStaleness';

describe('staleMessage', () => {
  it('jeden powod', () => {
    expect(staleMessage(['DELETED'])).toBe('Po ostatnim generowaniu usunieto zajecia z wzorca, a ich terminy wciaz sa w planie.');
    expect(staleMessage(['PLACEMENTS'])).toBe('Po ostatnim generowaniu wzorzec zmienil sie.');
  });

  it('kilka powodow w jednym zdaniu', () => {
    expect(staleMessage(['PLACEMENTS', 'SECTIONS', 'DELETED'])).toBe(
      'Po ostatnim generowaniu wzorzec zmienil sie, godziny zajec zmienily sie (synchronizacja z programem) i usunieto zajecia z wzorca, a ich terminy wciaz sa w planie.',
    );
  });

  it('brak powodow', () => expect(staleMessage([])).toBe(''));
});
