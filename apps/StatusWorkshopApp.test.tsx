// @vitest-environment jsdom

import React,{ useState } from 'react';
import { fireEvent,render,screen } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { useOS } from '../context/OSContext';
import type { CustomStatusTemplate } from '../types/statusCard';
import StatusWorkshopApp,{
    buildCssPolishPrompt,
    buildHtmlPrompt,
    buildJsPrompt,
    buildProtocolPrompt,
    buildStatusWorkshopExportPayload,
    buildSystemPromptPrompt,
    parseStatusWorkshopImportPayload,
    StatusWorkshopGeneratorFieldList,
} from './StatusWorkshopApp';

vi.mock('../context/OSContext', () => ({
    useOS: vi.fn(),
}));

const mockedUseOS = vi.mocked(useOS);

const FieldListHarness: React.FC = () => {
    const [fields, setFields] = useState([
        { id: 'field-1', name: '时间', desc: '当前时间 HH:MM' },
    ]);

    return <StatusWorkshopGeneratorFieldList fields={fields} setFields={setFields} />;
};

describe('StatusWorkshopGeneratorFieldList', () => {
    it('keeps generator field inputs mounted while typing and avoids password mode', () => {
        render(<FieldListHarness />);

        const fieldNameInput = screen.getByPlaceholderText('字段名') as HTMLInputElement;
        expect(fieldNameInput).toHaveAttribute('type', 'text');
        expect(fieldNameInput).toHaveAttribute('autocomplete', 'off');
        expect(fieldNameInput).toHaveAttribute('inputmode', 'text');
        expect(fieldNameInput).not.toHaveAttribute('type', 'password');

        fireEvent.change(fieldNameInput, { target: { value: '心情' } });
        const afterFirstChange = screen.getByPlaceholderText('字段名');
        expect(afterFirstChange).toBe(fieldNameInput);

        fireEvent.change(fieldNameInput, { target: { value: '心情浓度' } });
        const afterSecondChange = screen.getByPlaceholderText('字段名');
        expect(afterSecondChange).toBe(fieldNameInput);
    });
});

describe('StatusWorkshop prompt helpers', () => {
    const fields = [{ id: 'field-1', name: '时间', desc: '当前时间' }];
    const templateFields = [{ id: 'field_1', name: '时间', description: '当前时间', required: true }];
    const interaction = { mode: 'flip' as const, idea: '点击卡片翻到背面看隐藏心声' };

    it('keeps field protocol separate from status writing rules', () => {
        const protocolPrompt = buildProtocolPrompt('做一个心情状态栏', fields);
        const statusWritingPrompt = buildSystemPromptPrompt('做一个心情状态栏', templateFields);

        expect(protocolPrompt).toContain('"extractRegex"');
        expect(protocolPrompt).toContain('"fields"');
        expect(protocolPrompt).toContain('不要写状态文本规则');
        expect(protocolPrompt).not.toContain('"systemPrompt"');

        expect(statusWritingPrompt).toContain('"systemPrompt"');
        expect(statusWritingPrompt).toContain('字段协议');
        expect(statusWritingPrompt).toContain('时间');
        expect(statusWritingPrompt).toContain('必须逐一覆盖字段协议中的每个字段');
        expect(statusWritingPrompt).not.toContain('"extractRegex"');
        expect(statusWritingPrompt).not.toMatch(/角色 AI|char AI|System Prompt/);
    });

    it('does not rely on status writing rules when building field protocol prompts', () => {
        const protocolPrompt = buildProtocolPrompt('做一个心情状态栏', fields);

        expect(protocolPrompt).toContain('"extractRegex"');
        expect(protocolPrompt).toContain('"fields"');
        expect(protocolPrompt).not.toContain('当前状态文本规则');
        expect(protocolPrompt).not.toContain('"systemPrompt"');
    });

    it('threads interaction requirements through HTML, CSS, and JS prompts', () => {
        const htmlPrompt = buildHtmlPrompt('做一个翻卡状态栏', templateFields, interaction, '<section class="card">$1</section>');
        const cssPrompt = buildCssPolishPrompt('做一个翻卡状态栏', '<section data-action="flip">$1</section>', '.card { color: red; }', interaction);
        const jsPrompt = buildJsPrompt(interaction, '<button data-action="flip">flip</button>', '.is-flipped { transform: rotateY(180deg); }');

        expect(htmlPrompt).toContain('当前 HTML 骨架');
        expect(htmlPrompt).toContain('data-action');
        expect(cssPrompt).toContain('当前 CSS');
        expect(cssPrompt).toContain('保留已有有效视觉特征');
        expect(cssPrompt).toContain('.is-flipped');
        expect(jsPrompt).toContain('只能绑定已有 HTML 结构');
        expect(jsPrompt).toContain('不要重写整段 HTML');
    });
});

describe('StatusWorkshop import/export helpers', () => {
    it('exports versioned payloads and imports templates as new schemes', () => {
        const source = createTemplate({
            name: '雨夜状态',
            systemPrompt: '每个字段都短而具体。',
            extractRegex: '<status>[\\s\\S]*?时间:\\s*(.*?)<\\/status>',
            htmlBody: '<section>$1</section>',
            cssTemplate: '.status-card { color: red; }',
            jsTemplate: 'document.querySelector(".status-card")?.classList.toggle("is-active");',
            allowScripts: true,
            interactionMode: 'flip',
            reviewFlags: { html: true },
        });

        const payload = buildStatusWorkshopExportPayload([source]);
        const imported = parseStatusWorkshopImportPayload(payload, 4);

        expect(payload.type).toBe('sully.statusWorkshop.templates');
        expect(payload.templates).toHaveLength(1);
        expect(imported).toHaveLength(1);
        expect(imported[0].id).not.toBe(source.id);
        expect(imported[0].name).toBe('雨夜状态 导入');
        expect(imported[0].systemPrompt).toBe(source.systemPrompt);
        expect(imported[0].extractRegex).toBe(source.extractRegex);
        expect(imported[0].allowScripts).toBe(true);
        expect(imported[0].interactionMode).toBe('flip');
        expect(imported[0].reviewFlags).toEqual({});
    });

    it('accepts raw single-template imports for old hand-edited files', () => {
        const imported = parseStatusWorkshopImportPayload({
            name: '旧文件',
            systemPrompt: '状态规则',
            extractRegex: 'regex',
            fields: [{ name: '地点', description: '当前位置' }],
        });

        expect(imported).toHaveLength(1);
        expect(imported[0].name).toBe('旧文件 导入');
        expect(imported[0].fields?.[0]?.name).toBe('地点');
    });
});

const createTemplate = (overrides: Partial<CustomStatusTemplate> = {}): CustomStatusTemplate => ({
    id: 'tpl-1',
    name: '测试方案',
    systemPrompt: '',
    extractRegex: '',
    htmlBody: '',
    cssTemplate: '',
    jsTemplate: '',
    renderMode: 'html',
    fields: [{ id: 'field_1', name: '时间', description: '当前时间', required: true }],
    ...overrides,
});

function renderWorkshop(template: CustomStatusTemplate) {
    const addToast = vi.fn();
    mockedUseOS.mockReturnValue({
        closeApp: vi.fn(),
        characters: [{
            id: 'char-1',
            name: '测试角色',
            customStatusTemplates: [template],
            activeCustomTemplateId: template.id,
        }],
        activeCharacterId: 'char-1',
        addToast,
        updateCharacter: vi.fn(),
    } as any);

    render(<StatusWorkshopApp />);
    return { addToast };
}

describe('StatusWorkshopApp workflow', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('starts from field protocol and allows it before status writing rules', () => {
        renderWorkshop(createTemplate());

        expect(screen.getByText('1 字段协议')).toBeInTheDocument();
        expect(screen.getByText('导入方案')).toBeInTheDocument();
        expect(screen.getByText('导出当前')).toBeInTheDocument();
        expect(screen.getByText('导出全部')).toBeInTheDocument();
        const generateButton = screen.getByText('生成字段协议').closest('button');

        expect(generateButton).not.toBeDisabled();
        expect(screen.queryByText(/先完成.*状态写法/)).not.toBeInTheDocument();
    });

    it('does not show tool-like status writing copy to users', () => {
        renderWorkshop(createTemplate({ extractRegex: 'old regex' }));

        fireEvent.click(screen.getByText('2 TA 的状态写法'));

        expect(screen.getByText('状态文本规则')).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/告诉TA/)).toBeInTheDocument();
        expect(screen.queryByText(/System Prompt|角色 AI|char AI/)).not.toBeInTheDocument();
        expect(screen.queryByPlaceholderText(/System Prompt|角色 AI|char AI|告诉角色/)).not.toBeInTheDocument();
    });

    it('blocks HTML generation until field protocol is complete', () => {
        const { addToast } = renderWorkshop(createTemplate());

        fireEvent.change(screen.getByPlaceholderText(/说清楚你想做什么/), {
            target: { value: '做一个能显示时间的状态栏' },
        });
        fireEvent.click(screen.getByText('4 HTML 骨架'));
        fireEvent.click(screen.getByText('生成 HTML 骨架'));

        expect(addToast).toHaveBeenCalledWith('先完成字段协议和提取正则，再生成 HTML 骨架', 'error');
    });

    it('marks status writing and render steps for review after protocol changes without clearing content', () => {
        renderWorkshop(createTemplate({
            systemPrompt: '每个字段都要短而具体。',
            extractRegex: 'old regex',
            htmlBody: '<section class="status-card">$1</section>',
            cssTemplate: '.status-card { color: red; }',
            jsTemplate: 'document.querySelector(".status-card")?.classList.toggle("is-active");',
            interactionMode: 'flip',
        }));

        fireEvent.change(screen.getByDisplayValue('old regex'), {
            target: { value: 'new regex' },
        });

        expect(screen.getAllByText('需复核').length).toBeGreaterThanOrEqual(4);
        fireEvent.click(screen.getByText('2 TA 的状态写法'));
        expect(screen.getByDisplayValue('每个字段都要短而具体。')).toBeInTheDocument();
        expect(screen.getByText(/字段协议刚刚改过/)).toBeInTheDocument();
    });

    it('marks downstream steps for review after interaction changes without clearing content', () => {
        renderWorkshop(createTemplate({
            systemPrompt: '每次回复末尾输出状态。',
            extractRegex: '<status>[\\s\\S]*?时间:\\s*(.*?)<\\/status>',
            htmlBody: '<section class="status-card">$1</section>',
            cssTemplate: '.status-card { color: red; }',
            jsTemplate: 'document.querySelector(".status-card")?.classList.toggle("is-active");',
            interactionMode: 'none',
        }));

        fireEvent.click(screen.getByText('3 互动需求'));
        fireEvent.click(screen.getByText('翻卡'));

        expect(screen.getAllByText('需复核').length).toBeGreaterThanOrEqual(3);
        fireEvent.click(screen.getByText('4 HTML 骨架'));
        expect(screen.getByDisplayValue('<section class="status-card">$1</section>')).toBeInTheDocument();
    });

    it('requires confirmation before replacing existing HTML', () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        renderWorkshop(createTemplate({
            systemPrompt: '每次回复末尾输出状态。',
            extractRegex: '<status>[\\s\\S]*?时间:\\s*(.*?)<\\/status>',
            htmlBody: '<section class="status-card">$1</section>',
        }));

        fireEvent.change(screen.getByPlaceholderText(/说清楚你想做什么/), {
            target: { value: '做一个能显示时间的状态栏' },
        });
        fireEvent.click(screen.getByText('4 HTML 骨架'));
        fireEvent.click(screen.getByText('重新生成 / 覆盖'));

        expect(confirmSpy).toHaveBeenCalled();
    });
});
