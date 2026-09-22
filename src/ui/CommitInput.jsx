import React, { useEffect, useState } from 'react';

// 提交式输入框：失焦或回车时提交；onCommit 返回 false 表示校验未通过，恢复原值。
export default function CommitInput({ value, onCommit, placeholder, mono }) {
  const [draft, setDraft] = useState(value ?? '');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    if (String(draft) === String(value ?? '')) return;
    const ok = onCommit(String(draft).trim());
    if (ok === false) setDraft(value ?? '');
  };
  return (
    <input
      className={mono ? 'mono' : ''}
      value={draft}
      placeholder={placeholder}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value ?? '');
          e.currentTarget.blur();
        }
      }}
    />
  );
}
