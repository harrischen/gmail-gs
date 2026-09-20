# Gmail 自动分诊脚本

一个 Google Apps Script，用来把堆积的 Gmail 收件箱自动分类、归档。

初衷：收件箱堆了 2000+ 封未读邮件，绝大部分是营销推广，混着验证码、技术博客、
银行账单和账号安全告警。手动清不现实，第三方工具要么收费、要么要交出邮箱权限。
所以用 Apps Script 自己做——**数据不出你的 Google 账号，零成本，规则完全可控**。

---

## 快速开始

1. 打开 <https://script.google.com> → 新建项目
2. 把 `gmail-auto-triage.gs` 的全部内容粘进编辑器，保存
3. 左侧**项目设置**（齿轮）→ 勾选「在编辑器中显示 appsscript.json 清单文件」
4. 把本仓库 `appsscript.json` 的内容填进去（目的是收窄权限，见下文）
5. 保持 `CONFIG.dryRun = true`，运行 `preview()`，看每条规则各命中多少封
6. 核对数字合理后，把 `dryRun` 改成 `false`，运行 `run()`
7. 想长期自动跑，运行 `installDailyTrigger()`

**首次运行会弹授权。** 因为是自己写的脚本，Google 会提示「此应用未经过验证」，
点左下角**高级 → 前往（不安全）**继续即可。

---

## 设计原则

### 1. 只归档，永不删除

脚本从头到尾没有一行删除代码。归档 = 移出收件箱，邮件仍然在「所有邮件」里可搜索。
所有操作都可回滚。

### 2. 不可逆的批量操作，默认先演练

`dryRun: true` 时只统计不动作。批量归档 2000 封这种事，先看看会发生什么再执行。

### 3. 按「你拿它做什么」分类，不按「谁发的」分类

这是决定标签该合并还是拆分的标准：

> **处理动作相同 + 你不会分别去翻 = 同一个标签**

反面例子：建一个 `google` 标签。Google 域名下混着账号安全告警（必须看）和
Chrome 扩展更新通知（噪音），处理方式完全不同，塞进一个标签就毁了。
所以本项目把它们拆到 `Auto/账号安全`（不归档）和 `Auto/服务通知`（归档）。

### 4. 误判代价不对称时，宁可多留

银行邮件、账号安全告警这类，漏看的代价远大于收件箱多几封。
所以它们 `archive: false`，宁可占地方也不静默归档。

### 5. 靠时间衰减兜住总量，而不是靠猜关键字

招商银行邮件量大，但不去赌哪些标题重要（猜错代价太高）。
改为：全部先留收件箱，再用一条 `older_than:7d` 规则归档。
这样收件箱里的招行邮件永远不超过 7 天的量，而且**关键字漏判也不会误归档**——
最坏情况只是多躺 7 天。

---

## 函数一览

| 函数 | 参数 | 作用 |
|---|---|---|
| `run()` | 无 | 主入口，按 `CONFIG.rules` 处理 |
| `preview()` | 无 | 强制 dry run 跑一次，只看统计 |
| `installDailyTrigger()` | 无 | 安装每日凌晨 3 点定时执行 |
| `uninstallTriggers()` | 无 | 移除所有定时任务 |
| `listTopSenders(query, byFullAddress)` | 可选 | 诊断：列出发件人域名分布，用来填规则的 `from:` |
| `resetAll()` | 无 | **全部重来**：清空所有受管标签 + 放回 inbox + 标回未读 |
| `clearLabel(name)` | 默认 `Auto/技术阅读` | 只移除某个标签，不动 inbox/已读状态 |
| `undoByLabel(name)` | 需改默认值 | 把某标签下的邮件放回 inbox 并标回未读 |
| `fixMislabeled(from, to)` | 有默认值 | 把某个标签里的营销邮件挪走 |

> **注意**：Apps Script 编辑器点「运行」时**无法给函数传参数**。
> 需要参数的函数要么改代码里的默认值，要么在文件末尾临时加一行调用再删掉。

---

## 两类标签的区别（最重要）

这两个配置的作用完全不同，弄混了会丢数据：

```js
protectedLabels: ['工作邮件', '招商银行', '勤城达'],   // 只保护，任何规则都不碰
managedLabels:   ['招商银行', 'npm', ...],            // resetAll 会清空它
```

**`protectedLabels`** —— 这些标签下的邮件，任何规则都不会打新标签/标已读/归档。

**`managedLabels`** —— `resetAll()` 会清空这些标签，让邮件重新分诊。

⚠️ **只有「发件人明确、规则能自动复现」的标签才能进 `managedLabels`。**

`工作邮件` 和 `勤城达` 是手工分类的，发件人五花八门，**没有任何 `from:` 规则能复现**。
它们如果进了 `managedLabels`，`resetAll` 一清，那些手工分类就**永久丢失**
（邮件还在，但分类没了且无法还原）。所以它们只在 `protectedLabels` 里。

---

## 踩过的坑

### `from:` 是子串匹配，不是精确域名匹配

```js
from:newsletter   // 会命中 nikeofficial@newsletter.nike.com.cn ← Nike 广告邮件
```

所以**只填完整域名**，别填 `newsletter` / `digest` / `weekly` / `blog` 这种通用词。
这条机制反过来也能用：`from:openai.com` 一次覆盖 `email.openai.com` 和 `tm.openai.com`。

### 批量 API 单次上限 100 个线程

`addToThreads` / `markThreadsRead` / `moveThreadsToArchive` 超过 100 会抛
`Exception: This operation can only be applied to at most 100 threads`。
所以有 `eachBatch()` 做切块。

### Apps Script 单次执行上限 6 分钟

2000 封不可能一次跑完。脚本内置 `timeBudgetMs`（默认 4.5 分钟），
到点主动停止并打印提示，进度会保留——**多跑几次就行**。

### `run()` 里不要重复搜索

早期版本在实际执行时也跑了一遍 `collectStats()`，等于每条规则搜两次，工作量翻倍。
现在只有 dry run 模式才统计。

### 授权时会要求「撰写、发送」权限

因为 `GmailApp` 默认申请 `https://mail.google.com/`（完整权限）。
Google 是按 scope 授权，不是按你实际调用的方法。在 `appsscript.json` 里
手写 `oauthScopes` 收窄到 `gmail.modify` + `gmail.labels` 即可去掉。
改完需要重新授权一次。

### 规则顺序很重要

**具体的在前，兜底在后。** 命中即处理，被前面的规则标为已读后，
后面的规则就匹配不到了（规则都匹配 `is:unread`）。

特别注意：`Auto/账号安全` 必须排在 `Auto/系统通知` 之前——
Google 的安全告警在 Gmail 里被判为 `category:updates`，
排在后面会被系统通知规则抢走并归档。

---

## 规则结构

```js
{
  name: '显示名',
  query: 'Gmail 搜索语法',
  label: '目标标签',
  markRead: true,   // 是否标为已读
  archive: true,    // 是否移出收件箱
}
```

常用搜索语法：

```
category:promotions / updates / social / forums / purchases / reservations
older_than:7d    newer_than:1y
from:xxx         subject:"xxx"
has:attachment   label:xxx   in:inbox
```

---

## 内置分类

| 标签 | 归档 | 说明 |
|---|---|---|
| `Auto/验证码` | 7 天后 | 一次性验证码，有时效性 |
| `Auto/账号安全` | 否 | 异常登录、改密码、新设备 |
| `Auto/技术阅读` | 是 | 技术博客 / Newsletter |
| `Auto/账单` | 否 | Gmail 判定的购买/预订类 |
| `招商银行` | 部分 | 营销的立刻归档，其余 7 天后归档 |
| `npm` | 是 | 版本更新通知 |
| `Auto/AI服务` | 是 | OpenAI / Anthropic / Poe 等 |
| `Auto/设计` | 是 | Dribbble / IconScout |
| `Auto/服务通知` | 是 | Cloudflare / Stripe / Clerk / GA / Chrome Web Store |
| `Auto/营销推广` | 是 | Gmail 已识别的 promotions |
| `Auto/社交通知` | 是 | Gmail 已识别的 social |
| `Auto/系统通知` | 是 | Gmail 已识别的 updates |
| `Auto/待清理` | 是 | 兜底：30 天前的未读 |

---

## 执行顺序（别搞反）

```
1. listTopSenders()              查真实发件域名
2. 填好规则里的 from:             ← 没做完别往下走
3. dryRun: true 跑 run()         核对命中数
4. resetAll() 跑几次             清空旧标签
5. dryRun: false 跑 run()        正式分诊，多跑几次
6. installDailyTrigger()         之后每天自动增量处理
```

**第 2 步没做完就跑第 4 步**，邮件清出来后没有规则认领，会掉进兜底规则被归档。

---

## 已知局限

- **规则是白名单匹配**，做不到 100% 覆盖。漏判的邮件会掉进 `Auto/待清理`。
  要更高召回率就得把规则写宽，但会误伤——这是精确率和召回率的取舍，本脚本偏精确。
- **无法还原手工分类**。所以手工标签必须放进 `protectedLabels`。
- **收件箱未读数会先涨后降**。`resetAll()` 会把已归档的邮件标回未读，
  这是重新分诊的必要步骤，不是出错。

---

## 收窄 OAuth 权限

默认 `GmailApp` 申请 `https://mail.google.com/`（读 + 写 + 发送 + 删除）。
本仓库的 `appsscript.json` 收窄为：

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/script.scriptapp"
]
```

没法再降到 `gmail.readonly`——归档本身就是写操作。
改完后必须**重新授权一次**才会生效。
