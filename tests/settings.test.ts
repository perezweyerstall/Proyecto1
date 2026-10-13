import { beforeEach, describe, expect, it } from 'vitest';
import { addListenedWords, dayKey, loadSettings, saveSettings, streak, totalWords } from '../src/state/settings';

beforeEach(() => localStorage.clear());

describe('settings', () => {
  it('combina valores guardados con los valores por defecto', () => {
    saveSettings({ ...loadSettings(), rate: 2 });
    expect(loadSettings().rate).toBe(2);
    expect(loadSettings().highlightWords).toBe(true);
  });

  it('cuenta palabras y racha de días', () => {
    const today = new Date(2026, 9, 13);
    const yesterday = new Date(2026, 9, 12);
    addListenedWords(10, yesterday);
    expect(streak({ [dayKey(yesterday)]: 10 }, today)).toBe(1);
    const stats = addListenedWords(5, today);
    expect(streak(stats, today)).toBe(2);
    expect(totalWords(stats)).toBe(15);
  });
});
