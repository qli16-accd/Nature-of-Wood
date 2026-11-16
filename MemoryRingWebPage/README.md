# Memory Rings

## Layered group display

The **Group display / グループの表示** buttons in **Memory rings** switch between **Overlap / 重ね合わせ** and **Layered / 前後に重ねる**. Overlap leaves every group's text visible where groups cross. Layered uses the saved front-to-back order and each group's static outer contour to cover text behind it. Existing data defaults to Layered. The mode is saved in local storage and JSON and is synchronized to the projection window. Switching modes only changes the visibility of cached black contour fills; it does not rebuild ring text or reset motion.

In **Memory rings**, select a visible group and use **Bring forward / 前面へ** or **Send backward / 背面へ**. The front group's fixed outer contour fills black beneath its text, covering only the overlapping portion of groups behind it. Group positions, scale, and order are saved and included in JSON. Moving a front group reveals all the original text behind it.

**Group interaction / グループ間の反応** and **Mouse ripple & local drag / マウスの波紋・部分ドラッグ** are off by default, including when older saved data is migrated. They may be enabled separately for experiments. **Layout mode / 配置モード** continues to move whole groups without enabling local drag. Automatic undulation and text flow remain independent switches in **Motion / 動き**.

Static text widths and base paths are reused; disabled interactions skip their geometry work, and slow undulation updates paths at a lower rate than flowing glyphs. The fixed black overlap shape does not animate with undulation. Very deep overlaps can still obscure much of a rear group, so use order and placement controls to keep stories readable.

## Motion / 動き

The Motion panel adds low-amplitude shared contour undulation, hover ripples, a dedicated pointer layer with a local circular cursor, damped drag return, global text-flow controls, and optional per-ring text flow. Motion parameters and flow choices are persisted and exported. Temporary deformation is synchronized between windows, while the cursor stays local to its active window; neither is written to storage.

Motion パネルでは、低振幅の揺らぎ、ホバー波紋、円形カーソル、減衰して戻る局所ドラッグ、全体または年輪ごとの文字流動を設定できます。設定は保存・書き出しの対象ですが、一時的な変形やカーソル位置は保存されません。

一个无需后端、适合展览现场双窗口使用的记忆年轮网页原型。

## 运行

在本目录用 PowerShell 运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

打开 <http://127.0.0.1:8080/>，点击 “Open projection / 投影画面を開く”，把新窗口移到投影仪并按 F11 全屏。

管理员设置默认折叠在观众输入区旁侧；点击 “Administrator controls / 管理設定” 展开。投影视图不显示中心圆点，第一圈会根据自身字号保留自然的中心空白。

在 MEMORY RINGS 标题旁点击 “Archive & Start New / 保存して新しく始める”，确认后把当前整组记忆保存为独立快照，并在中心开始空组。默认投影最近两组归档；管理员可以选择旧组、调整显示数量（0–4）、逐组显示开关与位置/缩放，并在原有列表中编辑文字、删除记忆或调整 Gap。观众输入始终加入中心活动组。

“年轮组布局调整”位于 MEMORY RINGS 列表上方。选择当前组或归档组后，可用滑块或数值框分别调整水平位置、垂直位置（以 1200×800 投影画布中心为原点）与 10%–180% 缩放。Layout mode / 配置モード下，可在管理员预览里拖动整组，空心中心同样可选；Interaction mode / インタラクションモード恢复原有局部波纹与拖拽。虚线选中边界仅出现在管理员预览。

组间反应开关、影响范围和形变强度在同一区域，独立于鼠标波纹设置。接触检测使用各组保存的位置、缩放及当前外圈轮廓，并在双方外缘缓慢形成有上限的局部压弯。分开后按阻尼逐渐复位。为保护同组年轮的圈距，强度上限会受该组最小 Gap 限制；深度重叠仍可能影响阅读，现场可用布局控件回调。

故事、单圈样式、圈间净空、归档快照、每组独立布局和全局设置保存在浏览器 `localStorage`。控制页与投影页通过 `BroadcastChannel` 实时同步，并以 `storage` 事件作为后备。JSON 导入导出包含所有组；旧版单组数据会作为中心活动组加载。

## 主要文件

- `index.html`：观众输入、管理员编辑器和纯投影视图
- `styles.css`：黑色双语界面、编辑高亮和投影视觉
- `js/state.js`：v5 多组数据模型、旧数据迁移和持久化
- `js/geometry.js`：确定性的非规则闭合路径
- `js/rings.js`：多组渲染、分页、净空布局、长文本分圈、短句补齐和 SVG 文字排版
- `js/app.js`：输入、归档/组选择、单圈/圈对编辑、同步、撤销和导入导出
- `tests/integration.html`：浏览器集成测试；运行后恢复原有本地数据

## 排版实现与限制

短句补齐使用 SVG 路径的 `getTotalLength()` 获取实际周长，并用隐藏 SVG 文本的 `getComputedTextLength()` 测量当前字体、字号、粗细和字距。横向宽度再通过 `textLength` 与 `lengthAdjust="spacingAndGlyphs"` 独立应用。重复之间使用 ` · `，末尾按可用长度加入部分重复，并在闭合接缝两端保留小间隙。

界面和年轮默认使用 Serif。为保证断网运行，字体栈依次使用本机 Noto Serif CJK、思源宋体、宋体、游明朝、Hiragino Mincho 和 Georgia；Sans-serif 模式也配置了对应的中日韩回退。不同电脑安装的字体不同，字形和测量结果会轻微变化，但重复次数会在当前浏览器重新计算。正式布展如需跨机器完全一致，应在取得授权后加入本地 WOFF2 字体。

横向宽度范围限制为 75%–130%。它会真实改变字形比例，不使用增大字距来伪装，因此极端值仍会带来可见的字形压缩或拉伸。超过单圈合理容量的文本会按字素和自然断句处分到连续的显示圈；原文、标点和换行始终完整保存在 JSON 中。

圈间距保存为两圈文字带边缘之间的净空，最低为 18px。修改一对相邻年轮时，内圈半径保持不变，外圈及之后的年轮按新的净空重新布局。达到画面容量后自动分页，最低显示字号保护为 14px。

归档组在画面中展示该组全部显示圈，并按外围可用空间等比缩放。大量长文本会使归档组文字较小；数据不会被截断，管理员可以减少同时显示的归档数或调整组缩放。组间接近时只压弯接近处的外侧轮廓，内圈、组中心和流动文字的相位保持稳定。
