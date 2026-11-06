import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { generateSceneContent, type SceneCreationData } from './sceneGenerator';

const data: SceneCreationData = { act: 2, when: '', sceneNumber: 1, subplots: [], character: '', place: '' };

describe('generateSceneContent', () => {
    it('writes valid YAML for names with colons, hashes and quotes', () => {
        const input = { ...data, subplots: ['Arc: One'], character: 'Ann # lead', when: 'Spring: Year 3' };
        expect(parse(generateSceneContent('Subplot: {{Subplot}}\nCharacter: {{Character}}\nWhen: {{When}}', input)))
            .toEqual({ Subplot: 'Arc: One', Character: 'Ann # lead', When: 'Spring: Year 3' });
        expect(parse(generateSceneContent('Subplot:\n{{SubplotList}}', { ...data, subplots: ['The "Big" Arc'] })))
            .toEqual({ Subplot: ['The "Big" Arc'] });
    });
    it('leaves ordinary values plain', () => {
        expect(generateSceneContent('When: {{When}}\nSubplot: {{Subplot}}', { ...data, when: '2085-05-10 09:30', subplots: ['Main Plot'] }))
            .toBe('When: 2085-05-10 09:30\nSubplot: Main Plot');
    });
    it('writes several values inline for a Core template', () => {
        expect(parse(generateSceneContent('Character: {{Character}}', { ...data, character: 'Ann', characterList: ['Ann', 'Ben'] })))
            .toEqual({ Character: ['Ann', 'Ben'] });
    });
    it('never copies When into Due', () => {
        expect(generateSceneContent('Due: {{Due}}', { ...data, when: '2024-01-01' })).toBe('Due:');
    });
    it('leaves no blank line for an empty list and no raw placeholder', () => {
        expect(generateSceneContent('Act: {{Act}}\nCharacter:\n{{CharacterList}}\nMood: {{Mood}}', data)).toBe('Act: 2\nCharacter:\nMood:');
    });
    it('inserts values literally', () => {
        expect(generateSceneContent('Place: {{Place}}', { ...data, place: 'Cost $& more' })).toBe('Place: Cost $& more');
    });
});
