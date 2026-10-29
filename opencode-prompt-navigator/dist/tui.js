// @bun
// src/tui.tsx
import { use as _$use } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { createSignal, For, Show } from "solid-js";
import { Plugin } from "@opencode/plugin/tui";
var WIDGET_RECENT = 8;
var PANEL_MAX = 300;
var snippet = (text, max = 64) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}\u2026` : flat || "(empty input)";
};
var fullSnippet = (text) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat || "(empty input)";
};
var timeOf = (created) => {
  if (!created)
    return "";
  const d = new Date(created);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
var readEntries = (context, sessionID) => {
  if (!sessionID)
    return [];
  const raw = context.data.session.message.list(sessionID) ?? [];
  const entries = [];
  for (const message of raw) {
    if (message.type !== "user")
      continue;
    const user = message;
    entries.push({
      id: user.id,
      idx: entries.length + 1,
      text: user.text ?? "",
      created: user.time?.created ?? 0
    });
  }
  return entries;
};
var tui_default = Plugin.define({
  id: "prompt-navigator.tui",
  setup(context) {
    const [focusId, setFocusId] = createSignal(undefined);
    const [expandedId, setExpandedId] = createSignal(undefined);
    const entriesFor = (sessionID) => readEntries(context, sessionID);
    const openPanel = (sessionID, focus) => {
      if (!sessionID) {
        context.ui.toast.show({
          variant: "warning",
          message: "Open a session first"
        });
        return;
      }
      setFocusId(focus);
      setExpandedId(focus);
      context.data.session.message.sync(sessionID).catch(() => {
        return;
      });
      context.ui.panel.open("navigator", {
        presentation: "fullscreen"
      });
    };
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "prompt-navigator.panel",
        title: "Prompt navigation",
        description: "Browse every user input of the session",
        group: "Prompt",
        palette: true,
        suggested: true,
        slash: {
          name: "prompts"
        },
        run: () => {
          const route = context.ui.router.current();
          if (route.type !== "session") {
            openPanel(undefined);
            return;
          }
          openPanel(route.sessionID);
        }
      }]
    }));
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => {
        const sessionID = props.sessionID;
        context.data.session.message.sync(sessionID).catch(() => {
          return;
        });
        const entries = () => entriesFor(sessionID);
        const recent = () => entries().slice(-WIDGET_RECENT);
        const focusedIdx = () => {
          const index = entries().findIndex((entry) => entry.id === focusId()) + 1;
          return index > 0 ? index : entries().length;
        };
        return _$createComponent(Show, {
          get when() {
            return sessionID && entries().length > 0;
          },
          get children() {
            var _el$ = _$createElement("box"), _el$2 = _$createElement("text"), _el$3 = _$createTextNode(`USER PROMPTS \xB7 `), _el$4 = _$createElement("span");
            _$insertNode(_el$, _el$2);
            _$setProp(_el$, "flexDirection", "column");
            _$setProp(_el$, "marginTop", 1);
            _$setProp(_el$, "flexShrink", 0);
            _$insertNode(_el$2, _el$3);
            _$insertNode(_el$2, _el$4);
            _$setProp(_el$4, "style", {
              fg: "#4CAF50"
            });
            _$insert(_el$4, () => `${focusedIdx()}`);
            _$insert(_el$2, () => `/${entries().length}`, null);
            _$insert(_el$, _$createComponent(For, {
              get each() {
                return recent();
              },
              children: (entry) => (() => {
                var _el$5 = _$createElement("box"), _el$6 = _$createElement("text");
                _$insertNode(_el$5, _el$6);
                _$setProp(_el$5, "flexShrink", 0);
                _$setProp(_el$5, "onMouseUp", () => openPanel(sessionID, entry.id));
                _$setProp(_el$6, "wrapMode", "none");
                _$setProp(_el$6, "truncate", true);
                _$insert(_el$6, () => `#${entry.idx} ${timeOf(entry.created)} ${snippet(entry.text, 40)}`);
                _$effect((_$p) => _$setProp(_el$6, "fg", entry.id === focusId() ? context.theme.hue.interactive[200] : context.theme.text.muted, _$p));
                return _el$5;
              })()
            }), null);
            _$effect((_p$) => {
              var _v$ = context.theme.text.base, _v$2 = TextAttributes.BOLD;
              _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
              _v$2 !== _p$.t && (_p$.t = _$setProp(_el$2, "attributes", _v$2, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$;
          }
        });
      }
    });
    context.ui.slot({
      append: "session.panel",
      render: (panel) => {
        const [copiedId, setCopiedId] = createSignal(undefined);
        const sessionID = panel.sessionID;
        context.data.session.message.sync(sessionID).catch(() => {
          return;
        });
        const entries = () => entriesFor(sessionID);
        let scroll;
        const rows = () => entries().slice(-PANEL_MAX);
        const [focusIdx, setFocusIdx] = createSignal(-1);
        const moveFocus = (delta) => {
          const index = focusIdx() < 0 ? rows().length - 1 : focusIdx() + delta;
          setFocusIdx(Math.max(0, Math.min(rows().length - 1, index)));
          if (scroll && focusIdx() >= 0)
            scroll.scrollTo(focusIdx());
        };
        useKeyboard((event) => {
          if (!scroll)
            return;
          if (event.name === "up" || event.name === "k")
            return moveFocus(-1);
          if (event.name === "down" || event.name === "j")
            return moveFocus(1);
          if (event.name === "pageup")
            return scroll.scrollBy(-10);
          if (event.name === "pagedown")
            return scroll.scrollBy(10);
          if (event.name === "home") {
            scroll.scrollTo(0);
            setFocusIdx(rows().length > 0 ? Math.max(0, entries().length - PANEL_MAX) : -1);
            return;
          }
          if (event.name === "end") {
            scroll.scrollTo(scroll.scrollHeight);
            setFocusIdx(rows().length - 1);
            return;
          }
          if (event.name === "enter" || event.name === "return") {
            const entry = rows()[focusIdx()];
            if (!entry)
              return;
            setFocusId(entry.id);
            setExpandedId(expandedId() === entry.id ? undefined : entry.id);
          }
        });
        context.keymap.layer(() => ({
          commands: [{
            bind: "escape",
            run: () => {
              context.ui.panel.close();
            }
          }, {
            id: "prompt-navigator.copy",
            title: "Copy prompt",
            group: "Prompt Navigator",
            bind: "c",
            run: () => {
              const focused = rows()[focusIdx()] ?? entriesFor(sessionID).at(-1);
              if (!focused)
                return;
              const written = context.renderer.copyToClipboardOSC52(focused.text);
              setCopiedId(focused.id);
              context.ui.toast.show({
                variant: written ? "success" : "warning",
                message: written ? "Prompt copied (OSC-52)" : "Copy failed: terminal does not support OSC-52",
                duration: 3000
              });
            }
          }]
        }));
        return (() => {
          var _el$7 = _$createElement("box"), _el$8 = _$createElement("box"), _el$9 = _$createElement("text"), _el$1 = _$createElement("text"), _el$10 = _$createElement("box"), _el$11 = _$createElement("text"), _el$13 = _$createElement("scrollbox"), _el$14 = _$createElement("box");
          _$insertNode(_el$7, _el$8);
          _$insertNode(_el$7, _el$10);
          _$insertNode(_el$7, _el$13);
          _$setProp(_el$7, "flexDirection", "column");
          _$setProp(_el$7, "flexGrow", 1);
          _$setProp(_el$7, "height", "100%");
          _$setProp(_el$7, "paddingTop", 1);
          _$setProp(_el$7, "paddingBottom", 1);
          _$insertNode(_el$8, _el$9);
          _$insertNode(_el$8, _el$1);
          _$setProp(_el$8, "flexShrink", 0);
          _$setProp(_el$8, "paddingLeft", 2);
          _$setProp(_el$8, "paddingRight", 2);
          _$setProp(_el$8, "paddingBottom", 1);
          _$insertNode(_el$9, _$createTextNode(`PROMPT NAVIGATION`));
          _$insert(_el$1, () => `  #${(focusIdx() >= 0 ? rows()[focusIdx()]?.idx : rows().at(-1)?.idx) ?? 0}/${entries().length} \xB7 esc close`);
          _$insertNode(_el$10, _el$11);
          _$setProp(_el$10, "flexShrink", 0);
          _$setProp(_el$10, "paddingLeft", 2);
          _$setProp(_el$10, "paddingRight", 2);
          _$setProp(_el$10, "paddingBottom", 1);
          _$insertNode(_el$11, _$createTextNode(`\u2191/\u2193 select \xB7 enter expand \xB7 c copy \xB7 j/k scroll \xB7 esc close`));
          _$setProp(_el$11, "wrapMode", "none");
          _$insertNode(_el$13, _el$14);
          _$use((element) => scroll = element, _el$13);
          _$setProp(_el$13, "flexGrow", 1);
          _$setProp(_el$13, "contentOptions", {
            minHeight: 0
          });
          _$setProp(_el$13, "scrollbarOptions", {
            visible: false
          });
          _$setProp(_el$14, "paddingLeft", 2);
          _$setProp(_el$14, "paddingRight", 2);
          _$insert(_el$14, _$createComponent(For, {
            get each() {
              return rows();
            },
            children: (entry, position) => (() => {
              var _el$20 = _$createElement("box"), _el$21 = _$createElement("box"), _el$22 = _$createElement("text");
              _$insertNode(_el$20, _el$21);
              _$setProp(_el$20, "flexDirection", "column");
              _$setProp(_el$20, "flexShrink", 0);
              _$insertNode(_el$21, _el$22);
              _$setProp(_el$21, "flexShrink", 0);
              _$setProp(_el$21, "onMouseUp", () => {
                setFocusIdx(position());
                setFocusId(entry.id);
                setExpandedId(expandedId() === entry.id ? undefined : entry.id);
              });
              _$setProp(_el$22, "wrapMode", "none");
              _$insert(_el$22, () => `#${entry.idx} ${timeOf(entry.created)} ${snippet(entry.text, 88)}`);
              _$insert(_el$20, _$createComponent(Show, {
                get when() {
                  return expandedId() === entry.id;
                },
                get children() {
                  var _el$23 = _$createElement("box"), _el$24 = _$createElement("text");
                  _$insertNode(_el$23, _el$24);
                  _$setProp(_el$23, "paddingLeft", 3);
                  _$setProp(_el$23, "flexShrink", 0);
                  _$setProp(_el$24, "wrapMode", "word");
                  _$insert(_el$24, () => fullSnippet(entry.text));
                  _$effect((_$p) => _$setProp(_el$24, "fg", context.theme.text.base, _$p));
                  return _el$23;
                }
              }), null);
              _$effect((_p$) => {
                var _v$8 = position() === focusIdx() || entry.id === expandedId() ? TextAttributes.BOLD : 0, _v$9 = position() === focusIdx() || entry.id === expandedId() ? context.theme.hue.interactive[200] : context.theme.text.muted;
                _v$8 !== _p$.e && (_p$.e = _$setProp(_el$22, "attributes", _v$8, _p$.e));
                _v$9 !== _p$.t && (_p$.t = _$setProp(_el$22, "fg", _v$9, _p$.t));
                return _p$;
              }, {
                e: undefined,
                t: undefined
              });
              return _el$20;
            })()
          }), null);
          _$insert(_el$14, _$createComponent(Show, {
            get when() {
              return entries().length > PANEL_MAX;
            },
            get children() {
              var _el$15 = _$createElement("box"), _el$16 = _$createElement("text");
              _$insertNode(_el$15, _el$16);
              _$setProp(_el$15, "paddingLeft", 2);
              _$setProp(_el$15, "paddingTop", 1);
              _$setProp(_el$15, "flexShrink", 0);
              _$insert(_el$16, () => `showing latest ${PANEL_MAX} of ${entries().length} inputs`);
              _$effect((_$p) => _$setProp(_el$16, "fg", context.theme.text.faint, _$p));
              return _el$15;
            }
          }), null);
          _$insert(_el$7, _$createComponent(Show, {
            get when() {
              return copiedId();
            },
            get children() {
              var _el$17 = _$createElement("box"), _el$18 = _$createElement("text");
              _$insertNode(_el$17, _el$18);
              _$setProp(_el$17, "flexShrink", 0);
              _$setProp(_el$17, "paddingLeft", 2);
              _$setProp(_el$17, "paddingTop", 1);
              _$insertNode(_el$18, _$createTextNode(`\u2713 copied`));
              _$effect((_$p) => _$setProp(_el$18, "fg", context.theme.text.faint, _$p));
              return _el$17;
            }
          }), null);
          _$effect((_p$) => {
            var _v$3 = context.theme.background.base, _v$4 = TextAttributes.BOLD, _v$5 = context.theme.text.base, _v$6 = context.theme.text.faint, _v$7 = context.theme.text.faint;
            _v$3 !== _p$.e && (_p$.e = _$setProp(_el$7, "backgroundColor", _v$3, _p$.e));
            _v$4 !== _p$.t && (_p$.t = _$setProp(_el$9, "attributes", _v$4, _p$.t));
            _v$5 !== _p$.a && (_p$.a = _$setProp(_el$9, "fg", _v$5, _p$.a));
            _v$6 !== _p$.o && (_p$.o = _$setProp(_el$1, "fg", _v$6, _p$.o));
            _v$7 !== _p$.i && (_p$.i = _$setProp(_el$11, "fg", _v$7, _p$.i));
            return _p$;
          }, {
            e: undefined,
            t: undefined,
            a: undefined,
            o: undefined,
            i: undefined
          });
          return _el$7;
        })();
      }
    });
    console.error("[prompt-navigator] TUI part loaded");
  }
});
export {
  tui_default as default
};
