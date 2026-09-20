# Gmail 自动分诊脚本

一个 Google Apps Script，用来给堆积的 Gmail 邮件自动打分类标签。

初衷：收件箱堆了 2000+ 封未读邮件，绝大部分是营销推广，混着验证码、技术博客、
银行账单和账号安全告警。手动清不现实，第三方工具要么收费、要么要交出邮箱权限。
所以用 Apps Script 自己做——**数据不出你的 Google 账号，零成本，规则完全可控**。

`run()` 只做两件事：**给命中的邮件打标签**，以及按每条规则的配置**决定是否移出收件箱**。
它从不删除邮件，也从不改已读状态。

---

## 前置条件

除了 Apps Script，还需要启用 **Gmail API 高级服务**：
编辑器左侧「服务」→ 添加服务 → Gmail API → 添加。

所有批量操作都走 `batchModify`（1 个请求改 1000 封）。没启用时会直接报错并提示怎么开，不会静默失败。

## 快速开始

1. 打开 <https://script.google.com> → 新建项目
2. 把 `gmail-auto-triage.gs` 的全部内容粘进编辑器，保存
3. 左侧**项目设置**（齿轮）→ 勾选「在编辑器中显示 appsscript.json 清单文件」
4. 把本仓库 `appsscript.json` 的内容填进去（目的是收窄权限，见下文）
5. 左侧**服务** → 添加服务 → Gmail API
6. 运行 `run()` 分类（存量多就多跑几次，它有 4.5 分钟时间预算）
7. 想长期自动跑，运行 `installDailyTrigger()`

**首次运行会弹授权。** 因为是自己写的脚本，Google 会提示「此应用未经过验证」，
点左下角**高级 → 前往（不安全）**继续即可。

---

## 设计原则

### 1. 不删邮件，只加标签（归档是可选的）

`run()` 从头到尾没有一行删除邮件代码。它做的是**给命中的邮件加分类标签**，
以及按每条规则的 `archive` 配置决定是否移出收件箱。不改已读状态。
所有邮件都还在「所有邮件」里，归档的邮件通过它的标签照样能找到。

### 2. 加标签是安全的，删标签不可逆

`run()` 只加标签，随时可以重跑、覆盖，没有风险。
但 `deleteAllLabels` / `clearAllLabels` 会丢掉标签与邮件的关联，且**无法撤销**——
脚本里没有备份，也没有撤销功能。

### 3. 按「你拿它做什么」分类，不按「谁发的」分类

这是决定标签该合并还是拆分的标准：

> **处理动作相同 + 你不会分别去翻 = 同一个标签**

反面例子：建一个 `google` 标签。Google 域名下混着账号安全告警（必须看）和
Chrome 扩展更新通知（噪音），处理方式完全不同，塞进一个标签就毁了。
所以本项目把它们拆到 `Auto - 账号安全` 和 `Auto - 服务通知`。

### 4. 误判代价不对称时，宁可多留

银行邮件、账号安全告警这类，漏看的代价远大于多看几封。
所以判定它们的规则写得更严格（限定发件域名 + 主题关键词），宁可漏判也不误判。

### 5. 不赌标题，只认发件域名

招商银行邮件量大，但不去赌哪些标题重要（猜错代价太高）。
规则只做「认出发件域名是 cmbchina.com」，不做内容判断——**关键字漏判也不会误伤**，
最坏情况只是某封招行邮件没被认出来，它会掉进 `Auto - 待清理`。

### 6. 先命中优先：一封邮件只拿一个标签

规则按顺序执行，一封邮件只会拿到**第一条命中规则**的标签，后面的规则跳过它。

`Auto - 待清理` 因此才真正等于「没被任何规则命中」。否则兜底规则的查询是
`is:unread`（匹配全部未读），会把所有已分类的邮件再捞一遍打上第二个标签。

这个去重靠两个机制配合，缺一个就会出现重复标签：

- **同一轮内**靠 `run()` 里的 `processed` 集合——Gmail 索引有延迟，
  刚打上的标签下一次查询可能还查不出来，不能靠查询排除。
- **跨轮**靠 `queryFor()` 自动拼接的排除条件：每条规则的查询后面都会加上
  全部 13 个 `-label:"..."`，只要邮件身上已经有任意一个分类标签，任何规则都匹配不到它。

### 7. 不存任何状态，标签本身就是记录

脚本没有用 `PropertiesService`，也没有任何本地记录。
判断「这封邮件分过类了吗」的唯一依据是**它身上有没有规则标签**：

```
is:unread -is:starred -label:"Auto - 验证码" ... -label:"Auto - 待清理"
```

好处是重新部署、换设备都不会丢进度；你手工摘掉某封邮件的标签，
它就变回「未分类」，下次会被重新分类。

---

## 函数一览

### 下拉框里只有 4 个

| 函数 | 作用 |
|---|---|
| `run()` | 按 `CONFIG.rules` 批量分类（打标签，部分规则会归档） |
| `deleteAllLabels()` | 删除全部标签 |
| `clearAllLabels()` | 清空全部标签的邮件（标签保留） |
| `installDailyTrigger()` | 每天凌晨 3 点定时跑 `run()` |

### 单个标签的操作（在 tools 里，不占下拉框）

| 函数 | 作用 |
|---|---|
| `tools.deleteLabel()` | 删除单个标签 |
| `tools.clearLabel()` | 清空单个标签的邮件（标签保留） |

用法：把标签名填进 `CONFIG.targetLabel`，然后在**文件末尾加一行**调用，跑完删掉：

```js
tools.deleteLabel()
```

编辑器点「运行」不能传参，所以这是唯一的方式。

### 为什么下拉框正好 4 个

Apps Script 的下拉框会把**所有顶层函数**都列出来，
不管写成 `function foo(){}` 还是 `const foo = function(){}` —— 两种都会出现。

所以 22 个内部函数全部收在一个对象字面量里：

```js
const tools = {
  listMessageIds(query, cap, shouldStop) { ... },
  batchModifyAll(ids, add, remove, shouldStop) { ... },
  // ...共 22 个, 都是支撑上面功能的, 不是独立功能
};
```

它们不是顶层函数，下拉框里就不会出现。

### 删除 vs 清空

| 函数 | 移除标签 | 删除标签本身 |
|---|---|---|
| `clearLabel` / `clearAllLabels` | ✅ | ❌ |
| `deleteLabel` / `deleteAllLabels` | — | ✅ |

### 怎么指定操作哪个标签

Apps Script 编辑器点「运行」**无法传参数**，`deleteLabel("标签名")` 这种写法
在编辑器里做不到。唯一的方式是填 `CONFIG.targetLabel`：

```js
targetLabel: '工作邮件',   // 保存后运行 deleteLabel(), 就会删这个标签
```

留空就会提示你去填。

---

## 没有开关，也没有演练

脚本里**没有任何需要你修改的开关**。选函数 → 点运行，直接生效。

删除 / 清空标签在执行前会打印完整清单（标签名、各多少封、是否手工分类），
但**打印完就执行了**——清单是告诉你改了什么，不是让你再确认一次。

⚠️ **不可逆，没有备份，也没有撤销功能。**
手工分类（工作邮件 / 勤城达）是手动归类的，发件人五花八门，
没有任何 `from:` 规则能复现——清掉后邮件还在，但分类永久丢失。

所以建议的顺序是：先用 `run()` 跑一遍看分类效果（它只加标签，风险低），
确认满意了再去动标签。

## 「全部」是哪个范围

`deleteAllLabels()` / `clearAllLabels()` 里的「全部」=

**所有 `type === 'user'` 的标签**，包含你手工分类的。

用 Gmail API 返回的 `type` 字段判定，天然排除 INBOX / SENT / SPAM / DRAFT /
CATEGORY_* 这些系统标签——它们本来也删不掉。不按名字前缀猜，所以不会出现
「名字以 Auto 开头就误伤」的情况。

想跳过某些标签，填 `CONFIG.excludeFromBulk`：

```js
excludeFromBulk: ['工作邮件', '勤城达'],   // 批量操作永远跳过这两个
```

## `protectedLabels` 只管分类，不管清空

```js
protectedLabels: ['工作邮件', '勤城达'],
```

它的作用是：**分类规则（`run()`）会跳过这些标签下的邮件**，不给它们打新标签。
已经在这些标签下的邮件 = 你已经手动分好类了。

⚠️ 它**不阻止** `clearAllLabels()` / `deleteAllLabels()`。
「规则不碰」和「不允许清空」是两件事：前者是自动行为，后者是你显式调用的。
清单里会把这些标签标成「手工分类」并警告，但不会替你拦下来。

`run()` 会跳过这些标签下的邮件；
但它们仍会被 `clearAllLabels()` 清空——需要保护就加进 `excludeFromBulk`。

---

## 踩过的坑

### `from:` 是子串匹配，不是精确域名匹配

```js
from:newsletter   // 会命中 nikeofficial@newsletter.nike.com.cn ← Nike 广告邮件
```

所以**只填完整域名**，别填 `newsletter` / `digest` / `weekly` / `blog` 这种通用词。
这条机制反过来也能用：`from:openai.com` 一次覆盖 `email.openai.com` 和 `tm.openai.com`。

### 批量操作必须用 batchModify，不能用 GmailApp

`GmailApp` 的 `addToThreads` / `markThreadsRead` / `moveThreadsToArchive`
实测约 **0.4 秒/封**，且单次上限 100 个线程。8400 封要 56 分钟，跑不完。

`Gmail.Users.Messages.batchModify` 是 **1 个请求改 1000 封**，8400 封只要 9 个请求。
所以清空/删除全部走这条路径。

代价：batchModify 操作的是**消息**不是线程。同一线程里的其它消息仍带原标签，
所以清空后 `label:X` 可能仍命中——所以脚本按 ID 快照执行，并如实报告「还有剩余」。

### 不能靠「重搜搜不到」判定结束

Gmail 的搜索索引更新不是同步的。移除标签后**立刻**重搜，很可能又返回同一批。

曾经用 `while` 循环反复搜 `label:X` 直到搜不到为止，
结果是同一批邮件被反复处理、计数虚高、空转到超时。

现在的做法：**先把要改的 messageId 全部快照下来，再分块执行**。
结束条件是分页 `nextPageToken` 耗尽，不依赖重搜。

### 统计和执行必须同口径

统计曾经用 `GmailApp.search` 走**线程**数，而实际执行走 `batchModify`
处理**消息**数。数字对不上，等于拿错误的基准判断「确认无误」。

现在统计和执行都走同一个 `listMessageIds()`。

### Apps Script 单次执行上限 6 分钟

脚本内置 `timeBudgetMs`（默认 4.5 分钟），到点主动停止并打印提示。

每条规则一次就把命中的邮件全部拉完（`maxMessagesPerRule` 为 `Infinity`，
上限交给时间预算），所以 **1 万封通常一轮就能跑完**。
量再大到超时才会分几轮，进度会保留——多跑几次就行。

### `run()` 里不要重复搜索

早期版本在实际执行时也跑了一遍 `collectStats()`，等于每条规则搜两次，工作量翻倍。
现在 `runPlan()` 里搜索和执行各一次，没有独立的统计阶段。

### 授权时会要求「撰写、发送」权限

因为 `GmailApp` 默认申请 `https://mail.google.com/`（完整权限）。
Google 是按 scope 授权，不是按你实际调用的方法。在 `appsscript.json` 里
手写 `oauthScopes` 收窄到 `gmail.modify` + `gmail.labels` 即可去掉。
改完需要重新授权一次。

### 规则顺序很重要

**具体的在前，兜底在后。** 一封邮件只会拿到第一条命中规则的标签。

特别注意：`Auto - 账号安全` 必须排在 `Auto - 系统通知` 之前——
Google 的安全告警在 Gmail 里被判为 `category:updates`，
排在后面会被系统通知规则先匹配，打上错的标签。

---

## 规则结构

```js
{
  name: '显示名',
  query: 'Gmail 搜索语法',
  label: '目标标签',
  markRead: false,  // 是否标为已读（当前全部 false: 保留未读提醒）
  archive: false,   // 是否移出收件箱（噪音类 true, 涉及钱/安全的 false）
}
```

`archive: true` 的效果是移除「收件箱」标签——**不是"移动到某个标签下"**，
Gmail 没有这个概念。邮件本身不动，仍在「所有邮件」，通过它原有的标签随时能找到。

⚠️ 脚本**没有"批量放回收件箱"的功能**。批量归档前先想清楚，
或者只给明确的噪音类开 `archive`。

常用搜索语法：

```
category:promotions / updates / social / forums / purchases / reservations
older_than:7d    newer_than:1y
from:xxx         subject:"xxx"
has:attachment   label:xxx   in:inbox
```

---

## 内置分类

`run()` 给命中的邮件打标签，其中 7 条噪音类规则会同时把它移出收件箱；不改已读状态。

| 标签 | 说明 |
|---|---|
| `Auto - 验证码` | 一次性验证码，有时效性 |
| `Auto - 账号安全` | 异常登录、改密码、新设备 |
| `Auto - 技术阅读` | 技术博客 / Newsletter |
| `Auto - 账单` | Gmail 判定的购买/预订类 |
| `招商银行` | 招行邮件（含电子账单） |
| `npm` | 版本更新通知 |
| `Auto - AI服务` | OpenAI / Anthropic / Poe 等 |
| `Auto - 设计` | Dribbble / IconScout |
| `Auto - 服务通知` | Cloudflare / Stripe / Clerk / GA / Chrome Web Store |
| `Auto - 营销推广` | Gmail 已识别的 promotions |
| `Auto - 社交通知` | Gmail 已识别的 social |
| `Auto - 系统通知` | Gmail 已识别的 updates |
| `Auto - 待清理` | 兜底：没被任何规则命中的未读邮件 |

其中「技术博客 / npm / 设计 / 服务通知 / 营销推广 / 社交通知 / 系统更新通知」
这 7 条默认 `archive: true`，打完标签即移出收件箱。
「验证码 / 账号安全 / 账单 / 招商银行 / AI 服务 / 未分类」留在收件箱——
验证码要立刻用，账号安全和账单漏看有实际后果。

标签名用 ` - ` 而不是 `/`，所以不会产生嵌套父标签。带空格，搜索时必须加引号：
`label:"Auto - 验证码"`。

---

## 执行顺序（别搞反）

```
1. 先在 Gmail 搜索框试几条规则, 确认能搜到该搜的邮件
2. run()                          正式分诊, 存量多就多跑几次
3. installDailyTrigger()          之后每天自动增量处理
4. (可选, 且不可逆) clearAllLabels() / deleteAllLabels()
```

**存量大的时候 `run()` 一次跑不完** —— 它有 4.5 分钟时间预算，
到点会打印提示并停下，再跑一次继续即可。

**第 1 步没做完就跑第 4 步**，邮件清出来后没有规则认领，清掉就真没了。

---

## 已知局限

- **规则是白名单匹配**，做不到 100% 覆盖。漏判的邮件会掉进 `Auto - 待清理`。
  要更高召回率就得把规则写宽，但会误伤——这是精确率和召回率的取舍，本脚本偏精确。
- **没有备份，也没有撤销**。手工分类（工作邮件 / 勤城达）清空或删除后无法还原。
  唯一的防线是执行前打印的清单。要硬保护就填 `excludeFromBulk`。
- **清空操作是幂等的**。重复执行不会出错（移除一个已经没有的标签是空操作），
  所以「再运行一次继续」不会造成副作用。

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

没法再降到 `gmail.readonly`——打标签本身就是写操作。
改完后必须**重新授权一次**才会生效。
