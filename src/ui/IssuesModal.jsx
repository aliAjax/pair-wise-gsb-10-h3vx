import React from 'react';
import { RULE_TEXT } from '../addressing/validation.js';

// 校验结果弹窗：列出全部未通过项（检查按钮与导出拦截共用）。
export default function IssuesModal({ issues, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>校验结果</h3>
        <p className="dialog-intro">共 {issues.length} 项问题，全部修复后才能导出。</p>
        <div className="issues-list">
          {issues.map((is, i) => (
            <div className="issue-row" key={i}>
              <span>{is.message}</span>
              <small>{RULE_TEXT[is.rule] || is.rule}</small>
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="save" onClick={onClose}>知道了</button>
        </div>
      </div>
    </div>
  );
}
