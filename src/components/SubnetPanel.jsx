import React, { useState } from 'react';
import { subnetUsage } from '../addressing.js';
import { impactEditSubnet } from '../validation.js';

// 网段属性：调整 CIDR / 网关 / VLAN 前展示影响面，应用后整表校验，拒绝则保留原值
export default function SubnetPanel({ plan, subnet, node, onCommitSubnet, onRemoveSubnet, onBack }) {
  const [draft, setDraft] = useState({ name: subnet.name, cidr: subnet.cidr, gateway: subnet.gateway, vlan: subnet.vlan });
  const [errors, setErrors] = useState([]);
  const [impact, setImpact] = useState(null);

  const usage = subnetUsage(plan, subnet);
  const dirty =
    draft.name !== subnet.name ||
    draft.cidr !== subnet.cidr ||
    draft.gateway !== subnet.gateway ||
    String(draft.vlan) !== String(subnet.vlan);

  const evaluate = () => {
    const patch = {
      name: draft.name.trim() || subnet.name,
      cidr: draft.cidr.trim(),
      gateway: draft.gateway.trim(),
      vlan: draft.vlan === '' ? '' : Number(draft.vlan),
    };
    // 先由主流程校验，失败则展示规则错误；成功才进入影响面确认
    const res = onCommitSubnet(subnet.id, patch, { dryRun: true });
    if (!res.ok) {
      setErrors(res.errors);
      setImpact(null);
      return;
    }
    setErrors([]);
    setImpact(impactEditSubnet(plan, subnet.id, patch));
  };

  const apply = () => {
    const patch = {
      name: draft.name.trim() || subnet.name,
      cidr: draft.cidr.trim(),
      gateway: draft.gateway.trim(),
      vlan: draft.vlan === '' ? '' : Number(draft.vlan),
    };
    const res = onCommitSubnet(subnet.id, patch);
    if (res.ok) {
      setErrors([]);
      setImpact(null);
    } else {
      setErrors(res.errors);
    }
  };

  const revert = () => {
    setDraft({ name: subnet.name, cidr: subnet.cidr, gateway: subnet.gateway, vlan: subnet.vlan });
    setErrors([]);
    setImpact(null);
  };

  return (
    <>
      <button className="back-link" onClick={onBack}>‹ 返回设备属性{node ? `（${node.name}）` : ''}</button>

      <label>
        网段名称
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onBlur={() => draft.name !== subnet.name && applyName()} />
      </label>
      <label className={errors.some((x) => x.scope === 'subnet' && (x.code.startsWith('CIDR') || x.code.startsWith('SUBNET'))) ? 'field-bad' : ''}>
        网段 CIDR
        <input value={draft.cidr} placeholder="10.0.3.0/24" onChange={(e) => { setDraft({ ...draft, cidr: e.target.value }); setErrors([]); }} />
      </label>
      <label className={errors.some((x) => x.code.startsWith('GATEWAY')) ? 'field-bad' : ''}>
        网关地址
        <input value={draft.gateway} placeholder="10.0.3.1" onChange={(e) => { setDraft({ ...draft, gateway: e.target.value }); setErrors([]); }} />
      </label>
      <label className={errors.some((x) => x.code.startsWith('VLAN')) ? 'field-bad' : ''}>
        VLAN（1-4094）
        <input type="number" min="1" max="4094" value={draft.vlan} onChange={(e) => { setDraft({ ...draft, vlan: e.target.value }); setErrors([]); }} />
      </label>

      <div className="addr-readout">
        <div><small>可用地址</small><strong className={usage.free === 0 ? 'zero' : ''}>{usage.free}/{usage.count}</strong></div>
        <div><small>设备</small><strong>{usage.nodes.length} 台</strong></div>
        <div><small>占用率</small><strong>{usage.count ? Math.round((usage.used / usage.count) * 100) : 0}%</strong></div>
      </div>

      {errors.length > 0 && (
        <div className="reject-box">
          {errors.map((er, i) => <p key={i}>✕ {er.message}</p>)}
          <div className="reject-actions">
            <button className="mini-btn" onClick={evaluate}>重试</button>
            <button className="mini-btn" onClick={revert}>保留原值</button>
          </div>
        </div>
      )}

      {dirty && errors.length === 0 && !impact && (
        <div className="draft-actions">
          <button className="mini-btn primary" onClick={evaluate}>检查影响并应用</button>
          <button className="mini-btn" onClick={revert}>还原</button>
        </div>
      )}

      {impact && (
        <div className="impact-box">
          <strong>变更影响面</strong>
          {impact.lines.map((l, i) => <p key={i}>{l}</p>)}
          <div className="reject-actions">
            <button className="mini-btn primary" onClick={apply}>确认应用</button>
            <button className="mini-btn" onClick={() => setImpact(null)}>返回修改</button>
            <button className="mini-btn" onClick={revert}>保留原值</button>
          </div>
        </div>
      )}

      <div className="inspector-actions">
        <button className="danger" onClick={() => onRemoveSubnet(subnet.id)}>删除网段</button>
      </div>

      <div className="connections">
        <div className="section-title"><span>网段内设备</span><small>{usage.nodes.length} 台</small></div>
        {usage.nodes.map(({ node: n, inRange, usable }) => (
          <div className="connection" key={n.id}>
            <span className={`mini ${n.type}`}></span>
            <strong>{n.name}</strong>
            <small className={!inRange ? 'txt-bad' : ''}>{n.ip}{!inRange ? ' 越界' : !usable ? ' 网关' : ''}</small>
          </div>
        ))}
        {usage.nodes.length === 0 && <p className="empty-hint">网段内没有设备</p>}
      </div>
    </>
  );

  function applyName() {
    const name = draft.name.trim() || subnet.name;
    onCommitSubnet(subnet.id, { name });
  }
}
