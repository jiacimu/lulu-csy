# 典藏馆拾光墙 UI 交接

用途：把当前「典藏馆」里的「拾光墙」UI 单独整理出来，方便带给外部做视觉优化。这里不包含 IndexedDB 写入、角色邀请、自动保存、图片 Blob 读取或聊天跳转，只保留界面结构、类名、状态和数据边界。

配套静态预览：`ui-handoff-export/collection-lightwall-ui-handoff.html`

重要：这次只新增交接文件，没有拆改真实业务源码。

## 源文件地图

| 文件 | 作用 | 美化相关度 |
| --- | --- | --- |
| `apps/CollectionHallApp.tsx` | 典藏馆主页面，拾光墙列表、全屏墙、装修态和阅读弹窗都在这里 | 高 |
| `types/collection.ts` | `CollectionWall`、`CollectionWallItem`、`CollectionWallAsset` 数据结构 | 高 |
| `utils/db/collectionWallStore.ts` | 墙、墙上物、墙素材的 IndexedDB CRUD | 中 |
| `utils/collectionBooks.ts` | 藏品标题、转递 payload、卡片展示标题 | 中 |
| `utils/collectionWallCoCreation.ts` | 邀请角色看墙并留下便签 | 低 |
| `utils/collectionWallEditorDraft.ts` | 装修草稿变更判断与序列化 | 低 |

## 当前 UI 结构

```tsx
<CharacterArchivePage>
  <nav className="ar-seg">
    <button>书柜</button>
    <button>妆匣</button>
    <button className="on">拾光墙</button>
  </nav>

  <LightWallShelf>
    <LightWallListCard className="ar-wall-card" />
  </LightWallShelf>
</CharacterArchivePage>

{activeWall && (
  <FullScreenLightWall className="ar-full-wall">
    <div className="ar-tray" />
    <div className="ar-full-canvas">
      <div className="ar-wall-free-item">
        <CollectionWallCardFrame className="ar-live-card" />
        <WallImageLayer className="ar-wall-img-item" />
        <WallTextLayer className="ar-wall-note-item" />
      </div>
    </div>
    <Moveable />
    <div className="ar-wall-item-menu" />
    <div className="ar-edit-toolbar" />
  </FullScreenLightWall>
)}
```

## 状态拆解

| 状态 | 触发 | 主要 UI |
| --- | --- | --- |
| 角色分区 | 进入典藏馆后按角色分页 | `.ar-char-hd`、`.ar-seg` |
| 拾光墙列表 | tab 切到 `walls` | `.ar-wall-list`、`.ar-wall-card`、`.ar-wall-seen` |
| 空列表 | `zones.length === 0` | `.ar-wall-empty-list` |
| 全屏墙 | 点击墙卡 | `.ar-full-wall`、`.ar-full-bg`、`.ar-full-canvas` |
| 装修态 | 点击“装修”或长按墙上物 | `.ar-full-wall.editing`、`.ar-tray`、`Moveable`、`.ar-edit-toolbar` |
| 预览态 | 点击“预览” | `.ar-full-wall.preview`，隐藏退出、动作按钮、tray、toolbar、moveable |
| 墙上物菜单 | 编辑态选中物品或右键 | `.ar-wall-item-menu` |

## 数据字段

### CollectionWall

- `name`：墙名，显示在列表卡片。
- `background.value`：全屏墙背景色或背景资源。
- `background.dim`：背景遮罩深度，当前限制为 `0` 到 `0.6`。
- `hasUnseenCharItem`：角色留下新内容时，墙卡右上角显示亮点。
- `allowCharDecorate`、`changeCountSinceVisit`、`charLastVisitAt`：偏业务逻辑，视觉只需要知道是否有新内容。

### CollectionWallItem

- `type`：`card`、`image`、`text` 是当前拾光墙主要 UI 类型。
- `x`、`y`：在 750px 宽画布上的坐标；为 `null` 时出现在顶部 tray。
- `w`、`h`：物件尺寸。
- `rotation`：旋转角度。
- `z`：层级。
- `name`：装修态 tray / 菜单里显示的物件名。
- `bookId`、`assetId`、`text.content`：分别指向卡片、图片素材、便签文字。

### CollectionWallAsset

- `blob`：真实应用里通过 `URL.createObjectURL` 渲染。
- `meta.name`、`meta.prompt`：图片 fallback 标题。
- `origin`：`upload`、`chat_gen`、`char`。

## 可优化入口

- 墙卡视觉：`.ar-wall-card`、`.ar-wall-teaser`、`.ar-wall-card-count`。
- 全屏背景：`.ar-full-bg`、`--wall-bg`、`--wall-dim`。
- 墙上物外观：`.ar-live-card-placeholder`、`.ar-wall-img-item`、`.ar-wall-note-item`。
- 装修控件：`.ar-tray`、`.ar-tray-item`、`.ar-edit-toolbar`、`.ar-wall-item-menu`。
- 选中态：`.ar-wall-free-item.selected` 和 Moveable 控制框样式。

## 真实业务里需要保留的交互

- 点击墙卡打开 `FullScreenLightWall`。
- 点击卡片类墙上物打开藏品阅读器。
- 点击图片类墙上物打开图片阅读器。
- 长按或右键墙上物进入装修态并选中。
- 双击空白处新增便签。
- tray 中未安置内容可拖入画布。
- 装修完成会保存并写入一条角色上下文提示。
- 取消装修会回滚到进入装修时的快照。

## 外部优化建议边界

建议外部只改 HTML/CSS 结构和视觉表现，先不要改这些业务约定：

- 画布基础宽度目前是 `750px`，移动端通过 `--wall-scale` 缩放。
- 真实卡片通过 iframe `srcDoc` 渲染，外层尺寸由 `CollectionWallCardFrame` 控制。
- `react-moveable` 负责拖拽、缩放、旋转，不建议替换交互库，除非同步重测装修态。
- `x/y/w/h/rotation/z` 是已经入库的布局数据，视觉优化要兼容旧数据。
