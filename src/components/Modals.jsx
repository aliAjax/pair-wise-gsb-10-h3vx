import React from 'react';
import Dialog from './Dialog.jsx';

// 删除/调整前的影响面确认
export function ImpactDialog({ impact, onConfirm, onCancel }) {
  if (!impact) return null;
  const title =
    impact.kind === 'remove-node' ? '删除设备影响面'
    : impact.kind === 'remove-subnet' ? '删除网段影响面'
    : '调整网段影响面';
  const tone = impact.kind === 'edit-subnet' ? 'warn' : 'danger';
  return (
    <Dialog
      title={title}
      tone={tone}
      onClose={onCancel}
      footer={
        <>
          <button className="mini-btn" onClick={onCancel}>取消，保留原值</button>
          <button className="mini-btn danger" onClick={onConfirm}>确认{impact.kind === 'edit-subnet' ? '应用变更' : '删除'}</button>
        </>
      }
    >
      <ul className="impact-list">
        {impact.lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
      {impact.kind !== 'edit-subnet' && <p className="modal-note">此操作不可撤销，请确认以上设备与连线均可移除。</p>}
    </Dialog>
  );
}

// 整表校验结果
export function IssuesDialog({ issues, onClose }) {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  return (
    <Dialog
      title="规划校验结果"
      tone={errors.length ? 'danger' : warnings.length ? 'warn' : 'ok'}
      onClose={onClose}
      footer={<button className="mini-btn primary" onClick={onClose}>知道了</button>}
    >
      {errors.length === 0 && warnings.length === 0 && (
        <p className="modal-ok">✓ 全部规则通过：网段、IP、网关、VLAN 与跨网段路由均无冲突。</p>
      )}
      {errors.length > 0 && (
        <div className="issue-group">
          <strong className="err">错误（{errors.length}）— 这些内容不会进入导出</strong>
          <ul>{errors.map((i, k) => <li key={k} className="err">{i.message}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="issue-group">
          <strong className="warn">提示（{warnings.length}）</strong>
          <ul>{warnings.map((i, k) => <li key={k} className="warn">{i.message}</li>)}</ul>
        </div>
      )}
    </Dialog>
  );
}

// 跨网段连线确认：必须勾选“标明路由”才允许建立
export function ConnectDialog({ plan, req, onConfirm, onCancel }) {
  const a = plan.nodes.find((n) => n.id === req.a);
  const b = plan.nodes.find((n) => n.id === req.b);
  const sa = plan.subnets.find((s) => s.id === a.subnetId);
  const sb = plan.subnets.find((s) => s.id === b.subnetId);
  const [routed, setRouted] = React.useState(false);
  return (
    <Dialog
      title="跨网段连线"
      tone="warn"
      onClose={onCancel}
      footer={
        <>
          <button className="mini-btn" onClick={onCancel}>取消</button>
          <button className={`mini-btn primary ${routed ? '' : 'disabled'}`} disabled={!routed} onClick={() => onConfirm(true)}>
            标明路由并连接
          </button>
        </>
      }
    >
      <p className="modal-note">
        「{a.name}」({sa?.name} {sa?.cidr}) 与「{b.name}」({sb?.name} {sb?.cidr}) 不在同一网段。
      </p>
      <p className="modal-note">跨网段连线必须标明路由，否则该连线将被规则拒绝。</p>
      <label className="confirm-check">
        <input type="checkbox" checked={routed} onChange={(e) => setRouted(e.target.checked)} />
        该连线经过三层路由（R）
      </label>
    </Dialog>
  );
}

// 导出预览：仅校验通过的内容会被写出
export function ExportDialog({ exportData, onConfirm, onCancel }) {
  const { payload, omitted, fullyValid } = exportData;
  return (
    <Dialog
      title="导出预览（仅写出校验通过内容）"
      tone={fullyValid ? 'ok' : 'warn'}
      onClose={onCancel}
      footer={
        <>
          <button className="mini-btn" onClick={onCancel}>取消</button>
          <button className="mini-btn primary" onClick={onConfirm}>下载 JSON</button>
        </>
      }
    >
      <div className="export-summary">
        <span>网段 <b>{payload.summary.subnets}</b></span>
        <span>设备 <b>{payload.summary.devices}</b></span>
        <span>连线 <b>{payload.summary.links}</b></span>
      </div>
      {fullyValid ? (
        <p className="modal-ok">✓ 全部内容校验通过，将完整导出。</p>
      ) : (
        <div className="issue-group">
          <strong className="warn">以下 {omitted.length} 项未通过校验，将不会写入文件：</strong>
          <ul>
            {omitted.map((o, i) => (
              <li key={i} className="warn">[{o.kind === 'edge' ? '连线' : '设备'}] {o.name}：{o.reasons.join('；')}</li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
