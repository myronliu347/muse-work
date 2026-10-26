# 技能市场 — 设计说明

日期：2026-10-26  
状态：设计已确认，待审阅  
范围：桌面端「技能」页，以及本地 server 从 skills.sh 拉榜单、从 GitHub 安装到用户目录。不改 Agent 调用技能的方式。

## 问题

技能已经能从磁盘被发现，但桌面没有入口。用户不能在应用里看到已安装的技能，也不能从 skills.sh 装一个新技能。

## 目标

- 左侧图标栏增加「技能」，打开一整页。
- 页上半是已安装的用户技能，下半是 skills.sh 市场。
- 点「安装」把该技能写到 `~/.agents/skills/`，所有会话都能用。
- 在仓库里定位目录的规则与 skills CLI 一致：先找 `SKILL.md`，再用 frontmatter 的 `name` 对上 `skillId`。

## 非目标

- 不安装到当前项目目录。
- 不调用 `npx skills`，也不使用需要 Vercel OIDC 的 `https://skills.sh/api/v1`。
- 不安装私有仓库，也不安装 `source` 不是 `owner/repo` 的来源。
- 不在这一版做更新检查、版本锁定或 `skills-lock.json`。
- 不列出、不卸载内置技能和项目目录里的技能。
- 不改技能在对话里的调用方式。

## 左侧图标栏

在「自动化」和「设置」之间插入「技能」。顺序变为：Muse Bot、会话、自动化、技能、设置。

图标是一张折角文档，线宽 1.6，悬停「技能」。选中态与另外四个图标相同。`ShellSurface` 增加 `"skills"`。有窗格的 `DesktopShell` 和无窗格的图标栏都要能打开这一页。从设置页离开时，沿用自动化页那次未保存拦截。

这一页占中间整页，不显示会话列表，也不显示右侧面板。

## 页面

一个可滚动页面，两段。

### 已安装

直接读这三个用户目录，每个子目录一份技能：

- `~/.agents/skills`
- `~/.claude/skills`
- `~/.muse-work/skills`（`MUSE_HOME_DIR` 覆盖主目录名时跟着走）

每行显示 frontmatter 的 `name`、`description`，以及所在目录的最后两级路径。没有 description 或 `SKILL.md` 不合法的目录不出现。列表为空时显示「还没有安装技能」。

每行有「卸载」。点击后确认：「卸载这个技能？已经打开的会话要到下一轮才会停用它。」确认后按该行的 `path` 删除。`path` 必须是上述三个根目录的直接子目录。符号链接只解除链接，不删除链接目标。路径不是直接子目录，或真实路径逃出这三个根目录时，拒绝删除。同名技能分属两个根目录时，两行各自删除自己的目录。

内置技能和项目里的 `.agents/skills`、`.claude/skills`、`.muse-work/skills` 不出现在这张表里。

### 市场

默认请求 `https://www.skills.sh/api/skills/all-time/0`，展示返回的技能。`hasMore` 为真时，页底有「加载更多」，下一页路径是 `/api/skills/all-time/{page}`。

搜索框至少两个字符才请求 `https://skills.sh/api/search?q={q}&limit=50`。输入停 300ms 再发。清空搜索回到总榜第一页。搜索没有「加载更多」。

每行显示 `name`、`source`、安装次数。榜单带 `isOfficial: true` 时加「官方」。公开接口没有说明文字，市场行不显示 description。

`source` 符合 `owner/repo` 时显示「安装」。已经安装（已安装列表里有同名技能，比较时忽略大小写）时，按钮改为「已安装」且不可点。`source` 不是 `owner/repo` 时，按钮不可点，文案是「需用 CLI 安装」。

请求失败时，市场区域显示错误，已安装列表保持可用。

## 安装

`POST` 体为 `{ source, skillId }`。

`source` 必须是 `owner/repo`：两段都只含字母、数字、`.`、`_`、`-`，且不能是 `.` 或 `..`。`skillId` 是非空字符串，长度不超过 128，不能含 `/`、`\` 或空字符。不满足则 400。

步骤：

1. 在临时目录执行 `git clone --depth 1`，地址是 `https://github.com/{owner}/{repo}.git`。环境变量 `GIT_TERMINAL_PROMPT=0`。超时 60 秒。克隆失败则安装失败，并删掉临时目录。
2. 在克隆结果里找技能目录，规则见下一节。
3. 用 frontmatter `name` 作为安装目录名。这个名字必须是单个路径段：不能是空、`.`、`..`，不能含 `/`、`\` 或空字符。不满足则安装失败。
4. 目标 `~/.agents/skills/<name>/` 已存在时，返回「已经安装」，不覆盖。
5. 把技能目录里的文件复制进去。技能目录指含有匹配的 `SKILL.md` 的那一层，包含它旁边的脚本和引用，不包含更上层的仓库文件。
6. 复制时跳过 `.git`。符号链接先解析：真实路径在该技能目录内的，按目标文件的内容复制，不把链接留到临时克隆上。真实路径逃出该目录的，整次安装失败并删除已写入的目标。
7. 合计超过 25 MiB，或文件数超过 1000，或单个文件超过 10 MiB，安装失败并删除目标。
8. 成功或失败都删除临时克隆。

成功后：

- 清掉服务端 `GET /skills` 的 30 秒列表缓存。
- 对当前进程里已经建立的技能目录缓存做一次重新扫描。
- 正在进行的那一轮对话不改。该会话的下一轮，以及新开的会话，能发现这个技能。
- 技能页重新读磁盘，这一行变为「已安装」。

## 在仓库里定位目录

榜单只给 `source` 和 `skillId`，不给路径。不猜测 `skills/<skillId>/`。

容器，按这个顺序：

1. 仓库根。根目录有合法 `SKILL.md` 时，只认这一个技能，不再往下找。合法指能解析出字符串 `name` 和 `description`。
2. 否则在这些目录里找，从该目录往下最多 3 层。某一层自己有 `SKILL.md` 就收下它，不再进入它的子目录：
   - `skills/`
   - `skills/.curated/`
   - `skills/.experimental/`
   - `skills/.system/`
   - `.agents/skills/`、`.claude/skills/`、`.cline/skills/`、`.codebuddy/skills/`、`.codex/skills/`、`.commandcode/skills/`、`.continue/skills/`、`.factory/skills/`、`.github/skills/`、`.goose/skills/`、`.grok/skills/`、`.iflow/skills/`、`.junie/skills/`、`.kilo/skills/`、`.kilocode/skills/`、`.kimchi/skills/`、`.kiro/skills/`、`.minimax/skills/`、`.mux/skills/`、`.neovate/skills/`、`.opencode/skills/`、`.openhands/skills/`、`.pi/skills/`、`.posit/assistant/skills/`、`.qoder/skills/`、`.roo/skills/`、`.trae/skills/`、`.windsurf/skills/`、`.zcode/skills/`、`.zencoder/skills/`
3. 第 2 步一个技能都没有时，才从仓库根递归找 `SKILL.md`。容器里已经有别的技能时，不再递归，藏在第四层的目标技能算没找到。递归跳过 `node_modules`、`.git`、`dist`、`build`、`__pycache__`。

在找到的技能里，frontmatter `name` 与 `skillId` 忽略大小写后完全相等的留下。不用目录名凑匹配。留下 0 个时，错误是「仓库里没有这个技能」。留下多于 1 个时，错误是「仓库里有多份同名技能」。两种都不写入 `~/.agents/skills`。

`find-skills` 的例子：仓库 `vercel-labs/skills` 根上没有 `SKILL.md`，`skills/find-skills/SKILL.md` 的 `name` 是 `find-skills`，与 `skillId` 一致，于是复制 `skills/find-skills/`。

## 接口

都在现有本地 server 上。

- `GET /skills/installed`：已安装的用户技能。字段：`name`、`description`、`path`。
- `DELETE /skills/installed`：体为 `{ path }`。只接受三个用户根目录的直接子目录，否则 400，不删。
- `GET /skill-market?page=0`：代理总榜一页。字段：`source`、`skillId`、`name`、`installs`、`isOfficial`，以及 `hasMore`。
- `GET /skill-market?q=`：`q` 去掉首尾空白后至少 2 个字符，否则 400。同时带了 `q` 和 `page` 时走搜索，忽略 `page`。
- `POST /skill-market/install`：体为 `{ source, skillId }`。成功返回 `{ name, path }`。

市场代理超时 15 秒。上游非 2xx 时，本接口返回 502 和一句可读原因。

## 错误

安装按钮的状态只有四种：安装、安装中、已安装、失败。失败时按钮回到「安装」，该行下面显示原因。原因用中文短句，不贴 git 或 HTTP 原文。常见原因：

- 仓库克隆失败
- 仓库里没有这个技能
- 仓库里有多份同名技能
- 已经安装
- 技能文件过大
- 技能含有指向目录外的链接
- 本机没有 git

卸载失败时，该行保留，并显示原因。

## 测试

- 定位：根上的 `SKILL.md` 独占；`skills/<name>/SKILL.md` 能对上；容器内三层能对上。容器里已有别的技能时，第四层不会被递归补上。容器一个技能都没有时，第四层能被递归找到。0 个和多个同名都失败。目录名相同但 frontmatter `name` 不同时不算匹配。
- 复制：符号链接逃出技能目录时失败且不留下目标目录；超限失败且不留下目标目录；目标已存在时不覆盖。
- 校验：`source` 含 `..`、额外斜杠或别的主机时拒绝。`skillId` 含斜杠时拒绝。
- 市场：总榜和搜索的响应被收成上面的字段；上游失败变成 502。
- 页面：图标栏有「技能」；页上有已安装和市场；已安装的市场行按钮是「已安装」；点安装会带上该行的 `source` 和 `skillId`。

## 界面

技能页沿用自动化整页的版式。只使用已经在自动化页、全局样式和确认框里出现的颜色、字号、圆角和间距，不新增色值，不改图标栏宽度。

- 页面根：纵向 flex，占满中间栏，背景 `var(--color-background)`，文字 `var(--gray-12)`。
- 顶栏高 38px，左右 24px。标题「技能」用 `var(--font-size-1)`、字重 600。
- 内容最大宽 860px，居中，内边距 18px 24px 32px。
- 两段标题用 22px、字重 650、字距 -0.02em。段与段之间 32px。
- 列表是一张圆角 12px 的卡片：边框 `color-mix(in srgb, var(--gray-6) 70%, transparent)`，底 `var(--gray-3)`。每一行左右 14px、上下 12px，行间 `var(--hairline)` 的 `var(--gray-6)`，最后一行没有底边。
- 技能名 14px、字重 600。说明和来源 12px、`var(--gray-11)`，过长省略。
- 「官方」用高 20px 的药丸：底 `var(--gray-4)`，字 `var(--gray-11)`、11px，圆角 999px。
- 「安装」是主按钮：12px，内边距 6px 12px，圆角 8px，底和边框 `var(--accent-9)`，字 `var(--accent-contrast)`。
- 「加载更多」和不可用的「已安装」「需用 CLI 安装」是次按钮：底 `var(--gray-4)`，边框 `var(--gray-6)`，字 `var(--gray-12)`。禁用时透明度 0.4。
- 「卸载」是危险文字按钮：字 `var(--red-9)`，背景透明。
- 搜索框用文件搜索那套线框：边框 `var(--gray-6)`，底 `var(--gray-1)`，字 `var(--gray-12)`、`var(--font-size-1)`，圆角 8px，高 32px。
- 空状态和错误沿用自动化页：空状态字 `var(--gray-11)`；错误字 `var(--red-11)`、13px。
- 卸载确认用现有 `ConfirmDialog`，不新做对话框。
- 按钮焦点沿用全局 `button:focus-visible` 的 2px `var(--accent-9)` 描边。
- 图标栏按钮复用 `desktop-rail-btn`。图标是折角文档，线宽 1.6。

## 自查

- 安装目录只来自 frontmatter `name` 与 `skillId` 的忽略大小写全等，不来自猜测路径。
- 写入位置只有 `~/.agents/skills/<name>`。卸载只碰三个用户根目录的直接子目录。
- 市场挂了，已安装列表仍能读本地磁盘。
- 内置技能和项目技能不在这张表里，也不能被这个页面删掉。
- 技能页只复用自动化页、文件搜索框、全局焦点和现有确认框的颜色、字号、圆角、间距。
