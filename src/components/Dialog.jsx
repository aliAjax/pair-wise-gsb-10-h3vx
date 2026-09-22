import React from 'react';

// 通用模态：影响面确认、校验结果等共用
export default function Dialog({ title, tone = 'default', onClose, children, footer }) {
  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className={`modal ${tone}`} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <strong>{title}</strong>
          <button className="modal-x" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
