"use client";

/**
 * CodeMirror editor wrapper — replaces react-simple-code-editor.
 *
 * Features:
 * - Line numbers
 * - Syntax highlighting (JS/TS/Python/CSS/HTML/JSON/Markdown/YAML/SQL)
 * - Find & replace (Ctrl+F / Ctrl+H)
 * - Multiple cursors
 * - Auto-indent, bracket matching, code folding
 * - Dark theme matching the app
 */

import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars, rectangularSelection, crosshairCursor, dropCursor } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { sql } from "@codemirror/lang-sql";

const claudeTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#FAF9F7",
      color: "#2D2B27",
      height: "100%",
      fontSize: "12.5px",
    },
    ".cm-content": {
      caretColor: "#D97757",
      fontFamily: 'var(--font-jetbrains-mono), ui-monospace, "SF Mono", Menlo, Monaco, monospace',
      padding: "12px 0",
    },
    ".cm-gutters": {
      backgroundColor: "#FAF9F7",
      color: "#A8A29E",
      border: "none",
      borderRight: "1px solid #E5E2D9",
    },
    ".cm-activeLine": { backgroundColor: "#F5F3EE" },
    ".cm-activeLineGutter": { backgroundColor: "#F5F3EE", color: "#6B6862" },
    ".cm-selectionBackground, ::selection": { backgroundColor: "rgba(217, 119, 87, 0.15)" },
    ".cm-cursor": { borderLeftColor: "#D97757", borderLeftWidth: "2px" },
    ".cm-matchingBracket": { backgroundColor: "rgba(217, 119, 87, 0.2)", outline: "none" },
    ".cm-searchMatch": { backgroundColor: "rgba(217, 119, 87, 0.15)", outline: "1px solid rgba(217, 119, 87, 0.3)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "rgba(217, 119, 87, 0.3)" },
    ".cm-panels": { backgroundColor: "#F5F3EE", color: "#2D2B27" },
    ".cm-panels input": { backgroundColor: "#FFFFFF", color: "#2D2B27", border: "1px solid #E5E2D9" },
    ".cm-textfield": { backgroundColor: "#FFFFFF", color: "#2D2B27" },
    ".cm-foldPlaceholder": { backgroundColor: "#E5E2D9", color: "#8B8884", border: "none" },
    ".cm-tooltip": { backgroundColor: "#FFFFFF", border: "1px solid #E5E2D9", color: "#2D2B27" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "rgba(217, 119, 87, 0.1)" },
    "&.cm-focused": { outline: "none" },
  },
  { dark: false },
);

function getLanguageExtension(lang: string): import("@codemirror/language").LanguageSupport[] {
  switch (lang) {
    case "javascript":
    case "jsx":
      return [javascript({ jsx: true })];
    case "typescript":
    case "tsx":
      return [javascript({ jsx: true, typescript: true })];
    case "python":
      return [python()];
    case "css":
      return [css()];
    case "html":
    case "xml":
      return [html()];
    case "json":
      return [json()];
    case "markdown":
      return [markdown()];
    case "yaml":
      return [yaml()];
    case "sql":
      return [sql()];
    default:
      return [];
  }
}

export function CodeMirrorEditor({
  value,
  onChange,
  language,
}: {
  value: string;
  onChange: (v: string) => void;
  language: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  // Keep onChange ref fresh without recreating the editor
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Create the editor once per language change
  useEffect(() => {
    if (!parentRef.current) return;
    const langExts = getLanguageExtension(language);
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        ...langExts,
        claudeTheme,
        updateListener,
        EditorView.lineWrapping,
      ],
    });
    const view = new EditorView({ state, parent: parentRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate editor when language changes (extensions differ).
    // value is intentionally NOT a dep — we handle external value changes
    // via the separate effect below.
  }, [language]);

  // Sync external value changes into the editor (e.g. when switching tabs,
  // or when the AI modifies the file). We only dispatch if the content
  // actually differs to avoid clobbering the cursor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return <div ref={parentRef} className="h-full overflow-hidden" />;
}
