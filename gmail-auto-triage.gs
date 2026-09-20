/**
 * Gmail 自动分诊脚本
 *
 * 编辑器下拉框里只有 4 个:
 *   run()                 按 CONFIG.rules 批量分类(只打标签)
 *   deleteAllLabels()     删除全部标签
 *   clearAllLabels()      清空全部标签的邮件(标签保留)
 *   installDailyTrigger() 每天定时跑 run()
 *
 * 单个标签的操作在 tools 里, 不占下拉框:
 *   tools.deleteLabel()   删除单个标签   ← 标签名填 CONFIG.targetLabel
 *   tools.clearLabel()    清空单个标签的邮件(标签保留)  ← 同上
 * 用法: 在文件末尾加一行 tools.deleteLabel() 运行, 用完删掉。
 *
 * 上手: run() 分类 → installDailyTrigger() 之后每天自动跑。
 *       存量多时 run() 一次跑不完, 多跑几次即可(它有 4.5 分钟时间预算)。
 *
 * 编辑器点「运行」不能传参, 操作单个标签只能填 CONFIG.targetLabel。
 *
 * ⚠️ 删除/清空不可逆, 没有备份, 也没有撤销功能:
 *    执行前会打印清单(标签名/封数/是否手工分类), 但打完就执行, 没有二次确认。
 *    手工分类(工作邮件/勤城达)是手动归类的, 清掉后没有任何规则能还原。
 *
 * 依赖: 需启用 Gmail API 高级服务(编辑器左侧「服务」→ 添加服务 → Gmail API)。
 */
const CONFIG = {
  // 没有演练开关: 所有函数都是真执行。删除/清空会先打印清单, 但打完就执行。
  maxMessagesPerRule: Infinity, // 不限数量, 由 timeBudgetMs 控制上限
  maxMessagesPerLabel: 5000,   // 每个标签单次最多处理多少封(清空用, 一次只对付一个标签)
  timeBudgetMs: 4.5 * 60 * 1000, // 到点就停, 剩下的下次继续(单次执行硬上限 6 分钟)

  // 操作单个标签时读这个 —— 编辑器点运行不能传参, 只能这样指定
  targetLabel: '',

  protectQuery: '-is:starred',   // 星标邮件永不处理

  // 这些标签下的邮件会被分类规则【跳过】(规则会自动加 -label:xxx)。
  // 留空 = 所有邮件都参与分类, 包括手工分类的那些。
  // 想保护手工分类不被叠加 Auto - xxx 标签, 就填回去, 例如 ['工作邮件', '勤城达']。
  protectedLabels: [],

  // 「删除全部/清空全部」要跳过的标签。默认空 = 全纳入
  excludeFromBulk: [],

  // 按顺序执行, 先命中的优先 —— 一封邮件只会拿到第一个命中规则的标签,
  // 后面规则跳过它。越具体的放前面, 兜底放最后。
  // 语法: category:xxx / from:xxx / subject:"xxx" / label:xxx
  rules: [
    {
      name: '验证码 / 登录确认',
      query:
        'is:unread (subject:"验证码" OR subject:"校验码" OR subject:"动态码" OR subject:"确认码" OR ' +
        'subject:"身份验证" OR subject:"登录确认" OR subject:"verification code" OR subject:"security code" OR ' +
        'subject:"one-time" OR subject:"OTP" OR subject:"passcode" OR subject:"2FA")',
      label: 'Auto - 验证码',
      markRead: false,
      archive: false,
    },
    // 必须排在「系统通知」之前, 否则 Google 的安全告警会被 category:updates 吃掉
    {
      name: '账号安全',
      query:
        'is:unread (from:accounts.google.com OR from:appleid.apple.com OR from:id.apple.com OR ' +
        'from:account.meta.com OR from:accountprotection.microsoft.com OR ' +
        'subject:"异常登录" OR subject:"异地登录" OR subject:"新设备" OR subject:"安全提醒" OR ' +
        'subject:"密码已修改" OR subject:"密码重置" OR subject:"账号异常" OR subject:"账户异常" OR ' +
        'subject:"security alert" OR subject:"new sign-in" OR subject:"unusual activity" OR ' +
        'subject:"password changed" OR subject:"sign-in attempt" OR subject:"verify your identity")',
      label: 'Auto - 账号安全',
      markRead: false,
      archive: false,
    },
    {
      name: '技术博客 / Newsletter',
      // ⚠️ from: 是子串匹配: from:newsletter 会命中 nikeofficial@newsletter.nike.com.cn
      //    所以只填完整域名, 别填 newsletter/weekly/blog 这类通用词
      query:
        'is:unread -category:promotions (from:indiehackers.com OR from:leadershipintech.com OR ' +
        'from:substack.com OR from:medium.com OR from:dev.to OR from:infoq.com)',
      label: 'Auto - 技术阅读',
      markRead: false,
      archive: true,
    },
    {
      name: '账单 / 订单 / 收据',
      query: 'is:unread (category:purchases OR category:reservations)',
      label: 'Auto - 账单',
      markRead: false,
      archive: false,
    },
    // 招商银行: 发件域 message.cmbchina.com
    {
      name: '招商银行 - 营销',
      query:
        'is:unread from:message.cmbchina.com (subject:"优惠" OR subject:"活动" OR subject:"分期" OR ' +
        'subject:"积分" OR subject:"尊享" OR subject:"推荐" OR subject:"红包" OR subject:"抽奖" OR subject:"券")',
      label: '招商银行',
      markRead: false,
      archive: false,
    },
    {
      name: '招商银行 - 其余(含电子账单)',
      query: 'is:unread (from:message.cmbchina.com OR from:cmbchina.com)',
      label: '招商银行',
      markRead: false,
      archive: false,
    },
    {
      name: 'npm',
      query: 'is:unread (from:npmjs.com OR subject:"npm")',
      label: 'npm',
      markRead: false,
      archive: true,
    },
    // 按「你会拿它做什么」分组, 不按「谁发的」分组 —— 建一个 google 标签会把
    // 账号安全告警和扩展更新混在一起, 而两者处理方式完全不同
    // from: 子串匹配, from:openai.com 能同时命中 email. / tm.openai.com
    {
      name: 'AI 服务',
      query:
        'is:unread (from:openai.com OR from:anthropic.com OR from:poe.com OR ' +
        'from:x.ai OR from:okara.ai)',
      label: 'Auto - AI服务',
      markRead: false,
      archive: false,
    },
    {
      name: '设计',
      query: 'is:unread (from:dribbble.com OR from:iconscout.com)',
      label: 'Auto - 设计',
      markRead: false,
      archive: true,
    },
    {
      name: '服务通知',
      query:
        'is:unread (from:cloudflare.com OR from:clerk.com OR from:stripe.com OR ' +
        'from:huggingface.co OR from:analytics-noreply@google.com OR ' +
        'from:chromewebstore-noreply@google.com)',
      label: 'Auto - 服务通知',
      markRead: false,
      archive: true,
    },
    {
      name: '营销推广',
      query: 'is:unread category:promotions',
      label: 'Auto - 营销推广',
      markRead: false,
      archive: true,
    },
    {
      name: '社交通知',
      query: 'is:unread category:social',
      label: 'Auto - 社交通知',
      markRead: false,
      archive: true,
    },
    {
      name: '系统更新通知',
      query: 'is:unread category:updates',
      label: 'Auto - 系统通知',
      markRead: false,
      archive: true,
    },
    {
      // ===== 兜底 =====
      name: '未分类',
      query: 'is:unread',
      label: 'Auto - 待清理',
      markRead: false,
      archive: false,
    },
  ],
};

// Gmail 的系统标签。batchModify 里直接用这些 ID, 不需要也不能去创建
const SYSTEM_LABEL_IDS = [
  'INBOX', 'UNREAD', 'STARRED', 'SENT', 'DRAFT',
  'SPAM', 'TRASH', 'IMPORTANT', 'CHAT',
];

let _labelIdMap = null;

/**
 * 内部实现全部收在这个对象里, 调用写 tools.xxx()。
 * Apps Script 下拉框会列出所有顶层函数(function 和 const 都算),
 * 挂在对象上就不会出现。
 */
const tools = {

  /**
   * 删除单个标签(标签名填 CONFIG.targetLabel)。
   * 邮件一封都不会删 —— Gmail 删标签会自动把它从所有邮件上移除。
   * ⚠️ 不可逆, 执行前只打印清单, 没有二次确认。
   */
  deleteLabel(name) {
    const label = tools.resolveTarget(name);
    if (!label) return;
    tools.bulkDeleteLabels([label]);
  },

  bulkDeleteLabels(labels) {
    if (labels.length === 0) {
      console.log('没有用户标签可删。');
      return;
    }
    tools.previewLabels(labels, '删除');

    let n = 0;
    labels.forEach((l) => {
      try {
        if (tools.deleteLabelObject(l)) n++;
      } catch (e) {
        console.log(`  删除「${l.name}」失败: ${e.message}`);
      }
    });
    tools.resetLabelCache();
    console.log(`共删除 ${n} 个标签。邮件本身不受影响。`);
  },

  /**
   * 删掉一个标签对象, 直接用 id。
   * ⚠️ 方法名是 remove 不是 delete —— Apps Script 把 delete(JS 保留字)改名成 remove。
   */
  deleteLabelObject(label) {
    Gmail.Users.Labels.remove('me', label.id);
    console.log(`已删除: ${label.name}`);
    return true;
  },

  /**
   * 清空单个标签下的邮件(标签名填 CONFIG.targetLabel), 标签本身保留。
   * ⚠️ 不可逆, 执行前只打印清单, 没有二次确认。
   */
  clearLabel(name) {
    const label = tools.resolveTarget(name);
    if (!label) return;
    tools.bulkRemoveLabels([label], false, false);
  },

  bulkRemoveLabels(labels, restoreInbox, markUnread) {
    if (labels.length === 0) {
      console.log('没有用户标签。');
      return;
    }
    tools.previewLabels(labels, '清空');

    const add = [
      restoreInbox ? 'INBOX' : null,
      markUnread ? 'UNREAD' : null,
    ].filter(Boolean).map(tools.resolveLabelId);

    const startedAt = Date.now();
    const outOfTime = () => Date.now() - startedAt > CONFIG.timeBudgetMs;

    let total = 0;
    let stopped = false;
    const pending = [];

    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      if (outOfTime()) {
        stopped = true;
        pending.push(label.name);
        continue;
      }

      try {
        const { ids, truncated } = tools.listMessageIds(
          tools.labelQuery(label.name),
          CONFIG.maxMessagesPerLabel,
          outOfTime
        );
        if (ids.length === 0) {
          console.log(`「${label.name}」: 0 封`);
          continue;
        }

        const applied = tools.batchModifyAll(ids, add, [label.id], outOfTime);
        total += applied;

        const partial = applied < ids.length;
        if (partial || truncated) pending.push(label.name);
        console.log(`「${label.name}」: ${applied} 封${partial ? ' (本次未做完)' : ''}`);
      } catch (e) {
        console.log(`「${label.name}」处理失败: ${e.message}`);
        pending.push(label.name);
      }
    }

    console.log('');
    console.log(`共处理 ${total} 封消息。`);
    if (stopped) console.log('⏱ 接近执行时限, 已提前停止。');
    if (pending.length) {
      // 绝不说「已清空」—— 没跑完就是没跑完
      console.log(`以下标签可能还有剩余, 再运行一次本函数继续: ${pending.join(', ')}`);
    } else {
      console.log('本轮范围内已全部处理完。');
    }
  },

  /**
   * 拉取符合条件的 messageId, 翻页到耗尽或达到 cap。
   *
   * 这是整个脚本唯一的数据源 —— 统计和执行都走它, 口径统一为【消息数】。
   * 返回 truncated 表示「还有更多没拉完」, 调用方据此提示用户再跑一次。
   */
  listMessageIds(query, cap, shouldStop) {
    tools.ensureGmailApi();
    cap = cap || CONFIG.maxMessagesPerRule;

    const ids = [];
    let pageToken = null;
    let truncated = false;

    while (ids.length < cap) {
      if (shouldStop && shouldStop()) {
        truncated = true;
        break;
      }
      const params = { q: query, maxResults: Math.min(500, cap - ids.length) };
      // 只有非首页才带 pageToken —— 传 null 会被当成字面量参数
      if (pageToken) params.pageToken = pageToken;

      const res = Gmail.Users.Messages.list('me', params);
      const page = res.messages || [];
      page.forEach((m) => ids.push(m.id));

      if (page.length === 0 || !res.nextPageToken) break;
      pageToken = res.nextPageToken;
      if (ids.length >= cap && res.nextPageToken) truncated = true;
    }

    return { ids: ids, truncated: truncated };
  },

  /**
   * 唯一的执行原语: 按 1000 封切片调用 batchModify。
   * 返回实际改了多少封(可能因时间预算少于 ids.length)。
   */
  batchModifyAll(ids, addLabelIds, removeLabelIds, shouldStop) {
    const add = addLabelIds || [];
    const remove = removeLabelIds || [];
    if (add.length === 0 && remove.length === 0) return 0;

    let applied = 0;
    for (let k = 0; k < ids.length; k += 1000) {
      if (shouldStop && shouldStop()) break;
      const slice = ids.slice(k, k + 1000);
      if (slice.length === 0) continue;
      Gmail.Users.Messages.batchModify({
        ids: slice,
        addLabelIds: add,
        removeLabelIds: remove,
      }, 'me');
      applied += slice.length;
    }
    return applied;
  },

  /**
   * 编排一次批量操作: 搜索 → 执行 → 打日志。
   * plan: { name, query, cap, addLabels:[名称或系统ID], removeLabels:[同上] }
   * processed: 本次 run() 已处理过的 messageId 集合(可选), 里面有的直接跳过。
   */
  runPlan(plan, shouldStop, processed) {
    const t0 = Date.now();
    const listed = tools.listMessageIds(plan.query, plan.cap, shouldStop);
    const t1 = Date.now();

    // 同一次 run() 里前面规则已处理过的跳过, 让「兜底」规则真正只兜底:
    // 不能靠查询里的 -label:xxx 排除 —— 兜底规则只排除自己的标签, 不排除其它规则的,
    // 而且 Gmail 索引有延迟, 刚打上的标签下一次查询可能还查不出来。
    const ids = processed
      ? listed.ids.filter((id) => !processed.has(id))
      : listed.ids;

    if (ids.length === 0) {
      console.log(`${plan.name}: 0 封 (搜索 ${tools.ms(t1 - t0)})`);
      return { count: 0, truncated: false, stopped: !!(shouldStop && shouldStop()) };
    }

    const add = (plan.addLabels || []).map(tools.resolveLabelId);
    const remove = (plan.removeLabels || []).map(tools.resolveLabelId);
    const applied = tools.batchModifyAll(ids, add, remove, shouldStop);
    const t2 = Date.now();
    // 只记真正改过的, 时间预算中断时未执行的留给下次
    if (processed) ids.slice(0, applied).forEach((id) => processed.add(id));

    console.log(
      `${plan.name}: ${applied} 封 (搜索 ${tools.ms(t1 - t0)} / 执行 ${tools.ms(t2 - t1)})`
    );
    return {
      count: applied,
      truncated: listed.truncated || applied < ids.length,
      stopped: !!(shouldStop && shouldStop()),
    };
  },

  /** 标签增删后必须调这个, 否则缓存是脏的 */
  resetLabelCache() {
    _labelIdMap = null;
  },

  /** 把「标签名」或「系统标签 ID」解析成 batchModify 认的 labelId */
  resolveLabelId(token) {
    if (SYSTEM_LABEL_IDS.indexOf(token) >= 0) return token;
    return tools.labelId(token);
  },

  /**
   * 拼标签搜索条件。标签名带空格(如 "Auto - 验证码"), 必须加引号,
   * 否则 Gmail 按空格拆成多个条件, 搜出来的完全不是你要的。
   */
  labelQuery(name) {
    return `label:"${name}"`;
  },

  /** 重新拉一次「标签名 → labelId」映射 */
  refreshLabelCache() {
    _labelIdMap = {};
    Gmail.Users.Labels.list('me').labels.forEach((l) => {
      _labelIdMap[l.name] = l.id;
    });
    return _labelIdMap;
  },

  /** 标签名 → labelId。不存在就创建(走 GmailApp.createLabel, 建完重新拉缓存拿 ID) */
  labelId(name) {
    if (!_labelIdMap) tools.refreshLabelCache();
    if (_labelIdMap[name]) return _labelIdMap[name];

    // 标签名里的 " - " 不是嵌套分隔符(嵌套是 "/"), 所以不会产生父标签。
    GmailApp.createLabel(name);
    tools.refreshLabelCache();

    if (!_labelIdMap[name]) throw new Error(`标签创建后仍拿不到 ID: ${name}`);
    return _labelIdMap[name];
  },

  /**
   * 所有用户标签 —— 需求 2/4 里「全部」的范围。
   * ⚠️ 只能按 id/type 排除系统标签, 不能按显示名: 用户可能自建一个叫
   *    "Sent Messages" 的标签(id 是 Label_xxx), 和真系统标签 SENT 是两回事。
   */
  allUserLabels() {
    tools.ensureGmailApi();
    const exclude = CONFIG.excludeFromBulk || [];
    return Gmail.Users.Labels.list('me').labels
      .filter((l) => l.type !== 'system')
      .filter((l) => SYSTEM_LABEL_IDS.indexOf(l.id) < 0)
      .filter((l) => l.id.indexOf('CATEGORY_') !== 0)
      .filter((l) => exclude.indexOf(l.name) < 0);
  },

  findUserLabel(name) {
    return tools.allUserLabels().filter((l) => l.name === name)[0] || null;
  },

  /** 解析单个标签操作的目标, 回落到 CONFIG.targetLabel。找不到返回 null */
  resolveTarget(name) {
    const labelName = name || CONFIG.targetLabel;
    if (!labelName) {
      console.log('请指定标签: 把标签名填进 CONFIG.targetLabel, 再运行本函数。');
      console.log('(即 targetLabel: "工作邮件" 这样。编辑器点运行无法传参, 只能这样指定。)');
      return null;
    }
    const label = tools.findUserLabel(labelName);
    if (!label) {
      console.log(`标签不存在, 或它是系统标签: ${labelName}`);
      return null;
    }
    return label;
  },

  /**
   * 危险操作的清单。总是先打印, 但打印完紧接着就执行 ——
   * 它是「事后告诉你改了什么」, 不是「事前让你确认」。
   */
  previewLabels(labels, verb) {
    const rows = labels.map(tools.describeLabel);
    const totalMsgs = rows.reduce((a, r) => a + r.total, 0);

    console.log(`演练: 将${verb} ${labels.length} 个标签, 涉及约 ${totalMsgs} 封消息:`);
    rows.forEach((r) => {
      console.log(`  ${r.name.padEnd(28)}${String(r.total).padStart(7)} 封   ${r.kind}`);
    });
    console.log('');

    if (rows.some((r) => r.kind === '手工分类')) {
      console.log('⚠️  清单里含【手工分类】标签。这些是手动归类的, 发件人五花八门,');
      console.log('    没有任何 from: 规则能复现 —— 清掉后无法还原。');
      console.log('    邮件还在「所有邮件」里, 但分类永久丢失。');
      console.log('');
    }
  },

  /**
   * 标签的清单信息。邮件数优先用 Labels.get 的 messagesTotal(精确值),
   * 拿不到就退回 Messages.list 的 resultSizeEstimate(估算值)。
   * ⚠️ 不能静默吞异常 —— 吞了就会显示 0 封却查不出原因。
   */
  describeLabel(label) {
    let total = 0;
    let note = '';
    try {
      total = Gmail.Users.Labels.get('me', label.id).messagesTotal || 0;
    } catch (e) {
      note = ` (Labels.get 失败: ${e.message})`;
      try {
        const res = Gmail.Users.Messages.list('me', {
          q: tools.labelQuery(label.name),
          maxResults: 1,
        });
        total = res.resultSizeEstimate || 0;
        note = ' (估算值)';
      } catch (e2) {
        note = ` (邮件数获取失败: ${e2.message})`;
        total = 0;
      }
    }
    if (note) console.log(`  ⚠️ 取「${label.name}」的邮件数${note}`);
    return {
      name: label.name,
      id: label.id,
      total: total,
      kind: CONFIG.protectedLabels.indexOf(label.name) >= 0 ? '手工分类' : '脚本自建',
    };
  },

  buildQuery(base) {
    const exclusions = [
      CONFIG.protectQuery,
      ...CONFIG.protectedLabels.map((l) => `-label:"${l}"`),
    ].join(' ');
    return `${base} ${exclusions}`;
  },

  /**
   * 取某条规则的最终查询串。
   * 1. buildQuery(): 星标保护 + protectedLabels。
   * 2. 排除【所有】规则的标签: 邮件只要已经带了任意一个分类标签, 就说明它被分类过了,
   *    任何规则都不该再碰它 —— 规则按顺序执行, 先命中的优先。
   *    ⚠️ 只排除"本规则自己的标签"是不够的: 兜底规则查询是 is:unread, 匹配全部未读,
   *       它只排除自己的标签就等于把所有已分类邮件再捞一遍打个第二标签。
   */
  queryFor(rule) {
    const classified = [...new Set(CONFIG.rules.map((r) => r.label))]
      .map((l) => `-label:"${l}"`)
      .join(' ');
    return `${tools.buildQuery(rule.query)} ${classified}`;
  },

  ensureGmailApi() {
    if (typeof Gmail === 'undefined') {
      throw new Error(
        '未启用 Gmail API 高级服务。请在 Apps Script 编辑器左侧「服务」→ 添加服务 → ' +
        'Gmail API → 添加, 然后再运行。'
      );
    }
  },

  /** 毫秒转可读字符串 */
  ms(n) {
    return `${(n / 1000).toFixed(1)}s`;
  }

};

// ===== 需求 5: 主入口, 按规则批量分类 =====

function run() {
  console.log('===== Gmail 自动分诊 =====');

  tools.ensureGmailApi();

  // 实际执行: 带着时间预算跑, 超时就停, 剩下的交给下一次(触发器的下一次运行)
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > CONFIG.timeBudgetMs;

  let total = 0;
  let stopped = false;
  // 本次 run() 已处理过的 messageId。规则按顺序执行, 先命中的优先,
  // 后面的规则跳过已处理过的 —— 兜底规则因此只处理前面都没命中的邮件。
  const processed = new Set();

  for (let i = 0; i < CONFIG.rules.length; i++) {
    if (outOfTime()) {
      stopped = true;
      break;
    }
    const rule = CONFIG.rules[i];
    const tag = `[${i + 1}/${CONFIG.rules.length}] ${rule.name}`;
    try {
      const r = tools.runPlan({
        name: tag,
        query: tools.queryFor(rule),
        cap: CONFIG.maxMessagesPerRule,
        addLabels: [rule.label],
        removeLabels: [
          rule.markRead ? 'UNREAD' : null,
          rule.archive ? 'INBOX' : null,
        ].filter(Boolean),
      }, outOfTime, processed);

      total += r.count;
      if (r.stopped) {
        stopped = true;
        break;
      }
    } catch (e) {
      // 一条规则挂了(比如查询语法写错)不能拖垮剩下的规则
      console.log(`${tag}: 出错已跳过 — ${e.message}`);
    }
  }

  console.log('');
  console.log(`本次共处理 ${total} 封消息。剩余未读: ${GmailApp.getInboxUnreadCount()}`);
  if (stopped) {
    console.log('⏱ 接近单次执行时限, 已提前停止。未处理完的会在下次运行继续。');
  }

}

/**
 * 删除全部用户标签(含手工分类的)。
 * 系统标签(INBOX / SENT / SPAM 等)不在范围内, 它们本来也删不掉。
 */
function deleteAllLabels() {
  tools.bulkDeleteLabels(tools.allUserLabels());
}

/**
 * 清空全部用户标签下的邮件, 标签本身保留。
 */
function clearAllLabels() {
  tools.bulkRemoveLabels(tools.allUserLabels(), false, false);
}

// ===== 需求 6: 定时 =====

/** 安装每日定时任务 (每天凌晨按 appsscript.json 的 timeZone 跑一次) */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'run')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('run').timeBased().atHour(3).everyDays(1).create();
  console.log('已安装每日凌晨 3 点自动运行。');
}
