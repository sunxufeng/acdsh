window.__ModuleLoader__.load({
  id: "dsh-wb-ui",
  factory: (require) => {
    var module = { exports: {} };
    var React = require("react");
    var h = React.createElement;
    var Fragment = React.Fragment;

    // ---- 八大功能 + 快捷操作 ----
    var FEATURES = [
      {
        key: "assistant", label: "助理", icon: "🤖",
        desc: "可切换的助理角色，激活后其系统提示词注入会话。",
        actions: [
          { label: "新建助理", prompt: "帮我新建一个助理（使用 assistant_add 工具）：请告诉我助理名称、一句话角色定位，以及要注入的系统提示词。" },
          { label: "列出 / 激活", prompt: "用 assistant_list 列出我的所有助理；如果想激活某个，请再用 assistant_activate <id>。" },
          { label: "取消激活", prompt: "用 assistant_deactivate 取消当前激活的助理。" }
        ]
      },
      {
        key: "project", label: "项目", icon: "📁",
        desc: "管理项目与任务，跟踪进展。",
        actions: [
          { label: "新建项目", prompt: "帮我新建一个项目（使用 project_create 工具），告诉我项目名称和目标。" },
          { label: "列出项目", prompt: "用 project_list 列出所有项目。" },
          { label: "新建任务", prompt: "用 task_create 给当前项目添加一个任务（标题 + 负责人 + 截止日期）。" }
        ]
      },
      {
        key: "expert", label: "专家", icon: "🎓",
        desc: "特定领域的专家角色，按需启用。",
        actions: [
          { label: "新建专家", prompt: "帮我添加一个专家（使用 expert_add 工具）：领域、专长、何时启用。" },
          { label: "列出专家", prompt: "用 expert_list 列出所有专家。" },
          { label: "激活专家", prompt: "用 expert_list 列出后，用 expert_activate <id> 激活对应专家。" }
        ]
      },
      {
        key: "skill", label: "技能", icon: "🧩",
        desc: "可安装的技能，扩展自动化能力。",
        actions: [
          { label: "安装技能", prompt: "帮我安装一个技能（使用 skill_add 工具）。" },
          { label: "列出技能", prompt: "用 skill_list 列出已安装技能。" },
          { label: "搜索技能", prompt: "用 skill_search 搜索可用技能：<关键词>。" }
        ]
      },
      {
        key: "connector", label: "连接器", icon: "🔌",
        desc: "连接外部 API / 服务。",
        actions: [
          { label: "添加连接器", prompt: "帮我添加一个连接器（使用 connector_add 工具）：名称、类型、baseURL、鉴权方式。" },
          { label: "列出连接器", prompt: "用 connector_list 列出所有连接器。" },
          { label: "测试连接器", prompt: "用 connector_test 测试某个连接器是否可用。" }
        ]
      },
      {
        key: "automation", label: "自动化", icon: "⏰",
        desc: "按计划自动运行任务。",
        actions: [
          { label: "新建自动化", prompt: "帮我新建一个自动化任务（使用 automation_add 工具），例如：每天 9 点总结进行中的项目并写入资料库。" },
          { label: "列出自动化", prompt: "用 automation_list 列出所有自动化。" },
          { label: "立即运行", prompt: "用 automation_run 立即运行某个自动化。" }
        ]
      },
      {
        key: "library", label: "资料库", icon: "📚",
        desc: "知识库与文档管理。",
        actions: [
          { label: "新建资料库", prompt: "帮我新建一个资料库（使用 library_create 工具）。" },
          { label: "列出资料库", prompt: "用 library_list 列出资料库，并用 doc_list 列出文档。" },
          { label: "新建文档", prompt: "用 doc_add 在资料库新建一篇文档（标题 + 内容）。" }
        ]
      },
      {
        key: "feishu", label: "飞书文档", icon: "📝",
        desc: "连接飞书，读写云文档 / 知识库。",
        actions: [
          { label: "检查连接", prompt: "用 feishu_auth_status 检查飞书连接状态；若未连接，引导我用 feishu_config_set 配置 App ID / Secret。" },
          { label: "写文档", prompt: "用 feishu_doc_create 在飞书创建一个文档（标题 + 内容）。" },
          { label: "列知识库", prompt: "用 feishu_wiki_list 列出我的飞书知识库空间。" }
        ]
      }
    ];

    // ---- 样式 ----
    var BTN = {
      display: "inline-flex", alignItems: "center", gap: 4,
      height: 28, padding: "0 10px", marginRight: 6,
      borderRadius: 8, border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(120,130,255,0.18)", color: "#e8eaff",
      cursor: "pointer", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap"
    };
    var PANEL = {
      position: "fixed", left: 12, bottom: 78, zIndex: 1000,
      width: 392, height: 432, display: "flex", flexDirection: "column",
      background: "rgba(24,25,33,0.98)", color: "#e6e7ee",
      border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
      boxShadow: "0 12px 40px rgba(0,0,0,0.5)", overflow: "hidden",
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    };
    var PANEL_HEAD = {
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(120,130,255,0.12)"
    };
    var CLOSE_BTN = {
      background: "transparent", border: "none", color: "#b9bcd0",
      cursor: "pointer", fontSize: 14, lineHeight: 1
    };
    var PANEL_BODY = { display: "flex", flex: 1, minHeight: 0 };
    var NAV = {
      width: 116, flex: "none", borderRight: "1px solid rgba(255,255,255,0.08)",
      padding: 8, display: "flex", flexDirection: "column", gap: 4, overflowY: "auto"
    };
    var NAVITEM = {
      display: "block", width: "100%", textAlign: "left",
      padding: "7px 8px", borderRadius: 8, border: "none",
      background: "transparent", color: "#c9cbd8", cursor: "pointer",
      fontSize: 13, whiteSpace: "nowrap"
    };
    var NAVITEM_ACTIVE = {
      background: "rgba(120,130,255,0.22)", color: "#fff", fontWeight: 600
    };
    var ACTIONS_WRAP = { flex: 1, padding: 12, overflowY: "auto" };
    var ACTION_BTN = {
      display: "block", width: "100%", textAlign: "left",
      padding: "9px 11px", marginBottom: 8, borderRadius: 9,
      border: "1px solid rgba(255,255,255,0.12)",
      background: "rgba(255,255,255,0.04)", color: "#e6e7ee",
      cursor: "pointer", fontSize: 13, lineHeight: 1.35
    };

    // ---- 组件 ----
    function Launcher(props) {
      var open = React.useState(false);
      var isOpen = open[0];
      var setOpen = open[1];
      var active = React.useState(FEATURES[0].key);
      var activeKey = active[0];
      var setActive = active[1];
      var ref = React.useRef(null);

      React.useEffect(function () {
        if (!isOpen) return;
        function onDoc(e) {
          if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        }
        document.addEventListener("mousedown", onDoc);
        return function () { document.removeEventListener("mousedown", onDoc); };
      }, [isOpen]);

      function run(prompt) {
        var kb = props.keyboard;
        if (!kb || !kb.actions) {
          window.alert("请先在左侧选择一个会话，再使用 WorkBuddy 功能。");
          return;
        }
        try {
          kb.actions.setDraft(prompt);
          kb.actions.submit();
        } catch (e) {
          window.alert("执行失败：" + (e && e.message ? e.message : String(e)));
        }
        setOpen(false);
      }

      var btn = h("button", {
        type: "button",
        onClick: function () { setOpen(function (o) { return !o; }); },
        style: BTN,
        title: "WorkBuddy 工作台"
      }, "🧰 WorkBuddy");

      if (!isOpen) return btn;

      var feat = FEATURES.filter(function (f) { return f.key === activeKey; })[0] || FEATURES[0];

      var nav = h("div", { style: NAV }, FEATURES.map(function (f) {
        return h("button", {
          key: f.key, type: "button",
          onClick: function () { setActive(f.key); },
          style: Object.assign({}, NAVITEM, f.key === activeKey ? NAVITEM_ACTIVE : {})
        }, (f.icon || "") + " " + f.label);
      }));

      var actions = h("div", null, feat.actions.map(function (a, i) {
        return h("button", {
          key: i, type: "button",
          onClick: function () { run(a.prompt); },
          style: ACTION_BTN, title: a.prompt
        }, a.label);
      }));

      var panel = h("div", { ref: ref, style: PANEL },
        h("div", { style: PANEL_HEAD },
          h("span", { style: { fontWeight: 600 } }, "🧰 WorkBuddy 工作台"),
          h("button", { type: "button", onClick: function () { setOpen(false); }, style: CLOSE_BTN }, "✕")
        ),
        h("div", { style: PANEL_BODY }, nav,
          h("div", { style: ACTIONS_WRAP },
            h("div", { style: { color: "#aeb1c4", fontSize: 12, marginBottom: 10 } }, feat.desc),
            actions
          )
        )
      );

      return h(Fragment, null, btn, panel);
    }

    // ---- 注册 ----
    function apply(ctx) {
      ctx.effect(function () {
        return ctx.slots.inject("conversation.input.left", function () {
          return ctx.slots.register(
            { name: "conversation.input.left", id: "wb-launcher", order: 60 },
            function (props) { return h(Launcher, props); }
          );
        });
      }, "dsh-wb-ui: launcher");
    }

    return { name: "dsh-wb-ui", inject: ["slots"], apply: apply };
  }
});
