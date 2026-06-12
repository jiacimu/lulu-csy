# 念念浮生 & 天机之书 UI 交接

用途：把当前「念念浮生」主界面和「天机之书」状态书页整理给外部做视觉美化。这里不包含 AI 编排、IndexedDB 写入和提示词逻辑，只说明 UI 边界、状态和可改样式入口。

配套静态预览：`design-previews/niannian-fate-book-ui-handoff.html`

说明：静态预览为了交接方便会把若干浮层素材集中展示；真实应用里「回想录」和「天机之书」是互斥打开的。

## 1. 源文件地图

| 文件 | 作用 | 美化相关度 |
| --- | --- | --- |
| `apps/niannian/NianNianApp.tsx` | 念念浮生 React 页面，包含初始化表单、VN 场景、对白、选项、输入、回想录、天机之书 | 高 |
| `apps/niannian/niannian.css` | 念念浮生全部样式，类名集中为 `.nn-*` | 高 |
| `utils/niannianSceneVisuals.ts` | 场景图、场景名、背景渐变色映射 | 中 |
| `public/images/niannian-fusheng-scenes/` | 场景背景图素材 | 高 |
| `types/niannian.ts` | 会影响 UI 展示的数据结构：状态、选项、对白片段、会话 | 中 |
| `utils/niannianEngine.ts` | 生成/解析剧情和状态，通常不需要美化方改 | 低 |
| `utils/db/niannianStore.ts` | 会话存取，通常不需要美化方改 | 低 |
| `public/worldpacks/ancient-china.md` | 默认世界包，会预填初始化表单和初始状态 | 中 |

入口注册：

- `types/core.ts`：`AppID.NianNian = 'nian_nian'`
- `constants.tsx`：桌面图标名、颜色、入口文案
- `components/PhoneShell.tsx`：懒加载 `apps/niannian/NianNianApp`

## 2. 页面状态

当前 UI 是一个单文件 React 页面，靠 `session` 与局部状态切换不同画面：

| 状态 | 触发条件 | 主要 UI |
| --- | --- | --- |
| loading | `isLoadingSessions` | `.nn-loading` |
| 初始化 | `!session` | `.nn-setup`、`.nn-setup-panel`、`.nn-session-list` |
| 剧情对白 | `session && phase === 'dialogue'` | `.nn-stage`、`.nn-scene`、`.nn-vn-layer.is-dialogue`、`.nn-dialogue-card` |
| 选项/输入 | `phase === 'choice'` | `.nn-options`、`.nn-input-panel`、`.nn-beat-card`、`.nn-send-btn` |
| 回想录 | `historyOpen` | `.nn-history-toggle`、`.nn-history-panel`、`.nn-history-row` |
| 天机之书 | `statusExpanded` | `.nn-status-orb`、`.nn-fate-book`、`.nn-fate-tab`、`.nn-fate-section` |
| 生成中 | `isSubmittingTurn` | `.nn-dialogue-card.is-loading`、`.nn-loading-dots` |
| 错误 | `turnError` | `.nn-error-card`、`.nn-error-actions` |

## 3. 念念浮生主 UI 结构

```tsx
<div className="nn-app">
  <header className="nn-topbar">
    <button className="nn-icon-btn" />
    <div className="nn-brand">念念浮生 / 副本初始化或阶段</div>
    <button className="nn-icon-btn" />
  </header>

  {!session ? (
    <main className="nn-setup">
      <section className="nn-setup-panel">初始化表单</section>
      <aside className="nn-session-list">旧副本列表</aside>
    </main>
  ) : (
    <main className="nn-stage" style={{ "--nn-scene-image": "url(...)" }}>
      <button className="nn-scene"><span className="nn-scene-label" /></button>
      <button className="nn-history-toggle" />
      {historyOpen && <aside className="nn-history-panel" />}
      <section className={`nn-vn-layer is-${phase}`}>
        <div className="nn-options" />
        <div className="nn-dialogue-card" />
        <section className="nn-input-panel" />
      </section>
      <button className="nn-status-orb" />
      {statusExpanded && <aside className="nn-status-panel nn-fate-book" />}
    </main>
  )}
</div>
```

美化时优先改 `niannian.css`。如果只做视觉升级，建议保持上面的类名和条件渲染不变。

## 4. 关键组件拆解

### 顶部栏

- `.nn-topbar`：绝对定位，避让安全区。
- `.nn-icon-btn`：返回、新副本按钮。
- `.nn-brand`：中间胶囊标题，运行中显示角色名与阶段。

### 初始化表单

- `.nn-setup`：两列布局，移动端变单列。
- `.nn-setup-panel`：角色、题材、基调、身份、开场、补充提示词。
- `.nn-session-list`：旧副本列表，按钮会进入既有 session。

可美化点：表单层级、空状态、旧副本卡片、主按钮质感。

### VN 场景

- `.nn-stage`：全屏舞台容器。
- `.nn-scene`：背景图层，使用 CSS 变量：
  - `--nn-bg-a`
  - `--nn-bg-b`
  - `--nn-bg-c`
  - `--nn-scene-image`
- `.nn-scene-label`：左下角场景名。

场景资源来自 `utils/niannianSceneVisuals.ts`，图片放在 `public/images/niannian-fusheng-scenes/`。

### 对白卡

- `.nn-vn-layer.is-dialogue`：对白阶段底部区域。
- `.nn-dialogue-card`：对白主卡。
- `.nn-dialogue-card.is-narrator`：旁白样式。
- `.nn-dialogue-card.is-left` / `.is-right`：角色与用户方向。
- `.nn-dialogue-avatar`：头像或姓名缩写。
- `.nn-dialogue-pager`、`.nn-dialogue-nav`、`.nn-continue`：翻页提示。

可美化点：对白框、角色名牌、头像容器、翻页控件、点击继续提示。

### 选项与输入

- `.nn-options`：剧情选项列表。
- `.nn-input-panel`：底部输入容器。
- `.nn-beat-card.is-speech`：台词段落。
- `.nn-beat-card.is-action`：动作段落。
- `.nn-beat-toggle`：台词/动作切换。
- `.nn-send-btn`：发送按钮。

交互限制：输入段落支持多段，删除按钮在最后一段时是清空段落，不是删除 UI。

### 回想录

- `.nn-history-toggle`：左上浮动按钮，显示条目数。
- `.nn-history-panel`：展开面板。
- `.nn-history-row.is-user` / `.is-character` / `.is-active`：不同回放条目状态。
- `.nn-history-current`：回到当前。

回想录与天机之书互斥：打开其中一个会关闭另一个。

## 5. 天机之书 UI

触发按钮：

```tsx
<button className={`nn-status-orb ${statusExpanded ? 'is-expanded' : ''}`}>
  <BookOpenText />
  <span>天机</span>
  <strong>{statusExpanded ? '合卷' : session.status.ta.好感}</strong>
</button>
```

展开面板：

```tsx
<aside className="nn-status-panel nn-fate-book" aria-label="天机之书">
  <div className="nn-fate-spine" />
  <div className="nn-fate-pages">
    <header className="nn-fate-head"><span>天机之书</span></header>
    <div className="nn-fate-layout">
      <nav className="nn-fate-tabs">页签</nav>
      <section className="nn-fate-section is-active-page">当前页内容</section>
    </div>
  </div>
</aside>
```

当前页签数据在 `NianNianApp.tsx` 的 `fateBookSections` 里生成：

| key | 印章 | 标题 | 字段 |
| --- | --- | --- | --- |
| `moment` | 景 | 此刻 | 阶段、回合、时辰、地点、场景 |
| `ta` | 他 | 其人 | 好感、暧昧、心情、心声 |
| `me` | 我 | 我身 | 身份、银两、体力、名声 |
| `world` | 世 | 世局 | `worldExtra` 动态字段、在场旁人 |

可美化点：

- `.nn-status-orb`：浮动入口，可做成书签、玉佩、罗盘等。
- `.nn-fate-book`：书本外框、纸张、书脊。
- `.nn-fate-tabs`：右侧页签目录。
- `.nn-fate-seal`：印章视觉。
- `.nn-fate-row dt/dd`：字段和值的阅读层级。

需要注意：天机之书内容会有长文本，例如「心声」「在场旁人」。美化时要保留 `word-break: break-word` 或等价处理，避免小屏溢出。

## 6. 样式分层建议

如果后续要真正重构视觉，建议先按下面方式拆 CSS，便于外部回填：

```text
apps/niannian/
  NianNianApp.tsx
  niannian.css
  ui/
    NianNianTopbar.tsx
    NianNianSetup.tsx
    NianNianStage.tsx
    NianNianDialogueCard.tsx
    NianNianInputPanel.tsx
    NianNianHistoryPanel.tsx
    NianNianFateBook.tsx
```

这次交接没有做组件拆分，避免改变业务逻辑。外部美化可以先对照静态预览和现有类名出设计稿，再决定是否拆组件。

## 7. 验收重点

美化回填时建议逐项看：

- 初始化页：表单不挤压，旧副本列表可滚动。
- 剧情页：场景图铺满，顶部按钮、回想、天机入口不遮挡对白。
- 对白页：长对白、旁白、用户/角色两侧头像都不溢出。
- 选项页：选项列表和输入面板在小屏可滚动。
- 天机之书：四个页签都能切换，长文本不断版。
- 回想录：打开时与天机之书互斥，当前回放高亮明确。
