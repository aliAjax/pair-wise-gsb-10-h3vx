import React, { useState } from 'react';
import { DEVICE_TYPES, cidrContainsIp, findSubnet, nextFreeIp } from '../addressing.js';

// 设备属性：名称即时保存；网段与 IP 走“应用 -> 校验 -> 通过才落库，否则拒绝并保留原值”
function DraftForm({ plan, node, onCommitNode, onRemove, onToggleRouted }) {
  const [draft, setDraft] = useState({ subnetId: node.subnetId, ip: node.ip });
  const [errors, setErrors] = useState([]);

  const subnet = findSubnet(plan, node.subnetId);
  const draftSubnet = findSubnet(plan, draft.subnetId);

  const changeSubnet = (subnetId) => {
    // 切换网段时，若当前草稿 IP 不在新网段内，自动建议新网段的下一个空闲地址
    let ip = draft.ip;
    if (!ip || !cidrContainsIp(findSubnet(plan, subnetId)?.cidr || '', ip)) {
      ip = nextFreeIp(plan, findSubnet(plan, subnetId));
    }
    setDraft({ subnetId, ip });
    setErrors([]);
  };

  const apply = () => {
    const res = onCommitNode(node.id, { subnetId: draft.subnetId, ip: draft.ip.trim() });
    if (res.ok) setErrors([]);
    else setErrors(res.errors);
    return res.ok;
  };

  const revert = () => {
    setDraft({ subnetId: node.subnetId, ip: node.ip });
    setErrors([]);
  };

  const dirty = draft.subnetId !== node.subnetId || draft.ip.trim() !== node.ip;
  const connections = plan.edges.filter((e) => e.a === node.id || e.b === node.id);

  return (
    <>
      <label>
        设备名称
        <input value={node.name} onChange={(e) => onCommitNode(node.id, { name: e.target.value })} />
      </label>

      <label>
        设备类型
        <select value={node.type} onChange={(e) => onCommitNode(node.id, { type: e.target.value })}>
          {DEVICE_TYPES.map(({ type, label }) => <option key={type} value={type}>{label}</option>)}
        </select>
      </label>

      <label>
        所属网段（登记 VLAN 与网关）
        <select value={draft.subnetId} onChange={(e) => changeSubnet(e.target.value)}>
          {plan.subnets.map((s) => <option key={s.id} value={s.id}>{s.name}（{s.cidr} / VLAN {s.vlan}）</option>)}
        </select>
      </label>

      <label className={errors.some((x) => x.code === 'IP_OUT_OF_RANGE' || x.code === 'IP_INVALID' || x.code === 'IP_DUPLICATE' || x.code === 'IP_RESERVED') ? 'field-bad' : ''}>
        IP 地址
        <input
          value={draft.ip}
          placeholder="例：10.0.1.31"
          onChange={(e) => { setDraft({ ...draft, ip: e.target.value }); setErrors([]); }}
          onBlur={() => dirty && apply()}
          onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
        />
      </label>

      <div className="addr-readout">
        <div><small>网关</small><strong>{draftSubnet?.gateway || '—'}</strong></div>
        <div><small>VLAN</small><strong>{draftSubnet?.vlan ?? '—'}</strong></div>
        <div><small>CIDR</small><strong>{draftSubnet?.cidr || '—'}</strong></div>
      </div>

      {errors.length > 0 && (
        <div className="reject-box">
          {errors.map((er, i) => <p key={i}>✕ {er.message}</p>)}
          <div className="reject-actions">
            <button className="mini-btn" onClick={apply}>重试</button>
            <button className="mini-btn" onClick={revert}>还原为原值</button>
          </div>
        </div>
      )}

      {dirty && errors.length === 0 && (
        <div className="draft-actions">
          <button className="mini-btn primary" onClick={apply}>应用地址变更</button>
          <button className="mini-btn" onClick={revert}>还原</button>
        </div>
      )}

      <div className="inspector-actions">
        <button className="danger" onClick={onRemove}>删除设备</button>
      </div>

      <div className="connections">
        <div className="section-title">
          <span>连接</span>
          <small>{connections.length} 条</small>
        </div>
        {connections.map((e) => {
          const peer = plan.nodes.find((n) => n.id === (e.a === node.id ? e.b : e.a));
          const cross = peer && peer.subnetId !== node.subnetId;
          return (
            <div className="connection" key={e.id}>
              <span className={`mini ${peer?.type}`}></span>
              <strong>{peer?.name}</strong>
              {cross ? (
                <label className="route-check" title="跨网段连线必须标明路由">
                  <input
                    type="checkbox"
                    checked={!!e.routed}
                    onChange={() => onToggleRouted(e.id)}
                  />
                  路由
                </label>
              ) : (
                <small>同网段</small>
              )}
            </div>
          );
        })}
        {connections.length === 0 && <p className="empty-hint">暂无连线，使用工具条「连线」</p>}
      </div>
    </>
  );
}

export default function NodeInspector(props) {
  const { node } = props;
  if (!node) return <p className="empty-hint">选择一个设备</p>;
  // 已落库的值变化后重建草稿，保证“拒绝时保留原值”
  return <DraftForm key={`${node.id}|${node.subnetId}|${node.ip}|${node.name}|${node.type}`} {...props} />;
}
