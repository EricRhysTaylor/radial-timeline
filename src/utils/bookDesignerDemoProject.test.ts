import { describe, expect, it } from 'vitest';
import {
    NONLINEAR_DEMO_ACT_COUNT,
    NONLINEAR_DEMO_DEFAULT_START_DATE,
    NONLINEAR_DEMO_SCENE_COUNT,
    buildNonlinearDemoProjectPlan,
    isValidIsoDateOnly,
} from './bookDesignerDemoProject';

describe('bookDesignerDemoProject', () => {
    it('builds a deterministic 20-scene nonlinear plan', () => {
        const plan = buildNonlinearDemoProjectPlan();

        expect(plan.startDate).toBe(NONLINEAR_DEMO_DEFAULT_START_DATE);
        expect(plan.scenes).toHaveLength(NONLINEAR_DEMO_SCENE_COUNT);
        expect(plan.scenes[0]).toMatchObject({ sceneNumber: 1, act: 1, when: '2085-03-30 18:00', subplot: 'A' });
        expect(plan.scenes[1]).toMatchObject({ sceneNumber: 2, act: 1, when: '2085-03-31 07:00', subplot: 'B' });
        expect(plan.scenes[2]).toMatchObject({ sceneNumber: 3, act: 1, when: '2085-03-30 07:00', subplot: 'C' });
        expect(plan.scenes[3]).toMatchObject({ sceneNumber: 4, act: 1, when: '2085-04-01 07:00', subplot: 'A' });
    });

    it('keeps the chronologue cadence at two scenes per day with alternating slot lengths', () => {
        const plan = buildNonlinearDemoProjectPlan();
        const scenesByWhen = [...plan.scenes].sort((left, right) => left.when.localeCompare(right.when));
        const countsByDate = new Map<string, number>();

        scenesByWhen.forEach((scene, index) => {
            const [date, time] = scene.when.split(' ');
            countsByDate.set(date, (countsByDate.get(date) ?? 0) + 1);
            expect(time).toBe(index % 2 === 0 ? '07:00' : '18:00');
            if (index % 2 === 0) {
                expect(scene.durationMinutes).toBeGreaterThanOrEqual(3);
                expect(scene.durationMinutes).toBeLessThanOrEqual(6);
            } else {
                expect(scene.durationMinutes).toBeGreaterThanOrEqual(6);
                expect(scene.durationMinutes).toBeLessThanOrEqual(10);
            }
        });

        expect([...countsByDate.values()]).toEqual(new Array(10).fill(2));
    });

    it('balances subplot assignments without long runs', () => {
        const plan = buildNonlinearDemoProjectPlan();
        const subplotCounts = plan.scenes.reduce<Record<string, number>>((counts, scene) => {
            counts[scene.subplot] = (counts[scene.subplot] ?? 0) + 1;
            return counts;
        }, {});

        expect(subplotCounts).toEqual({ A: 7, B: 7, C: 6 });

        for (let index = 1; index < plan.scenes.length; index += 1) {
            expect(plan.scenes[index].subplot).not.toBe(plan.scenes[index - 1].subplot);
        }
    });

    it('anchors Save The Cat beats to the expected scenes', () => {
        const plan = buildNonlinearDemoProjectPlan();

        expect(plan.builtinBeatSystemName).toBe('Save The Cat');
        expect(plan.builtinBeatAnchors).toEqual([
            { beatName: 'Opening Image', sceneNumber: 1 },
            { beatName: 'Theme Stated', sceneNumber: 2 },
            { beatName: 'Setup', sceneNumber: 2 },
            { beatName: 'Catalyst', sceneNumber: 3 },
            { beatName: 'Debate', sceneNumber: 4 },
            { beatName: 'Break into Two', sceneNumber: 5 },
            { beatName: 'B Story', sceneNumber: 6 },
            { beatName: 'Fun and Games', sceneNumber: 9 },
            { beatName: 'Midpoint', sceneNumber: 10 },
            { beatName: 'Bad Guys Close In', sceneNumber: 14 },
            { beatName: 'All Is Lost', sceneNumber: 16 },
            { beatName: 'Dark Night of the Soul', sceneNumber: 16 },
            { beatName: 'Break into Three', sceneNumber: 17 },
            { beatName: 'Finale', sceneNumber: 19 },
            { beatName: 'Final Image', sceneNumber: 20 },
        ]);

        expect(plan.scenes.length).toBeGreaterThanOrEqual(NONLINEAR_DEMO_ACT_COUNT);
    });

    it('validates ISO date-only input', () => {
        expect(isValidIsoDateOnly('2085-03-30')).toBe(true);
        expect(isValidIsoDateOnly('2085-02-29')).toBe(false);
        expect(isValidIsoDateOnly('bad-input')).toBe(false);
    });
});
