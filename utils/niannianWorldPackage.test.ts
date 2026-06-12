import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNianNianWorldBibleMarkdown } from './niannianWorldPackage';

describe('niannianWorldPackage', () => {
    it('parses the external ancient China world pack into engine fields', () => {
        const markdown = readFileSync(
            'public/worldpacks/ancient-china.md',
            'utf8',
        );
        const world = parseNianNianWorldBibleMarkdown(markdown);

        expect(world.theme).toContain('古代中国');
        expect(world.worldStyle).toContain('浮生六记');
        expect(world.customPrompt).toContain('红楼梦');
        expect(world.seedStatus?.ta.好感).toBe(8);
        expect(world.seedStatus?.worldExtra.拘束).toBe(75);
        expect(world.hiddenVarsSeed?.缘分).toBe(5);
        expect(world.openingStep?.sceneText).toContain('上元的灯火');
        expect(world.openingStep?.options).toHaveLength(3);
        expect(world.eventWeights.初遇).toEqual(expect.objectContaining({
            公共节庆: 5,
            被迫独处: 2,
        }));
        expect(world.statusSchema).toEqual([
            { key: '拘束', label: '拘束', type: 'number', min: 0, max: 100 },
        ]);
    });

    it('parses v2 world pack fields for western fantasy and republic-era packs', () => {
        const west = parseNianNianWorldBibleMarkdown(readFileSync(
            'public/worldpacks/westfantasy.md',
            'utf8',
        ));
        const minguo = parseNianNianWorldBibleMarkdown(readFileSync(
            'public/worldpacks/minguo.md',
            'utf8',
        ));

        expect(west.worldId).toBe('westfantasy');
        expect(west.worldName).toContain('誓约');
        expect(west.statusSchema).toEqual([
            { key: '誓约', label: '誓约', type: 'number', min: 0, max: 100 },
        ]);
        expect(west.hiddenVarsSeed?.流言).toBe(0);
        expect(west.fateBookSections?.[0].title).toBe('誓约');
        expect(west.eventPrototypes?.some(event => event.类目 === '礼缚规训')).toBe(true);
        expect(west.eventWeights.厮守).toEqual(expect.objectContaining({ 收束抉择: 5 }));
        expect(west.directorNotes).toContain('誓约-流言联动');
        expect(west.endingRoutes?.[0].title).toContain('请誓');

        expect(minguo.worldId).toBe('minguo');
        expect(minguo.statusSchema.map(field => field.key)).toEqual(['风声', '牵连']);
        expect(minguo.seedStatus?.worldExtra.风声).toBe(12);
        expect(minguo.fateBookSections?.[2].title).toBe('名声');
        expect(minguo.eventPrototypes?.some(event => event.名称 === '报纸绯闻')).toBe(true);
        expect(minguo.directorNotes).toContain('报纸绯闻');
        expect(minguo.endingRoutes?.map(route => route.title)).toContain('别离 · 月台送行');
    });
});
