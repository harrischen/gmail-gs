/**
 * Gmail 自动分诊脚本
 *
 * 用法:
 *   1. 打开 https://script.google.com → 新建项目
 *   2. 把本文件全部内容粘进去，保存
 *   3. 第一次务必保持 CONFIG.dryRun = true，运行 preview() 看统计
 *   4. 确认无误后把 dryRun 改成 false，运行 run()
 *   5. 想长期自动跑，运行 installDailyTrigger()
 *   6. 后悔了就跑 undoByLabel('Auto/营销推广')
 *
 * 安全设计:
 *   - 只归档(archive), 永不删除。归档 = 移出收件箱, 邮件仍在「所有邮件」里可搜索
 *   - 星标邮件永不处理
 *   - 默认只处理「已读」以外的未读邮件, 处理完标记已读, 因此重复运行不会重复处理
 */

const CONFIG = {
  // ===== 第一次一定保持 true, 只统计不动作 =====
  dryRun: true,

  // 单次最多处理多少封线程 (Apps Script 单次执行上限 6 分钟, 保守设小一点)
  maxThreadsPerRun: 150,

  // 时间预算: 到点就停, 剩下的下次继续。6 分钟硬上限, 这里留 1.5 分钟余量
  timeBudgetMs: 4.5 * 60 * 1000,

  // 永不处理的邮件 (星标保护)
  protectQuery: '-is:starred',

  // ===== 已有标签保护 =====
  // 这些标签下的邮件, 任何规则都不会碰(不会打新标签/标已读/归档)。
  // 已经在这些标签下的邮件 = 你已经手动分好类了, 脚本不该再动。
  // 注意: 新邮件没有这些标签, 所以仍会被下面的规则正常归类进去。
  // 注意: 工作邮件 / 勤城达 是你手动归类的, 发件人五花八门, 没有任何 from: 规则能复现。
  //      所以它们【只保护, 不清理, 不重新分配】——resetAll 绝不能碰, 否则你的手工分类就永久丢了。
  protectedLabels: ['工作邮件', '招商银行', '勤城达'],

  // ===== 纳入管理的已有标签 =====
  // resetAll() 会清空这些标签; run() 会按规则把邮件重新分配进去。
  // 加进来的标签必须同时在下面的 rules 里有对应的归类规则, 否则清空后没人认领,
  // 会被兜底规则(历史遗留未读)吃掉并归档。
  // 只有「发件人明确、规则能自动复现」的标签才能进这里。
  // 工作邮件 / 勤城达 不在这里 —— 它们是手工分类, 清空了就再也回不来。
  // 注: Google Analytics / Chrome Web Store 保留在这里, 是为了让 resetAll 把它们清空,
  //     这样里面的旧邮件能被重新分配到 Auto/服务通知。
  //     等 resetAll 跑完、这两个标签空了之后, 就可以从本列表移除, 并在 Gmail 设置里删掉标签
  //     (和 Notes 一样: 齿轮 → 查看所有设置 → Labels → Remove)。
  managedLabels: ['招商银行', 'npm', 'Google Analytics', 'Chrome Web Store'],

  // ===== 分类规则 =====
  // 按顺序执行, 命中即处理。越具体的规则放前面, 兜底规则放最后。
  // 可用搜索语法:
  //   category:promotions / updates / social / forums / purchases  (Gmail 自带分类)
  //   older_than:7d / newer_than:1y
  //   from:xxx  subject:"xxx"  has:attachment  label:xxx
  rules: [
    {
      name: '验证码 / 登录确认',
      // 验证码有时效性, 只打标签不立刻归档, 等 7 天后由下面的归档规则处理
      query:
        'is:unread (subject:"验证码" OR subject:"校验码" OR subject:"动态码" OR subject:"确认码" OR ' +
        'subject:"身份验证" OR subject:"登录确认" OR subject:"verification code" OR subject:"security code" OR ' +
        'subject:"one-time" OR subject:"OTP" OR subject:"passcode" OR subject:"2FA")',
      label: 'Auto/验证码',
      markRead: true,
      archive: false,
    },
    // 放在「验证码」之后: 验证码是一次性的码(7天后自动归档),
    // 这里抓的是真正的安全事件(异常登录/改密码/新设备), 不归档、不标已读。
    // 必须排在「系统通知」之前, 否则 Google 的安全告警会被 category:updates 吃掉归档。
    {
      name: '账号安全',
      // 双重匹配: 既认发件域名, 也认主题关键字(覆盖没列进来的服务商)
      query:
        'is:unread (from:accounts.google.com OR from:appleid.apple.com OR from:id.apple.com OR ' +
        'from:account.meta.com OR from:accountprotection.microsoft.com OR ' +
        'subject:"异常登录" OR subject:"异地登录" OR subject:"新设备" OR subject:"安全提醒" OR ' +
        'subject:"密码已修改" OR subject:"密码重置" OR subject:"账号异常" OR subject:"账户异常" OR ' +
        'subject:"security alert" OR subject:"new sign-in" OR subject:"unusual activity" OR ' +
        'subject:"password changed" OR subject:"sign-in attempt" OR subject:"verify your identity")',
      label: 'Auto/账号安全',
      markRead: false,
      archive: false,
    },
    {
      name: '技术博客 / Newsletter',
      // ⚠️ Gmail 的 from: 是【子串匹配】不是精确域名匹配!
      //    from:newsletter 会命中 nikeofficial@newsletter.nike.com.cn 这种广告邮件
      //    所以: (1) 只填完整域名, 别填 newsletter/digest/weekly/blog 这种通用词
      //         (2) 保留 -category:promotions 作为兜底, 营销邮件永远不进这个标签
      //    把你真实订阅的技术源填进下面的 from: 列表
      query:
        'is:unread -category:promotions (from:indiehackers.com OR from:leadershipintech.com OR ' +
        'from:substack.com OR from:medium.com OR from:dev.to OR from:infoq.com)',
      label: 'Auto/技术阅读',
      markRead: true,
      archive: true, // 跳过收件箱, 想看的时候去标签里看
    },
    {
      name: '账单 / 订单 / 收据',
      query: 'is:unread (category:purchases OR category:reservations)',
      label: 'Auto/账单',
      markRead: false, // 账单建议保留未读提醒, 你可能真要看
      archive: false,
    },
    // ===== 你已有的标签 =====
    // ⚠️ 下面每条的 from: 都要按你的真实发件人核对。不确定就运行 listTopSenders() 看真实域名。
    //    archive:false 表示只打标签不归档 —— 重要的用 false, 噪音类的用 true
    // 工作邮件 / 勤城达 不在这里 —— 手工分类无法用 from: 规则复现,
    // 它们只出现在 CONFIG.protectedLabels 里(任何规则都不碰)。
    // 招商银行: 实测发件域名是 message.cmbchina.com, 标题多为「电子账单」「XX优惠」
    // 策略: 不靠关键字赌哪些重要, 而是【全部先留收件箱, 再用「7天过期归档」兜住总量】
    //       这样就算关键字漏判, 也不会误归档 —— 最坏情况只是它在收件箱多躺 7 天
    {
      name: '招商银行 - 营销',
      // 只把明显是营销的挑出来立刻归档
      query:
        'is:unread from:message.cmbchina.com (subject:"优惠" OR subject:"活动" OR subject:"分期" OR ' +
        'subject:"积分" OR subject:"尊享" OR subject:"推荐" OR subject:"红包" OR subject:"抽奖" OR subject:"券")',
      label: '招商银行',
      markRead: true,
      archive: true,
    },
    {
      name: '招商银行 - 其余(含电子账单)',
      // 电子账单里可能带还款金额/还款日, 不归档; 交给下面的 7 天规则兜底
      query: 'is:unread (from:message.cmbchina.com OR from:cmbchina.com)',
      label: '招商银行',
      markRead: false,
      archive: false,
    },
    {
      name: '招商银行 - 过期归档',
      // 关键: 保证收件箱里的招行邮件永远不超过 7 天的量, 不管总数多少。
      //       还款提醒过期就没用了; 而且所有邮件都在「招商银行」标签里, 随时能翻。
      query: 'label:招商银行 in:inbox older_than:7d',
      label: '招商银行',
      markRead: true,
      archive: true,
    },
    // Notes 标签已空, 建议在 Gmail 设置里直接删掉, 这里不建规则
    {
      name: 'npm',
      query: 'is:unread (from:npmjs.com OR subject:"npm")',
      label: 'npm',
      markRead: true,
      archive: true, // 版本更新通知, 归档即可
    },
    // Google Analytics / Chrome Web Store 不发独立标签了, 统一进「服务通知」。
    // 理由: 按【你会拿它做什么】分组, 而不是按【谁发的】分组。
    //       建一个 "google" 标签会把账号安全告警和扩展更新通知混在一起, 而这两者处理方式完全不同。
    // ===== 从 listTopSenders() 数据里发现的新聚类 =====
    // 注意: from: 是子串匹配, 所以 from:openai.com 能同时命中 email.openai.com / tm.openai.com
    {
      name: 'AI 服务',
      query:
        'is:unread (from:openai.com OR from:anthropic.com OR from:poe.com OR ' +
        'from:x.ai OR from:okara.ai)',
      label: 'Auto/AI服务',
      markRead: true,
      archive: true, // 订阅/用量通知, 不需要实时看
    },
    {
      name: '设计',
      query: 'is:unread (from:dribbble.com OR from:iconscout.com)',
      label: 'Auto/设计',
      markRead: true,
      archive: true,
    },
    {
      name: '服务通知',
      // 低频系统通知: 都是标已读+归档, 不会分别去翻, 所以合并成一个标签
      query:
        'is:unread (from:cloudflare.com OR from:clerk.com OR from:stripe.com OR ' +
        'from:huggingface.co OR from:analytics-noreply@google.com OR ' +
        'from:chromewebstore-noreply@google.com)',
      label: 'Auto/服务通知',
      markRead: true,
      archive: true,
    },
    {
      name: '营销推广 (Gmail 已识别的)',
      query: 'is:unread category:promotions older_than:3d',
      label: 'Auto/营销推广',
      markRead: true,
      archive: true,
    },
    {
      name: '社交通知',
      query: 'is:unread category:social older_than:3d',
      label: 'Auto/社交通知',
      markRead: true,
      archive: true,
    },
    {
      name: '系统更新通知',
      query: 'is:unread category:updates older_than:3d',
      label: 'Auto/系统通知',
      markRead: true,
      archive: true,
    },
    {
      name: '验证码归档 (7天前)',
      query: 'is:read label:Auto/验证码 older_than:7d',
      label: 'Auto/验证码',
      markRead: true,
      archive: true,
    },
    {
      // ===== 兜底: 清理历史包袱 =====
      // 30 天前的未读邮件, 如果到今天都没看, 大概率以后也不会看
      name: '历史遗留未读 (30天前)',
      query: 'is:unread older_than:30d',
      label: 'Auto/待清理',
      markRead: true,
      archive: true,
    },
  ],
};

/** 主入口: 按规则处理 */
function run() {
  console.log('===== Gmail 自动分诊 =====');
  console.log(`模式: ${CONFIG.dryRun ? 'DRY RUN (只看不做)' : '实际执行'}`);
  console.log('');

  if (CONFIG.dryRun) {
    collectStats().forEach((s) => {
      console.log(`${s.name}: 命中 ${s.count} 封  → ${s.actions}`);
    });
    console.log('');
    console.log('这是演练。确认无误后把 CONFIG.dryRun 改成 false 再运行 run()。');
    return;
  }

  // 实际执行: 带着时间预算跑, 超时就停, 剩下的交给下一次(触发器的下一次运行)
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > CONFIG.timeBudgetMs;

  let total = 0;
  let stopped = false;

  for (let i = 0; i < CONFIG.rules.length; i++) {
    if (outOfTime()) {
      stopped = true;
      break;
    }

    const rule = CONFIG.rules[i];
    const threads = searchThreads(buildQuery(rule.query), CONFIG.maxThreadsPerRun, outOfTime);
    if (threads.length === 0) continue;

    const label = getOrCreateLabel(rule.label);
    eachBatch(threads, (batch) => {
      label.addToThreads(batch);
      if (rule.markRead) GmailApp.markThreadsRead(batch);
      if (rule.archive) GmailApp.moveThreadsToArchive(batch);
    }, outOfTime);

    total += threads.length;
    console.log(`[${i + 1}/${CONFIG.rules.length}] ${rule.name}: 处理 ${threads.length} 封`);
  }

  console.log('');
  console.log(`本次共处理 ${total} 封。剩余未读: ${GmailApp.getInboxUnreadCount()}`);
  if (stopped) {
    console.log('⏱ 接近单次执行时限, 已提前停止。未处理完的会在下次运行继续。');
  }
  console.log('后悔了就运行 undoByLabel("标签名") 把它们放回收件箱。');
}

/** 只看不动: 打印每条规则会命中多少封 */
function preview() {
  const saved = CONFIG.dryRun;
  CONFIG.dryRun = true;
  run();
  CONFIG.dryRun = saved;
}

/** 把某个标签下的邮件全部放回收件箱并标回未读 */
function undoByLabel(labelName) {
  const label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    console.log(`标签不存在: ${labelName}`);
    return;
  }
  const threads = searchThreads(`label:${labelName}`, CONFIG.maxThreadsPerRun);
  eachBatch(threads, (batch) => {
    GmailApp.moveThreadsToInbox(batch);
    GmailApp.markThreadsUnread(batch);
  });
  console.log(`已把 ${threads.length} 封放回收件箱并标为未读。`);
}

/**
 * 补救: 把误归入某个标签的营销邮件挪走。
 * 默认修 Auto/技术阅读 → Auto/营销推广 这次的误伤。
 *
 * 用法: 函数下拉框选 fixMislabeled → 运行。
 * 误伤超过 150 封就多跑几次(跑完的会被移出标签, 重跑不会重复)。
 */
function fixMislabeled(fromLabelName, toLabelName) {
  fromLabelName = fromLabelName || 'Auto/技术阅读';
  toLabelName = toLabelName || 'Auto/营销推广';

  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > CONFIG.timeBudgetMs;

  const threads = searchThreads(
    `label:${fromLabelName} category:promotions`,
    CONFIG.maxThreadsPerRun,
    outOfTime
  );

  if (threads.length === 0) {
    console.log(`「${fromLabelName}」里没有营销邮件, 无需处理。`);
    return;
  }

  const fromLabel = GmailApp.getUserLabelByName(fromLabelName);
  const toLabel = getOrCreateLabel(toLabelName);

  eachBatch(threads, (batch) => {
    fromLabel.removeFromThreads(batch);
    toLabel.addToThreads(batch);
    GmailApp.moveThreadsToArchive(batch);
  }, outOfTime);

  console.log(`已把 ${threads.length} 封从「${fromLabelName}」移到「${toLabelName}」并归档。`);
  console.log('如果还有剩余, 再运行一次本函数。');
}

/**
 * 诊断工具: 列出未读邮件里出现最多的发件人域名, 方便你填规则里的 from:。
 * 运行后看「执行日志」, 按出现次数从多到少排列。
 */
function listTopSenders(query, byFullAddress) {
  query = query || 'is:unread';

  const threads = searchThreads(query, 300);
  const counter = {};

  threads.forEach((t) => {
    const raw = t.getMessages()[0].getFrom(); // 形如 "Name <a@b.com>"
    const match = raw.match(/<(.+?)>/);
    const addr = (match ? match[1] : raw).trim();
    const domain = addr.split('@')[1] || addr;
    const key = byFullAddress ? addr : domain;
    counter[key] = (counter[key] || 0) + 1;
  });

  console.log(`查询 [${query}] 共采样 ${threads.length} 封, 按${byFullAddress ? '完整地址' : '域名'}统计:`);
  Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .forEach(([key, n]) => console.log(`  ${n}\t${key}`));
  console.log('(采样上限 300 封; 要看更细用 listTopSenders("查询", true))');
}

/**
 * 移除某个标签下的所有邮件上的该标签(不归档、不改已读状态)。
 * 用于"这个标签全部分错了, 清空它, 让下次 run() 重新分诊"。
 */
function clearLabel(labelName) {
  labelName = labelName || 'Auto/技术阅读';
  const label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    console.log(`标签不存在: ${labelName}`);
    return;
  }
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > CONFIG.timeBudgetMs;

  const threads = searchThreads(`label:${labelName}`, CONFIG.maxThreadsPerRun, outOfTime);
  eachBatch(threads, (batch) => label.removeFromThreads(batch), outOfTime);
  console.log(`已清空「${labelName}」标签下的 ${threads.length} 封。下次 run() 会重新分诊。`);
}

/**
 * 全部重来: 清空所有 Auto/ 开头的标签, 把涉及到的邮件
 *   1. 移除标签
 *   2. 标回未读   ← 关键: 规则都是匹配 is:unread, 不标回未读下次就匹配不到了
 *   3. 放回 inbox ← 关键: 归档过的也要放回来
 * 恢复到跑脚本之前的状态, 然后重新运行 run() 即可重新分诊。
 *
 * 注意: 跑完后收件箱会瞬间回到 2000+ 未读, 这是预期的。
 *       处理量超过单次时限就多跑几次, 每跑完 100 封标签就被移除, 进度会保留。
 */
function resetAll() {
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > CONFIG.timeBudgetMs;

  // Auto/ 系列 + CONFIG.managedLabels 里你已有的标签, 全部清空
  const autoLabels = GmailApp.getUserLabels().filter((l) => l.getName().indexOf('Auto') === 0);
  const managed = CONFIG.managedLabels
    .map((n) => GmailApp.getUserLabelByName(n))
    .filter(Boolean);

  const seen = new Set();
  const labels = autoLabels.concat(managed).filter((l) => {
    if (seen.has(l.getName())) return false;
    seen.add(l.getName());
    return true;
  });

  if (labels.length === 0) {
    console.log('没有找到任何 Auto/ 或 managedLabels 标签, 无需重置。');
    return;
  }
  console.log(`待清空的标签: ${labels.map((l) => l.getName()).join(', ')}`);

  let total = 0;
  let stopped = false;

  for (const label of labels) {
    if (outOfTime()) { stopped = true; break; }
    const name = label.getName();

    // 每轮取 300 封(内部再按 100 切块执行), 清空后再取下一轮
    let restored = 0;
    while (!outOfTime()) {
      const threads = searchThreads(`label:${name}`, 300, outOfTime);
      if (threads.length === 0) break;

      eachBatch(threads, (batch) => {
        label.removeFromThreads(batch);
        GmailApp.moveThreadsToInbox(batch);
        GmailApp.markThreadsUnread(batch);
      }, outOfTime);

      restored += threads.length;
    }
    total += restored;
    console.log(`「${name}」已清空, 恢复 ${restored} 封`);
  }

  console.log('');
  console.log(`本次共恢复 ${total} 封到未读 + 收件箱。`);
  if (stopped) {
    console.log('⏱ 接近执行时限, 已提前停止。再运行 resetAll() 继续。');
  } else {
    console.log('重置完成。现在运行 run() 重新分诊。');
  }
}

/** 安装每日定时任务 (每天凌晨自动跑一次) */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'run')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('run').timeBased().atHour(3).everyDays(1).create();
  console.log('已安装每日凌晨 3 点自动运行。');
}

function uninstallTriggers() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  console.log('已移除所有定时任务。');
}

// ---------- 内部函数 ----------

function buildQuery(base) {
  const exclusions = [
    CONFIG.protectQuery,
    ...CONFIG.protectedLabels.map((l) => `-label:${l}`),
  ].join(' ');
  return `${base} ${exclusions}`;
}

function collectStats() {
  return CONFIG.rules.map((rule) => ({
    name: rule.name,
    count: searchThreads(buildQuery(rule.query), CONFIG.maxThreadsPerRun).length,
    actions: [
      `标签「${rule.label}」`,
      rule.markRead ? '标已读' : null,
      rule.archive ? '归档' : null,
    ]
      .filter(Boolean)
      .join(' + '),
  }));
}

/** GmailApp.search 单次最多 500 条, 这里分页取够 max 条 */
function searchThreads(query, max, shouldStop) {
  const result = [];
  const pageSize = 100;
  let start = 0;
  while (result.length < max) {
    if (shouldStop && shouldStop()) break;
    const batch = GmailApp.search(query, start, Math.min(pageSize, max - result.length));
    if (batch.length === 0) break;
    result.push(...batch);
    start += batch.length;
  }
  return result;
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/**
 * Gmail 的批量 API (addToThreads / markThreadsRead / moveThreadsToArchive 等)
 * 单次调用上限是 100 个线程, 超了会抛 "at most 100 threads", 所以这里切块执行。
 */
function eachBatch(threads, fn, shouldStop) {
  const BATCH_SIZE = 100;
  for (let i = 0; i < threads.length; i += BATCH_SIZE) {
    if (shouldStop && shouldStop()) return;
    fn(threads.slice(i, i + BATCH_SIZE));
  }
}
