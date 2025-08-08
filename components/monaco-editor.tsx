"use client"

import { useEffect, useRef } from "react"
import Editor, { type OnChange, type OnMount } from "@monaco-editor/react"

export default function MonacoEditor({
  value,
  onChange,
  language = "javascript",
}: {
  value: string
  onChange: (v: string) => void
  language?: string
}) {
  const editorRef = useRef<any>(null)

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    editor.updateOptions({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 14,
      minimap: { enabled: false },
      lineNumbers: "on",
      automaticLayout: true,
      scrollbar: { vertical: "auto" },
      cursorBlinking: "smooth",
      smoothScrolling: true,
      theme: "vs", // black-white aesthetic
    })
  }

  const handleChange: OnChange = (val) => {
    onChange(val || "")
  }

  useEffect(() => {
    return () => {
      editorRef.current = null
    }
  }, [])

  return (
    <Editor
      height="100%"
      defaultLanguage={language}
      value={value}
      onMount={handleMount}
      onChange={handleChange}
      options={{
        wordWrap: "on",
        renderWhitespace: "none",
        renderLineHighlight: "all",
      }}
    />
  )
}
